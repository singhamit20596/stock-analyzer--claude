import os
import shutil
import threading
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import (Depends, FastAPI, File, Header, HTTPException, Query,
                     Request, UploadFile)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

import migrations
import models
import schemas
from database import engine, get_db
from services.deduplicator import AccountDeduplicator
from services.ocr_engine import PortfolioOCREngine
from services.portfolio_engine import PortfolioAggregator, account_currency
from services import (auth_engine, chat_agent, daily_engine, history_engine,
                      holdings_history, news_engine, position_engine,
                      price_moves, stock_detail, target_engine, taxonomy)
from services.quote_service import (fetch_live_prices_batch, fetch_sector,
                                   fetch_sectors_batch, fetch_usd_to_inr_rate)
from services.symbols import guess_market, normalize_symbol

models.Base.metadata.create_all(bind=engine)
# create_all only adds missing tables, so a database from before logins existed
# still needs its columns and unique constraints brought up to date.
migrations.run(engine)
migrations.seed_change_log(engine)

SCREENSHOTS_DIR = os.path.join(os.path.dirname(__file__), "screenshots")
os.makedirs(SCREENSHOTS_DIR, exist_ok=True)


def _warm_anthropic_sdk() -> None:
    """Fault the Anthropic SDK in ahead of the first request that needs it.

    The venv sits on an iCloud path, and once macOS has evicted the package
    the import has to pull it back down — measured at eleven minutes from cold,
    against 0.7s warm. Both the assistant and the news fetch import it lazily,
    so without this the first click on either looks like the app has hung.
    Failure is ignored: this is a cache warm-up, not a dependency check.
    """
    try:
        import anthropic  # noqa: F401
    except Exception:
        pass


threading.Thread(target=_warm_anthropic_sdk, daemon=True).start()

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


# ─────────────────────────────────────────────────────────────
# AUTHENTICATION
# ─────────────────────────────────────────────────────────────

def _bearer(authorization: Optional[str]) -> Optional[str]:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    return token.strip() if scheme.lower() == "bearer" and token.strip() else None


def current_user(authorization: Optional[str] = Header(None),
                 db: Session = Depends(get_db)) -> models.User:
    """The signed-in user, or 401."""
    user = auth_engine.resolve_token(db, _bearer(authorization))
    if user is None:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    return user


class Viewer:
    """Who is signed in, and whose data is being looked at.

    They differ only when an admin is viewing another user. In that case the
    session stays the admin's — so the audit trail and the write guard still
    know who is really acting — while every query is scoped to `user`.
    """

    def __init__(self, account: models.User, target: models.User):
        self.account = account          # who signed in
        self.user = target              # whose data is in scope
        self.impersonating = account.id != target.id

    @property
    def id(self) -> str:
        return self.user.id

    @property
    def is_admin(self) -> bool:
        return self.account.role == auth_engine.ADMIN_ROLE


def viewer(request: Request,
           x_view_as: Optional[str] = Header(None),
           account: models.User = Depends(current_user),
           db: Session = Depends(get_db)) -> Viewer:
    """Resolves the admin's "view as" header into the user being inspected.

    Non-admins are always themselves. An admin viewing someone else is held to
    reads: the choice was to let the admin see everything, not to edit on
    another person's behalf, and a stray click on a page rendered with someone
    else's data would otherwise change their portfolio.
    """
    if not x_view_as or x_view_as == account.id:
        return Viewer(account, account)

    if account.role != auth_engine.ADMIN_ROLE:
        raise HTTPException(status_code=403, detail="Only an admin can view other users.")

    target = db.query(models.User).filter(models.User.id == x_view_as).first()
    if target is None:
        raise HTTPException(status_code=404, detail="No such user.")

    if request.method not in ("GET", "HEAD", "OPTIONS"):
        raise HTTPException(
            status_code=403,
            detail=f"Viewing {target.username} is read-only. "
                   f"Switch back to your own account to make changes.")

    return Viewer(account, target)


# ── ownership-scoped lookups ─────────────────────────────────
# Every query for user-owned data goes through one of these. Filtering at each
# call site instead would mean one forgotten `.filter` is a data leak between
# users, and there are more than fifty such call sites.

def _accounts_of(db: Session, view: Viewer) -> List[models.Account]:
    return (db.query(models.Account)
            .filter(models.Account.user_id == view.id).all())


def _account_or_404(db: Session, view: Viewer, account_id: str) -> models.Account:
    account = (db.query(models.Account)
               .filter(models.Account.id == account_id,
                       models.Account.user_id == view.id).first())
    if account is None:
        # Deliberately the same answer as a genuinely missing row: whether
        # someone else owns this id is not this user's business.
        raise HTTPException(status_code=404, detail="Account not found")
    return account


def _holdings_of(db: Session, view: Viewer) -> List[models.Holding]:
    """Every holding in the viewer's own accounts."""
    account_ids = [a.id for a in _accounts_of(db, view)]
    if not account_ids:
        return []
    return (db.query(models.Holding)
            .filter(models.Holding.account_id.in_(account_ids)).all())


