from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Table
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid
from database import Base

def generate_uuid():
    return str(uuid.uuid4())

class Account(Base):
    __tablename__ = "accounts"

    id = Column(String, primary_key=True, default=generate_uuid)
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
    is_user_verified = Column(Integer, default=0)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    account = relationship("Account", back_populates="holdings")


class TargetAllocation(Base):
    __tablename__ = "target_allocations"

    id = Column(String, primary_key=True, default=generate_uuid)
    symbol = Column(String, nullable=False, unique=True)
    company_name = Column(String, nullable=False)
    target_percentage = Column(Float, nullable=False)
    asset_class = Column(String, default="EQUITY")


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
    name = Column(String, nullable=False, unique=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    account_links = relationship("PortfolioAccount", back_populates="portfolio", cascade="all, delete-orphan")


class PortfolioAccount(Base):
    __tablename__ = "portfolio_accounts"

    portfolio_id = Column(String, ForeignKey("portfolios.id"), primary_key=True)
    account_id = Column(String, ForeignKey("accounts.id"), primary_key=True)

    portfolio = relationship("Portfolio", back_populates="account_links")
    account = relationship("Account", back_populates="portfolio_links")
