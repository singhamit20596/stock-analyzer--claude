"""
Stock Deep-Dive Analysis Service
─────────────────────────────────
Fetches company info, price history, financial ratios, quarterly results,
technical indicators, and generates a buy/hold/sell recommendation.

Uses `yfinance` for all data. For Indian stocks the ".NS" suffix is appended.
"""

import math
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import yfinance as yf

from services.symbols import resolve_quote_symbol

# ── Period mapping for chart requests ────────────────────────────────────────

PERIOD_MAP = {
    "1D":  {"period": "1d",  "interval": "5m"},
    "5D":  {"period": "5d",  "interval": "15m"},
    "1W":  {"period": "5d",  "interval": "15m"},
    "1M":  {"period": "1mo", "interval": "1h"},
    "6M":  {"period": "6mo", "interval": "1d"},
    "1Y":  {"period": "1y",  "interval": "1d"},
    "3Y":  {"period": "3y",  "interval": "1wk"},
    "5Y":  {"period": "5y",  "interval": "1wk"},
    "10Y": {"period": "10y", "interval": "1mo"},
}


def _safe(v, default=None):
    """Return *v* unless it's NaN / None / inf, else *default*."""
    if v is None:
        return default
    try:
        if math.isnan(v) or math.isinf(v):
            return default
    except TypeError:
        pass
    return v


def _round(v, digits=2):
    v = _safe(v)
    return round(v, digits) if v is not None else None


def _yf_ticker(symbol: str, country: str) -> str:
    """Build the yfinance ticker string."""
    sym = resolve_quote_symbol(symbol) or symbol.strip().upper()
    if country.upper() == "IND":
        if not sym.endswith(".NS") and not sym.endswith(".BO"):
            sym = f"{sym}.NS"
    return sym


# ── Technical Indicator Calculations ─────────────────────────────────────────

def _compute_rsi(closes: List[float], period: int = 14) -> Optional[float]:
    if len(closes) < period + 1:
        return None
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [d if d > 0 else 0 for d in deltas]
    losses = [-d if d < 0 else 0 for d in deltas]

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period

    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - (100 / (1 + rs)), 2)


def _compute_sma(closes: List[float], period: int) -> Optional[float]:
    if len(closes) < period:
        return None
    return round(sum(closes[-period:]) / period, 2)


def _compute_ema(closes: List[float], period: int) -> List[float]:
    if len(closes) < period:
        return []
    k = 2 / (period + 1)
    ema = [sum(closes[:period]) / period]
    for price in closes[period:]:
        ema.append(price * k + ema[-1] * (1 - k))
    return ema


def _compute_macd(closes: List[float]):
    ema12 = _compute_ema(closes, 12)
    ema26 = _compute_ema(closes, 26)
    if not ema12 or not ema26:
        return None, None, None

    # Align lengths
    offset = len(ema12) - len(ema26)
    ema12_aligned = ema12[offset:]
    macd_line = [a - b for a, b in zip(ema12_aligned, ema26)]

    signal = _compute_ema(macd_line, 9)
    if not signal:
        return _round(macd_line[-1]) if macd_line else None, None, None

    offset2 = len(macd_line) - len(signal)
    macd_trimmed = macd_line[offset2:]
    histogram = [m - s for m, s in zip(macd_trimmed, signal)]

    return (
        _round(macd_trimmed[-1]) if macd_trimmed else None,
        _round(signal[-1]) if signal else None,
        _round(histogram[-1]) if histogram else None,
    )


def _find_support_resistance(closes: List[float]):
    if len(closes) < 20:
        return None, None
    recent = closes[-60:] if len(closes) >= 60 else closes
    current = closes[-1]

    # Simple approach: recent swing lows/highs
    lows = sorted(set(recent))[:5]
    highs = sorted(set(recent), reverse=True)[:5]

    support = max([l for l in lows if l < current], default=min(recent))
    resistance = min([h for h in highs if h > current], default=max(recent))
    return _round(support), _round(resistance)


