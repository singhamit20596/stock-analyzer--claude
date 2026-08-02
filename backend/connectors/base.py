from typing import List, Dict, Any
from schemas import HoldingData

class BaseConnector:
    """Base class for broker connectors"""
    
    def __init__(self, auth_credentials: str = None):
        self.auth_credentials = auth_credentials

    async def fetch_holdings(self) -> List[HoldingData]:
        raise NotImplementedError("Subclasses must implement fetch_holdings")
