import os
import shutil
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import Depends, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

import models
import schemas
from database import engine, get_db
from services.deduplicator import AccountDeduplicator
from services.ocr_engine import PortfolioOCREngine
from services.portfolio_engine import PortfolioAggregator, account_currency
from services import history_engine, target_engine, taxonomy
from services.quote_service import (fetch_live_prices_batch, fetch_sector,
                                   fetch_sectors_batch, fetch_usd_to_inr_rate)
from services.symbols import guess_market, normalize_symbol

models.Base.metadata.create_all(bind=engine)

SCREENSHOTS_DIR = os.path.join(os.path.dirname(__file__), "screenshots")
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

app = FastAPI(
    title="Multi-Broker Stock Portfolio Manager & Rebalancer",
    description="OCR holdings ingestion, live quotes, portfolio aggregation and rebalancing.",
    version="3.1.0",
)

# Local-only app: the frontend is served from this same origin in production
# and from the Vite dev server otherwise.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", "http://127.0.0.1:3000",
        "http://localhost:8080", "http://127.0.0.1:8080",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _price_quotes(accounts: List[models.Account],
                  holdings: List[models.Holding]) -> Tuple[Dict[Tuple[str, str], float], float]:
    """Fetches live quotes for every holding, plus the current USD->INR rate.

    Quotes are keyed by (symbol, country) so the same ticker in two markets
    resolves to two different prices.
    """
    account_map = {acc.id: acc for acc in accounts}
    pairs = {
        (h.symbol.strip().upper(),
         "US" if account_currency(account_map.get(h.account_id)) == "USD" else "IND")
        for h in holdings if h.symbol
    }
    return fetch_live_prices_batch(pairs), fetch_usd_to_inr_rate()


# ─────────────────────────────────────────────────────────────
# ACCOUNT MANAGEMENT
# ─────────────────────────────────────────────────────────────

@app.get("/api/accounts", response_model=List[schemas.AccountResponse])
def get_accounts(db: Session = Depends(get_db)):
    return db.query(models.Account).all()


@app.post("/api/accounts", response_model=schemas.AccountResponse)
def create_account(account: schemas.AccountCreate, db: Session = Depends(get_db)):
    new_acc = models.Account(
        name=account.name,
        currency_type=account.currency_type or "IND",
        wallet_balance=account.wallet_balance or 0.0,
    )
    db.add(new_acc)
    db.commit()
    db.refresh(new_acc)
    return new_acc


@app.put("/api/accounts/{account_id}", response_model=schemas.AccountResponse)
def update_account(account_id: str, update_data: schemas.AccountUpdate, db: Session = Depends(get_db)):
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")

    if update_data.name is not None:
        acc.name = update_data.name
    if update_data.currency_type is not None:
        acc.currency_type = update_data.currency_type
    if update_data.wallet_balance is not None:
        acc.wallet_balance = update_data.wallet_balance

    db.commit()
    db.refresh(acc)
    return acc


@app.delete("/api/accounts/{account_id}")
def delete_account(account_id: str, db: Session = Depends(get_db)):
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")

    db.query(models.SyncLog).filter(models.SyncLog.account_id == account_id).delete()
    # Holdings and portfolio links cascade off the ORM delete.
    db.delete(acc)
    db.commit()

    shutil.rmtree(os.path.join(SCREENSHOTS_DIR, account_id), ignore_errors=True)
    return {"message": "Account deleted successfully"}


def _resolve_sectors(db: Session, holdings: List[models.Holding]) -> Dict[Tuple[str, str], Dict[str, str]]:
    """Sector and section per (symbol, country), filling in defaults once.

    Classification is user-owned: anything already stored is returned as-is and
    never overwritten. Only unclassified holdings get a scraped-and-mapped
    default, which is then persisted so the scrape happens once ever.
    """
    unclassified = [h for h in holdings if not h.sector]
    if unclassified:
        scraped = fetch_sectors_batch(
            (h.symbol, h.country or "IND") for h in unclassified
        )
        for h in unclassified:
            country = h.country or "IND"
            raw = scraped.get((h.symbol.strip().upper(), country), "")
            h.sector = taxonomy.default_sector(h.symbol, country, raw)
            if not h.section:
                h.section = taxonomy.default_section(h.symbol)
        db.commit()

    # Backfill section for rows classified before sections existed.
    missing_section = [h for h in holdings if not h.section]
    if missing_section:
        for h in missing_section:
            h.section = taxonomy.default_section(h.symbol)
        db.commit()

    return {
        (h.symbol.strip().upper(), h.country or "IND"): {
            "sector": h.sector or taxonomy.DEFAULT_SECTOR,
            "section": h.section or taxonomy.DEFAULT_SECTION,
        }
        for h in holdings
    }


