from pydantic import BaseModel
from typing import List, Optional, Dict
from datetime import datetime

class AccountBase(BaseModel):
    name: str
    currency_type: Optional[str] = "IND"
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
    latest_screenshot_path: Optional[str] = None

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
    country: Optional[str] = "IND"
    currency: Optional[str] = "INR"
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

# --- Portfolio Schemas ---

class PortfolioCreate(BaseModel):
    name: str
    account_ids: List[str]

class PortfolioResponse(BaseModel):
    id: str
    name: str
    created_at: datetime
    account_ids: List[str]
    account_names: List[str]

    class Config:
        from_attributes = True

class PortfolioAccountEntry(BaseModel):
    """Per-account qty and avg for a single stock row in the portfolio table."""
    qty: float
    avg_inr: float  # always in INR

class PortfolioStockRow(BaseModel):
    """One row in the portfolio table (one unique symbol+currency combination)."""
    symbol: str
    company_name: str
    country: str         # "IND" or "US"
    currency: str        # "INR" or "USD"
    per_account: Dict[str, PortfolioAccountEntry]  # keyed by account_id
    mkt_price_inr: float
    portfolio_qty: float
    portfolio_avg_inr: float
    invested_value_inr: float
    current_value_inr: float
    pnl_inr: float
    pnl_percent: float
    allocation_percent: float

class PortfolioDetailResponse(BaseModel):
    portfolio_id: str
    portfolio_name: str
    accounts: List[dict]            # [{id, name, currency_type}]
    usd_inr_rate: float
    summary: dict                   # totals
    rows: List[PortfolioStockRow]
