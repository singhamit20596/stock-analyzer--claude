from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime

class AccountCreate(BaseModel):
    name: str
    broker: str
    auth_credentials: Optional[str] = None
    sync_method: Optional[str] = "API"

class AccountOut(BaseModel):
    id: str
    name: str
    broker: str
    auth_credentials: Optional[str] = None
    sync_method: str
    last_synced_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True

class HoldingData(BaseModel):
    symbol: str
    company_name: Optional[str] = ""
    quantity: float
    avg_buy_price: float
    current_price: Optional[float] = 0.0

class HoldingCreate(BaseModel):
    account_id: str
    symbol: str
    company_name: Optional[str] = ""
    quantity: float
    avg_buy_price: float
    current_price: Optional[float] = 0.0
    is_user_verified: Optional[bool] = True

class HoldingUpdate(BaseModel):
    symbol: Optional[str] = None
    company_name: Optional[str] = None
    quantity: Optional[float] = None
    avg_buy_price: Optional[float] = None
    current_price: Optional[float] = None
    is_user_verified: Optional[bool] = None

class HoldingOut(BaseModel):
    id: str
    account_id: str
    symbol: str
    company_name: Optional[str] = None
    quantity: float
    avg_buy_price: float
    current_price: float
    is_user_verified: bool
    updated_at: datetime

    class Config:
        from_attributes = True

class HoldingsBatchVerify(BaseModel):
    account_id: str
    holdings: List[HoldingData]

class TargetAllocationCreate(BaseModel):
    symbol: str
    target_percentage: float

class TargetAllocationOut(BaseModel):
    id: str
    symbol: str
    target_percentage: float
    updated_at: datetime

    class Config:
        from_attributes = True

class SyncLogOut(BaseModel):
    id: str
    account_id: Optional[str] = None
    status: str
    message: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True
