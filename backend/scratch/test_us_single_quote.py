import sys
sys.path.insert(0, './backend')
from services.quote_service import fetch_single_quote, fetch_live_prices_batch

for sym in ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN', 'PLTR', 'ITBEES', 'SBICARD']:
    p = fetch_single_quote(sym)
    print(f"Symbol {sym:<10} => Live Price: {p}")

print("\nBatch test:")
res = fetch_live_prices_batch(['AAPL', 'NVDA', 'TSLA', 'MSFT'])
print(res)
