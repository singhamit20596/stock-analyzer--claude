"""Cross-account holdings aggregation.

Everything this module returns is denominated in INR. USD holdings are
converted on both sides of the P&L — price *and* average cost — because
converting only one side silently inflates gains by the exchange rate.

Rows are keyed by (symbol, currency): the same ticker listed in India and in
the US is two different instruments and must not be merged.
"""

from typing import Any, Dict, List, Tuple


def account_currency(account: Any) -> str:
    """INR unless the account is explicitly a US one."""
    return "USD" if account is not None and account.currency_type == "US" else "INR"


class PortfolioAggregator:

    @classmethod
    def aggregate_holdings(
        cls,
        accounts: List[Any],
        holdings: List[Any],
        live_prices: Dict[Tuple[str, str], float],
        usd_inr_rate: float,
    ) -> Dict[str, Any]:
        """Consolidates holdings across accounts into per-instrument INR rows.

        `live_prices` is keyed by (symbol, country) in the instrument's native
        currency, as returned by `fetch_live_prices_batch`.
        """
        account_map = {acc.id: acc for acc in accounts}
        grouped: Dict[Tuple[str, str], Dict[str, Any]] = {}

        for holding in holdings:
            symbol = holding.symbol.upper()
            account = account_map.get(holding.account_id)
            currency = account_currency(account)
            country = "US" if currency == "USD" else "IND"
            to_inr = usd_inr_rate if currency == "USD" else 1.0

            native_price = live_prices.get((symbol, country), 0.0)
            if native_price <= 0:
                # No live quote — fall back to the last stored price, then to
                # cost, so the row still shows a sane value instead of zero.
                native_price = holding.current_price or holding.avg_buy_price or 0.0

            quantity = float(holding.quantity)
            avg_inr = float(holding.avg_buy_price) * to_inr
            price_inr = native_price * to_inr

            row = grouped.setdefault((symbol, currency), {
                "symbol": symbol,
                "company_name": holding.company_name or symbol,
                "country": country,
                "currency": currency,
                "total_quantity": 0.0,
                "total_invested_inr": 0.0,
                "current_price_inr": price_inr,
                "accounts_breakdown": [],
            })

            invested_inr = quantity * avg_inr
            row["total_quantity"] += quantity
            row["total_invested_inr"] += invested_inr
            row["current_price_inr"] = price_inr
            if holding.company_name and len(holding.company_name) > len(row["company_name"]):
                row["company_name"] = holding.company_name

            row["accounts_breakdown"].append({
                "account_id": holding.account_id,
                "account_name": account.name if account else "Unknown",
                "currency_type": account.currency_type if account else "IND",
                "quantity": round(quantity, 4),
                "avg_buy_price": round(float(holding.avg_buy_price), 2),
                "avg_buy_price_inr": round(avg_inr, 2),
                "invested_inr": round(invested_inr, 2),
                "current_value_inr": round(quantity * price_inr, 2),
            })

        items = []
        total_invested_inr = 0.0
        total_current_inr = 0.0

        for row in grouped.values():
            quantity = row["total_quantity"]
            invested_inr = row["total_invested_inr"]
            price_inr = row["current_price_inr"]
            current_inr = quantity * price_inr
            pnl_inr = current_inr - invested_inr

            total_invested_inr += invested_inr
            total_current_inr += current_inr

            items.append({
                "symbol": row["symbol"],
                "company_name": row["company_name"],
                "country": row["country"],
                "currency": row["currency"],
                "total_quantity": round(quantity, 4),
                # Weighted average cost, in INR.
                "wacp_inr": round(invested_inr / quantity, 2) if quantity > 0 else 0.0,
                "current_price_inr": round(price_inr, 2),
                "total_invested_inr": round(invested_inr, 2),
                "current_value_inr": round(current_inr, 2),
                "pnl_inr": round(pnl_inr, 2),
                "pnl_percent": round(pnl_inr / invested_inr * 100.0, 2) if invested_inr > 0 else 0.0,
                "accounts_breakdown": row["accounts_breakdown"],
            })

        for item in items:
            item["allocation_percent"] = (
                round(item["current_value_inr"] / total_current_inr * 100.0, 2)
                if total_current_inr > 0 else 0.0
            )

        items.sort(key=lambda i: i["current_value_inr"], reverse=True)

        total_pnl_inr = total_current_inr - total_invested_inr
        return {
            "summary": {
                "total_invested_inr": round(total_invested_inr, 2),
                "current_value_inr": round(total_current_inr, 2),
                "total_pnl_inr": round(total_pnl_inr, 2),
                "total_pnl_percent": (
                    round(total_pnl_inr / total_invested_inr * 100.0, 2)
                    if total_invested_inr > 0 else 0.0
                ),
                "total_stocks_count": len(items),
            },
            "items": items,
        }
