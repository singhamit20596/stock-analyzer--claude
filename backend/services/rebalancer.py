from typing import List, Dict, Any
from sqlalchemy.orm import Session
import models
from services.portfolio_engine import get_consolidated_portfolio

def compute_rebalancing_plan(db: Session, account_ids: List[str] = None) -> Dict[str, Any]:
    """
    Calculates target allocation variance and recommended Buy/Sell actions.
    """
    portfolio_data = get_consolidated_portfolio(db, account_ids)
    summary = portfolio_data["summary"]
    items = portfolio_data["items"]
    total_portfolio_value = summary["current_value"]

    # Fetch stored target allocations
    targets_db = db.query(models.TargetAllocation).all()
    targets_map = {t.symbol.upper(): t.target_percentage for t in targets_db}

    rebalance_matrix = []
    total_target_pct = 0.0

    # Process existing holdings
    held_symbols = set()
    for item in items:
        symbol = item["symbol"]
        held_symbols.add(symbol)
        current_val = item["current_value"]
        current_pct = item["allocation_percent"]
        target_pct = targets_map.get(symbol, 0.0)
        total_target_pct += target_pct

        target_val = (total_portfolio_value * target_pct / 100.0) if total_portfolio_value > 0 else 0.0
        diff_val = target_val - current_val
        drift_pct = current_pct - target_pct

        ltp = item["current_price"]
        action = "HOLD"
        action_qty = 0
        
        # Buffer of 1% or Rs 1000 threshold to prevent minor noise trades
        if diff_val > 500:
            action = "BUY"
            action_qty = max(1, int(round(diff_val / ltp))) if ltp > 0 else 0
        elif diff_val < -500:
            action = "SELL"
            action_qty = max(1, int(round(abs(diff_val) / ltp))) if ltp > 0 else 0

        rebalance_matrix.append({
            "symbol": symbol,
            "company_name": item["company_name"],
            "current_price": ltp,
            "current_value": current_val,
            "current_pct": round(current_pct, 2),
            "target_pct": round(target_pct, 2),
            "target_value": round(target_val, 2),
            "drift_pct": round(drift_pct, 2),
            "diff_value": round(diff_val, 2),
            "action": action,
            "action_amount": round(abs(diff_val), 2),
            "action_quantity": action_qty
        })

    # Include target stocks that are not yet held in portfolio (Target > 0, Current = 0)
    for sym, target_pct in targets_map.items():
        if sym not in held_symbols and target_pct > 0:
            total_target_pct += target_pct
            target_val = (total_portfolio_value * target_pct / 100.0) if total_portfolio_value > 0 else 0.0
            rebalance_matrix.append({
                "symbol": sym,
                "company_name": f"{sym} Ltd",
                "current_price": 0.0,
                "current_value": 0.0,
                "current_pct": 0.0,
                "target_pct": round(target_pct, 2),
                "target_value": round(target_val, 2),
                "drift_pct": round(-target_pct, 2),
                "diff_value": round(target_val, 2),
                "action": "BUY",
                "action_amount": round(target_val, 2),
                "action_quantity": 0  # Requires LTP fetch if stock not held
            })

    return {
        "summary": {
            "portfolio_value": total_portfolio_value,
            "total_target_percentage": round(total_target_pct, 2),
            "is_target_valid": abs(total_target_pct - 100.0) <= 0.5 if total_target_pct > 0 else False
        },
        "matrix": rebalance_matrix
    }