def _trend_assessment(rsi, macd_hist, sma_20, sma_50, sma_200, current_price):
    """Simple trend classification based on technicals."""
    signals = []

    if rsi is not None:
        if rsi > 70:
            signals.append("OVERBOUGHT")
        elif rsi < 30:
            signals.append("OVERSOLD")
        elif rsi > 50:
            signals.append("BULLISH_RSI")
        else:
            signals.append("BEARISH_RSI")

    if macd_hist is not None:
        signals.append("BULLISH_MACD" if macd_hist > 0 else "BEARISH_MACD")

    if sma_20 and sma_50 and current_price:
        if current_price > sma_20 > sma_50:
            signals.append("BULLISH_TREND")
        elif current_price < sma_20 < sma_50:
            signals.append("BEARISH_TREND")

    bullish = sum(1 for s in signals if "BULLISH" in s or "OVERSOLD" in s)
    bearish = sum(1 for s in signals if "BEARISH" in s or "OVERBOUGHT" in s)

    if bullish > bearish:
        return "BULLISH"
    elif bearish > bullish:
        return "BEARISH"
    return "NEUTRAL"


# ── Main Analysis Function ───────────────────────────────────────────────────

def get_stock_analysis(symbol: str, country: str = "IND", chart_period: str = "1Y") -> Dict[str, Any]:
    """
    Complete stock analysis: company info, chart data, technicals, ratios,
    quarterly results, and recommendation. All in one call.
    """
    yf_symbol = _yf_ticker(symbol, country)
    ticker = yf.Ticker(yf_symbol)
    info = {}
    try:
        info = ticker.info or {}
    except Exception:
        pass

    currency = "USD" if country.upper() == "US" else "INR"
    currency_symbol = "$" if country.upper() == "US" else "₹"

    # ── 1. Company Info ──────────────────────────────────────────────────────
    company = {
        "name": info.get("longName") or info.get("shortName") or symbol,
        "description": info.get("longBusinessSummary") or "",
        "sector": info.get("sector") or "",
        "industry": info.get("industry") or "",
        "market_cap": _safe(info.get("marketCap")),
        "employees": _safe(info.get("fullTimeEmployees")),
        "website": info.get("website") or "",
        "country": info.get("country") or "",
        "exchange": info.get("exchange") or "",
        "currency": currency,
        "currency_symbol": currency_symbol,
    }

    # ── 2. Chart Data ────────────────────────────────────────────────────────
    period_cfg = PERIOD_MAP.get(chart_period, PERIOD_MAP["1Y"])
    chart_data = []
    chart_change_percent = 0.0

    try:
        hist = ticker.history(period=period_cfg["period"], interval=period_cfg["interval"])
        if not hist.empty:
            for idx, row in hist.iterrows():
                ts = idx.strftime("%Y-%m-%d") if period_cfg["interval"] in ("1d", "1wk", "1mo") else int(idx.timestamp())
                chart_data.append({
                    "time": ts,
                    "open": _round(row.get("Open")),
                    "high": _round(row.get("High")),
                    "low": _round(row.get("Low")),
                    "close": _round(row.get("Close")),
                    "volume": int(row.get("Volume", 0)),
                })

            if len(chart_data) >= 2:
                first_close = chart_data[0]["close"] or 1
                last_close = chart_data[-1]["close"] or 0
                chart_change_percent = _round((last_close - first_close) / first_close * 100)
    except Exception:
        pass

    # ── 3. Technical Indicators (from 1Y daily data) ─────────────────────────
    tech_closes = []
    try:
        tech_hist = ticker.history(period="1y", interval="1d")
        if not tech_hist.empty:
            tech_closes = [float(c) for c in tech_hist["Close"].dropna().tolist()]
    except Exception:
        pass

    rsi_14 = _compute_rsi(tech_closes, 14) if tech_closes else None
    sma_20 = _compute_sma(tech_closes, 20) if tech_closes else None
    sma_50 = _compute_sma(tech_closes, 50) if tech_closes else None
    sma_200 = _compute_sma(tech_closes, 200) if tech_closes else None
    macd_line, signal_line, macd_hist = _compute_macd(tech_closes) if tech_closes else (None, None, None)
    support, resistance = _find_support_resistance(tech_closes) if tech_closes else (None, None)
    current_price = _round(tech_closes[-1]) if tech_closes else _safe(info.get("currentPrice"))

    trend = _trend_assessment(rsi_14, macd_hist, sma_20, sma_50, sma_200, current_price)

    # Entry/exit zones
    entry_zone = None
    exit_zone = None
    if support is not None and resistance is not None:
        entry_low = support
        entry_high = _round(support + (resistance - support) * 0.2)
        exit_low = _round(resistance - (resistance - support) * 0.2)
        exit_high = resistance
        entry_zone = f"{currency_symbol}{entry_low} – {currency_symbol}{entry_high}"
        exit_zone = f"{currency_symbol}{exit_low} – {currency_symbol}{exit_high}"

    technicals = {
        "rsi_14": rsi_14,
        "macd": {"macd_line": macd_line, "signal_line": signal_line, "histogram": macd_hist},
        "sma_20": sma_20,
        "sma_50": sma_50,
        "sma_200": sma_200,
        "support_level": support,
        "resistance_level": resistance,
        "trend": trend,
        "entry_zone": entry_zone,
        "exit_zone": exit_zone,
        "current_price": current_price,
    }

    # ── 4. Key Ratios ────────────────────────────────────────────────────────
    ratios = {
        "pe_ratio": _round(info.get("trailingPE")),
        "forward_pe": _round(info.get("forwardPE")),
        "peg_ratio": _round(info.get("pegRatio")),
        "pb_ratio": _round(info.get("priceToBook")),
        "ps_ratio": _round(info.get("priceToSalesTrailing12Months")),
        "de_ratio": _round(info.get("debtToEquity")),
        "roe": _round(info.get("returnOnEquity"), 4),
        "roa": _round(info.get("returnOnAssets"), 4),
        "eps": _round(info.get("trailingEps")),
        "forward_eps": _round(info.get("forwardEps")),
        "dividend_yield": _round(info.get("dividendYield"), 4),
        "beta": _round(info.get("beta")),
        "52w_high": _round(info.get("fiftyTwoWeekHigh")),
        "52w_low": _round(info.get("fiftyTwoWeekLow")),
        "avg_volume": _safe(info.get("averageVolume")),
        "profit_margin": _round(info.get("profitMargins"), 4),
        "operating_margin": _round(info.get("operatingMargins"), 4),
        "revenue_growth": _round(info.get("revenueGrowth"), 4),
        "earnings_growth": _round(info.get("earningsGrowth"), 4),
        "current_ratio": _round(info.get("currentRatio")),
        "quick_ratio": _round(info.get("quickRatio")),
        "free_cash_flow": _safe(info.get("freeCashflow")),
        "target_mean_price": _round(info.get("targetMeanPrice")),
        "target_high_price": _round(info.get("targetHighPrice")),
        "target_low_price": _round(info.get("targetLowPrice")),
        "analyst_rating": info.get("recommendationKey") or "",
        "number_of_analysts": _safe(info.get("numberOfAnalystOpinions")),
    }

    # ── 5. Quarterly Results ─────────────────────────────────────────────────
    quarterly_results = []
    try:
        qf = ticker.quarterly_financials
        if qf is not None and not qf.empty:
            for col in qf.columns[:8]:  # Last 8 quarters max
                quarter_data = {}
                quarter_data["quarter"] = col.strftime("%b %Y") if hasattr(col, 'strftime') else str(col)

                for label in ("Total Revenue", "Revenue"):
                    if label in qf.index:
                        quarter_data["revenue"] = _safe(qf.loc[label, col])
                        break

                for label in ("Net Income", "Net Income Common Stockholders"):
                    if label in qf.index:
                        quarter_data["net_income"] = _safe(qf.loc[label, col])
                        break

                if "EBITDA" in qf.index:
                    quarter_data["ebitda"] = _safe(qf.loc["EBITDA", col])

                if "Operating Income" in qf.index:
                    quarter_data["operating_income"] = _safe(qf.loc["Operating Income", col])

                if "Gross Profit" in qf.index:
                    quarter_data["gross_profit"] = _safe(qf.loc["Gross Profit", col])

                # Margins
                rev = quarter_data.get("revenue")
                ni = quarter_data.get("net_income")
                if rev and ni and rev > 0:
                    quarter_data["net_margin"] = _round(ni / rev * 100)

                gp = quarter_data.get("gross_profit")
                if rev and gp and rev > 0:
                    quarter_data["gross_margin"] = _round(gp / rev * 100)

                quarterly_results.append(quarter_data)
    except Exception:
        pass

    # Compute YoY revenue growth for quarters that have a comparison
    for i, qr in enumerate(quarterly_results):
        if i + 4 < len(quarterly_results):
            prev_rev = quarterly_results[i + 4].get("revenue")
            cur_rev = qr.get("revenue")
            if prev_rev and cur_rev and prev_rev > 0:
                qr["revenue_growth_yoy"] = _round((cur_rev - prev_rev) / prev_rev * 100)

    # ── 6. Management Insights (auto-generated from data trends) ─────────────
    insights = _generate_insights(company, ratios, quarterly_results, technicals, current_price)

    # ── 7. Recommendation ────────────────────────────────────────────────────
    recommendation = _generate_recommendation(info, ratios, technicals, quarterly_results, current_price)

    return {
        "symbol": symbol.upper(),
        "yf_symbol": yf_symbol,
        "country": country.upper(),
        "company": company,
        "chart_data": chart_data,
        "chart_change_percent": chart_change_percent,
        "technicals": technicals,
        "ratios": ratios,
        "quarterly_results": quarterly_results,
        "insights": insights,
        "recommendation": recommendation,
    }