def _portfolio_or_404(db: Session, view: Viewer, portfolio_id: str) -> models.Portfolio:
    portfolio = (db.query(models.Portfolio)
                 .filter(models.Portfolio.id == portfolio_id,
                         models.Portfolio.user_id == view.id).first())
    if portfolio is None:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return portfolio


def _target_or_404(db: Session, view: Viewer, target_id: str) -> models.TargetPortfolio:
    target = (db.query(models.TargetPortfolio)
              .filter(models.TargetPortfolio.id == target_id,
                      models.TargetPortfolio.user_id == view.id).first())
    if target is None:
        raise HTTPException(status_code=404, detail="Target not found")
    return target


def _watch_of(db: Session, view: Viewer) -> List[models.WatchStock]:
    return (db.query(models.WatchStock)
            .filter(models.WatchStock.user_id == view.id).all())


@app.get("/api/auth/status")
def auth_status(db: Session = Depends(get_db)):
    """Whether anyone has registered yet, so the UI knows to offer the first
    account — which is the one that becomes admin."""
    return {"has_users": auth_engine.user_count(db) > 0}


@app.post("/api/auth/register")
def register(payload: schemas.CredentialsRequest, db: Session = Depends(get_db)):
    problem = auth_engine.validate_credentials(payload.username, payload.password)
    if problem:
        raise HTTPException(status_code=400, detail=problem)
    if auth_engine.find_user(db, payload.username):
        raise HTTPException(status_code=409, detail="That username is taken.")

    first = auth_engine.user_count(db) == 0
    user = auth_engine.create_user(db, payload.username, payload.password)
    claimed = auth_engine.claim_unowned_data(db, user) if first else {}

    token, expires = auth_engine.issue_token(db, user)
    return {
        "token": token,
        "expires_at": expires,
        "user": {"id": user.id, "username": user.username, "role": user.role},
        "claimed": claimed,
    }


@app.post("/api/auth/login")
def login(payload: schemas.CredentialsRequest, db: Session = Depends(get_db)):
    user = auth_engine.authenticate(db, payload.username, payload.password)
    if user is None:
        # Same message either way, so this cannot be used to discover usernames.
        raise HTTPException(status_code=401, detail="Incorrect username or password.")
    token, expires = auth_engine.issue_token(db, user)
    return {
        "token": token,
        "expires_at": expires,
        "user": {"id": user.id, "username": user.username, "role": user.role},
    }


@app.post("/api/auth/logout")
def logout(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)):
    auth_engine.revoke_token(db, _bearer(authorization))
    return {"message": "Signed out."}


@app.get("/api/auth/me")
def whoami(account: models.User = Depends(current_user), db: Session = Depends(get_db)):
    """The signed-in user, plus the list of users an admin may view."""
    others = []
    if account.role == auth_engine.ADMIN_ROLE:
        others = [
            {"id": u.id, "username": u.username, "role": u.role}
            for u in db.query(models.User).order_by(models.User.created_at).all()
        ]
    return {
        "id": account.id,
        "username": account.username,
        "role": account.role,
        "users": others,
    }


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
def get_accounts(db: Session = Depends(get_db), view: Viewer = Depends(viewer)):
    return _accounts_of(db, view)


@app.post("/api/accounts", response_model=schemas.AccountResponse)
def create_account(account: schemas.AccountCreate, db: Session = Depends(get_db),
                   view: Viewer = Depends(viewer)):
    new_acc = models.Account(
        user_id=view.id,
        name=account.name,
        currency_type=account.currency_type or "IND",
        wallet_balance=account.wallet_balance or 0.0,
    )
    db.add(new_acc)
    db.commit()
    db.refresh(new_acc)
    return new_acc


@app.put("/api/accounts/{account_id}", response_model=schemas.AccountResponse)
def update_account(account_id: str, update_data: schemas.AccountUpdate,
                   db: Session = Depends(get_db), view: Viewer = Depends(viewer)):
    acc = _account_or_404(db, view, account_id)

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
def delete_account(account_id: str, db: Session = Depends(get_db),
                   view: Viewer = Depends(viewer)):
    acc = _account_or_404(db, view, account_id)

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

    # Classification is per stock, but it is stored per holding row — so the
    # same stock held in two accounts has two rows that can drift apart (a
    # re-import used to reset one of them to the default). Once they disagree,
    # every reader picks a different winner depending on row order, and the UI
    # contradicts itself. Converge them here, preferring the value that is not
    # the fallback: a wipe reverts to the default, so the non-default side is
    # the user's actual edit.
    grouped: Dict[Tuple[str, str], List[models.Holding]] = {}
    for h in holdings:
        grouped.setdefault((h.symbol.strip().upper(), h.country or "IND"), []).append(h)

    def agree(rows: List[models.Holding], field: str, fallback: str) -> str:
        values = [getattr(r, field) for r in rows if getattr(r, field)]
        if not values:
            return fallback
        return next((v for v in values if v != fallback), values[0])

    resolved: Dict[Tuple[str, str], Dict[str, str]] = {}
    drifted = False
    for key, rows in grouped.items():
        sector = agree(rows, "sector", taxonomy.DEFAULT_SECTOR)
        section = agree(rows, "section", taxonomy.DEFAULT_SECTION)
        for r in rows:
            if r.sector != sector or r.section != section:
                r.sector, r.section = sector, section
                drifted = True
        resolved[key] = {"sector": sector, "section": section}
    if drifted:
        db.commit()

    return resolved