@app.get("/api/accounts/{account_id}/screenshot")
def get_account_screenshot(account_id: str, db: Session = Depends(get_db)):
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not acc or not acc.latest_screenshot_path or not os.path.exists(acc.latest_screenshot_path):
        raise HTTPException(status_code=404, detail="No screenshot found for this account")
    return FileResponse(acc.latest_screenshot_path, media_type="image/png")


@app.get("/api/accounts/{account_id}/detail")
def get_account_detail(account_id: str, db: Session = Depends(get_db)):
    """Single-account view, reported in the account's own currency.

    US accounts additionally carry `_inr` fields so the UI can show both.
    """
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")

    holdings = db.query(models.Holding).filter(models.Holding.account_id == account_id).all()
    live_prices, usd_inr_rate = _price_quotes([acc], holdings)

    is_us = acc.currency_type == "US"
    country = "US" if is_us else "IND"
    sectors = _resolve_sectors(db, holdings)

    items: List[Dict[str, Any]] = []
    total_invested = 0.0
    total_current = 0.0

    for h in holdings:
        price = live_prices.get((h.symbol.strip().upper(), country), 0.0)
        if price <= 0:
            price = h.current_price or h.avg_buy_price or 0.0

        invested = round(h.quantity * h.avg_buy_price, 2)
        current = round(h.quantity * price, 2)
        pnl = round(current - invested, 2)
        total_invested += invested
        total_current += current

        item = {
            "id": h.id,
            "symbol": h.symbol,
            "company_name": h.company_name,
            "sector": sectors.get((h.symbol.strip().upper(), country), {}).get("sector", ""),
            "section": sectors.get((h.symbol.strip().upper(), country), {}).get("section", ""),
            "quantity": round(h.quantity, 4),
            "avg_buy_price": round(h.avg_buy_price, 2),
            "live_current_price": round(price, 2),
            "invested_value": invested,
            "current_value": current,
            "pnl": pnl,
            "pnl_percent": round(pnl / invested * 100, 2) if invested > 0 else 0.0,
        }
        if is_us:
            item.update({
                "invested_value_inr": round(invested * usd_inr_rate, 2),
                "current_value_inr": round(current * usd_inr_rate, 2),
                "pnl_inr": round(pnl * usd_inr_rate, 2),
            })
        items.append(item)

    items.sort(key=lambda i: i["current_value"], reverse=True)

    total_pnl = round(total_current - total_invested, 2)
    wallet = acc.wallet_balance or 0.0

    summary = {
        "invested_value": round(total_invested, 2),
        "current_value": round(total_current, 2),
        "holding_count": len(items),
        "pnl": total_pnl,
        "pnl_percent": round(total_pnl / total_invested * 100, 2) if total_invested > 0 else 0.0,
        "currency_type": acc.currency_type,
        "currency_symbol": "$" if is_us else "₹",
        "wallet_balance": round(wallet, 2),
    }
    if is_us:
        summary.update({
            "usd_to_inr_rate": usd_inr_rate,
            "invested_value_inr": round(total_invested * usd_inr_rate, 2),
            "current_value_inr": round(total_current * usd_inr_rate, 2),
            "pnl_inr": round(total_pnl * usd_inr_rate, 2),
            "wallet_balance_inr": round(wallet * usd_inr_rate, 2),
        })

    return {
        "account_id": acc.id,
        "account_name": acc.name,
        "currency_type": acc.currency_type,
        "wallet_balance": round(wallet, 2),
        "has_screenshot": bool(acc.latest_screenshot_path
                               and os.path.exists(acc.latest_screenshot_path)),
        "last_synced_at": acc.last_synced_at,
        "summary": summary,
        "items": items,
    }


# ─────────────────────────────────────────────────────────────
# OCR UPLOAD & VERIFICATION
# ─────────────────────────────────────────────────────────────

