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
from services.quote_service import fetch_live_prices_batch, fetch_usd_to_inr_rate
from services.rebalancer import RebalanceEngine

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

        rows.append({
            "symbol": item["symbol"],
            "company_name": item["company_name"],
            "country": item["country"],
            "currency": item["currency"],
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

    return {
        "portfolio_id": portfolio.id,
        "portfolio_name": portfolio.name,
        "usd_inr_rate": usd_inr_rate,
        "accounts": [
            {"id": a.id, "name": a.name, "currency_type": a.currency_type} for a in accounts
        ],
        "summary": {
            "total_invested_inr": summary["total_invested_inr"],
            "total_current_inr": summary["current_value_inr"],
            "total_pnl_inr": summary["total_pnl_inr"],
            "total_pnl_percent": summary["total_pnl_percent"],
            "total_wallet_inr": round(total_wallet_inr, 2),
            "total_stocks": summary["total_stocks_count"],
        },
        "rows": rows,
    }


# ─────────────────────────────────────────────────────────────
# TARGET ALLOCATIONS & REBALANCER
# ─────────────────────────────────────────────────────────────

@app.get("/api/target-allocations", response_model=List[schemas.TargetAllocationResponse])
def get_target_allocations(db: Session = Depends(get_db)):
    return db.query(models.TargetAllocation).all()


@app.post("/api/target-allocations", response_model=schemas.TargetAllocationResponse)
def create_target_allocation(alloc: schemas.TargetAllocationBase, db: Session = Depends(get_db)):
    symbol = alloc.symbol.strip().upper()
    existing = db.query(models.TargetAllocation).filter(
        models.TargetAllocation.symbol == symbol
    ).first()

    if existing:
        existing.target_percentage = alloc.target_percentage
        existing.company_name = alloc.company_name or existing.company_name
        existing.asset_class = alloc.asset_class or "EQUITY"
        db.commit()
        db.refresh(existing)
        return existing

    db_alloc = models.TargetAllocation(
        symbol=symbol,
        company_name=alloc.company_name or symbol,
        target_percentage=alloc.target_percentage,
        asset_class=alloc.asset_class or "EQUITY",
    )
    db.add(db_alloc)
    db.commit()
    db.refresh(db_alloc)
    return db_alloc


@app.delete("/api/target-allocations/{alloc_id}")
def delete_target_allocation(alloc_id: str, db: Session = Depends(get_db)):
    alloc = db.query(models.TargetAllocation).filter(
        models.TargetAllocation.id == alloc_id
    ).first()
    if not alloc:
        raise HTTPException(status_code=404, detail="Target allocation not found")
    db.delete(alloc)
    db.commit()
    return {"message": "Target allocation deleted"}


@app.get("/api/rebalance")
def get_rebalance_recommendations(portfolio_id: Optional[str] = None, db: Session = Depends(get_db)):
    """Drift and trade recommendations, in INR.

    Scoped to one named portfolio when `portfolio_id` is given, otherwise
    across every account.
    """
    if portfolio_id:
        portfolio = db.query(models.Portfolio).filter(
            models.Portfolio.id == portfolio_id
        ).first()
        if not portfolio:
            raise HTTPException(status_code=404, detail="Portfolio not found")
        accounts = [link.account for link in portfolio.account_links if link.account]
    else:
        accounts = db.query(models.Account).all()

    account_ids = [a.id for a in accounts]
    holdings = (
        db.query(models.Holding).filter(models.Holding.account_id.in_(account_ids)).all()
        if account_ids else []
    )
    targets = db.query(models.TargetAllocation).all()

    live_prices, usd_inr_rate = _price_quotes(accounts, holdings)

    # Targets for stocks not held yet have no holding to source a quote from,
    # so look those up too — otherwise their "units to buy" is always zero.
    held = {sym for sym, _ in live_prices}
    unheld = [(t.symbol.strip().upper(), "IND") for t in targets
              if t.symbol.strip().upper() not in held]
    if unheld:
        live_prices.update(fetch_live_prices_batch(unheld))

    return RebalanceEngine.calculate_rebalance(
        accounts, holdings, targets, live_prices, usd_inr_rate
    )


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