@app.get("/api/accounts/{account_id}/screenshot")
def get_account_screenshot(account_id: str, db: Session = Depends(get_db),
                           view: Viewer = Depends(viewer)):
    acc = _account_or_404(db, view, account_id)
    if not acc.latest_screenshot_path or not os.path.exists(acc.latest_screenshot_path):
        raise HTTPException(status_code=404, detail="No screenshot found for this account")
    return FileResponse(acc.latest_screenshot_path, media_type="image/png")


@app.get("/api/accounts/{account_id}/changes")
def get_account_changes(account_id: str, limit: int = Query(100, ge=1, le=500),
                        db: Session = Depends(get_db), view: Viewer = Depends(viewer)):
    """What each import changed in this account, most recent first."""
    _account_or_404(db, view, account_id)
    return {"account_id": account_id,
            "changes": holdings_history.recent_changes(db, [account_id], limit)}


@app.get("/api/accounts/{account_id}/detail")
def get_account_detail(account_id: str, db: Session = Depends(get_db),
                       view: Viewer = Depends(viewer)):
    """Single-account view, reported in the account's own currency.

    US accounts additionally carry `_inr` fields so the UI can show both.
    """
    acc = _account_or_404(db, view, account_id)

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
    view: Viewer = Depends(viewer),
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
        acc = _account_or_404(db, view, account_id)
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
    view: Viewer = Depends(viewer),
):
    account = _account_or_404(db, view, request.account_id)

    is_us = account.currency_type == "US"
    country = "US" if is_us else "IND"
    currency = "USD" if is_us else "INR"

    prior = db.query(models.Holding).filter(models.Holding.account_id == account.id).all()
    existing = [
        {
            "id": h.id, "symbol": h.symbol, "company_name": h.company_name,
            "quantity": h.quantity, "avg_buy_price": h.avg_buy_price,
            "current_price": h.current_price,
        }
        for h in prior
    ]

    # Rows are deleted and re-inserted below, so anything the user owns has to
    # be carried across by symbol: their sector/section edits, and the date the
    # position was first seen.
    final_holdings, warnings = AccountDeduplicator.process_deduplication(
        existing_holdings=existing,
        incoming_holdings=[h.dict() for h in request.holdings],
        strategy=strategy,
    )

    # Applied as a diff, not a replacement: rows that did not move keep their
    # id, their classification and their first_seen_at, and everything that did
    # move is written to the change log so the history can be reconstructed.
    result = holdings_history.apply_import(
        db, account, final_holdings, country, currency, when=_utcnow())

    account.last_synced_at = _utcnow()
    db.add(models.SyncLog(
        account_id=account.id, status="SUCCESS", holdings_count=len(final_holdings)
    ))
    db.commit()

    return {
        "message": "Holdings saved successfully",
        "count": len(final_holdings),
        "changed": result["changed"],
        "unchanged": result["unchanged"],
        "changes": result["counts"],
        "events": result["events"],
        "warnings": warnings,
    }


# ─────────────────────────────────────────────────────────────
# NAMED PORTFOLIOS
# ─────────────────────────────────────────────────────────────

@app.get("/api/portfolios")
def list_portfolios(db: Session = Depends(get_db), view: Viewer = Depends(viewer)):
    result = []
    owned = (db.query(models.Portfolio)
             .filter(models.Portfolio.user_id == view.id).all())
    for p in owned:
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


def _replace_portfolio_accounts(db: Session, view: Viewer, portfolio_id: str,
                                account_ids: List[str]) -> None:
    db.query(models.PortfolioAccount).filter(
        models.PortfolioAccount.portfolio_id == portfolio_id
    ).delete()
    # Only the viewer's own accounts can be linked, so a guessed id from
    # someone else's account cannot be pulled into this portfolio.
    known = {
        a.id for a in db.query(models.Account)
        .filter(models.Account.id.in_(account_ids),
                models.Account.user_id == view.id).all()
    }
    for acc_id in dict.fromkeys(account_ids):  # de-duplicate, keep order
        if acc_id in known:
            db.add(models.PortfolioAccount(portfolio_id=portfolio_id, account_id=acc_id))


def _portfolio_name_clash(db: Session, view: Viewer, name: str,
                          exclude_id: Optional[str] = None) -> bool:
    query = db.query(models.Portfolio).filter(models.Portfolio.name == name,
                                              models.Portfolio.user_id == view.id)
    if exclude_id:
        query = query.filter(models.Portfolio.id != exclude_id)
    return query.first() is not None


