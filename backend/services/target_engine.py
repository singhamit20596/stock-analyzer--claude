"""Compares a portfolio's actual shape against a target's declared shape.

Everything is in INR. The comparison is bucket-level: market, then sector and
section within each market. Positive `delta_inr` means the bucket is over its
target and should be trimmed; negative means it is under and should be added to.
"""
from typing import Any, Dict, List

from services import taxonomy


# India is managed by sector, the US by section. Each market therefore shows
# exactly one dimension, and the other is ignored when comparing.
MARKET_DIMENSION = {"IND": "sector", "US": "section"}


def _key_of(row: Dict[str, Any], dimension: str) -> str:
    return row.get(dimension) or (
        taxonomy.DEFAULT_SECTOR if dimension == "sector" else taxonomy.DEFAULT_SECTION
    )


def _bucket(rows: List[Dict[str, Any]], market: str, dimension: str) -> Dict[str, float]:
    """Current value per sector/section key, for one market."""
    totals: Dict[str, float] = {}
    for r in rows:
        if r["country"] != market:
            continue
        key = _key_of(r, dimension)
        totals[key] = totals.get(key, 0.0) + r["current_value_inr"]
    return totals


def _stocks_in_bucket(rows: List[Dict[str, Any]], market: str, dimension: str,
                      key: str, bucket_target_inr: float) -> List[Dict[str, Any]]:
    """Per-stock current vs target inside one bucket.

    The target is equal-weighted: a bucket's money is split evenly across the
    stocks in it, so an oversized position shows up as REDUCE even when the
    bucket as a whole is under target.
    """
    members = [r for r in rows
               if r["country"] == market and _key_of(r, dimension) == key]
    if not members:
        return []

    bucket_current = sum(r["current_value_inr"] for r in members)
    per_stock_target = (bucket_target_inr / len(members)
                        if bucket_target_inr is not None else None)

    out = []
    for r in sorted(members, key=lambda x: -x["current_value_inr"]):
        current = r["current_value_inr"]
        share = (current / bucket_current * 100) if bucket_current > 0 else 0.0
        entry = {
            "symbol": r["symbol"],
            "company_name": r["company_name"],
            "current_inr": round(current, 2),
            "current_percent": round(share, 2),
            "target_percent": None,
            "target_inr": None,
            "delta_inr": None,
        }
        if per_stock_target is not None:
            entry["target_percent"] = round(100.0 / len(members), 2)
            entry["target_inr"] = round(per_stock_target, 2)
            entry["delta_inr"] = round(current - per_stock_target, 2)
        out.append(entry)
    return out


def _lines(actual: Dict[str, float], target_pct: Dict[str, float],
           invested_total: float) -> List[Dict[str, Any]]:
    """One row per key present in either the actual holdings or the target."""
    out = []
    for key in sorted(set(actual) | set(target_pct)):
        current = round(actual.get(key, 0.0), 2)
        tgt_pct = target_pct.get(key)
        current_pct = (current / invested_total * 100) if invested_total > 0 else 0.0

        row = {
            "key": key,
            "current_inr": current,
            "current_percent": round(current_pct, 2),
            "target_percent": None if tgt_pct is None else round(tgt_pct, 2),
            "target_inr": None,
            "delta_inr": None,
            "delta_percent": None,
        }
        if tgt_pct is not None:
            target_inr = invested_total * tgt_pct / 100
            row["target_inr"] = round(target_inr, 2)
            row["delta_inr"] = round(current - target_inr, 2)
            row["delta_percent"] = round(current_pct - tgt_pct, 2)
        out.append(row)
    return out


def compare(target, rows: List[Dict[str, Any]],
            wallet_by_market: Dict[str, float]) -> Dict[str, Any]:
    """Bucket-level diff of `rows` (a portfolio detail's rows) against `target`."""
    invested = {
        m: sum(r["current_value_inr"] for r in rows if r["country"] == m)
        for m in ("IND", "US")
    }
    money = {m: invested[m] + wallet_by_market.get(m, 0.0) for m in ("IND", "US")}
    total_money = money["IND"] + money["US"]

    # Market split, measured on total money (invested + cash) per market.
    ind_target_pct = target.ind_percent or 0.0
    market_lines = []
    for market, tgt_pct in (("IND", ind_target_pct), ("US", 100.0 - ind_target_pct)):
        current = money[market]
        current_pct = (current / total_money * 100) if total_money > 0 else 0.0
        target_inr = total_money * tgt_pct / 100
        market_lines.append({
            "key": market,
            "current_inr": round(current, 2),
            "current_percent": round(current_pct, 2),
            "target_percent": round(tgt_pct, 2),
            "target_inr": round(target_inr, 2),
            "delta_inr": round(current - target_inr, 2),
            "delta_percent": round(current_pct - tgt_pct, 2),
        })

    # Cash ratio, measured on that market's own money.
    cash_targets = {"IND": target.ind_cash_percent or 0.0,
                    "US": target.us_cash_percent or 0.0}
    cash_lines = []
    for market in ("IND", "US"):
        cash = wallet_by_market.get(market, 0.0)
        tgt_pct = cash_targets[market]
        current_pct = (cash / money[market] * 100) if money[market] > 0 else 0.0
        target_inr = money[market] * tgt_pct / 100
        cash_lines.append({
            "key": market,
            "current_inr": round(cash, 2),
            "current_percent": round(current_pct, 2),
            "target_percent": round(tgt_pct, 2),
            "target_inr": round(target_inr, 2),
            "delta_inr": round(cash - target_inr, 2),
            "delta_percent": round(current_pct - tgt_pct, 2),
        })

    rules: Dict[str, Dict[str, Dict[str, float]]] = {
        "IND": {"sector": {}, "section": {}},
        "US": {"sector": {}, "section": {}},
    }
    for rule in target.rules:
        if rule.market in rules and rule.dimension in rules[rule.market]:
            rules[rule.market][rule.dimension][rule.key] = rule.percent

    # Only the dimension that governs each market is reported.
    breakdown = {}
    for market in ("IND", "US"):
        dimension = MARKET_DIMENSION[market]
        lines = _lines(
            _bucket(rows, market, dimension),
            rules[market][dimension],
            invested[market],
        )
        for line in lines:
            line["stocks"] = _stocks_in_bucket(
                rows, market, dimension, line["key"], line["target_inr"]
            )
        breakdown[market] = {"dimension": dimension, "lines": lines}

    return {
        "target_id": target.id,
        "target_name": target.name,
        "total_money_inr": round(total_money, 2),
        "invested_inr": {m: round(invested[m], 2) for m in invested},
        "cash_inr": {m: round(wallet_by_market.get(m, 0.0), 2) for m in ("IND", "US")},
        "market": market_lines,
        "cash": cash_lines,
        "breakdown": breakdown,
    }
