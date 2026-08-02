from fastapi import FastAPI, Depends, HTTPException, File, UploadFile, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from typing import List, Dict, Any, Optional
import os

from database import engine, get_db, Base
import models
import schemas
from services.quote_service import fetch_live_prices_batch, fetch_usd_to_inr_rate
from services.portfolio_engine import PortfolioAggregator
from services.rebalancer import RebalanceEngine
from services.ocr_engine import PortfolioOCREngine
from services.deduplicator import AccountDeduplicator

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Stocks Analyzer API")

FRONTEND_DIST = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "dist")
if os.path.exists(FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(FRONTEND_DIST, "assets")), name="assets")

@app.get("/")
def read_root():
    index_file = os.path.join(FRONTEND_DIST, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"message": "Stocks Analyzer API is running."}

# --- ACCOUNT MANAGEMENT ENDPOINTS ---

@app.get("/api/accounts", response_model=List[schemas.AccountResponse])
def get_accounts(db: Session = Depends(get_db)):
    return db.query(models.Account).all()

@app.post("/api/accounts", response_model=schemas.AccountResponse)
def create_account(account: schemas.AccountCreate, db: Session = Depends(get_db)):
    db_account = models.Account(
        name=account.name.strip(),
        currency_type=account.currency_type or "IND"
    )
    db.add(db_account)
    db.commit()
    db.refresh(db_account)
    return db_account

@app.put("/api/accounts/{account_id}", response_model=schemas.AccountResponse)
def update_account(account_id: str, update_data: schemas.AccountUpdate, db: Session = Depends(get_db)):
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")

    if update_data.name is not None and update_data.name.strip():
        acc.name = update_data.name.strip()
    if update_data.currency_type is not None:
        acc.currency_type = update_data.currency_type

    db.commit()
    db.refresh(acc)
    return acc

@app.delete("/api/accounts/{account_id}")
def delete_account(account_id: str, db: Session = Depends(get_db)):
    account = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    db.delete(account)
    db.commit()
    return {"message": "Account deleted successfully"}

# --- ACCOUNT DETAIL & METRICS ENDPOINT ---

@app.get("/api/accounts/{account_id}/detail")
def get_single_account_detail(account_id: str, db: Session = Depends(get_db)):
    account = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    holdings = db.query(models.Holding).filter(models.Holding.account_id == account_id).all()
    symbols = [h.symbol for h in holdings]
    live_quotes = fetch_live_prices_batch(symbols) if symbols else {}
    usd_inr_rate = fetch_usd_to_inr_rate()

    total_invested = 0.0
    total_current = 0.0
    items = []

    is_us_account = (account.currency_type == "US")
    currency_symbol = "$" if is_us_account else "₹"

    for h in holdings:
        live_price = live_quotes.get(h.symbol) or live_quotes.get(h.symbol.upper()) or h.current_price or h.avg_buy_price
        invested_val = h.quantity * h.avg_buy_price
        current_val = h.quantity * live_price
        pnl_val = current_val - invested_val
        pnl_pct = (pnl_val / invested_val * 100) if invested_val > 0 else 0.0

        total_invested += invested_val
        total_current += current_val

        item_dict = {
            "id": h.id,
            "symbol": h.symbol,
            "company_name": h.company_name,
            "quantity": round(h.quantity, 4),
            "avg_buy_price": round(h.avg_buy_price, 2),
            "live_current_price": round(live_price, 2),
            "invested_value": round(invested_val, 2),
            "current_value": round(current_val, 2),
            "pnl": round(pnl_val, 2),
            "pnl_percent": round(pnl_pct, 2)
        }

        if is_us_account:
            item_dict["invested_value_inr"] = round(invested_val * usd_inr_rate, 2)
            item_dict["current_value_inr"] = round(current_val * usd_inr_rate, 2)
            item_dict["pnl_inr"] = round(pnl_val * usd_inr_rate, 2)

        items.append(item_dict)

    total_pnl = total_current - total_invested
    total_pnl_pct = (total_pnl / total_invested * 100) if total_invested > 0 else 0.0

    summary_dict = {
        "invested_value": round(total_invested, 2),
        "current_value": round(total_current, 2),
        "holding_count": len(items),
        "pnl": round(total_pnl, 2),
        "pnl_percent": round(total_pnl_pct, 2),
        "currency_type": account.currency_type or "IND",
        "currency_symbol": currency_symbol
    }

    if is_us_account:
        summary_dict["usd_to_inr_rate"] = round(usd_inr_rate, 2)
        summary_dict["invested_value_inr"] = round(total_invested * usd_inr_rate, 2)
        summary_dict["current_value_inr"] = round(total_current * usd_inr_rate, 2)
        summary_dict["pnl_inr"] = round(total_pnl * usd_inr_rate, 2)

    return {
        "account_id": account.id,
        "account_name": account.name,
        "currency_type": account.currency_type or "IND",
        "last_synced_at": account.last_synced_at,
        "summary": summary_dict,
        "items": items
    }

