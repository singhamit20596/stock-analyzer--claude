import io
import re
import csv
from typing import List, Optional
from connectors.base import BaseConnector
from schemas import HoldingData

class CASParserConnector(BaseConnector):
    """
    CDSL / NSDL CAS PDF Statement and CSV Parser Connector
    """

    @staticmethod
    def parse_csv_bytes(content_bytes: bytes) -> List[HoldingData]:
        holdings = []
        try:
            text = content_bytes.decode("utf-8")
            reader = csv.DictReader(io.StringIO(text))
            for row in reader:
                # Flexible column key matching
                symbol = row.get("Symbol") or row.get("symbol") or row.get("Ticker") or row.get("Stock") or "UNKNOWN"
                name = row.get("Company Name") or row.get("Name") or row.get("name") or symbol
                qty = row.get("Quantity") or row.get("qty") or row.get("Qty") or 0
                buy_price = row.get("Avg Price") or row.get("Buy Price") or row.get("Avg Buy Price") or row.get("Cost") or 0.0
                curr_price = row.get("LTP") or row.get("Current Price") or row.get("Market Price") or 0.0

                holdings.append(HoldingData(
                    symbol=str(symbol).strip().upper(),
                    company_name=str(name).strip(),
                    quantity=float(qty),
                    avg_buy_price=float(buy_price),
                    current_price=float(curr_price) if float(curr_price) > 0 else float(buy_price)
                ))
        except Exception as e:
            print(f"[CASParserConnector] CSV parse error: {e}")
        return holdings

    @staticmethod
    def parse_pdf_bytes(content_bytes: bytes, password: Optional[str] = None) -> List[HoldingData]:
        holdings = []
        try:
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(content_bytes))
            if reader.is_encrypted and password:
                reader.decrypt(password)
            
            full_text = ""
            for page in reader.pages:
                full_text += page.extract_text() or ""
            
            # Simple regex search pattern for CAS Equity lines (ISIN, Company, Qty, Valuation)
            # Pattern matches ticker/name followed by numerical quantity and price
            lines = full_text.split("\n")
            for line in lines:
                match = re.search(r"([A-Z0-9]{2,15})\s+([A-Za-z0-9\.\s]+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)", line)
                if match:
                    sym, name, qty, val = match.groups()
                    holdings.append(HoldingData(
                        symbol=sym.upper(),
                        company_name=name.strip(),
                        quantity=float(qty),
                        avg_buy_price=float(val) / max(float(qty), 1.0),
                        current_price=float(val) / max(float(qty), 1.0)
                    ))
        except Exception as e:
            print(f"[CASParserConnector] PDF parse error: {e}")
        return holdings

    async def fetch_holdings(self) -> List[HoldingData]:
        # Fallback / Initial Demo Mock Data for CAS Import Account
        return [
            HoldingData(symbol="RELIANCE", company_name="Reliance Industries Ltd", quantity=25, avg_buy_price=2480.0, current_price=2980.0),
            HoldingData(symbol="BHARTIARTL", company_name="Bharti Airtel Ltd", quantity=80, avg_buy_price=850.0, current_price=1450.0),
            HoldingData(symbol="LTIM", company_name="LTIMindtree Ltd", quantity=15, avg_buy_price=4800.0, current_price=5350.0),
            HoldingData(symbol="INFY", company_name="Infosys Ltd", quantity=30, avg_buy_price=1450.0, current_price=1750.0),
        ]