@app.post("/api/portfolios")
def create_portfolio(payload: schemas.PortfolioCreate, db: Session = Depends(get_db),
                     view: Viewer = Depends(viewer)):
    if _portfolio_name_clash(db, view, payload.name):
        raise HTTPException(status_code=400, detail=f"Portfolio '{payload.name}' already exists")

    portfolio = models.Portfolio(name=payload.name, user_id=view.id)
    db.add(portfolio)
    db.flush()
    _replace_portfolio_accounts(db, view, portfolio.id, payload.account_ids)
    db.commit()
    db.refresh(portfolio)
    return {"id": portfolio.id, "name": portfolio.name, "created_at": portfolio.created_at}


@app.put("/api/portfolios/{portfolio_id}")
def update_portfolio(portfolio_id: str, payload: schemas.PortfolioCreate,
                     db: Session = Depends(get_db), view: Viewer = Depends(viewer)):
    portfolio = _portfolio_or_404(db, view, portfolio_id)

    if _portfolio_name_clash(db, view, payload.name, exclude_id=portfolio_id):
        raise HTTPException(status_code=400, detail=f"Portfolio '{payload.name}' already exists")

    portfolio.name = payload.name
    _replace_portfolio_accounts(db, view, portfolio_id, payload.account_ids)
    db.commit()
    db.refresh(portfolio)
    return {"id": portfolio.id, "name": portfolio.name}


