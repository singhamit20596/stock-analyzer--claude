from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Table, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid
from database import Base

def generate_uuid():
    return str(uuid.uuid4())


class User(Base):
    """A login. The first one to register becomes the admin.

    Portfolios, accounts, targets and watch-list stocks all belong to a user;
    the admin may additionally view any other user's data read-only.
    """
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=generate_uuid)
    username = Column(String, nullable=False, unique=True)
    # PBKDF2-HMAC-SHA256, salt and iteration count encoded alongside the digest.
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False, default="user")  # "admin" or "user"
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class UserSession(Base):
    """An issued login token.

    Only the token's SHA-256 is stored, so a copy of the database does not hand
    over live sessions.
    """
    __tablename__ = "user_sessions"

    token_hash = Column(String, primary_key=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    expires_at = Column(DateTime, nullable=False)


class Account(Base):
    __tablename__ = "accounts"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    name = Column(String, nullable=False)
    currency_type = Column(String, default="IND")  # "IND" (₹ INR) or "US" ($ USD)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    last_synced_at = Column(DateTime, nullable=True)
    wallet_balance = Column(Float, default=0.0, nullable=True)
    latest_screenshot_path = Column(String, nullable=True)

    holdings = relationship("Holding", back_populates="account", cascade="all, delete-orphan")
    portfolio_links = relationship("PortfolioAccount", back_populates="account", cascade="all, delete-orphan")


class Holding(Base):
    __tablename__ = "holdings"

    id = Column(String, primary_key=True, default=generate_uuid)
    account_id = Column(String, ForeignKey("accounts.id"), nullable=False)
    symbol = Column(String, nullable=False)
    company_name = Column(String, nullable=False)
    quantity = Column(Float, nullable=False)
    avg_buy_price = Column(Float, nullable=False)
    current_price = Column(Float, nullable=False)
    country = Column(String, default="IND")     # "IND" or "US"
    currency = Column(String, default="INR")    # "INR" or "USD"
    sector = Column(String, nullable=True)      # Financials, Healthcare, Datacentre, CapitalMarket, AI, Software, Semiconductor, Others
    section = Column(String, nullable=True)     # Hyperscalers, Satellite, regular
    # When this stock first appeared in an import — NOT the purchase date. It
    # dates from when the app started tracking the position, so it is a lower
    # bound on the holding period and nothing more.
    first_seen_at = Column(DateTime, nullable=True)
    is_user_verified = Column(Integer, default=0)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    account = relationship("Account", back_populates="holdings")


class WatchStock(Base):
    """A stock classified but not held in any account.

    Added from the Classification tab so a name can be planned for — it carries
    sector/section but contributes no value to any portfolio.
    """
    __tablename__ = "watch_stocks"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    symbol = Column(String, nullable=False)
    company_name = Column(String, nullable=False, default="")
    country = Column(String, default="IND")     # "IND" or "US"
    sector = Column(String, nullable=True)
    section = Column(String, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    # Scoped to the owner: two users watching the same stock are two rows.
    __table_args__ = (
        UniqueConstraint("user_id", "symbol", "country", name="uq_watch_user_symbol_country"),
    )


class TargetPortfolio(Base):
    """The shape a portfolio should be in, expressed as percentages.

    Split is India-vs-US at the top; within each market the user sets a cash
    ratio plus sector and section splits (see TargetRule).
    """
    __tablename__ = "target_portfolios"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    # Unique per owner, not globally: two users may both have a "Target 1".
    name = Column(String, nullable=False)
    ind_percent = Column(Float, default=50.0)   # of total money; US is the remainder
    ind_cash_percent = Column(Float, default=0.0)  # cash as % of that market's money
    us_cash_percent = Column(Float, default=0.0)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    rules = relationship("TargetRule", back_populates="target",
                         cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_target_user_name"),)


class TargetRule(Base):
    """One sector or section percentage, within one market of one target."""
    __tablename__ = "target_rules"

    id = Column(String, primary_key=True, default=generate_uuid)
    target_id = Column(String, ForeignKey("target_portfolios.id"), nullable=False)
    market = Column(String, nullable=False)      # "IND" or "US"
    dimension = Column(String, nullable=False)   # "sector" or "section"
    key = Column(String, nullable=False)         # e.g. "Financials", "Satellite"
    percent = Column(Float, nullable=False)      # of that market's invested money

    target = relationship("TargetPortfolio", back_populates="rules")


class SyncLog(Base):
    __tablename__ = "sync_logs"

    id = Column(String, primary_key=True, default=generate_uuid)
    account_id = Column(String, ForeignKey("accounts.id"), nullable=False)
    status = Column(String, nullable=False)  # "SUCCESS", "FAILED"
    holdings_count = Column(Integer, default=0)
    synced_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class Portfolio(Base):
    __tablename__ = "portfolios"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=True, index=True)
    # Unique per owner, not globally.
    name = Column(String, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    account_links = relationship("PortfolioAccount", back_populates="portfolio", cascade="all, delete-orphan")

    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_portfolio_user_name"),)


class PortfolioDailySnapshot(Base):
    """What a portfolio was actually worth on a given day.

    The performance chart reconstructs the past by valuing *today's* quantities
    at old closes, so it cannot show what the portfolio really did — a position
    bought last week is priced as though it had been held all along. These rows
    are the real record: each one is written from live values while the user has
    the app open, so the series only becomes true from the day recording starts.

    Rows accumulate forever; the UI shows the most recent 30.
    """
    __tablename__ = "portfolio_daily_snapshots"

    id = Column(String, primary_key=True, default=generate_uuid)
    portfolio_id = Column(String, ForeignKey("portfolios.id"), nullable=False)
    # Local calendar date. One row per portfolio per day, overwritten through
    # the day, so the stored value is the last one seen that day.
    snapshot_date = Column(String, nullable=False)   # "YYYY-MM-DD"
    invested_inr = Column(Float, nullable=False, default=0.0)
    current_value_inr = Column(Float, nullable=False, default=0.0)
    recorded_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                         onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        UniqueConstraint("portfolio_id", "snapshot_date", name="uq_snapshot_portfolio_day"),
    )


class PortfolioAccount(Base):
    __tablename__ = "portfolio_accounts"

    portfolio_id = Column(String, ForeignKey("portfolios.id"), primary_key=True)
    account_id = Column(String, ForeignKey("accounts.id"), primary_key=True)

    portfolio = relationship("Portfolio", back_populates="account_links")
    account = relationship("Account", back_populates="portfolio_links")
