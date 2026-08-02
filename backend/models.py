from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid
from database import Base

def generate_uuid():
    return str(uuid.uuid4())

class Account(Base):
    __tablename__ = "accounts"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False)  # e.g., "Amit Groww", "Preeti US"
    broker = Column(String, nullable=False)  # e.g., "GROWW", "INDMONEY", "ZERODHA"
    sync_method = Column(String, default="IMAGE_OCR")  # "IMAGE_OCR", "CAS_PDF", "API_SYNC"
    currency_type = Column(String, default="IND")  # "IND" (₹ INR) or "US" ($ USD)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    last_synced_at = Column(DateTime, nullable=True)

    holdings = relationship("Holding", back_populates="account", cascade="all, delete-orphan")
    credentials = relationship("AccountCredential", back_populates="account", cascade="all, delete-orphan")


class AccountCredential(Base):
    __tablename__ = "account_credentials"

    id = Column(String, primary_key=True, default=generate_uuid)
    account_id = Column(String, ForeignKey("accounts.id"), nullable=False)
    key_name = Column(String, nullable=False)  # e.g., "API_KEY", "CLIENT_ID"
    value = Column(String, nullable=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    account = relationship("Account", back_populates="credentials")


class Holding(Base):
    __tablename__ = "holdings"

    id = Column(String, primary_key=True, default=generate_uuid)
    account_id = Column(String, ForeignKey("accounts.id"), nullable=False)
    symbol = Column(String, nullable=False)  # Ticker symbol e.g., "RELIANCE", "AAPL"
    company_name = Column(String, nullable=False)
    quantity = Column(Float, nullable=False)
    avg_buy_price = Column(Float, nullable=False)
    current_price = Column(Float, nullable=False)
    is_user_verified = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc))

    account = relationship("Account", back_populates="holdings")


class TargetAllocation(Base):
    __tablename__ = "target_allocations"

    id = Column(String, primary_key=True, default=generate_uuid)
    symbol = Column(String, nullable=False, unique=True)
    company_name = Column(String, nullable=False)
    target_percentage = Column(Float, nullable=False)  # e.g., 10.0 for 10%
    asset_class = Column(String, default="EQUITY")  # e.g., "EQUITY", "DEBT", "GOLD"


class SyncLog(Base):
    __tablename__ = "sync_logs"

    id = Column(String, primary_key=True, default=generate_uuid)
    account_id = Column(String, ForeignKey("accounts.id"), nullable=False)
    status = Column(String, nullable=False)  # "SUCCESS", "FAILED"
    holdings_count = Column(Integer, default=0)
    error_message = Column(String, nullable=True)
    synced_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
