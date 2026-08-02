from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel


class AccountBase(BaseModel):
    name: str
    currency_type: Optional[str] = "IND"   # "IND" (₹ INR) or "US" ($ USD)
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
    latest_screenshot_path: Optional[str] = None

    class Config:
        from_attributes = True


class HoldingBase(BaseModel):
    symbol: str
    company_name: Optional[str] = ""
    quantity: float
    avg_buy_price: float
    current_price: Optional[float] = 0.0


class VerifySaveRequest(BaseModel):
    """OCR-parsed holdings, after the user has reviewed them in the UI."""
    account_id: str
    holdings: List[HoldingBase]


class TargetAllocationBase(BaseModel):
    symbol: str
    company_name: Optional[str] = ""
    target_percentage: float
    asset_class: Optional[str] = "EQUITY"


class TargetAllocationResponse(TargetAllocationBase):
    id: str

    class Config:
        from_attributes = True


class PortfolioCreate(BaseModel):
    name: str
    account_ids: List[str]