@app.post("/api/upload-ocr-images")
async def upload_ocr_images(
    files: List[UploadFile] = File(...),
    account_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    if not files:
        raise HTTPException(status_code=400, detail="No screenshot files provided")

    parsed_holdings = []
    last_screenshot: Optional[bytes] = None
    last_extension = ".png"

    for file in files:
        contents = await file.read()
        last_screenshot = contents
        last_extension = os.path.splitext(file.filename or "screenshot.png")[1] or ".png"
        parsed_holdings.extend(PortfolioOCREngine.process_image(contents))

    if account_id and last_screenshot:
        acc = db.query(models.Account).filter(models.Account.id == account_id).first()
        if acc:
            acc_dir = os.path.join(SCREENSHOTS_DIR, account_id)
            os.makedirs(acc_dir, exist_ok=True)
            save_path = os.path.join(acc_dir, f"latest{last_extension}")
            with open(save_path, "wb") as f:
                f.write(last_screenshot)
            acc.latest_screenshot_path = save_path
            db.commit()

    if not parsed_holdings:
        return {
            "account_id": account_id,
            "holdings": [],
            "warnings": ["No stock holdings detected in the uploaded screenshot(s)."],
        }

    return {
        "account_id": account_id,
        "holdings": AccountDeduplicator.deduplicate_holdings(parsed_holdings),
        "warnings": [],
    }


@app.post("/api/verify-save-holdings")
def verify_and_save_holdings(
    request: schemas.VerifySaveRequest,
    strategy: str = Query("MERGE"),
    db: Session = Depends(get_db),
):
    account = db.query(models.Account).filter(models.Account.id == request.account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Target account not found")

    is_us = account.currency_type == "US"
    country = "US" if is_us else "IND"
    currency = "USD" if is_us else "INR"

    existing = [
        {
            "id": h.id, "symbol": h.symbol, "company_name": h.company_name,
            "quantity": h.quantity, "avg_buy_price": h.avg_buy_price,
            "current_price": h.current_price,
        }
        for h in db.query(models.Holding).filter(models.Holding.account_id == account.id).all()
    ]

    final_holdings, warnings = AccountDeduplicator.process_deduplication(
        existing_holdings=existing,
        incoming_holdings=[h.dict() for h in request.holdings],
        strategy=strategy,
    )

    db.query(models.Holding).filter(models.Holding.account_id == account.id).delete()
    for h in final_holdings:
        db.add(models.Holding(
            account_id=account.id,
            symbol=h["symbol"],
            company_name=h.get("company_name") or h["symbol"],
            quantity=h["quantity"],
            avg_buy_price=h["avg_buy_price"],
            current_price=h.get("current_price") or 0.0,
            country=country,
            currency=currency,
            is_user_verified=1,
        ))

    account.last_synced_at = _utcnow()
    db.add(models.SyncLog(
        account_id=account.id, status="SUCCESS", holdings_count=len(final_holdings)
    ))
    db.commit()

    return {
        "message": "Holdings saved successfully",
        "count": len(final_holdings),
        "warnings": warnings,
    }


# ─────────────────────────────────────────────────────────────
# NAMED PORTFOLIOS
# ─────────────────────────────────────────────────────────────

@app.get("/api/portfolios")
def list_portfolios(db: Session = Depends(get_db)):
    result = []
    for p in db.query(models.Portfolio).all():
        accounts = [link.account for link in p.account_links if link.account]
        result.append({
            "id": p.id,
            "name": p.name,
            "created_at": p.created_at,
            "account_ids": [a.id for a in accounts],
            "account_names": [a.name for a in accounts],
            "account_count": len(accounts),
        })
    return result


def _replace_portfolio_accounts(db: Session, portfolio_id: str, account_ids: List[str]) -> None:
    db.query(models.PortfolioAccount).filter(
        models.PortfolioAccount.portfolio_id == portfolio_id
    ).delete()
    known = {
        a.id for a in db.query(models.Account).filter(models.Account.id.in_(account_ids)).all()
    }
    for acc_id in dict.fromkeys(account_ids):  # de-duplicate, keep order
        if acc_id in known:
            db.add(models.PortfolioAccount(portfolio_id=portfolio_id, account_id=acc_id))


@app.post("/api/portfolios")
def create_portfolio(payload: schemas.PortfolioCreate, db: Session = Depends(get_db)):
    if db.query(models.Portfolio).filter(models.Portfolio.name == payload.name).first():
        raise HTTPException(status_code=400, detail=f"Portfolio '{payload.name}' already exists")

    portfolio = models.Portfolio(name=payload.name)
    db.add(portfolio)
    db.flush()
    _replace_portfolio_accounts(db, portfolio.id, payload.account_ids)
    db.commit()
    db.refresh(portfolio)
    return {"id": portfolio.id, "name": portfolio.name, "created_at": portfolio.created_at}


@app.put("/api/portfolios/{portfolio_id}")
def update_portfolio(portfolio_id: str, payload: schemas.PortfolioCreate, db: Session = Depends(get_db)):
    portfolio = db.query(models.Portfolio).filter(models.Portfolio.id == portfolio_id).first()
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    clash = db.query(models.Portfolio).filter(
        models.Portfolio.name == payload.name, models.Portfolio.id != portfolio_id
    ).first()
    if clash:
        raise HTTPException(status_code=400, detail=f"Portfolio '{payload.name}' already exists")

    portfolio.name = payload.name
    _replace_portfolio_accounts(db, portfolio_id, payload.account_ids)
    db.commit()
    db.refresh(portfolio)
    return {"id": portfolio.id, "name": portfolio.name}


@app.delete("/api/portfolios/{portfolio_id}")
def delete_portfolio(portfolio_id: str, db: Session = Depends(get_db)):
    portfolio = db.query(models.Portfolio).filter(models.Portfolio.id == portfolio_id).first()
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    db.delete(portfolio)
    db.commit()
    return {"message": "Portfolio deleted"}


def _split(a: float, b: float) -> str:
    """'62% : 38%' — the same pair as a percentage split."""
    total = a + b
    if total <= 0:
        return "—"
    return f"{a / total * 100:.0f}% : {b / total * 100:.0f}%"


@app.get("/api/portfolios/{portfolio_id}/detail")
def get_portfolio_detail(portfolio_id: str, db: Session = Depends(get_db)):
    """Cross-account view of one named portfolio. Every value is in INR."""
    portfolio = db.query(models.Portfolio).filter(models.Portfolio.id == portfolio_id).first()
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    accounts = [link.account for link in portfolio.account_links if link.account]
    account_ids = [a.id for a in accounts]
    holdings = (
        db.query(models.Holding).filter(models.Holding.account_id.in_(account_ids)).all()
        if account_ids else []
    )

    live_prices, usd_inr_rate = _price_quotes(accounts, holdings)
    aggregated = PortfolioAggregator.aggregate_holdings(
        accounts, holdings, live_prices, usd_inr_rate
    )

    sectors = _resolve_sectors(db, holdings)

    rows = []
    for item in aggregated["items"]:
        # Collapse the per-holding breakdown into one entry per account.
        per_account: Dict[str, Dict[str, float]] = {}
        for entry in item["accounts_breakdown"]:
            acc_id = entry["account_id"]
            bucket = per_account.setdefault(acc_id, {"qty": 0.0, "_cost_inr": 0.0, "_cost_native": 0.0})
            bucket["qty"] += entry["quantity"]
            bucket["_cost_inr"] += entry["quantity"] * entry["avg_buy_price_inr"]
            bucket["_cost_native"] += entry["quantity"] * entry["avg_buy_price"]

        for bucket in per_account.values():
            qty = bucket.pop("qty")
            cost_inr = bucket.pop("_cost_inr")
            cost_native = bucket.pop("_cost_native")
            bucket["qty"] = round(qty, 4)
            bucket["avg_inr"] = round(cost_inr / qty, 2) if qty > 0 else 0.0
            bucket["avg_native"] = round(cost_native / qty, 2) if qty > 0 else 0.0

        klass = sectors.get((item["symbol"].strip().upper(), item["country"]), {})
        rows.append({
            "symbol": item["symbol"],
            "company_name": item["company_name"],
            "country": item["country"],
            "currency": item["currency"],
            "sector": klass.get("sector", ""),
            "section": klass.get("section", ""),
            "per_account": per_account,
            "mkt_price_inr": item["current_price_inr"],
            "portfolio_qty": item["total_quantity"],
            "portfolio_avg_inr": item["wacp_inr"],
            "invested_value_inr": item["total_invested_inr"],
            "current_value_inr": item["current_value_inr"],
            "pnl_inr": item["pnl_inr"],
            "pnl_percent": item["pnl_percent"],
            "allocation_percent": item["allocation_percent"],
        })

    total_wallet_inr = sum(
        (a.wallet_balance or 0.0) * (usd_inr_rate if a.currency_type == "US" else 1.0)
        for a in accounts
    )
    summary = aggregated["summary"]

    invested = summary["total_invested_inr"]
    current = summary["current_value_inr"]

    def ratio(a: float, b: float) -> str:
        """Normalised 'X : 1' so the split is readable at a glance."""
        if b <= 0:
            return "—" if a <= 0 else "100% : 0%"
        return f"{a / b:.2f} : 1"

    invested_to_cash_ratio = ratio(invested, total_wallet_inr)

    # US to IND ratio: separate holdings by country
    us_current = sum(r["current_value_inr"] for r in rows if r["country"] == "US")
    us_wallet = sum(
        (a.wallet_balance or 0.0) * usd_inr_rate
        for a in accounts if a.currency_type == "US"
    )
    us_total = us_current + us_wallet

    ind_current = sum(r["current_value_inr"] for r in rows if r["country"] == "IND")
    ind_wallet = sum(
        (a.wallet_balance or 0.0)
        for a in accounts if a.currency_type == "IND"
    )
    ind_total = ind_current + ind_wallet

    us_to_ind_ratio = ratio(us_total, ind_total)

    # Separate metrics for US and IND
    us_invested = sum(r["invested_value_inr"] for r in rows if r["country"] == "US")
    us_pnl = us_current - us_invested
    us_pnl_pct = (us_pnl / us_invested * 100) if us_invested > 0 else 0.0

    ind_invested = sum(r["invested_value_inr"] for r in rows if r["country"] == "IND")
    ind_pnl = ind_current - ind_invested
    ind_pnl_pct = (ind_pnl / ind_invested * 100) if ind_invested > 0 else 0.0

    return {
        "portfolio_id": portfolio.id,
        "portfolio_name": portfolio.name,
        "usd_inr_rate": usd_inr_rate,
        "accounts": [
            {"id": a.id, "name": a.name, "currency_type": a.currency_type} for a in accounts
        ],
        "summary": {
            "total_invested_inr": invested,
            "total_current_inr": current,
            "total_pnl_inr": summary["total_pnl_inr"],
            "total_pnl_percent": summary["total_pnl_percent"],
            "total_wallet_inr": round(total_wallet_inr, 2),
            "total_stocks": summary["total_stocks_count"],
            "invested_to_cash_ratio": invested_to_cash_ratio,
            "invested_to_cash_split": _split(invested, total_wallet_inr),
            "us_to_ind_ratio": us_to_ind_ratio,
            "us_to_ind_split": _split(us_total, ind_total),
            "us_total_inr": round(us_total, 2),
            "ind_total_inr": round(ind_total, 2),
            "us_metrics": {
                "invested": us_invested,
                "current": us_current,
                "pnl": us_pnl,
                "pnl_percent": round(us_pnl_pct, 2),
                "wallet": us_wallet,
            },
            "ind_metrics": {
                "invested": ind_invested,
                "current": ind_current,
                "pnl": ind_pnl,
                "pnl_percent": round(ind_pnl_pct, 2),
                "wallet": ind_wallet,
            },
        },
        "rows": rows,
    }


# ─────────────────────────────────────────────────────────────
# CLASSIFICATION (sector / section)
# ─────────────────────────────────────────────────────────────

@app.get("/api/classification")
def get_classification(db: Session = Depends(get_db)):
    """One row per distinct symbol: held positions plus watch-list stocks."""
    holdings = db.query(models.Holding).all()
    _resolve_sectors(db, holdings)

    accounts = {a.id: a.name for a in db.query(models.Account).all()}

    by_symbol: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for h in holdings:
        key = (h.symbol.strip().upper(), h.country or "IND")
        row = by_symbol.get(key)
        if row is None:
            row = by_symbol[key] = {
                "symbol": key[0],
                "company_name": h.company_name,
                "country": key[1],
                "sector": h.sector or taxonomy.DEFAULT_SECTOR,
                "section": h.section or taxonomy.DEFAULT_SECTION,
                "quantity": 0.0,
                "accounts": [],
                "held": True,
            }
        row["quantity"] += h.quantity
        name = accounts.get(h.account_id)
        if name and name not in row["accounts"]:
            row["accounts"].append(name)

    # Watch-list entries only surface when nothing is actually held under that
    # symbol — once bought, the real holding is the source of truth.
    for w in db.query(models.WatchStock).all():
        key = (w.symbol.strip().upper(), w.country or "IND")
        if key in by_symbol:
            continue
        by_symbol[key] = {
            "symbol": key[0],
            "company_name": w.company_name or key[0],
            "country": key[1],
            "sector": w.sector or taxonomy.DEFAULT_SECTOR,
            "section": w.section or taxonomy.DEFAULT_SECTION,
            "quantity": 0.0,
            "accounts": [],
            "held": False,
        }

    rows = sorted(by_symbol.values(), key=lambda r: (r["sector"], r["section"], r["symbol"]))
    for r in rows:
        r["quantity"] = round(r["quantity"], 4)

    return {
        "sectors": taxonomy.SECTORS,
        "sections": taxonomy.SECTIONS,
        "account_names": sorted(accounts.values()),
        "rows": rows,
    }


@app.put("/api/classification/{symbol}")
def update_classification(
    symbol: str,
    payload: schemas.ClassificationUpdate,
    db: Session = Depends(get_db),
):
    """Set sector/section for a symbol across every account that holds it."""
    if payload.sector is not None and payload.sector not in taxonomy.SECTORS:
        raise HTTPException(status_code=400, detail=f"Unknown sector: {payload.sector}")
    if payload.section is not None and payload.section not in taxonomy.SECTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown section: {payload.section}")

    sym = symbol.strip().upper()
    query = db.query(models.Holding).filter(models.Holding.symbol == sym)
    if payload.country:
        query = query.filter(models.Holding.country == payload.country)
    holdings = query.all()

    if holdings:
        for h in holdings:
            if payload.sector is not None:
                h.sector = payload.sector
            if payload.section is not None:
                h.section = payload.section
        db.commit()
        return {"symbol": sym, "updated": len(holdings),
                "sector": holdings[0].sector, "section": holdings[0].section}

    watch_q = db.query(models.WatchStock).filter(models.WatchStock.symbol == sym)
    if payload.country:
        watch_q = watch_q.filter(models.WatchStock.country == payload.country)
    watch = watch_q.first()
    if not watch:
        raise HTTPException(status_code=404, detail=f"No holdings or watch entry for {sym}")

    if payload.sector is not None:
        watch.sector = payload.sector
    if payload.section is not None:
        watch.section = payload.section
    db.commit()
    return {"symbol": sym, "updated": 1,
            "sector": watch.sector, "section": watch.section}


def _propose(symbol: str, company_name: str = "", country: str = "") -> Dict[str, Any]:
    """Resolve a user-typed name into a classified proposal (nothing saved)."""
    raw = (symbol or "").strip()
    sym = normalize_symbol(raw) or raw.upper()
    resolved = (country or "").upper() or guess_market(sym)
    scraped = fetch_sector(sym, resolved) or ""
    return {
        "symbol": sym,
        "company_name": company_name.strip() or raw,
        "country": resolved,
        "sector": taxonomy.default_sector(sym, resolved, scraped),
        "section": taxonomy.default_section(sym),
        "input": raw,
    }


@app.post("/api/classification/resolve")
def resolve_classification(payload: schemas.ResolveStocksRequest,
                           db: Session = Depends(get_db)):
    """Classify typed stock names. Returns proposals for the user to confirm."""
    names = [n.strip() for n in (payload.names or []) if n and n.strip()]
    if not names:
        raise HTTPException(status_code=400, detail="No stock names provided")

    existing = {
        (h.symbol.strip().upper(), h.country or "IND")
        for h in db.query(models.Holding).all()
    } | {
        (w.symbol.strip().upper(), w.country or "IND")
        for w in db.query(models.WatchStock).all()
    }

    proposals = []
    seen = set()
    for name in names:
        p = _propose(name)
        key = (p["symbol"], p["country"])
        if key in seen:
            continue
        seen.add(key)
        p["already_exists"] = key in existing
        proposals.append(p)
    return {"sectors": taxonomy.SECTORS, "sections": taxonomy.SECTIONS,
            "proposals": proposals}


@app.post("/api/classification/resolve-image")
async def resolve_classification_image(files: List[UploadFile] = File(...),
                                       db: Session = Depends(get_db)):
    """Same as /resolve, but reads the stock names off a screenshot."""
    if not files:
        raise HTTPException(status_code=400, detail="No screenshot files provided")

    parsed = []
    for file in files:
        parsed.extend(PortfolioOCREngine.process_image(await file.read()))
    if not parsed:
        return {"sectors": taxonomy.SECTORS, "sections": taxonomy.SECTIONS,
                "proposals": [],
                "warnings": ["No stock names detected in the uploaded screenshot(s)."]}

    existing = {
        (h.symbol.strip().upper(), h.country or "IND")
        for h in db.query(models.Holding).all()
    } | {
        (w.symbol.strip().upper(), w.country or "IND")
        for w in db.query(models.WatchStock).all()
    }

    proposals = []
    seen = set()
    for item in parsed:
        p = _propose(item.get("symbol", ""), item.get("company_name", ""))
        key = (p["symbol"], p["country"])
        if not p["symbol"] or key in seen:
            continue
        seen.add(key)
        p["already_exists"] = key in existing
        proposals.append(p)
    return {"sectors": taxonomy.SECTORS, "sections": taxonomy.SECTIONS,
            "proposals": proposals, "warnings": []}


@app.post("/api/classification/stocks")
def add_watch_stocks(payload: schemas.AddStocksRequest, db: Session = Depends(get_db)):
    """Commit confirmed proposals to the watch list."""
    added, skipped = [], []
    for item in payload.stocks:
        sym = item.symbol.strip().upper()
        if not sym:
            continue
        country = (item.country or "IND").upper()
        if country not in ("IND", "US"):
            raise HTTPException(status_code=400, detail=f"Unknown market: {country}")
        if item.sector and item.sector not in taxonomy.SECTORS:
            raise HTTPException(status_code=400, detail=f"Unknown sector: {item.sector}")
        if item.section and item.section not in taxonomy.SECTIONS:
            raise HTTPException(status_code=400, detail=f"Unknown section: {item.section}")

        held = db.query(models.Holding).filter(
            models.Holding.symbol == sym, models.Holding.country == country
        ).first()
        if held:
            skipped.append(sym)
            continue

        watch = db.query(models.WatchStock).filter(
            models.WatchStock.symbol == sym, models.WatchStock.country == country
        ).first()
        if watch:
            watch.company_name = item.company_name or watch.company_name
            watch.sector = item.sector or watch.sector
            watch.section = item.section or watch.section
        else:
            db.add(models.WatchStock(
                symbol=sym,
                company_name=item.company_name or sym,
                country=country,
                sector=item.sector or taxonomy.DEFAULT_SECTOR,
                section=item.section or taxonomy.DEFAULT_SECTION,
            ))
        added.append(sym)
    db.commit()
    return {"added": added, "skipped": skipped}


@app.delete("/api/classification/stocks/{symbol}")
def delete_watch_stock(symbol: str, country: str = "IND", db: Session = Depends(get_db)):
    """Removes a watch-list entry. Held positions are never touched."""
    watch = db.query(models.WatchStock).filter(
        models.WatchStock.symbol == symbol.strip().upper(),
        models.WatchStock.country == country.upper(),
    ).first()
    if not watch:
        raise HTTPException(status_code=404, detail="Watch-list entry not found")
    db.delete(watch)
    db.commit()
    return {"message": "Removed from watch list"}


@app.get("/api/portfolios/{portfolio_id}/history")
def get_portfolio_history(portfolio_id: str, range: str = "3mo",
                          db: Session = Depends(get_db)):
    """Portfolio value over time against Nifty 50, Nasdaq and the S&P 500.

    Reconstructed from current quantities priced at each day's close — see
    history_engine for what that does and does not represent.
    """
    portfolio = db.query(models.Portfolio).filter(
        models.Portfolio.id == portfolio_id
    ).first()
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    accounts = [link.account for link in portfolio.account_links if link.account]
    account_ids = [a.id for a in accounts]
    holdings = (
        db.query(models.Holding).filter(models.Holding.account_id.in_(account_ids)).all()
        if account_ids else []
    )
    account_map = {a.id: a for a in accounts}

    rows = [
        {
            "symbol": h.symbol,
            "quantity": h.quantity,
            "country": "US" if account_currency(account_map.get(h.account_id)) == "USD" else "IND",
        }
        for h in holdings
    ]

    result = history_engine.build_history(rows, range)
    result["portfolio_id"] = portfolio_id
    result["portfolio_name"] = portfolio.name
    return result


# ─────────────────────────────────────────────────────────────
# TARGET PORTFOLIOS
# ─────────────────────────────────────────────────────────────

def _target_payload(t: models.TargetPortfolio) -> Dict[str, Any]:
    rules: Dict[str, Dict[str, Dict[str, float]]] = {
        "IND": {"sector": {}, "section": {}},
        "US": {"sector": {}, "section": {}},
    }
    for r in t.rules:
        if r.market in rules and r.dimension in rules[r.market]:
            rules[r.market][r.dimension][r.key] = r.percent
    return {
        "id": t.id,
        "name": t.name,
        "ind_percent": t.ind_percent,
        "us_percent": round(100.0 - (t.ind_percent or 0.0), 2),
        "ind_cash_percent": t.ind_cash_percent,
        "us_cash_percent": t.us_cash_percent,
        "rules": rules,
    }


def _apply_rules(db: Session, target: models.TargetPortfolio,
                 rules: Optional[Dict[str, Dict[str, Dict[str, float]]]]) -> None:
    """Replaces the target's rule set wholesale. Zero/blank entries are dropped."""
    if rules is None:
        return
    db.query(models.TargetRule).filter(
        models.TargetRule.target_id == target.id
    ).delete(synchronize_session=False)

    for market, dims in rules.items():
        if market not in ("IND", "US"):
            raise HTTPException(status_code=400, detail=f"Unknown market: {market}")
        for dimension, entries in (dims or {}).items():
            if dimension not in ("sector", "section"):
                raise HTTPException(status_code=400, detail=f"Unknown dimension: {dimension}")
            allowed = taxonomy.SECTORS if dimension == "sector" else taxonomy.SECTIONS
            for key, percent in (entries or {}).items():
                if key not in allowed:
                    raise HTTPException(status_code=400, detail=f"Unknown {dimension}: {key}")
                if percent is None or float(percent) <= 0:
                    continue
                db.add(models.TargetRule(
                    target_id=target.id, market=market,
                    dimension=dimension, key=key, percent=float(percent),
                ))


@app.get("/api/targets")
def list_targets(db: Session = Depends(get_db)):
    targets = db.query(models.TargetPortfolio).order_by(models.TargetPortfolio.name).all()
    return {
        "sectors": taxonomy.SECTORS,
        "sections": taxonomy.SECTIONS,
        "targets": [_target_payload(t) for t in targets],
    }


@app.post("/api/targets")
def create_target(payload: schemas.TargetPortfolioCreate, db: Session = Depends(get_db)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Target name is required")
    if db.query(models.TargetPortfolio).filter(models.TargetPortfolio.name == name).first():
        raise HTTPException(status_code=400, detail=f"A target named '{name}' already exists")

    target = models.TargetPortfolio(
        name=name,
        ind_percent=payload.ind_percent,
        ind_cash_percent=payload.ind_cash_percent,
        us_cash_percent=payload.us_cash_percent,
    )
    db.add(target)
    db.flush()
    _apply_rules(db, target, payload.rules)
    db.commit()
    db.refresh(target)
    return _target_payload(target)


@app.put("/api/targets/{target_id}")
def update_target(target_id: str, payload: schemas.TargetPortfolioCreate,
                  db: Session = Depends(get_db)):
    target = db.query(models.TargetPortfolio).filter(
        models.TargetPortfolio.id == target_id
    ).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")

    target.name = payload.name.strip() or target.name
    target.ind_percent = payload.ind_percent
    target.ind_cash_percent = payload.ind_cash_percent
    target.us_cash_percent = payload.us_cash_percent
    _apply_rules(db, target, payload.rules)
    db.commit()
    db.refresh(target)
    return _target_payload(target)


@app.delete("/api/targets/{target_id}")
def delete_target(target_id: str, db: Session = Depends(get_db)):
    target = db.query(models.TargetPortfolio).filter(
        models.TargetPortfolio.id == target_id
    ).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")
    db.delete(target)
    db.commit()
    return {"message": "Target deleted"}


@app.get("/api/targets/{target_id}/compare")
def compare_target(target_id: str, portfolio_id: str, db: Session = Depends(get_db)):
    """Bucket-level diff between a target's shape and a real portfolio."""
    target = db.query(models.TargetPortfolio).filter(
        models.TargetPortfolio.id == target_id
    ).first()
    if not target:
        raise HTTPException(status_code=404, detail="Target not found")

    detail = get_portfolio_detail(portfolio_id, db)
    accounts = db.query(models.Account).filter(
        models.Account.id.in_([a["id"] for a in detail["accounts"]])
    ).all() if detail["accounts"] else []

    usd_inr_rate = detail["usd_inr_rate"]
    wallet_by_market = {"IND": 0.0, "US": 0.0}
    for a in accounts:
        is_us = a.currency_type == "US"
        wallet_by_market["US" if is_us else "IND"] += (
            (a.wallet_balance or 0.0) * (usd_inr_rate if is_us else 1.0)
        )

    result = target_engine.compare(target, detail["rows"], wallet_by_market)
    result["portfolio_id"] = portfolio_id
    result["portfolio_name"] = detail["portfolio_name"]
    return result


@app.get("/api/sync-logs")
def get_sync_logs(db: Session = Depends(get_db)):
    logs = (
        db.query(models.SyncLog)
        .order_by(models.SyncLog.synced_at.desc())
        .limit(50)
        .all()
    )
    names = {a.id: a.name for a in db.query(models.Account).all()}
    return [
        {
            "id": log.id,
            "account_id": log.account_id,
            "account_name": names.get(log.account_id, "Deleted account"),
            "status": log.status,
            "holdings_count": log.holdings_count,
            "synced_at": log.synced_at,
        }
        for log in logs
    ]


# ─────────────────────────────────────────────────────────────
# SERVE FRONTEND STATIC FILES
# ─────────────────────────────────────────────────────────────

frontend_dist_path = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
)
if os.path.exists(frontend_dist_path):
    app.mount(
        "/assets",
        StaticFiles(directory=os.path.join(frontend_dist_path, "assets")),
        name="assets",
    )

    @app.get("/")
    @app.get("/{full_path:path}")
    def serve_spa(full_path: str = ""):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        return FileResponse(os.path.join(frontend_dist_path, "index.html"))
