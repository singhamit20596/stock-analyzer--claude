import httpx, re

headers = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'}

def get_us_live_price(symbol):
    sym = symbol.strip().upper()
    try:
        url = f'https://query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1m&range=1d'
        r = httpx.get(url, headers=headers, timeout=3.0)
        if r.status_code == 200:
            meta = r.json()['chart']['result'][0]['meta']
            price = meta.get('regularMarketPrice') or meta.get('previousClose')
            if price:
                return float(price), 'Yahoo Finance'
    except Exception as e:
        pass

    for exch in ['NASDAQ', 'NYSE']:
        try:
            client = httpx.Client(follow_redirects=True, headers=headers)
            gf_url = f'https://www.google.com/finance/quote/{sym}:{exch}'
            r = client.get(gf_url, timeout=3.0)
            m = re.search(r'data-last-price="([\d\.]+)"', r.text)
            if not m:
                m = re.search(r'class="YMlKec fxfaPl">\s*\$?\s*([\d,]+\.?\d*)', r.text)
            if m:
                val = float(m.group(1).replace(',', ''))
                if val > 0:
                    return val, f'Google Finance {exch}'
        except Exception:
            pass

    return 0.0, 'Unavailable'

us_tickers = ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN', 'GOOGL', 'META', 'PLTR', 'AMD', 'NFLX', 'BRK-B']

print('=== TESTING REALTIME US STOCK MARKET QUOTE API ===')
for sym in us_tickers:
    price, src = get_us_live_price(sym)
    print(f"{sym:<10} => Live Price: ${price:.2f} (Source: {src})")
