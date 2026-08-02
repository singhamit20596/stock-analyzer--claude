import re
import time
import httpx
from typing import Dict, Any, List
from concurrent.futures import ThreadPoolExecutor, as_completed

PRICE_CACHE: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_SECONDS = 60  # 1 minute cache

# Known US Stock Ticker set for automatic US market routing
KNOWN_US_TICKERS = {
    'AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN', 'GOOGL', 'GOOG', 'META', 'PLTR',
    'AMD', 'NFLX', 'BRK-B', 'BRK.B', 'COIN', 'MSTR', 'DIS', 'INTC', 'AVGO', 'QCOM', 'SPY', 'QQQ'
}

# Precise Ticker symbol mapping for Indian Stocks & ETFs to official NSE Symbols
NSE_SYMBOL_MAP = {
    # ETFs
    "ICICINIFTY": "NIFTYIETF",
    "ICICINIFTY50": "NIFTYIETF",
    "ICICI PRUDENT.NIFTY": "NIFTYIETF",
    "NIFTYIT": "ITBEES",
    "NIPPONIT": "ITBEES",
    "NIPPON INDIA ETF IT": "ITBEES",
    "BANKBEES": "BANKBEES",
    "NIPPON INDIA ETF BANK": "BANKBEES",
    "MOREALTY": "MOREALTY",
    
    # Stocks & Financials
    "SBICARDSANDPAY": "SBICARD",
    "SBICARD": "SBICARD",
    "SBICARDS": "SBICARD",
    "MAXHEALTHC": "MAXHEALTH",
    "MAXHEALTH": "MAXHEALTH",
    "HOMEFIRSTF": "HOMEFIRST",
    "HOMEFIRST": "HOMEFIRST",
    "JIOFINANCIAL": "JIOFIN",
    "JIOFINANCI": "JIOFIN",
    "JIOFIN": "JIOFIN",
    "JLHL": "JLHL",
    "MEDIASSIST": "MEDIASSIST",
    "ANANTRAJ": "ANANTRAJ",
    "OBEROIRLTY": "OBEROIRLTY",
    "TECHNOE": "TECHNOE",
    "MEDANTA": "MEDANTA",
    "HEROMOTOCO": "HEROMOTOCO",
    "AAVAS": "AAVAS",
    "IEX": "IEX",
    "BHARTIARTL": "BHARTIARTL",
    "CGCL": "CGCL",
    "HDFCBANK": "HDFCBANK",
    "SBIN": "SBIN",
    "IDFCFIRSTB": "IDFCFIRSTB",
    "DCBBANK": "DCBBANK",
    "KOVAI": "KOVAI",
    "NUVAMAWEAL": "NUVAMA",
    "FORTISHEAL": "FORTIS",
    "APTUSVALUE": "APTUS",
    "CANARABANK": "CANBK",
}

def resolve_nse_symbol(symbol: str) -> str:
    sym = symbol.strip().upper()
    return NSE_SYMBOL_MAP.get(sym, sym)