@app.delete("/api/portfolios/{portfolio_id}")
def delete_portfolio(portfolio_id: str, db: Session = Depends(get_db),
                     view: Viewer = Depends(viewer)):
    portfolio = _portfolio_or_404(db, view, portfolio_id)
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
def get_portfolio_detail(portfolio_id: str, db: Session = Depends(get_db),
                         view: Viewer = Depends(viewer)):
    """Cross-account view of one named portfolio. Every value is in INR."""
    portfolio = _portfolio_or_404(db, view, portfolio_id)

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

    # Viewing a portfolio is what builds its daily record: the values are
    # already priced here, and there is no background job to do it otherwise.
    # An admin looking at someone else's portfolio does not write to it —
    # read-only has to mean read-only, or the record shows days its owner was
    # never here.
    if not view.impersonating:
        daily_engine.record_snapshot(db, portfolio_id, invested, current)

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
def get_classification(db: Session = Depends(get_db), view: Viewer = Depends(viewer)):
    """One row per distinct symbol: held positions plus watch-list stocks."""
    holdings = _holdings_of(db, view)
    classified = _resolve_sectors(db, holdings)

    accounts = {a.id: a.name for a in _accounts_of(db, view)}

    by_symbol: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for h in holdings:
        key = (h.symbol.strip().upper(), h.country or "IND")
        row = by_symbol.get(key)
        if row is None:
            # Take the classification from the resolver, not from this row —
            # it is the one value every other view will also see.
            meta = classified.get(key, {})
            row = by_symbol[key] = {
                "symbol": key[0],
                "company_name": h.company_name,
                "country": key[1],
                "sector": meta.get("sector") or taxonomy.DEFAULT_SECTOR,
                "section": meta.get("section") or taxonomy.DEFAULT_SECTION,
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
    for w in _watch_of(db, view):
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
    view: Viewer = Depends(viewer),
):
    """Set sector/section for a symbol across every account that holds it."""
    if payload.sector is not None and payload.sector not in taxonomy.SECTORS:
        raise HTTPException(status_code=400, detail=f"Unknown sector: {payload.sector}")
    if payload.section is not None and payload.section not in taxonomy.SECTIONS:
        raise HTTPException(status_code=400, detail=f"Unknown section: {payload.section}")

    sym = symbol.strip().upper()
    account_ids = [a.id for a in _accounts_of(db, view)]
    query = db.query(models.Holding).filter(models.Holding.symbol == sym,
                                            models.Holding.account_id.in_(account_ids))
    if payload.country:
        query = query.filter(models.Holding.country == payload.country)
    holdings = query.all() if account_ids else []

    if holdings:
        for h in holdings:
            if payload.sector is not None:
                h.sector = payload.sector
            if payload.section is not None:
                h.section = payload.section
        db.commit()
        return {"symbol": sym, "updated": len(holdings),
                "sector": holdings[0].sector, "section": holdings[0].section}

    watch_q = db.query(models.WatchStock).filter(models.WatchStock.symbol == sym,
                                                 models.WatchStock.user_id == view.id)
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
                           db: Session = Depends(get_db),
                           view: Viewer = Depends(viewer)):
    """Classify typed stock names. Returns proposals for the user to confirm."""
    names = [n.strip() for n in (payload.names or []) if n and n.strip()]
    if not names:
        raise HTTPException(status_code=400, detail="No stock names provided")

    existing = {
        (h.symbol.strip().upper(), h.country or "IND")
        for h in _holdings_of(db, view)
    } | {
        (w.symbol.strip().upper(), w.country or "IND")
        for w in _watch_of(db, view)
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
                                       db: Session = Depends(get_db),
                                       view: Viewer = Depends(viewer)):
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
        for h in _holdings_of(db, view)
    } | {
        (w.symbol.strip().upper(), w.country or "IND")
        for w in _watch_of(db, view)
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
def add_watch_stocks(payload: schemas.AddStocksRequest, db: Session = Depends(get_db),
                     view: Viewer = Depends(viewer)):
    """Commit confirmed proposals to the watch list."""
    account_ids = [a.id for a in _accounts_of(db, view)]
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
            models.Holding.symbol == sym, models.Holding.country == country,
            models.Holding.account_id.in_(account_ids)
        ).first() if account_ids else None
        if held:
            skipped.append(sym)
            continue

        watch = db.query(models.WatchStock).filter(
            models.WatchStock.symbol == sym, models.WatchStock.country == country,
            models.WatchStock.user_id == view.id
        ).first()
        if watch:
            watch.company_name = item.company_name or watch.company_name
            watch.sector = item.sector or watch.sector
            watch.section = item.section or watch.section
        else:
            db.add(models.WatchStock(
                user_id=view.id,
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
def delete_watch_stock(symbol: str, country: str = "IND", db: Session = Depends(get_db),
                       view: Viewer = Depends(viewer)):
    """Removes a watch-list entry. Held positions are never touched."""
    watch = db.query(models.WatchStock).filter(
        models.WatchStock.symbol == symbol.strip().upper(),
        models.WatchStock.country == country.upper(),
        models.WatchStock.user_id == view.id,
    ).first()
    if not watch:
        raise HTTPException(status_code=404, detail="Watch-list entry not found")
    db.delete(watch)
    db.commit()
    return {"message": "Removed from watch list"}


@app.get("/api/portfolios/{portfolio_id}/history")
def get_portfolio_history(portfolio_id: str, range: str = "3mo",
                          db: Session = Depends(get_db),
                          view: Viewer = Depends(viewer)):
    """Portfolio value over time against Nifty 50, Nasdaq and the S&P 500.

    Reconstructed from current quantities priced at each day's close — see
    history_engine for what that does and does not represent.
    """
    portfolio = _portfolio_or_404(db, view, portfolio_id)
    result = history_engine.build_history(
        _holding_rows_for_history(db, portfolio), range,
        quantity_at=_quantity_reader(db, portfolio).at)
    result["portfolio_id"] = portfolio_id
    result["portfolio_name"] = portfolio.name
    return result


def _portfolio_holdings_for_news(db: Session, portfolio) -> List[Dict[str, Any]]:
    """One entry per distinct stock in the portfolio, with its best-known name."""
    account_ids = [link.account.id for link in portfolio.account_links if link.account]
    if not account_ids:
        return []
    holdings = (db.query(models.Holding)
                .filter(models.Holding.account_id.in_(account_ids)).all())

    distinct: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for h in holdings:
        symbol = (h.symbol or "").strip().upper()
        if not symbol:
            continue
        key = (symbol, (h.country or "IND").upper())
        name = (h.company_name or "").strip()
        entry = distinct.setdefault(
            key, {"symbol": symbol, "country": key[1], "company_name": name})
        # OCR truncates names; the longest one seen is the most complete.
        if len(name) > len(entry["company_name"]):
            entry["company_name"] = name
    return list(distinct.values())


def _positions_for_pnl(db: Session, portfolio) -> List[Dict[str, Any]]:
    """One entry per (symbol, market) with total quantity and weighted average
    cost in the instrument's own currency.

    The average cost is what a newly-arrived position is measured against on
    its first day, so it has to be the cost actually paid, not a market price.
    """
    accounts = [link.account for link in portfolio.account_links if link.account]
    account_map = {a.id: a for a in accounts}
    if not account_map:
        return []
    holdings = (db.query(models.Holding)
                .filter(models.Holding.account_id.in_(list(account_map))).all())

    totals: Dict[Tuple[str, str], Dict[str, float]] = {}
    for h in holdings:
        symbol = (h.symbol or "").strip().upper()
        if not symbol or not h.quantity:
            continue
        country = "US" if account_currency(account_map.get(h.account_id)) == "USD" else "IND"
        bucket = totals.setdefault((symbol, country), {"quantity": 0.0, "cost": 0.0})
        bucket["quantity"] += float(h.quantity)
        bucket["cost"] += float(h.quantity) * float(h.avg_buy_price or 0.0)

    return [
        {"symbol": symbol, "country": country,
         "quantity": round(bucket["quantity"], 6),
         "avg_cost_native": round(bucket["cost"] / bucket["quantity"], 4)
                            if bucket["quantity"] else 0.0}
        for (symbol, country), bucket in totals.items()
    ]


def _quantity_reader(db: Session, portfolio) -> holdings_history.QuantityReader:
    """Replays the change log for this portfolio's accounts."""
    account_ids = [link.account.id for link in portfolio.account_links if link.account]
    return holdings_history.quantity_reader(db, account_ids)


def _holding_rows_for_history(db: Session, portfolio) -> List[Dict[str, Any]]:
    """Quantities per (symbol, market), in the shape `history_engine` wants."""
    accounts = [link.account for link in portfolio.account_links if link.account]
    account_map = {a.id: a for a in accounts}
    account_ids = list(account_map)
    holdings = (
        db.query(models.Holding).filter(models.Holding.account_id.in_(account_ids)).all()
        if account_ids else []
    )
    return [
        {
            "symbol": h.symbol,
            "quantity": h.quantity,
            "country": "US" if account_currency(account_map.get(h.account_id)) == "USD" else "IND",
        }
        for h in holdings
    ]


@app.get("/api/portfolios/{portfolio_id}/price-changes")
def get_portfolio_price_changes(portfolio_id: str, db: Session = Depends(get_db),
                                view: Viewer = Depends(viewer)):
    """1D/7D/30D/6M/1Y move for every holding in the portfolio.

    Separate from `/detail` on purpose: on a cold cache this reads a year of
    candles per symbol, and the table should render immediately and fill these
    columns in rather than wait.
    """
    portfolio = _portfolio_or_404(db, view, portfolio_id)
    rows = _holding_rows_for_history(db, portfolio)
    return {"portfolio_id": portfolio_id,
            "changes": price_moves.changes_for_many(
                (r["symbol"], r["country"]) for r in rows)}


@app.post("/api/portfolios/{portfolio_id}/news")
def get_portfolio_news(portfolio_id: str,
                       window_days: int = Query(news_engine.DEFAULT_WINDOW_DAYS, ge=1, le=90),
                       db: Session = Depends(get_db), view: Viewer = Depends(viewer)):
    """Material news across the portfolio's holdings.

    A POST because it is an action with a real cost — a dozen web searches
    against a paid model — not something to fire on every page load.
    """
    portfolio = _portfolio_or_404(db, view, portfolio_id)

    holdings = _portfolio_holdings_for_news(db, portfolio)
    if not holdings:
        return {"items": [], "covered": 0, "holdings": 0}

    try:
        result = news_engine.portfolio_news(holdings, window_days)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"News lookup failed: {exc}")

    result["holdings"] = len(holdings)
    result["fetched_at"] = _utcnow()
    return result


@app.post("/api/stock/{symbol}/news")
def get_stock_news(symbol: str, country: str = Query("IND"),
                   company_name: str = Query(""),
                   window_days: int = Query(30, ge=1, le=90),
                   view: Viewer = Depends(viewer)):
    """A deeper read on one stock, for the "more" action on a news card."""
    try:
        result = news_engine.stock_news(symbol, company_name, country, window_days)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"News lookup failed: {exc}")
    result["fetched_at"] = _utcnow()
    return result