# ── Insight Generation ───────────────────────────────────────────────────────

def _generate_insights(company, ratios, quarterly_results, technicals, current_price) -> List[str]:
    """Generate human-readable insight bullet points from financial data."""
    insights = []

    # Revenue trend
    if len(quarterly_results) >= 2:
        latest_rev = quarterly_results[0].get("revenue")
        prev_rev = quarterly_results[1].get("revenue")
        if latest_rev and prev_rev and prev_rev > 0:
            growth = (latest_rev - prev_rev) / prev_rev * 100
            if growth > 5:
                insights.append(f"Revenue grew {growth:.1f}% QoQ, showing strong top-line momentum.")
            elif growth > 0:
                insights.append(f"Revenue grew modestly at {growth:.1f}% QoQ, maintaining steady growth.")
            else:
                insights.append(f"Revenue declined {abs(growth):.1f}% QoQ — the top-line is under pressure.")

    # YoY growth
    if quarterly_results and quarterly_results[0].get("revenue_growth_yoy") is not None:
        yoy = quarterly_results[0]["revenue_growth_yoy"]
        if yoy > 20:
            insights.append(f"Year-over-year revenue growth of {yoy}% signals strong execution and market expansion.")
        elif yoy > 0:
            insights.append(f"Year-over-year revenue growth of {yoy}% suggests steady business performance.")
        else:
            insights.append(f"Revenue contracted {abs(yoy)}% year-over-year — a concerning trend for growth investors.")

    # Margin trends
    if len(quarterly_results) >= 2:
        latest_margin = quarterly_results[0].get("net_margin")
        prev_margin = quarterly_results[1].get("net_margin")
        if latest_margin is not None and prev_margin is not None:
            if latest_margin > prev_margin:
                insights.append(f"Net margin expanded from {prev_margin}% to {latest_margin}%, indicating improving profitability.")
            elif latest_margin < prev_margin:
                insights.append(f"Net margin contracted from {prev_margin}% to {latest_margin}%, suggesting cost pressures.")

    # Valuation
    pe = ratios.get("pe_ratio")
    if pe is not None:
        if pe > 50:
            insights.append(f"Trading at a P/E of {pe}x — expensive by most standards, pricing in high growth expectations.")
        elif pe > 25:
            insights.append(f"P/E ratio of {pe}x is moderate — fairly valued if growth continues at current pace.")
        elif pe > 0:
            insights.append(f"P/E ratio of {pe}x is attractive — the stock appears reasonably valued.")

    # Debt
    de = ratios.get("de_ratio")
    if de is not None:
        if de > 100:
            insights.append(f"Debt-to-equity ratio of {de}% is elevated — high leverage increases risk in a downturn.")
        elif de < 30:
            insights.append(f"Debt-to-equity of {de}% is conservative — strong balance sheet with low leverage.")

    # 52-week position
    w52_high = ratios.get("52w_high")
    w52_low = ratios.get("52w_low")
    if current_price and w52_high and w52_low and w52_high > w52_low:
        position = (current_price - w52_low) / (w52_high - w52_low) * 100
        if position > 90:
            insights.append(f"Trading near 52-week high ({position:.0f}% of range) — momentum is strong but upside may be limited.")
        elif position < 20:
            insights.append(f"Trading near 52-week low ({position:.0f}% of range) — potential value opportunity if fundamentals are intact.")

    # Technical
    trend = technicals.get("trend")
    if trend == "BULLISH":
        insights.append("Technical indicators are bullish — price is above key moving averages with positive MACD momentum.")
    elif trend == "BEARISH":
        insights.append("Technical indicators are bearish — price is below key moving averages with negative momentum.")

    return insights if insights else ["Insufficient data to generate detailed insights for this stock."]


