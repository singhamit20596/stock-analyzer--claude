import sys
sys.path.insert(0, './backend')
import httpx, re

headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}

KNOWN_US_TICKERS = {
    'AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN', 'GOOGL', 'GOOG', 'META', 'PLTR',
    'AMD', 'NFLX', 'BRK-B', 'BRK.B', 'COIN', 'MSTR', 'DIS', 'INTC', 'AVGO', 'QCOM', 'SPY', 'QQQ'
}

def fetch_live_quote(symbol):
    sym = symbol.strip().upper()
    
    # Check if US ticker
    if sym in KNOWN_US_TICKERS or (len(sym) <= 5 and sym.isalpha() and sym not in {'SBIN', 'ITC', 'IEX', 'KOVAI', 'AAVAS', 'TCS', 'INFY', 'LT', 'NIFTY'}):
        try:
            url = f'https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1m&range=1d'
            r = httpx.get(url, headers=headers, timeout=3.0)
            if r.status_code == 200:
                meta = r.json()['chart']['result'][0]['meta']
                price = meta.get('regularMarketPrice') or meta.get('previousClose')
                if price and float(price) > 0:
                    return float(price), 'USD ($)', 'Yahoo Finance US'
        except Exception:
            pass

    # Indian Stock / ETF (Groww API)
    try:
        url = f'https://groww.in/v1/api/stocks_data/v1/tr_live_prices/exchange/NSE/segment/CASH/{sym}/latest'
        r = httpx.get(url, headers=headers, timeout=3.0)
        if r.status_code == 200:
            data = r.json()
            ltp = data.get('ltp') or data.get('close')
            if ltp and float(ltp) > 0:
                return float(ltp), 'INR (₹)', 'Groww NSE API'
    except Exception:
        pass

    return 0.0, 'UNKNOWN', 'Unavailable'

test_symbols = [
    'AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN', 'GOOGL', 'META', 'PLTR',
    'ITBEES', 'MAXHEALTH', 'SBICARD', 'JIOFIN', 'NIFTYIETF'
]

print("=== HYBRID REALTIME US & INDIAN STOCK QUOTE TEST ===")
for s in test_symbols:
    price, currency, src = fetch_live_quote(s)
    print(f"{s:<12} => Live Price: {currency} {price:<10.2f} (Source: {src})")
