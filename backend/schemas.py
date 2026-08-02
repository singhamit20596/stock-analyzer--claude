from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class AccountBase(BaseModel):
    name: str
    broker: str
    sync_method: Optional[str] = "IMAGE_OCR"
    currency_type: Optional[str] = "IND"  # "IND" (₹ INR) or "US" ($ USD)

class AccountCreate(AccountBase):
    credentials: Optional[dict] = {}

class AccountResponse(AccountBase):
    id: str
    is_active: bool
    created_at: datetime
    last_synced_at: Optional[datetime] = None

    class Config:
        from_attributes = True

class HoldingBase(BaseModel):
    symbol: str
    company_name: str
    quantity: float
    avg_buy_price: float
    current_price: Optional[float] = 0.0

class HoldingResponse(HoldingBase):
    id: str
    account_id: str
    is_user_verified: bool = False
    updated_at: datetime

    class Config:
        from_attributes = True

class HoldingUpdate(BaseModel):
    symbol: Optional[str] = None
    company_name: Optional[str] = None
    quantity: Optional[float] = None
    avg_buy_price: Optional[float] = None
    current_price: Optional[float] = None
    is_user_verified: Optional[bool] = None

class TargetAllocationBase(BaseModel):
    symbol: str
    company_name: str
    target_percentage: float
    asset_class: Optional[str] = "EQUITY"

class TargetAllocationResponse(TargetAllocationBase):
    id: str

    class Config:
        from_attributes = True

class OCRIngestRequest(BaseModel):
    broker_hint: Optional[str] = "GROWW"
    account_id: Optional[str] = None

class VerifyHoldingsRequest(BaseModel):
    account_id: str
    holdings: List[HoldingBase]
