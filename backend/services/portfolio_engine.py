from typing import List, Dict, Any
from sqlalchemy.orm import Session
import models
from services.quote_service import fetch_live_prices_batch, fetch_live_stock_price

def get_consolidated_portfolio(db: Session, account_ids: List[str] = None) -> Dict[str, Any]:
    query = db.query(models.Holding).join(models.Account)
    
    if account_ids and len(account_ids) > 0:
        query = query.filter(models.Holding.account_id.in_(account_ids))
        
    all_holdings = query.all()
    
    symbol_map: Dict[str, Dict[str, Any]] = {}
    
    for h in all_holdings:
        symbol = h.symbol.upper()
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
            
        account_name = h.account.name if h.account else "Unknown"
        broker = h.account.broker if h.account else "Manual"
        
        symbol_map[symbol]["accounts_breakdown"].append({
            "account_id": h.account_id,
            "account_name": account_name,
            "broker": broker,
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

def get_single_account_detail(db: Session, account_id: str) -> Dict[str, Any]:
    acc = db.query(models.Account).filter(models.Account.id == account_id).first()
    if not acc:
        return {
            "account_id": account_id,
            "account_name": "Account Not Found",
            "broker": "UNKNOWN",
            "summary": {
                "invested_value": 0.0,
                "current_value": 0.0,
                "holding_count": 0,
                "pnl": 0.0,
                "pnl_percent": 0.0
            },
            "items": []
        }

    holdings = db.query(models.Holding).filter(models.Holding.account_id == account_id).all()
    symbols = [h.symbol for h in holdings]

    # Fetch live quotes for all account stocks in parallel
    live_quotes = fetch_live_prices_batch(symbols)

    items = []
    total_invested = 0.0
    total_current_val = 0.0

    for h in holdings:
        qty = float(h.quantity)
        avg_price = float(h.avg_buy_price)
        invested = qty * avg_price

        # Retrieve parallel live quote
        live_price = live_quotes.get(h.symbol.upper(), 0.0)
        if live_price <= 0:
            live_price = float(h.current_price or h.avg_buy_price)

        current_val = qty * live_price
        pnl = current_val - invested
        pnl_pct = (pnl / invested * 100.0) if invested > 0 else 0.0

        total_invested += invested
        total_current_val += current_val

        items.append({
            "id": h.id,
            "symbol": h.symbol,
            "company_name": h.company_name or h.symbol,
            "quantity": qty,
            "avg_buy_price": round(avg_price, 2),
            "live_current_price": round(live_price, 2),
            "invested_value": round(invested, 2),
            "current_value": round(current_val, 2),
            "pnl": round(pnl, 2),
            "pnl_percent": round(pnl_pct, 2)
        })

    items.sort(key=lambda x: x["current_value"], reverse=True)

    total_pnl = total_current_val - total_invested
    total_pnl_pct = (total_pnl / total_invested * 100.0) if total_invested > 0 else 0.0

    return {
        "account_id": acc.id,
        "account_name": acc.name,
        "broker": acc.broker,
        "last_synced_at": acc.last_synced_at,
        "summary": {
            "invested_value": round(total_invested, 2),
            "current_value": round(total_current_val, 2),
            "holding_count": len(items),
            "pnl": round(total_pnl, 2),
            "pnl_percent": round(total_pnl_pct, 2)
        },
        "items": items
    }
