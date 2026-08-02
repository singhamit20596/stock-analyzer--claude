"""Turns target allocations into buy/sell recommendations.

All values are INR, matching PortfolioAggregator's output.
"""

from typing import Any, Dict, List, Tuple

from services.portfolio_engine import PortfolioAggregator

# Trades smaller than this are noise — brokerage and rounding eat the benefit.
MIN_TRADE_VALUE_INR = 500.0


class RebalanceEngine:

    @classmethod
    def calculate_rebalance(
        cls,
        accounts: List[Any],
        holdings: List[Any],
        targets: List[Any],
        live_prices: Dict[Tuple[str, str], float],
        usd_inr_rate: float,
    ) -> Dict[str, Any]:
        portfolio = PortfolioAggregator.aggregate_holdings(
            accounts, holdings, live_prices, usd_inr_rate
        )
        total_value = portfolio["summary"]["current_value_inr"]
        targets_map = {t.symbol.upper(): t.target_percentage for t in targets}

        matrix = []
        # A symbol held in both markets produces two rows but has one target;
        # count its target percentage once so the 100% check stays honest.
        counted_targets = set()
        total_target_pct = 0.0

        for item in portfolio["items"]:
            symbol = item["symbol"]
            target_pct = targets_map.get(symbol, 0.0)
            if symbol not in counted_targets:
                counted_targets.add(symbol)
                total_target_pct += target_pct

            current_value = item["current_value_inr"]
            target_value = total_value * target_pct / 100.0 if total_value > 0 else 0.0
            delta = target_value - current_value
            price = item["current_price_inr"]

            action, quantity = "HOLD", 0
            if delta > MIN_TRADE_VALUE_INR:
                action = "BUY"
                quantity = max(1, round(delta / price)) if price > 0 else 0
            elif delta < -MIN_TRADE_VALUE_INR:
                action = "SELL"
                quantity = max(1, round(abs(delta) / price)) if price > 0 else 0
                # Never recommend selling more than is actually held.
                quantity = min(quantity, item["total_quantity"])

            matrix.append({
                "symbol": symbol,
                "company_name": item["company_name"],
                "country": item["country"],
                "current_price": price,
                "current_value": current_value,
                "current_pct": item["allocation_percent"],
                "target_pct": round(target_pct, 2),
                "target_value": round(target_value, 2),
                "drift_pct": round(item["allocation_percent"] - target_pct, 2),
                "action": action,
                "action_amount": round(abs(delta), 2),
                "action_quantity": int(quantity),
            })

        # Targets set for stocks not held yet — surface them as fresh buys.
        # Their quote is looked up directly, since no holding carries it.
        for symbol, target_pct in targets_map.items():
            if symbol in counted_targets or target_pct <= 0:
                continue
            counted_targets.add(symbol)
            total_target_pct += target_pct

            target_value = total_value * target_pct / 100.0 if total_value > 0 else 0.0
            price = live_prices.get((symbol, "IND")) or live_prices.get((symbol, "US")) or 0.0
            country = "US" if live_prices.get((symbol, "US")) else "IND"
            if country == "US":
                price *= usd_inr_rate

            matrix.append({
                "symbol": symbol,
                "company_name": symbol,
                "country": country,
                "current_price": round(price, 2),
                "current_value": 0.0,
                "current_pct": 0.0,
                "target_pct": round(target_pct, 2),
                "target_value": round(target_value, 2),
                "drift_pct": round(-target_pct, 2),
                "action": "BUY",
                "action_amount": round(target_value, 2),
                "action_quantity": int(max(1, round(target_value / price))) if price > 0 else 0,
            })

        matrix.sort(key=lambda row: abs(row["drift_pct"]), reverse=True)

        return {
            "summary": {
                "portfolio_value": total_value,
                "total_target_percentage": round(total_target_pct, 2),
                "is_target_valid": abs(total_target_pct - 100.0) <= 0.5,
            },
            "matrix": matrix,
        }
