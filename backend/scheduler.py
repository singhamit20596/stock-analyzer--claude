import asyncio
import datetime
from apscheduler.schedulers.background import BackgroundScheduler
from database import SessionLocal
import models
from connectors.groww import GrowwConnector
from connectors.indmoney import INDmoneyConnector
from connectors.cas_parser import CASParserConnector

scheduler = BackgroundScheduler()

async def async_sync_account(acc, db):
    if acc.broker == "GROWW":
        connector = GrowwConnector(acc.auth_credentials)
    elif acc.broker == "INDMONEY":
        connector = INDmoneyConnector(acc.auth_credentials)
    else:
        connector = CASParserConnector(acc.auth_credentials)

    return await connector.fetch_holdings()

def run_daily_portfolio_sync():
    """
    Background job triggered daily (or manually).
    Syncs holdings across all registered broker accounts.
    """
    print(f"[{datetime.datetime.utcnow()}] Running automated daily portfolio sync...")
    db = SessionLocal()
    try:
        accounts = db.query(models.Account).all()
        for acc in accounts:
            try:
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                holdings_data = loop.run_until_complete(async_sync_account(acc, db))
                loop.close()

                # Update existing holdings or append new
                for item in holdings_data:
                    existing = db.query(models.Holding).filter(
                        models.Holding.account_id == acc.id,
                        models.Holding.symbol == item.symbol
                    ).first()

                    if existing:
                        existing.quantity = item.quantity
                        existing.avg_buy_price = item.avg_buy_price
                        existing.current_price = item.current_price
                        existing.updated_at = datetime.datetime.utcnow()
                    else:
                        new_h = models.Holding(
                            account_id=acc.id,
                            symbol=item.symbol,
                            company_name=item.company_name,
                            quantity=item.quantity,
                            avg_buy_price=item.avg_buy_price,
                            current_price=item.current_price,
                            is_user_verified=True
                        )
                        db.add(new_h)

                acc.last_synced_at = datetime.datetime.utcnow()
                log = models.SyncLog(
                    account_id=acc.id,
                    status="SUCCESS",
                    message=f"Synced {len(holdings_data)} holdings successfully."
                )
                db.add(log)
                db.commit()
            except Exception as e:
                db.rollback()
                log = models.SyncLog(
                    account_id=acc.id,
                    status="FAILED",
                    message=f"Sync failed: {str(e)}"
                )
                db.add(log)
                db.commit()
    finally:
        db.close()

def start_scheduler():
    scheduler.add_job(
        run_daily_portfolio_sync,
        'cron',
        hour=10,
        minute=30,
        id='daily_portfolio_sync',
        replace_existing=True
    )
    scheduler.start()
    print("[Scheduler] APScheduler started successfully.")
