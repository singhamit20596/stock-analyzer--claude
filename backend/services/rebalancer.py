from typing import List, Dict, Any
from sqlalchemy.orm import Session
import models
from services.portfolio_engine import PortfolioAggregator

class RebalanceEngine:

    @classmethod
    def calculate_rebalance(cls, accounts: List[Any], holdings: List[Any], targets: List[Any]) -> Dict[str, Any]:
        portfolio_data = PortfolioAggregator.aggregate_holdings(accounts, holdings)
        summary = portfolio_data["summary"]
        items = portfolio_data["items"]
        total_portfolio_value = summary["current_value"]

        targets_map = {t.symbol.upper(): t.target_percentage for t in targets}
        rebalance_matrix = []
        total_target_pct = 0.0

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
                    "action_quantity": 0
                })

        return {
            "summary": {
                "portfolio_value": total_portfolio_value,
                "total_target_percentage": round(total_target_pct, 2),
                "is_target_valid": abs(total_target_pct - 100.0) <= 0.5 if total_target_pct > 0 else False
            },
            "matrix": rebalance_matrix
        }

def compute_rebalancing_plan(db: Session, account_ids: List[str] = None) -> Dict[str, Any]:
    accounts = db.query(models.Account).all()
    holdings = db.query(models.Holding).all()
    targets = db.query(models.TargetAllocation).all()
    return RebalanceEngine.calculate_rebalance(accounts, holdings, targets)