@app.get("/api/portfolios/{portfolio_id}/daily")
def get_portfolio_daily(portfolio_id: str,
                        limit: int = Query(daily_engine.DISPLAY_DAYS, ge=1, le=365),
                        db: Session = Depends(get_db),
                        view: Viewer = Depends(viewer)):
    """Day-by-day value, P&L and percentage move, newest first.

    Days the app recorded live are used as-is; earlier days are reconstructed
    from price history so the section is populated before recording has had
    time to accumulate. Every row says which it is.
    """
    portfolio = _portfolio_or_404(db, view, portfolio_id)

    result = daily_engine.build_daily(
        db, portfolio_id, _positions_for_pnl(db, portfolio),
        _quantity_reader(db, portfolio).at, limit)
    result["portfolio_name"] = portfolio.name
    return result


@app.post("/api/chat")
def chat(payload: schemas.ChatRequest, db: Session = Depends(get_db),
         view: Viewer = Depends(viewer)):
    """Ask the portfolio assistant a question.

    Assembles the full portfolio into the prompt (see chat_agent for why that
    beats retrieval at this size) and lets the model search the web itself.

    Only the viewer's own holdings are assembled — the prompt is the one place
    where another user's positions would leak in full rather than a row at a
    time.
    """
    if not payload.messages:
        raise HTTPException(status_code=400, detail="No messages provided")

    accounts = _accounts_of(db, view)
    holdings = _holdings_of(db, view)
    classified = _resolve_sectors(db, holdings)

    live_prices, usd_inr_rate = _price_quotes(accounts, holdings)
    aggregated = PortfolioAggregator.aggregate_holdings(
        accounts, holdings, live_prices, usd_inr_rate
    )

    first_seen = {
        (h.symbol.strip().upper(), h.country or "IND"): h.first_seen_at
        for h in holdings if h.first_seen_at
    }
    rows = []
    for item in aggregated["items"]:
        seen = first_seen.get((item["symbol"], item["country"]))
        rows.append({
            "symbol": item["symbol"],
            "company_name": item["company_name"],
            "country": item["country"],
            "sector": item.get("sector"),
            "section": item.get("section"),
            "quantity": item["total_quantity"],
            "avg_buy_price_inr": item["wacp_inr"],
            "current_price_inr": item["current_price_inr"],
            "current_value_inr": item["current_value_inr"],
            "pnl_inr": item["pnl_inr"],
            "pnl_percent": item["pnl_percent"],
            "first_seen_at": seen.strftime("%Y-%m-%d") if seen else None,
        })

    for row in rows:
        meta = classified.get((row["symbol"], row["country"])) or {}
        row["sector"] = row["sector"] or meta.get("sector")
        row["section"] = row["section"] or meta.get("section")

    wallet_by_market = {"IND": 0.0, "US": 0.0}
    account_rows = []
    for a in accounts:
        is_us = a.currency_type == "US"
        wallet_inr = (a.wallet_balance or 0.0) * (usd_inr_rate if is_us else 1.0)
        wallet_by_market["US" if is_us else "IND"] += wallet_inr
        account_rows.append({
            "name": a.name,
            "currency_type": a.currency_type,
            "wallet_balance_inr": round(wallet_inr, 2),
        })

    summary = aggregated["summary"]
    invested = summary["total_invested_inr"]
    current = summary["current_value_inr"]
    total_wallet = wallet_by_market["IND"] + wallet_by_market["US"]

    def market_slice(market: str) -> Dict[str, Any]:
        inv = sum(r["current_value_inr"] for r in rows if r["country"] == market)
        cost = sum(r["current_value_inr"] - r["pnl_inr"] for r in rows if r["country"] == market)
        return {
            "invested": round(cost, 2),
            "current": round(inv, 2),
            "pnl": round(inv - cost, 2),
            "pnl_percent": round((inv - cost) / cost * 100, 2) if cost > 0 else 0.0,
            "wallet": round(wallet_by_market[market], 2),
        }

    ind, us = market_slice("IND"), market_slice("US")
    ind_total = ind["current"] + ind["wallet"]
    us_total = us["current"] + us["wallet"]

    snapshot = {
        "usd_inr_rate": usd_inr_rate,
        "summary": {
            "total_invested_inr": invested,
            "total_current_inr": current,
            "total_pnl_inr": summary["total_pnl_inr"],
            "total_pnl_percent": summary["total_pnl_percent"],
            "total_wallet_inr": round(total_wallet, 2),
            "invested_to_cash_ratio": f"{invested:.0f} : {total_wallet:.0f}",
            "us_to_ind_ratio": f"{us_total:.0f} : {ind_total:.0f}",
            "ind_metrics": ind,
            "us_metrics": us,
        },
        "accounts": account_rows,
        "holdings": rows,
        "targets": [_target_payload(t) for t in db.query(models.TargetPortfolio).all()],
        "watchlist": [
            {"symbol": w.symbol, "country": w.country,
             "sector": w.sector, "section": w.section}
            for w in db.query(models.WatchStock).all()
        ],
    }

    try:
        result = chat_agent.ask([m.dict() for m in payload.messages], snapshot)
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Assistant call failed: {exc}")

    result["holdings_in_context"] = len(rows)
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
def list_targets(db: Session = Depends(get_db), view: Viewer = Depends(viewer)):
    targets = (db.query(models.TargetPortfolio)
               .filter(models.TargetPortfolio.user_id == view.id)
               .order_by(models.TargetPortfolio.name).all())
    return {
        "sectors": taxonomy.SECTORS,
        "sections": taxonomy.SECTIONS,
        "targets": [_target_payload(t) for t in targets],
    }


