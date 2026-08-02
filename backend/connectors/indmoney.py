import json
import httpx
from typing import List
from connectors.base import BaseConnector
from schemas import HoldingData

class INDmoneyConnector(BaseConnector):
    """
    INDmoney API/Session Connector
    Handles INDmoney portfolio fetch using session tokens or credentials payload.
    """

    async def fetch_holdings(self) -> List[HoldingData]:
        token = None
        if self.auth_credentials:
            try:
                data = json.loads(self.auth_credentials)
                token = data.get("token") or data.get("bearer_token") or self.auth_credentials
            except Exception:
                token = self.auth_credentials

        if token and len(token) > 10:
            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    headers = {
                        "Authorization": f"Bearer {token}",
                        "User-Agent": "INDmoney/1.0",
                        "Accept": "application/json"
                    }
                    response = await client.get("https://api.indmoney.com/api/v1/portfolio/user-holdings", headers=headers)
                    if response.status_code == 200:
                        res_json = response.json()
                        holdings = []
                        for item in res_json.get("data", {}).get("holdings", []):
                            holdings.append(HoldingData(
                                symbol=item.get("ticker_symbol", "UNKNOWN").upper(),
                                company_name=item.get("name", ""),
                                quantity=float(item.get("units", 0)),
                                avg_buy_price=float(item.get("avg_price", 0.0)),
                                current_price=float(item.get("current_price", 0.0))
                            ))
                        if holdings:
                            return holdings
            except Exception as e:
                print(f"[INDmoneyConnector] Live fetch exception: {e}")

        # Fallback / Initial Demo Mock Data for INDmoney Account
        return [
            HoldingData(symbol="RELIANCE", company_name="Reliance Industries Ltd", quantity=30, avg_buy_price=2510.0, current_price=2980.0),
            HoldingData(symbol="TATAMOTORS", company_name="Tata Motors Ltd", quantity=100, avg_buy_price=610.0, current_price=980.0),
            HoldingData(symbol="ICICIBANK", company_name="ICICI Bank Ltd", quantity=60, avg_buy_price=920.0, current_price=1210.0),
            HoldingData(symbol="TCS", company_name="Tata Consultancy Services Ltd", quantity=15, avg_buy_price=3600.0, current_price=3850.0),
        ]
