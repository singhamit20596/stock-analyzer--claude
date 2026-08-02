import os
import shutil
import uuid
from datetime import datetime
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

import models
import schemas
from database import engine, get_db
from services.ocr_engine import PortfolioOCREngine
from services.quote_service import fetch_live_prices_batch, fetch_usd_to_inr_rate
from services.deduplicator import AccountDeduplicator
from services.portfolio_engine import PortfolioAggregator
from services.rebalancer import RebalanceEngine

# Create database tables automatically
models.Base.metadata.create_all(bind=engine)

SCREENSHOTS_DIR = os.path.join(os.path.dirname(__file__), "screenshots")
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)

app = FastAPI(
    title="Multi-Broker Stock Portfolio Manager & Rebalancer",
    description="Backend API for OCR holdings ingestion, live stock quotes, portfolio aggregation, and rebalancing.",
    version="3.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
        wallet_balance=account.wallet_balance or 0.0
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
    db.query(models.Holding).filter(models.Holding.account_id == account_id).delete()
    db.query(models.SyncLog).filter(models.SyncLog.account_id == account_id).delete()
    db.delete(acc)
    db.commit()
    return {"message": "Account deleted successfully"}

@app.get("/api/accounts/{account_id}/screenshot")
def get_account_screenshot(account_id: str, db: Session = Depends(get_db)):
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not acc or not acc.latest_screenshot_path or not os.path.exists(acc.latest_screenshot_path):
        raise HTTPException(status_code=404, detail="No screenshot found for this account")
    return FileResponse(acc.latest_screenshot_path, media_type="image/png")

@app.get("/api/accounts/{account_id}/detail")
def get_account_detail(account_id: str, db: Session = Depends(get_db)):
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")

    holdings = db.query(models.Holding).filter(models.Holding.account_id == account_id).all()
    symbols = [h.symbol for h in holdings]
    live_prices = fetch_live_prices_batch(symbols) if symbols else {}
    usd_inr_rate = fetch_usd_to_inr_rate()

    items = []
    tot_invested = 0.0
    tot_current = 0.0
    is_us = (acc.currency_type == "US")

    for h in holdings:
        live_price = live_prices.get(h.symbol) or live_prices.get(h.symbol.upper()) or h.current_price or h.avg_buy_price

        if is_us:
            inv = round(h.quantity * h.avg_buy_price, 2)
            cur = round(h.quantity * live_price, 2)
            pnl = round(cur - inv, 2)
            pnl_pct = round((pnl / inv * 100), 2) if inv > 0 else 0.0
            tot_invested += inv
            tot_current += cur
            items.append({
                "id": h.id,
                "symbol": h.symbol,
                "company_name": h.company_name,
                "quantity": round(h.quantity, 4),
                "avg_buy_price": round(h.avg_buy_price, 2),
                "live_current_price": round(live_price, 2),
                "invested_value": inv,
                "current_value": cur,
                "pnl": pnl,
                "pnl_percent": pnl_pct,
                "invested_value_inr": round(inv * usd_inr_rate, 2),
                "current_value_inr": round(cur * usd_inr_rate, 2),
                "pnl_inr": round(pnl * usd_inr_rate, 2),
            })
        else:
            inv = round(h.quantity * h.avg_buy_price, 2)
            cur = round(h.quantity * live_price, 2)
            pnl = round(cur - inv, 2)
            pnl_pct = round((pnl / inv * 100), 2) if inv > 0 else 0.0
            tot_invested += inv
            tot_current += cur
            items.append({
                "id": h.id,
                "symbol": h.symbol,
                "company_name": h.company_name,
                "quantity": round(h.quantity, 4),
                "avg_buy_price": round(h.avg_buy_price, 2),
                "live_current_price": round(live_price, 2),
                "invested_value": inv,
                "current_value": cur,
                "pnl": pnl,
                "pnl_percent": pnl_pct,
            })

    tot_pnl = round(tot_current - tot_invested, 2)
    tot_pnl_pct = round((tot_pnl / tot_invested * 100), 2) if tot_invested > 0 else 0.0
    wallet_bal = acc.wallet_balance or 0.0

    summary = {
        "invested_value": round(tot_invested, 2),
        "current_value": round(tot_current, 2),
        "holding_count": len(items),
        "pnl": tot_pnl,
        "pnl_percent": tot_pnl_pct,
        "currency_type": acc.currency_type,
        "currency_symbol": "$" if is_us else "₹",
        "wallet_balance": round(wallet_bal, 2),
    }
    if is_us:
        summary["usd_to_inr_rate"] = usd_inr_rate
        summary["invested_value_inr"] = round(tot_invested * usd_inr_rate, 2)
        summary["current_value_inr"] = round(tot_current * usd_inr_rate, 2)
        summary["pnl_inr"] = round(tot_pnl * usd_inr_rate, 2)
        summary["wallet_balance_inr"] = round(wallet_bal * usd_inr_rate, 2)

    return {
        "account_id": acc.id,
        "account_name": acc.name,
        "currency_type": acc.currency_type,
        "wallet_balance": round(wallet_bal, 2),
        "has_screenshot": bool(acc.latest_screenshot_path and os.path.exists(acc.latest_screenshot_path or "")),
        "last_synced_at": acc.last_synced_at,
        "summary": summary,
        "items": items
    }

# ─────────────────────────────────────────────────────────────
# OCR UPLOAD & VERIFICATION
# ─────────────────────────────────────────────────────────────

@app.post("/api/upload-ocr-images")
async def upload_ocr_images(
    files: List[UploadFile] = File(...),
    account_id: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    if not files:
        raise HTTPException(status_code=400, detail="No screenshot files provided")

    all_raw_holdings = []
    latest_screenshot_bytes = None
    latest_screenshot_ext = ".png"

    for file in files:
        contents = await file.read()
        latest_screenshot_bytes = contents
        latest_screenshot_ext = os.path.splitext(file.filename or "screenshot.png")[1] or ".png"
        parsed = PortfolioOCREngine.process_image(contents)
        if parsed:
            all_raw_holdings.extend(parsed)

    # Save the last uploaded screenshot against the account
    if account_id and latest_screenshot_bytes:
        acc = db.query(models.Account).filter(models.Account.id == account_id).first()
        if acc:
            acc_dir = os.path.join(SCREENSHOTS_DIR, account_id)
            os.makedirs(acc_dir, exist_ok=True)
            save_path = os.path.join(acc_dir, f"latest{latest_screenshot_ext}")
            with open(save_path, "wb") as f:
                f.write(latest_screenshot_bytes)
            acc.latest_screenshot_path = save_path
            db.commit()

    if not all_raw_holdings:
        return {
            "account_id": account_id,
            "holdings": [],
            "warnings": ["No stock holdings detected in the uploaded screenshot(s)."]
        }

    deduped_holdings = AccountDeduplicator.deduplicate_holdings(all_raw_holdings)
    return {
        "account_id": account_id,
        "holdings": deduped_holdings,
        "warnings": []
    }

@app.post("/api/verify-save-holdings")
def verify_and_save_holdings(
    request: schemas.VerifySaveRequest,
    strategy: str = Query("MERGE"),
    db: Session = Depends(get_db)
):
    account = db.query(models.Account).filter(models.Account.id == request.account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Target account not found")

    # Derive country/currency from account type
    is_us = (account.currency_type == "US")
    country = "US" if is_us else "IND"
    currency = "USD" if is_us else "INR"

    existing_db_holdings = db.query(models.Holding).filter(models.Holding.account_id == account.id).all()
    existing_list = [
        {
            "id": h.id, "symbol": h.symbol, "company_name": h.company_name,
            "quantity": h.quantity, "avg_buy_price": h.avg_buy_price, "current_price": h.current_price
        }
        for h in existing_db_holdings
    ]

    incoming_list = [h.dict() for h in request.holdings]
    final_holdings, warnings = AccountDeduplicator.process_deduplication(
        existing_holdings=existing_list,
        incoming_holdings=incoming_list,
        strategy=strategy
    )

    # Save to DB — delete old, insert new with country/currency
    db.query(models.Holding).filter(models.Holding.account_id == account.id).delete()
    for h in final_holdings:
        db_holding = models.Holding(
            account_id=account.id,
            symbol=h["symbol"],
            company_name=h.get("company_name", h["symbol"]),
            quantity=h["quantity"],
            avg_buy_price=h["avg_buy_price"],
            current_price=h.get("current_price") or 0.0,
            country=country,
            currency=currency,
            is_user_verified=1
        )
        db.add(db_holding)

    account.last_synced_at = datetime.utcnow()
    db.commit()

    sync_log = models.SyncLog(account_id=account.id, status="SUCCESS", holdings_count=len(request.holdings))
    db.add(sync_log)
    db.commit()

    return {"message": "Holdings saved successfully", "count": len(request.holdings)}

# ─────────────────────────────────────────────────────────────
# CONSOLIDATED PORTFOLIO (legacy simple aggregation)
# ─────────────────────────────────────────────────────────────

@app.get("/api/portfolio/consolidated")
@app.get("/api/consolidated-portfolio")
def get_consolidated_portfolio(account_ids: Optional[str] = None, db: Session = Depends(get_db)):
    acc_id_list = [a.strip() for a in account_ids.split(",")] if account_ids else None
    if acc_id_list:
        accounts = db.query(models.Account).filter(models.Account.id.in_(acc_id_list)).all()
        holdings = db.query(models.Holding).filter(models.Holding.account_id.in_(acc_id_list)).all()
    else:
        accounts = db.query(models.Account).all()
        holdings = db.query(models.Holding).all()

    symbols = [h.symbol for h in holdings]
    live_prices = fetch_live_prices_batch(symbols) if symbols else {}
    usd_inr_rate = fetch_usd_to_inr_rate()

    updated_holdings = []
    for h in holdings:
        acc = db.query(models.Account).filter(models.Account.id == h.account_id).first()
        is_us = (acc and acc.currency_type == "US")
        raw_price = live_prices.get(h.symbol) or live_prices.get(h.symbol.upper()) or h.current_price or h.avg_buy_price
        h.current_price = raw_price * usd_inr_rate if is_us else raw_price
        updated_holdings.append(h)

    return PortfolioAggregator.aggregate_holdings(accounts, updated_holdings)

# ─────────────────────────────────────────────────────────────
# NAMED PORTFOLIOS
# ─────────────────────────────────────────────────────────────

@app.get("/api/portfolios")
def list_portfolios(db: Session = Depends(get_db)):
    portfolios = db.query(models.Portfolio).all()
    result = []
    for p in portfolios:
        acc_links = db.query(models.PortfolioAccount).filter(models.PortfolioAccount.portfolio_id == p.id).all()
        account_ids = [lnk.account_id for lnk in acc_links]
        accounts = db.query(models.Account).filter(models.Account.id.in_(account_ids)).all()
        result.append({
            "id": p.id,
            "name": p.name,
            "created_at": p.created_at,
            "account_ids": account_ids,
            "account_names": [a.name for a in accounts],
            "account_count": len(account_ids),
        })
    return result

@app.post("/api/portfolios")
def create_portfolio(payload: schemas.PortfolioCreate, db: Session = Depends(get_db)):
    # Check duplicate name
    existing = db.query(models.Portfolio).filter(models.Portfolio.name == payload.name).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Portfolio '{payload.name}' already exists")

    portfolio = models.Portfolio(name=payload.name)
    db.add(portfolio)
    db.flush()

    for acc_id in payload.account_ids:
        acc = db.query(models.Account).filter(models.Account.id == acc_id).first()
        if acc:
            link = models.PortfolioAccount(portfolio_id=portfolio.id, account_id=acc_id)
            db.add(link)

    db.commit()
    db.refresh(portfolio)
    return {"id": portfolio.id, "name": portfolio.name, "created_at": portfolio.created_at}

@app.put("/api/portfolios/{portfolio_id}")
def update_portfolio(portfolio_id: str, payload: schemas.PortfolioCreate, db: Session = Depends(get_db)):
    portfolio = db.query(models.Portfolio).filter(models.Portfolio.id == portfolio_id).first()
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    portfolio.name = payload.name
    # Replace account links
    db.query(models.PortfolioAccount).filter(models.PortfolioAccount.portfolio_id == portfolio_id).delete()
    for acc_id in payload.account_ids:
        acc = db.query(models.Account).filter(models.Account.id == acc_id).first()
        if acc:
            link = models.PortfolioAccount(portfolio_id=portfolio_id, account_id=acc_id)
            db.add(link)

    db.commit()
    db.refresh(portfolio)
    return {"id": portfolio.id, "name": portfolio.name}

@app.delete("/api/portfolios/{portfolio_id}")
def delete_portfolio(portfolio_id: str, db: Session = Depends(get_db)):
    portfolio = db.query(models.Portfolio).filter(models.Portfolio.id == portfolio_id).first()
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    db.query(models.PortfolioAccount).filter(models.PortfolioAccount.portfolio_id == portfolio_id).delete()
    db.delete(portfolio)
    db.commit()
    return {"message": "Portfolio deleted"}

@app.get("/api/portfolios/{portfolio_id}/detail")
def get_portfolio_detail(portfolio_id: str, db: Session = Depends(get_db)):
    portfolio = db.query(models.Portfolio).filter(models.Portfolio.id == portfolio_id).first()
    if not portfolio:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    acc_links = db.query(models.PortfolioAccount).filter(models.PortfolioAccount.portfolio_id == portfolio_id).all()
    account_ids = [lnk.account_id for lnk in acc_links]
    accounts = db.query(models.Account).filter(models.Account.id.in_(account_ids)).all()
    account_map = {a.id: a for a in accounts}

    # Fetch all holdings for all accounts in this portfolio
    all_holdings = db.query(models.Holding).filter(models.Holding.account_id.in_(account_ids)).all()

    # Get live prices for all symbols
    symbols = list(set(h.symbol for h in all_holdings))
    live_prices = fetch_live_prices_batch(symbols) if symbols else {}
    usd_inr_rate = fetch_usd_to_inr_rate()

    def get_live_price_inr(symbol, currency):
        raw = live_prices.get(symbol) or live_prices.get(symbol.upper()) or 0.0
        return raw * usd_inr_rate if currency == "USD" else raw

    # Group holdings by (symbol, currency) — so same ticker in IND vs US = different rows
    from collections import defaultdict
    groups = defaultdict(list)
    for h in all_holdings:
        acc = account_map.get(h.account_id)
        currency = "USD" if (acc and acc.currency_type == "US") else "INR"
        key = (h.symbol, currency)
        groups[key].append((h, acc))

    rows = []
    total_current_inr = 0.0

    # First pass — build rows without allocation %
    for (symbol, currency), holding_list in groups.items():
        # Representative company name (longest / most complete)
        company_name = max((h.company_name for h, _ in holding_list), key=len)

        per_account = {}
        portfolio_qty = 0.0
        weighted_avg_sum = 0.0

        for h, acc in holding_list:
            avg_inr = h.avg_buy_price * usd_inr_rate if currency == "USD" else h.avg_buy_price
            per_account[h.account_id] = {
                "qty": round(h.quantity, 4),
                "avg_native": round(h.avg_buy_price, 2),   # in native currency
                "avg_inr": round(avg_inr, 2),
            }
            portfolio_qty += h.quantity
            weighted_avg_sum += h.quantity * avg_inr

        portfolio_avg_inr = round(weighted_avg_sum / portfolio_qty, 2) if portfolio_qty > 0 else 0.0
        mkt_price_inr = round(get_live_price_inr(symbol, currency), 2)
        invested_inr = round(portfolio_qty * portfolio_avg_inr, 2)
        current_inr = round(portfolio_qty * mkt_price_inr, 2)
        pnl_inr = round(current_inr - invested_inr, 2)
        pnl_pct = round((pnl_inr / invested_inr * 100), 2) if invested_inr > 0 else 0.0

        total_current_inr += current_inr

        rows.append({
            "symbol": symbol,
            "company_name": company_name,
            "country": "US" if currency == "USD" else "IND",
            "currency": currency,
            "per_account": per_account,
            "mkt_price_inr": mkt_price_inr,
            "portfolio_qty": round(portfolio_qty, 4),
            "portfolio_avg_inr": portfolio_avg_inr,
            "invested_value_inr": invested_inr,
            "current_value_inr": current_inr,
            "pnl_inr": pnl_inr,
            "pnl_percent": pnl_pct,
            "allocation_percent": 0.0,  # filled in second pass
        })

    # Second pass — fill allocation %
    for row in rows:
        row["allocation_percent"] = round((row["current_value_inr"] / total_current_inr * 100), 2) if total_current_inr > 0 else 0.0

    # Sort by current value descending
    rows.sort(key=lambda r: r["current_value_inr"], reverse=True)

    # Wallet balance sum (convert US wallet to INR)
    total_wallet_inr = 0.0
    for acc in accounts:
        wb = acc.wallet_balance or 0.0
        total_wallet_inr += wb * usd_inr_rate if acc.currency_type == "US" else wb

    # Summary
    total_invested_inr = sum(r["invested_value_inr"] for r in rows)
    total_pnl_inr = round(total_current_inr - total_invested_inr, 2)
    total_pnl_pct = round((total_pnl_inr / total_invested_inr * 100), 2) if total_invested_inr > 0 else 0.0

    return {
        "portfolio_id": portfolio.id,
        "portfolio_name": portfolio.name,
        "usd_inr_rate": usd_inr_rate,
        "accounts": [
            {"id": a.id, "name": a.name, "currency_type": a.currency_type}
            for a in accounts
        ],
        "summary": {
            "total_invested_inr": round(total_invested_inr, 2),
            "total_current_inr": round(total_current_inr, 2),
            "total_pnl_inr": total_pnl_inr,
            "total_pnl_percent": total_pnl_pct,
            "total_wallet_inr": round(total_wallet_inr, 2),
            "total_stocks": len(rows),
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
    existing = db.query(models.TargetAllocation).filter(models.TargetAllocation.symbol == alloc.symbol).first()
    if existing:
        existing.target_percentage = alloc.target_percentage
        existing.company_name = alloc.company_name
        existing.asset_class = alloc.asset_class or "EQUITY"
        db.commit()
        db.refresh(existing)
        return existing
    db_alloc = models.TargetAllocation(
        symbol=alloc.symbol, company_name=alloc.company_name,
        target_percentage=alloc.target_percentage, asset_class=alloc.asset_class or "EQUITY"
    )
    db.add(db_alloc)
    db.commit()
    db.refresh(db_alloc)
    return db_alloc

@app.delete("/api/target-allocations/{alloc_id}")
def delete_target_allocation(alloc_id: str, db: Session = Depends(get_db)):
    alloc = db.query(models.TargetAllocation).filter(models.TargetAllocation.id == alloc_id).first()
    if not alloc:
        raise HTTPException(status_code=404, detail="Target allocation not found")
    db.delete(alloc)
    db.commit()
    return {"message": "Target allocation deleted"}

@app.get("/api/rebalance")
def get_rebalance_recommendations(db: Session = Depends(get_db)):
    accounts = db.query(models.Account).all()
    holdings = db.query(models.Holding).all()
    targets = db.query(models.TargetAllocation).all()
    symbols = [h.symbol for h in holdings]
    live_prices = fetch_live_prices_batch(symbols) if symbols else {}
    usd_inr_rate = fetch_usd_to_inr_rate()
    for h in holdings:
        acc = db.query(models.Account).filter(models.Account.id == h.account_id).first()
        is_us = (acc and acc.currency_type == "US")
        raw_price = live_prices.get(h.symbol) or live_prices.get(h.symbol.upper()) or h.current_price or h.avg_buy_price
        h.current_price = (raw_price * usd_inr_rate) if is_us else raw_price
    return RebalanceEngine.calculate_rebalance(accounts, holdings, targets)

@app.get("/api/sync-logs")
def get_sync_logs(db: Session = Depends(get_db)):
    return db.query(models.SyncLog).order_by(models.SyncLog.synced_at.desc()).limit(50).all()

# ─────────────────────────────────────────────────────────────
# SERVE FRONTEND STATIC FILES
# ─────────────────────────────────────────────────────────────

frontend_dist_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))
if os.path.exists(frontend_dist_path):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist_path, "assets")), name="assets")

    @app.get("/")
    @app.get("/{full_path:path}")
    def serve_spa(full_path: str = ""):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404)
        index_path = os.path.join(frontend_dist_path, "index.html")
        return FileResponse(index_path)