# --- HOLDING UPDATE ENDPOINT ---

@app.put("/api/holdings/{holding_id}")
def update_holding(holding_id: str, holding_update: schemas.HoldingUpdate, db: Session = Depends(get_db)):
    h = db.query(models.Holding).filter(models.Holding.id == holding_id).first()
    if not h:
        raise HTTPException(status_code=404, detail="Holding not found")

    if holding_update.symbol is not None:
        h.symbol = holding_update.symbol.strip().upper()
    if holding_update.company_name is not None:
        h.company_name = holding_update.company_name.strip()
    if holding_update.quantity is not None:
        h.quantity = holding_update.quantity
    if holding_update.avg_buy_price is not None:
        h.avg_buy_price = holding_update.avg_buy_price
    if holding_update.current_price is not None:
        h.current_price = holding_update.current_price

    db.commit()
    db.refresh(h)
    return {"message": "Holding updated successfully", "holding": h}

# --- OCR SCREENSHOT UPLOAD & INGESTION ---

@app.post("/api/upload-ocr-images")
async def upload_ocr_images(
    files: List[UploadFile] = File(...),
    account_id: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    all_raw_holdings = []
    
    for f in files:
        contents = await f.read()
        extracted = PortfolioOCREngine.process_image(contents)
        if extracted:
            all_raw_holdings.extend(extracted)

    deduped_holdings = AccountDeduplicator.deduplicate_holdings(all_raw_holdings)
    symbols = [h['symbol'] for h in deduped_holdings]
    live_prices = fetch_live_prices_batch(symbols) if symbols else {}
    
    enriched_holdings = []
    for h in deduped_holdings:
        sym = h['symbol']
        lp = live_prices.get(sym) or live_prices.get(sym.upper()) or h.get('current_price') or h['avg_buy_price']
        h['current_price'] = lp
        enriched_holdings.append(h)

    return {
        "status": "SUCCESS",
        "processed_files_count": len(files),
        "total_holdings_parsed": len(enriched_holdings),
        "holdings": enriched_holdings
    }

@app.post("/api/verify-save-holdings")
def verify_and_save_holdings(
    request: schemas.VerifyHoldingsRequest,
    strategy: str = Query("MERGE", description="MERGE or OVERWRITE"),
    db: Session = Depends(get_db)
):
    account = db.query(models.Account).filter(models.Account.id == request.account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    symbols = [h.symbol for h in request.holdings]
    live_prices = fetch_live_prices_batch(symbols) if symbols else {}

    if strategy == "OVERWRITE":
        db.query(models.Holding).filter(models.Holding.account_id == request.account_id).delete()
        db.commit()

        for h in request.holdings:
            lp = live_prices.get(h.symbol) or live_prices.get(h.symbol.upper()) or h.current_price or h.avg_buy_price
            db_h = models.Holding(
                account_id=request.account_id,
                symbol=h.symbol,
                company_name=h.company_name,
                quantity=h.quantity,
                avg_buy_price=h.avg_buy_price,
                current_price=lp
            )
            db.add(db_h)

    else:
        existing_holdings = db.query(models.Holding).filter(models.Holding.account_id == request.account_id).all()
        existing_map = {eh.symbol: eh for eh in existing_holdings}

        for h in request.holdings:
            lp = live_prices.get(h.symbol) or live_prices.get(h.symbol.upper()) or h.current_price or h.avg_buy_price
            if h.symbol in existing_map:
                eh = existing_map[h.symbol]
                eh.quantity = h.quantity
                eh.avg_buy_price = h.avg_buy_price
                eh.current_price = lp
            else:
                db_h = models.Holding(
                    account_id=request.account_id,
                    symbol=h.symbol,
                    company_name=h.company_name,
                    quantity=h.quantity,
                    avg_buy_price=h.avg_buy_price,
                    current_price=lp
                )
                db.add(db_h)

    account.last_synced_at = models.datetime.now(models.timezone.utc)
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
def get_consolidated_portfolio(db: Session = Depends(get_db)):
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
