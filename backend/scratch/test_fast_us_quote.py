import httpx, re

headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
}

def get_us_price_fast(sym):
    # Tier 1: Google Finance NASDAQ / NYSE
    client = httpx.Client(follow_redirects=True, headers=headers)
    for exch in ['NASDAQ', 'NYSE']:
        try:
            url = f"https://www.google.com/finance/quote/{sym}:{exch}"
            r = client.get(url, timeout=2.5)
            m = re.search(r'data-last-price="([\d\.]+)"', r.text)
            if not m:
                m = re.search(r'class="YMlKec fxfaPl">\s*\$?\s*([\d,]+\.?\d*)', r.text)
            if m:
                val = float(m.group(1).replace(',', ''))
                if val > 0:
                    return val, f'Google Finance ({exch})'
        except Exception:
            pass

    # Tier 2: Stooq US Stock Quote API
    try:
        url = f"https://stooq.com/q/l/?s={sym.lower()}.us&f=sdlc12n&e=json"
        r = client.get(url, timeout=2.5)
        if r.status_code == 200:
            symbols_data = r.json().get('symbols', [])
            if symbols_data:
                close_price = symbols_data[0].get('close')
                if close_price and float(close_price) > 0:
                    return float(close_price), 'Stooq US API'
    except Exception:
        pass

    return 0.0, 'Unavailable'

for s in ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN', 'GOOGL', 'META', 'PLTR', 'AMD', 'NFLX', 'BRK-B']:
    p, src = get_us_price_fast(s)
    print(f"US Stock {s:<10} => Live Price: ${p:<10.2f} (Source: {src})")
