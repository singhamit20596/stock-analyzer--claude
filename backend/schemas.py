from datetime import datetime
from typing import Dict, List, Optional

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


class TargetPortfolioCreate(BaseModel):
    name: str
    ind_percent: float = 50.0
    ind_cash_percent: float = 0.0
    us_cash_percent: float = 0.0
    # {"IND": {"sector": {"Financials": 40.0}, "section": {...}}, "US": {...}}
    rules: Optional[Dict[str, Dict[str, Dict[str, float]]]] = None


class PortfolioCreate(BaseModel):
    name: str
    account_ids: List[str]


class ResolveStocksRequest(BaseModel):
    """Free-text stock names to classify, before anything is saved."""
    names: List[str]


class StockClassification(BaseModel):
    symbol: str
    company_name: Optional[str] = ""
    country: Optional[str] = "IND"
    sector: Optional[str] = None
    section: Optional[str] = None


class AddStocksRequest(BaseModel):
    stocks: List[StockClassification]


class ClassificationUpdate(BaseModel):
    sector: Optional[str] = None
    section: Optional[str] = None
    country: Optional[str] = None