# ── Recommendation Engine ────────────────────────────────────────────────────

def _generate_recommendation(info, ratios, technicals, quarterly_results, current_price) -> Dict[str, Any]:
    """Generate a BUY / HOLD / SELL recommendation with reasons."""
    score = 0  # Positive = bullish, negative = bearish
    reasons = []

    # Analyst consensus
    analyst = ratios.get("analyst_rating", "").lower()
    if "buy" in analyst or "strong_buy" in analyst:
        score += 2
        n = ratios.get("number_of_analysts")
        reasons.append(f"Analyst consensus: {analyst.upper()}" + (f" ({n} analysts)" if n else ""))
    elif "hold" in analyst:
        reasons.append(f"Analyst consensus: HOLD")
    elif "sell" in analyst or "underperform" in analyst:
        score -= 2
        reasons.append(f"Analyst consensus: {analyst.upper()}")

    # Target price vs current
    target = ratios.get("target_mean_price")
    if target and current_price and current_price > 0:
        upside = (target - current_price) / current_price * 100
        if upside > 15:
            score += 2
            reasons.append(f"Analyst target price implies {upside:.0f}% upside potential.")
        elif upside > 0:
            score += 1
            reasons.append(f"Analyst target price implies modest {upside:.0f}% upside.")
        else:
            score -= 1
            reasons.append(f"Analyst target price implies {abs(upside):.0f}% downside risk.")

    # Technicals
    trend = technicals.get("trend")
    if trend == "BULLISH":
        score += 1
        reasons.append("Technical indicators show bullish momentum.")
    elif trend == "BEARISH":
        score -= 1
        reasons.append("Technical indicators show bearish momentum.")

    rsi = technicals.get("rsi_14")
    if rsi is not None:
        if rsi < 30:
            score += 1
            reasons.append(f"RSI at {rsi} — oversold, potential bounce opportunity.")
        elif rsi > 70:
            score -= 1
            reasons.append(f"RSI at {rsi} — overbought, may face near-term pullback.")

    # Fundamentals
    pe = ratios.get("pe_ratio")
    rev_growth = ratios.get("revenue_growth")
    if pe and rev_growth:
        if pe < 25 and rev_growth and rev_growth > 0.1:
            score += 1
            reasons.append("Attractive valuation relative to revenue growth.")
        elif pe > 50 and (not rev_growth or rev_growth < 0.05):
            score -= 1
            reasons.append("High valuation not supported by revenue growth.")

    profit_margin = ratios.get("profit_margin")
    if profit_margin is not None:
        if profit_margin > 0.2:
            score += 1
            reasons.append(f"Strong profit margins ({profit_margin*100:.1f}%) indicate pricing power.")
        elif profit_margin < 0:
            score -= 1
            reasons.append("Company is currently unprofitable.")

    # Quarterly momentum
    if len(quarterly_results) >= 2:
        latest_rev = quarterly_results[0].get("revenue")
        prev_rev = quarterly_results[1].get("revenue")
        if latest_rev and prev_rev and prev_rev > 0:
            qoq = (latest_rev - prev_rev) / prev_rev
            if qoq > 0.1:
                score += 1
                reasons.append(f"Strong QoQ revenue growth ({qoq*100:.1f}%).")
            elif qoq < -0.05:
                score -= 1
                reasons.append(f"Revenue declined {abs(qoq)*100:.1f}% QoQ.")

    # Verdict
    if score >= 3:
        verdict = "STRONG BUY"
    elif score >= 1:
        verdict = "BUY"
    elif score >= -1:
        verdict = "HOLD"
    elif score >= -3:
        verdict = "SELL"
    else:
        verdict = "STRONG SELL"

    return {
        "verdict": verdict,
        "score": score,
        "reasons": reasons if reasons else ["Insufficient data to generate a strong recommendation."],
        "target_price": ratios.get("target_mean_price"),
        "analyst_rating": ratios.get("analyst_rating"),
    }
