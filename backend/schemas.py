from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class AccountBase(BaseModel):
    name: str
    currency_type: Optional[str] = "IND"  # "IND" (₹ INR) or "US" ($ USD)
    wallet_balance: Optional[float] = 0.0

class AccountCreate(AccountBase):
    pass

class AccountUpdate(BaseModel):
    name: Optional[str] = None
    currency_type: Optional[str] = None
    wallet_balance: Optional[float] = None

class AccountResponse(AccountBase):
    id: str
    created_at: datetime
    last_synced_at: Optional[datetime] = None
    wallet_balance: Optional[float] = 0.0

    class Config:
        from_attributes = True

class HoldingBase(BaseModel):
    symbol: str
    company_name: Optional[str] = ""
    quantity: float
    avg_buy_price: float
    current_price: Optional[float] = 0.0

class HoldingResponse(HoldingBase):
    id: str
    account_id: str
    updated_at: datetime

    class Config:
        from_attributes = True

class HoldingUpdate(BaseModel):
    symbol: Optional[str] = None
    company_name: Optional[str] = None
    quantity: Optional[float] = None
    avg_buy_price: Optional[float] = None
    current_price: Optional[float] = None

class TargetAllocationBase(BaseModel):
    symbol: str
    company_name: Optional[str] = ""
    target_percentage: float
    asset_class: Optional[str] = "EQUITY"

class TargetAllocationResponse(TargetAllocationBase):
    id: str

    class Config:
        from_attributes = True

class VerifyHoldingsRequest(BaseModel):
    account_id: str
    holdings: List[HoldingBase]

VerifySaveRequest = VerifyHoldingsRequest

class WalletBalanceUpdate(BaseModel):
    wallet_balance: float