@app.post("/api/targets")
def create_target(payload: schemas.TargetPortfolioCreate, db: Session = Depends(get_db),
                  view: Viewer = Depends(viewer)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Target name is required")
    if db.query(models.TargetPortfolio).filter(
            models.TargetPortfolio.name == name,
            models.TargetPortfolio.user_id == view.id).first():
        raise HTTPException(status_code=400, detail=f"A target named '{name}' already exists")

    target = models.TargetPortfolio(
        user_id=view.id,
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
                  db: Session = Depends(get_db), view: Viewer = Depends(viewer)):
    target = _target_or_404(db, view, target_id)

    target.name = payload.name.strip() or target.name
    target.ind_percent = payload.ind_percent
    target.ind_cash_percent = payload.ind_cash_percent
    target.us_cash_percent = payload.us_cash_percent
    _apply_rules(db, target, payload.rules)
    db.commit()
    db.refresh(target)
    return _target_payload(target)


@app.delete("/api/targets/{target_id}")
def delete_target(target_id: str, db: Session = Depends(get_db),
                  view: Viewer = Depends(viewer)):
    target = _target_or_404(db, view, target_id)
    db.delete(target)
    db.commit()
    return {"message": "Target deleted"}


@app.get("/api/targets/{target_id}/compare")
def compare_target(target_id: str, portfolio_id: str, db: Session = Depends(get_db),
                   view: Viewer = Depends(viewer)):
    """Bucket-level diff between a target's shape and a real portfolio."""
    target = _target_or_404(db, view, target_id)

    detail = get_portfolio_detail(portfolio_id, db, view)
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
def get_sync_logs(db: Session = Depends(get_db), view: Viewer = Depends(viewer)):
    names = {a.id: a.name for a in _accounts_of(db, view)}
    if not names:
        return []
    logs = (
        db.query(models.SyncLog)
        .filter(models.SyncLog.account_id.in_(list(names)))
        .order_by(models.SyncLog.synced_at.desc())
        .limit(50)
        .all()
    )
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
# STOCK DEEP-DIVE ANALYSIS
# ─────────────────────────────────────────────────────────────

def _scope_accounts(db: Session, view: Viewer,
                    portfolio_id: Optional[str]) -> List[models.Account]:
    """The accounts a position is measured against.

    Without a portfolio the scope is every account the viewer owns, so the page
    still works when it is opened from a view that has no portfolio context.
    """
    if portfolio_id:
        portfolio = _portfolio_or_404(db, view, portfolio_id)
        return [link.account for link in portfolio.account_links if link.account]
    return _accounts_of(db, view)


def _pick_target(db: Session, view: Viewer, target_id: Optional[str]):
    """The named target, or the only one there is.

    Falling back to a single target keeps target tracking working without the
    caller having to know about targets; with several defined, guessing which
    one the user means would be wrong, so tracking is simply omitted.
    """
    owned = db.query(models.TargetPortfolio).filter(
        models.TargetPortfolio.user_id == view.id)
    if target_id:
        return owned.filter(models.TargetPortfolio.id == target_id).first()
    targets = owned.all()
    return targets[0] if len(targets) == 1 else None


def _position_context(db: Session, view: Viewer, symbol: str, country: str,
                      portfolio_id: Optional[str], target_id: Optional[str]) -> Dict[str, Any]:
    """The user's holding in this stock, plus how it tracks against target."""
    accounts = _scope_accounts(db, view, portfolio_id)
    account_ids = [a.id for a in accounts]
    holdings = (db.query(models.Holding)
                .filter(models.Holding.account_id.in_(account_ids)).all()
                if account_ids else [])

    live_prices, usd_inr_rate = _price_quotes(accounts, holdings)
    aggregated = PortfolioAggregator.aggregate_holdings(
        accounts, holdings, live_prices, usd_inr_rate)
    sectors = _resolve_sectors(db, holdings)

    key = (symbol.strip().upper(), country.strip().upper())
    position = position_engine.build(
        symbol, country, aggregated, sectors.get(key, {}), holdings, usd_inr_rate)

    target = _pick_target(db, view, target_id)
    tracking = None
    if target and position.get("held"):
        rows = [{
            "symbol": item["symbol"],
            "company_name": item["company_name"],
            "country": item["country"],
            "current_value_inr": item["current_value_inr"],
            **sectors.get((item["symbol"], item["country"]), {}),
        } for item in aggregated["items"]]

        wallet_by_market = {"IND": 0.0, "US": 0.0}
        for account in accounts:
            is_us = account.currency_type == "US"
            wallet_by_market["US" if is_us else "IND"] += (
                (account.wallet_balance or 0.0) * (usd_inr_rate if is_us else 1.0))

        tracking = position_engine.locate_in_target(
            target_engine.compare(target, rows, wallet_by_market), symbol, country)

    return {"position": position, "target_tracking": tracking}


@app.get("/api/stock/{symbol}/analysis")
def get_stock_deep_dive(
    symbol: str,
    country: str = Query("IND"),
    portfolio_id: Optional[str] = Query(None),
    target_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    view: Viewer = Depends(viewer),
):
    """Everything the deep-dive page shows: the user's position first, then
    price history, ratios, quarterly results and technical indicators.

    No verdict is computed anywhere — indicators are inputs, and the page hands
    off to the assistant for interpretation.
    """
    try:
        detail = stock_detail.get_stock_detail(symbol, country)
    except Exception as exc:
        raise HTTPException(status_code=502,
                            detail=f"Market data lookup failed: {exc}")

    detail.update(_position_context(db, view, symbol, country, portfolio_id, target_id))
    return detail


@app.get("/api/stock/{symbol}/candles")
def get_stock_candles(
    symbol: str,
    country: str = Query("IND"),
    range_key: str = Query(stock_detail.DEFAULT_RANGE, alias="range"),
    view: Viewer = Depends(viewer),
):
    """One range of the price series. Separate from the analysis endpoint so
    switching a range pill does not refetch the fundamentals."""
    if range_key.upper() not in stock_detail.RANGES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported range. Use one of: {', '.join(stock_detail.RANGES)}")
    candles = stock_detail.fetch_candles(symbol, country)
    return stock_detail.slice_range(candles, range_key.upper())


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
