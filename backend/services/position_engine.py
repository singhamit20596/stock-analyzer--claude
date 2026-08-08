"""The user's own holding in one instrument, for the deep-dive page.

This is the part of the page a generic stock site cannot show, so it leads:
what is owned, what it cost, what it is worth now, and how it sits against the
target. Everything is in INR, on both sides of the P&L, for the reason spelt
out in `portfolio_engine`.

Pure functions over data the caller has already fetched — no database and no
network here.
"""
from typing import Any, Dict, List, Optional


def _account_entry(entry: Dict[str, Any], price_inr: float) -> Dict[str, Any]:
    quantity = entry["quantity"]
    return {
        "account_id": entry["account_id"],
        "account_name": entry["account_name"],
        "currency_type": entry["currency_type"],
        "quantity": quantity,
        # Native cost is what the broker screen showed; the INR figure is what
        # the rest of the app compares against.
        "avg_cost_native": entry["avg_buy_price"],
        "avg_cost_inr": entry["avg_buy_price_inr"],
        "invested_inr": entry["invested_inr"],
        "current_value_inr": round(quantity * price_inr, 2),
    }


def build(symbol: str, country: str, aggregated: Dict[str, Any],
          classification: Dict[str, str], holdings: List[Any],
          usd_inr_rate: float) -> Dict[str, Any]:
    """The consolidated position in *symbol*, or a not-held marker.

    `aggregated` is a `PortfolioAggregator.aggregate_holdings` result over the
    accounts in scope, so `allocation_percent` is already the share of that
    scope's current value.
    """
    symbol = symbol.strip().upper()
    country = (country or "IND").upper()

    item = next((i for i in aggregated.get("items", [])
                 if i["symbol"] == symbol and i["country"] == country), None)
    if item is None:
        return {"held": False, "symbol": symbol, "country": country,
                "sector": classification.get("sector", ""),
                "section": classification.get("section", "")}

    price_inr = item["current_price_inr"]
    # first_seen_at records when a stock first appeared in an OCR import, not
    # when it was bought, so the earliest import across accounts is the closest
    # thing to a start date and is a lower bound on the holding period.
    seen = [h.first_seen_at for h in holdings
            if h.symbol and h.symbol.strip().upper() == symbol and h.first_seen_at]

    return {
        "held": True,
        "symbol": symbol,
        "country": country,
        "company_name": item["company_name"],
        "currency": item["currency"],
        "usd_inr_rate": usd_inr_rate if item["currency"] == "USD" else None,
        "quantity": item["total_quantity"],
        "avg_cost_inr": item["wacp_inr"],
        "avg_cost_native": (round(item["wacp_inr"] / usd_inr_rate, 2)
                            if item["currency"] == "USD" and usd_inr_rate else item["wacp_inr"]),
        "current_price_inr": price_inr,
        "current_price_native": (round(price_inr / usd_inr_rate, 2)
                                 if item["currency"] == "USD" and usd_inr_rate else price_inr),
        "invested_inr": item["total_invested_inr"],
        "current_value_inr": item["current_value_inr"],
        "pnl_inr": item["pnl_inr"],
        "pnl_percent": item["pnl_percent"],
        "portfolio_percent": item["allocation_percent"],
        "sector": classification.get("sector", ""),
        "section": classification.get("section", ""),
        "accounts": [_account_entry(e, price_inr) for e in item["accounts_breakdown"]],
        "first_seen_at": min(seen).isoformat() if seen else None,
    }


def locate_in_target(comparison: Dict[str, Any], symbol: str,
                     country: str) -> Optional[Dict[str, Any]]:
    """Where *symbol* sits in a target comparison.

    India is compared on sectors and the US on sections, so the bucket this
    stock belongs to depends on its market. Returns None when the stock's
    bucket carries no target — an untargeted bucket has nothing to track
    against, and showing a drift of zero would imply it were on target.
    """
    market = (comparison.get("breakdown") or {}).get(country.upper())
    if not market:
        return None

    symbol = symbol.strip().upper()
    for line in market.get("lines", []):
        stock = next((s for s in line.get("stocks", [])
                      if s["symbol"].strip().upper() == symbol), None)
        if stock is None:
            continue
        if stock.get("target_inr") is None:
            return {
                "target_name": comparison.get("target_name"),
                "dimension": market.get("dimension"),
                "bucket": line["key"],
                "has_target": False,
            }
        return {
            "target_name": comparison.get("target_name"),
            "dimension": market.get("dimension"),
            "bucket": line["key"],
            "has_target": True,
            # The bucket as a whole.
            "bucket_current_inr": line["current_inr"],
            "bucket_current_percent": line["current_percent"],
            "bucket_target_percent": line["target_percent"],
            "bucket_delta_inr": line["delta_inr"],
            # This stock's equal-weighted share inside that bucket.
            "stock_current_inr": stock["current_inr"],
            "stock_current_percent": stock["current_percent"],
            "stock_target_percent": stock["target_percent"],
            "stock_target_inr": stock["target_inr"],
            "stock_delta_inr": stock["delta_inr"],
        }
    return None
