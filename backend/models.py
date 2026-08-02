import uuid
from datetime import datetime
from sqlalchemy import Column, String, Float, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from database import Base

def generate_uuid():
    return str(uuid.uuid4())

class Account(Base):
    __tablename__ = "accounts"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String, nullable=False)
    broker = Column(String, nullable=False)  # 'GROWW', 'INDMONEY', 'OTHER', etc.
    auth_credentials = Column(Text, nullable=True)  # Deprecated
    sync_method = Column(String, default="IMAGE_OCR")  # 'IMAGE_OCR', 'MANUAL', 'FILE_IMPORT'
    last_synced_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    holdings = relationship("Holding", back_populates="account", cascade="all, delete-orphan")
    sync_logs = relationship("SyncLog", back_populates="account", cascade="all, delete-orphan")

class Holding(Base):
    __tablename__ = "holdings"

    id = Column(String, primary_key=True, default=generate_uuid)
    account_id = Column(String, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    symbol = Column(String, nullable=False)
    company_name = Column(String, nullable=True)
    quantity = Column(Float, nullable=False)
    avg_buy_price = Column(Float, nullable=False)
    current_price = Column(Float, default=0.0)
    is_user_verified = Column(Boolean, default=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    account = relationship("Account", back_populates="holdings")

class TargetAllocation(Base):
    __tablename__ = "target_allocations"

    id = Column(String, primary_key=True, default=generate_uuid)
    symbol = Column(String, nullable=False, unique=True)
    target_percentage = Column(Float, nullable=False)  # e.g., 15.0 for 15%
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class SyncLog(Base):
    __tablename__ = "sync_logs"

    id = Column(String, primary_key=True, default=generate_uuid)
    account_id = Column(String, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True)
    status = Column(String, nullable=False)  # 'SUCCESS', 'NEEDS_VERIFICATION', 'NEEDS_REAUTH', 'FAILED'
    message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    account = relationship("Account", back_populates="sync_logs")
