from typing import List, Dict, Any
from sqlalchemy.orm import Session
import models
from services.quote_service import fetch_live_prices_batch, fetch_live_stock_price

class PortfolioAggregator:

    @classmethod
    def aggregate_holdings(cls, accounts: List[Any], holdings: List[Any]) -> Dict[str, Any]:
        account_map = {acc.id: acc for acc in accounts}
        symbol_map: Dict[str, Dict[str, Any]] = {}

        for h in holdings:
            symbol = h.symbol.upper()
            acc = account_map.get(h.account_id)
            if symbol not in symbol_map:
                symbol_map[symbol] = {
                    "symbol": symbol,
                    "company_name": h.company_name or symbol,
                    "total_quantity": 0.0,
                    "total_invested": 0.0,
                    "current_price": h.current_price or 0.0,
                    "accounts_breakdown": []
                }

            qty = float(h.quantity)
            buy_price = float(h.avg_buy_price)
            invested = qty * buy_price

            symbol_map[symbol]["total_quantity"] += qty
            symbol_map[symbol]["total_invested"] += invested
            if h.current_price and h.current_price > 0:
                symbol_map[symbol]["current_price"] = float(h.current_price)

            account_name = acc.name if acc else "Unknown"
            currency_type = acc.currency_type if acc else "IND"

            symbol_map[symbol]["accounts_breakdown"].append({
                "account_id": h.account_id,
                "account_name": account_name,
                "currency_type": currency_type,
                "quantity": qty,
                "avg_buy_price": buy_price,
                "invested": invested,
                "current_value": qty * symbol_map[symbol]["current_price"]
            })

        consolidated_items = []
        portfolio_total_invested = 0.0
        portfolio_total_current_value = 0.0

        for symbol, data in symbol_map.items():
            qty = data["total_quantity"]
            total_invested = data["total_invested"]
            wacp = total_invested / qty if qty > 0 else 0.0
            ltp = data["current_price"]
            current_value = qty * ltp
            pnl = current_value - total_invested
            pnl_percent = (pnl / total_invested * 100.0) if total_invested > 0 else 0.0

            portfolio_total_invested += total_invested
            portfolio_total_current_value += current_value

            consolidated_items.append({
                "symbol": symbol,
                "company_name": data["company_name"],
                "total_quantity": qty,
                "wacp": round(wacp, 2),
                "current_price": round(ltp, 2),
                "total_invested": round(total_invested, 2),
                "current_value": round(current_value, 2),
                "pnl": round(pnl, 2),
                "pnl_percent": round(pnl_percent, 2),
                "accounts_breakdown": data["accounts_breakdown"]
            })

        consolidated_items.sort(key=lambda x: x["current_value"], reverse=True)

        portfolio_pnl = portfolio_total_current_value - portfolio_total_invested
        portfolio_pnl_percent = (portfolio_pnl / portfolio_total_invested * 100.0) if portfolio_total_invested > 0 else 0.0

        for item in consolidated_items:
            item["allocation_percent"] = round((item["current_value"] / portfolio_total_current_value * 100.0), 2) if portfolio_total_current_value > 0 else 0.0

        return {
            "summary": {
                "total_invested": round(portfolio_total_invested, 2),
                "current_value": round(portfolio_total_current_value, 2),
                "total_pnl": round(portfolio_pnl, 2),
                "total_pnl_percent": round(portfolio_pnl_percent, 2),
                "total_stocks_count": len(consolidated_items)
            },
            "items": consolidated_items
        }

def get_consolidated_portfolio(db: Session, account_ids: List[str] = None) -> Dict[str, Any]:
    accounts = db.query(models.Account).all()
    holdings = db.query(models.Holding).all()
    return PortfolioAggregator.aggregate_holdings(accounts, holdings)
