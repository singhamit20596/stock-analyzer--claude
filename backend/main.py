import os
import shutil
import uuid
from datetime import datetime
from typing import List, Optional
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
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

app = FastAPI(
    title="Multi-Broker Stock Portfolio Manager & Rebalancer",
    description="Backend API for OCR holdings ingestion, live stock quotes, portfolio aggregation, and rebalancing.",
    version="2.0.0"
)

# CORS middleware for local frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- ACCOUNT MANAGEMENT ENDPOINTS ---

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
    
    # Delete associated holdings and sync logs
    db.query(models.Holding).filter(models.Holding.account_id == account_id).delete()
    db.query(models.SyncLog).filter(models.SyncLog.account_id == account_id).delete()
    db.delete(acc)
    db.commit()
    return {"message": "Account deleted successfully"}

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
            # All buy prices & values for US accounts are in USD ($)
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
                # Additional INR conversion for dual currency headers/views
                "invested_value_inr": round(inv * usd_inr_rate, 2),
                "current_value_inr": round(cur * usd_inr_rate, 2),
                "pnl_inr": round(pnl * usd_inr_rate, 2),
            })
        else:
            # Indian accounts in INR (₹)
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

    summary = {
        "invested_value": round(tot_invested, 2),
        "current_value": round(tot_current, 2),
        "holding_count": len(items),
        "pnl": tot_pnl,
        "pnl_percent": tot_pnl_pct,
        "currency_type": acc.currency_type,
        "currency_symbol": "$" if is_us else "₹",
    }
    
    if is_us:
        summary["usd_to_inr_rate"] = usd_inr_rate
        summary["invested_value_inr"] = round(tot_invested * usd_inr_rate, 2)
        summary["current_value_inr"] = round(tot_current * usd_inr_rate, 2)
        summary["pnl_inr"] = round(tot_pnl * usd_inr_rate, 2)

    wallet_bal = acc.wallet_balance or 0.0
    if is_us:
        summary["wallet_balance"] = round(wallet_bal, 2)
        summary["wallet_balance_inr"] = round(wallet_bal * usd_inr_rate, 2)
    else:
        summary["wallet_balance"] = round(wallet_bal, 2)

    return {
        "account_id": acc.id,
        "account_name": acc.name,
        "currency_type": acc.currency_type,
        "wallet_balance": round(wallet_bal, 2),
        "last_synced_at": acc.last_synced_at,
        "summary": summary,
        "items": items
    }

# --- OCR MULTI-SCREENSHOT UPLOAD & VERIFICATION ---

@app.post("/api/upload-ocr-images")
async def upload_ocr_images(
    files: List[UploadFile] = File(...),
    account_id: Optional[str] = Query(None)
):
    if not files:
        raise HTTPException(status_code=400, detail="No screenshot files provided")

    all_raw_holdings = []

    for file in files:
        contents = await file.read()
        parsed = PortfolioOCREngine.process_image(contents)
        if parsed:
            all_raw_holdings.extend(parsed)

    if not all_raw_holdings:
        return {
            "account_id": account_id,
            "holdings": [],
            "warnings": ["No stock holdings detected in the uploaded screenshot(s)."]
        }

    # Deduplicate across multiple uploaded screenshots
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

    existing_db_holdings = db.query(models.Holding).filter(models.Holding.account_id == account.id).all()
    existing_list = [
        {
            "id": h.id,
            "symbol": h.symbol,
            "company_name": h.company_name,
            "quantity": h.quantity,
            "avg_buy_price": h.avg_buy_price,
            "current_price": h.current_price
        }
        for h in existing_db_holdings
    ]

    incoming_list = [h.dict() for h in request.holdings]
    final_holdings, warnings = AccountDeduplicator.process_deduplication(
        existing_holdings=existing_list,
        incoming_holdings=incoming_list,
        strategy=strategy
    )

    # Save to DB
    db.query(models.Holding).filter(models.Holding.account_id == account.id).delete()
    
    for h in final_holdings:
        db_holding = models.Holding(
            account_id=account.id,
            symbol=h["symbol"],
            company_name=h.get("company_name", h["symbol"]),
            quantity=h["quantity"],
            avg_buy_price=h["avg_buy_price"],
            current_price=h.get("current_price") or h["avg_buy_price"]
        )
        db.add(db_holding)

    account.last_synced_at = datetime.utcnow()
    db.commit()

    sync_log = models.SyncLog(
        account_id=account.id,
        status="SUCCESS",
        holdings_count=len(request.holdings)
    )
    db.add(sync_log)
    db.commit()

    return {"message": "Holdings saved successfully", "count": len(request.holdings)}

# --- CONSOLIDATED PORTFOLIO & REBALANCER ---

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
        
        if is_us:
            h.current_price = raw_price * usd_inr_rate
        else:
            h.current_price = raw_price
            
        updated_holdings.append(h)

    return PortfolioAggregator.aggregate_holdings(accounts, updated_holdings)

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
        symbol=alloc.symbol,
        company_name=alloc.company_name,
        target_percentage=alloc.target_percentage,
        asset_class=alloc.asset_class or "EQUITY"
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

# --- SERVE FRONTEND STATIC FILES ---

frontend_dist_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "dist"))
if os.path.exists(frontend_dist_path):
    app.mount("/assets", StaticFiles(directory=os.path.join(frontend_dist_path, "assets")), name="static_assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="API route not found")
        file_path = os.path.join(frontend_dist_path, full_path)
        if os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(frontend_dist_path, "index.html"))