def fetch_single_quote(symbol: str) -> float:
    sym = symbol.strip().upper()
    now = time.time()
    
    # Check 1-minute cache
    if sym in PRICE_CACHE and (now - PRICE_CACHE[sym]["timestamp"]) < CACHE_TTL_SECONDS:
        return PRICE_CACHE[sym]["price"]

    headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }

    # 1. US Stock Market Tickers (Google Finance NASDAQ / NYSE Scraper & Yahoo Finance)
    if sym in KNOWN_US_TICKERS or (len(sym) <= 5 and sym.isalpha() and sym not in {'SBIN', 'ITC', 'IEX', 'KOVAI', 'AAVAS', 'TCS', 'INFY', 'LT', 'NIFTY', 'CANBK'}):
        # Tier A: Google Finance US Exchanges
        client = httpx.Client(follow_redirects=True, headers=headers)
        for exch in ['NASDAQ', 'NYSE']:
            try:
                gf_url = f"https://www.google.com/finance/quote/{sym}:{exch}"
                r = client.get(gf_url, timeout=2.5)
                m = re.search(r'data-last-price="([\d\.]+)"', r.text)
                if not m:
                    m = re.search(r'class="YMlKec fxfaPl">\s*\$?\s*([\d,]+\.?\d*)', r.text)
                if m:
                    val = float(m.group(1).replace(',', ''))
                    if val > 0:
                        PRICE_CACHE[sym] = {"price": val, "timestamp": now}
                        return val
            except Exception:
                pass

        # Tier B: Yahoo Finance US
        try:
            url = f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1m&range=1d"
            r = httpx.get(url, headers=headers, timeout=2.5)
            if r.status_code == 200:
                res_json = r.json()
                chart = res_json.get('chart', {}).get('result', [])
                if chart:
                    meta = chart[0].get('meta', {})
                    price = meta.get('regularMarketPrice') or meta.get('previousClose')
                    if price and float(price) > 0:
                        val = float(price)
                        PRICE_CACHE[sym] = {"price": val, "timestamp": now}
                        return val
        except Exception:
            pass

    # 2. Indian Stock / ETF (Groww Open Stock Live Quote API)
    resolved_sym = resolve_nse_symbol(sym)
    try:
        url = f"https://groww.in/v1/api/stocks_data/v1/tr_live_prices/exchange/NSE/segment/CASH/{resolved_sym}/latest"
        r = httpx.get(url, headers=headers, timeout=2.5)
        if r.status_code == 200:
            data = r.json()
            ltp = data.get('ltp') or data.get('close')
            if ltp and float(ltp) > 0:
                val = float(ltp)
                PRICE_CACHE[sym] = {"price": val, "timestamp": now}
                PRICE_CACHE[resolved_sym] = {"price": val, "timestamp": now}
                return val
    except Exception:
        pass

    # 3. Yahoo Finance API (.NS NSE Ticker)
    try:
        ticker = f"{resolved_sym}.NS"
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?interval=1m&range=1d"
        r = httpx.get(url, headers=headers, timeout=2.5)
        if r.status_code == 200:
            res_json = r.json()
            chart = res_json.get('chart', {}).get('result', [])
            if chart:
                meta = chart[0].get('meta', {})
                price = meta.get('regularMarketPrice') or meta.get('previousClose')
                if price and float(price) > 0:
                    val = float(price)
                    PRICE_CACHE[sym] = {"price": val, "timestamp": now}
                    return val
    except Exception:
        pass

    # 4. Google Finance NSE Open Page Scraper
    try:
        client = httpx.Client(follow_redirects=True, headers=headers)
        gf_url = f"https://www.google.com/finance/quote/{resolved_sym}:NSE"
        r = client.get(gf_url, timeout=2.5)
        m = re.search(r'data-last-price="([\d\.]+)"', r.text)
        if not m:
            m = re.search(r'class="YMlKec fxfaPl">\s*₹?\s*([\d,]+\.?\d*)', r.text)
        if m:
            val = float(m.group(1).replace(',', ''))
            if val > 0:
                PRICE_CACHE[sym] = {"price": val, "timestamp": now}
                return val
    except Exception:
        pass

    return 0.0

def fetch_live_prices_batch(symbols: List[str]) -> Dict[str, float]:
    results = {}
    unique_symbols = list(set(sym.strip().upper() for sym in symbols if sym))

    with ThreadPoolExecutor(max_workers=min(10, max(1, len(unique_symbols)))) as executor:
        future_to_sym = {executor.submit(fetch_single_quote, sym): sym for sym in unique_symbols}
        for future in as_completed(future_to_sym):
            raw_sym = future_to_sym[future]
            resolved_sym = resolve_nse_symbol(raw_sym)
            try:
                price_val = future.result()
                results[raw_sym] = price_val
                results[resolved_sym] = price_val
            except Exception:
                results[raw_sym] = 0.0

    return results

def fetch_live_stock_price(symbol: str) -> float:
    return fetch_single_quote(symbol)
