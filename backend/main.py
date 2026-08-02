import os
import json
from typing import List, Optional
from datetime import datetime
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from database import engine, Base, get_db
import models
import schemas
from services.ocr_engine import PortfolioOCREngine
from services.deduplicator import AccountDeduplicator
from services.portfolio_engine import get_consolidated_portfolio, get_single_account_detail
from services.rebalancer import compute_rebalancing_plan

# Initialize DB tables
Base.metadata.create_all(bind=engine)

app = FastAPI(title="Stock Portfolio Manager & Rebalancer (OCR Screenshot Ingestion)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def on_startup():
    db = next(get_db())
    if db.query(models.Account).count() == 0:
        demo_groww = models.Account(
            name="Groww Account",
            broker="GROWW",
            sync_method="IMAGE_OCR"
        )
        demo_ind = models.Account(
            name="INDmoney Account",
            broker="INDMONEY",
            sync_method="IMAGE_OCR"
        )
        db.add_all([demo_groww, demo_ind])
        db.commit()
        db.refresh(demo_groww)
        db.refresh(demo_ind)

        # Seed initial target allocations
        db.add_all([
            models.TargetAllocation(symbol="ITBEES", target_percentage=30.0),
            models.TargetAllocation(symbol="TCS", target_percentage=25.0),
            models.TargetAllocation(symbol="INFY", target_percentage=15.0),
            models.TargetAllocation(symbol="HDFCBANK", target_percentage=15.0),
            models.TargetAllocation(symbol="TATAMOTORS", target_percentage=15.0),
        ])
        db.commit()

@app.get("/api/accounts", response_model=List[schemas.AccountOut])
def get_accounts(db: Session = Depends(get_db)):
    return db.query(models.Account).all()

@app.post("/api/accounts", response_model=schemas.AccountOut)
def create_account(acc: schemas.AccountCreate, db: Session = Depends(get_db)):
    new_acc = models.Account(
        name=acc.name,
        broker=acc.broker.upper(),
        sync_method=acc.sync_method or "IMAGE_OCR"
    )
    db.add(new_acc)
    db.commit()
    db.refresh(new_acc)
    return new_acc

@app.delete("/api/accounts/{account_id}")
def delete_account(account_id: str, db: Session = Depends(get_db)):
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")
    db.delete(acc)
    db.commit()
    return {"message": "Account deleted successfully"}

@app.post("/api/upload-ocr-image")
async def upload_ocr_image(
    file: UploadFile = File(...),
    account_id: Optional[str] = Form(None),
    broker_hint: Optional[str] = Form("GROWW"),
    db: Session = Depends(get_db)
):
    return await upload_ocr_images(files=[file], account_id=account_id, broker_hint=broker_hint, db=db)

@app.post("/api/upload-ocr-images")
async def upload_ocr_images(
    files: List[UploadFile] = File(...),
    account_id: Optional[str] = Form(None),
    broker_hint: Optional[str] = Form("GROWW"),
    db: Session = Depends(get_db)
):
    """
    Extracts stock holdings across MULTIPLE uploaded broker screenshot images.
    Reads file content regardless of browser MIME type and merges all holdings with deduplication.
    """
    all_raw_holdings = []
    processed_filenames = []

    for f in files:
        try:
            content = await f.read()
            if content and len(content) > 0:
                extracted = PortfolioOCREngine.process_image(content, broker_hint=broker_hint)
                all_raw_holdings.extend(extracted)
                processed_filenames.append(f.filename)
        except Exception as e:
            print(f"[OCR Error] Failed to parse screenshot {f.filename}: {e}")

    # Deduplicate batch across multiple screenshots
    combined_incoming, batch_warnings = AccountDeduplicator.process_deduplication(
        existing_holdings=[],
        incoming_holdings=all_raw_holdings,
        strategy="MERGE"
    )

    warnings = batch_warnings
    final_holdings = combined_incoming

    valid_account_id = account_id.strip() if (account_id and account_id.strip()) else None

    if valid_account_id:
        existing_models = db.query(models.Holding).filter(models.Holding.account_id == valid_account_id).all()
        existing_dicts = [
            {
                "symbol": h.symbol,
                "company_name": h.company_name,
                "quantity": h.quantity,
                "avg_buy_price": h.avg_buy_price,
                "current_price": h.current_price,
            }
            for h in existing_models
        ]
        
        final_holdings, warnings = AccountDeduplicator.process_deduplication(
            existing_holdings=existing_dicts,
            incoming_holdings=combined_incoming,
            strategy="MERGE"
        )

    return {
        "filenames": processed_filenames,
        "account_id": valid_account_id,
        "broker_hint": broker_hint,
        "extracted_count": len(final_holdings),
        "holdings": final_holdings,
        "warnings": warnings
    }

@app.post("/api/verify-save-holdings")
def verify_and_save_holdings(
    payload: schemas.HoldingsBatchVerify,
    strategy: Optional[str] = "OVERWRITE",
    db: Session = Depends(get_db)
):
    acc = db.query(models.Account).filter(models.Account.id == payload.account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")

    if strategy.upper() == "OVERWRITE":
        db.query(models.Holding).filter(models.Holding.account_id == payload.account_id).delete()

    for item in payload.holdings:
        existing = db.query(models.Holding).filter(
            models.Holding.account_id == payload.account_id,
            models.Holding.symbol == item.symbol.upper()
        ).first()

        if existing:
            existing.company_name = item.company_name or item.symbol
            existing.quantity = item.quantity
            existing.avg_buy_price = item.avg_buy_price
            existing.current_price = item.current_price or item.avg_buy_price
            existing.is_user_verified = True
            existing.updated_at = datetime.utcnow()
        else:
            new_h = models.Holding(
                account_id=payload.account_id,
                symbol=item.symbol.upper(),
                company_name=item.company_name or item.symbol,
                quantity=item.quantity,
                avg_buy_price=item.avg_buy_price,
                current_price=item.current_price or item.avg_buy_price,
                is_user_verified=True
            )
            db.add(new_h)

    acc.last_synced_at = datetime.utcnow()
    log = models.SyncLog(
        account_id=acc.id,
        status="SUCCESS",
        message=f"Verified and saved {len(payload.holdings)} holdings via image OCR screenshot."
    )
    db.add(log)
    db.commit()

    return {"message": "Holdings saved successfully", "count": len(payload.holdings)}

@app.get("/api/portfolio/consolidated")
def get_consolidated_view(account_ids: Optional[str] = None, db: Session = Depends(get_db)):
    parsed_ids = account_ids.split(",") if account_ids else None
    return get_consolidated_portfolio(db, parsed_ids)

@app.get("/api/accounts/{account_id}/detail")
def get_account_detail(account_id: str, db: Session = Depends(get_db)):
    return get_single_account_detail(db, account_id)

@app.put("/api/holdings/{holding_id}")
def update_holding_item(holding_id: str, payload: schemas.HoldingUpdate, db: Session = Depends(get_db)):
    h = db.query(models.Holding).filter(models.Holding.id == holding_id).first()
    if not h:
        raise HTTPException(status_code=404, detail="Holding not found")

    if payload.symbol is not None:
        h.symbol = payload.symbol.upper().strip()
    if payload.company_name is not None:
        h.company_name = payload.company_name.strip()
    if payload.quantity is not None:
        h.quantity = payload.quantity
    if payload.avg_buy_price is not None:
        h.avg_buy_price = payload.avg_buy_price
    if payload.current_price is not None:
        h.current_price = payload.current_price
    if payload.is_user_verified is not None:
        h.is_user_verified = payload.is_user_verified

    h.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(h)
    return {"message": "Holding updated successfully", "holding": {
        "id": h.id,
        "symbol": h.symbol,
        "company_name": h.company_name,
        "quantity": h.quantity,
        "avg_buy_price": h.avg_buy_price,
        "current_price": h.current_price,
        "is_user_verified": h.is_user_verified
    }}

@app.get("/api/rebalance")
def get_rebalance_matrix(account_ids: Optional[str] = None, db: Session = Depends(get_db)):
    parsed_ids = account_ids.split(",") if account_ids else None
    return compute_rebalancing_plan(db, parsed_ids)

@app.get("/api/target-allocations", response_model=List[schemas.TargetAllocationOut])
def get_target_allocations(db: Session = Depends(get_db)):
    return db.query(models.TargetAllocation).all()

@app.post("/api/target-allocations")
def update_target_allocations(targets: List[schemas.TargetAllocationCreate], db: Session = Depends(get_db)):
    db.query(models.TargetAllocation).delete()
    for t in targets:
        if t.target_percentage > 0:
            db.add(models.TargetAllocation(
                symbol=t.symbol.upper(),
                target_percentage=t.target_percentage
            ))
    db.commit()
    return {"message": "Target allocations updated successfully"}

@app.get("/api/sync-logs", response_model=List[schemas.SyncLogOut])
def get_sync_logs(db: Session = Depends(get_db)):
    return db.query(models.SyncLog).order_by(models.SyncLog.created_at.desc()).limit(20).all()

# Serve static frontend dist assets directly on FastAPI
DIST_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../frontend/dist"))
if os.path.exists(DIST_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        if full_path.startswith("api"):
            raise HTTPException(status_code=404, detail="API route not found")
        file_path = os.path.join(DIST_DIR, full_path)
        if os.path.exists(file_path) and os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(DIST_DIR, "index.html"))
