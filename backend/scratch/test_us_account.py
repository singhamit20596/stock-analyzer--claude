import httpx

# 1. Create account 'Preeti - US'
r_acc = httpx.post('http://127.0.0.1:8080/api/accounts', json={'name': 'Preeti - US', 'broker': 'INDMONEY', 'sync_method': 'IMAGE_OCR'}).json()
acc_id = r_acc['id']

# 2. Save US Stock holdings (AAPL, NVDA, TSLA, MSFT, AMZN, PLTR)
payload = {
    'account_id': acc_id,
    'holdings': [
        {'symbol': 'AAPL', 'company_name': 'Apple Inc.', 'quantity': 15.0, 'avg_buy_price': 190.50},
        {'symbol': 'NVDA', 'company_name': 'NVIDIA Corp', 'quantity': 25.0, 'avg_buy_price': 115.00},
        {'symbol': 'TSLA', 'company_name': 'Tesla Inc', 'quantity': 10.0, 'avg_buy_price': 220.00},
        {'symbol': 'MSFT', 'company_name': 'Microsoft Corp', 'quantity': 8.0, 'avg_buy_price': 410.00},
        {'symbol': 'AMZN', 'company_name': 'Amazon.com', 'quantity': 12.0, 'avg_buy_price': 180.00},
        {'symbol': 'PLTR', 'company_name': 'Palantir', 'quantity': 50.0, 'avg_buy_price': 25.00}
    ]
}
httpx.post('http://127.0.0.1:8080/api/verify-save-holdings?strategy=OVERWRITE', json=payload)

# 3. Fetch single account detail with live US market prices
detail = httpx.get(f'http://127.0.0.1:8080/api/accounts/{acc_id}/detail').json()
print("=== ACCOUNT PREETI - US LIVE METRICS ===")
print("Summary Metrics:")
print(f"1. Invested Value: ${detail['summary']['invested_value']:,.2f}")
print(f"2. Current Value:  ${detail['summary']['current_value']:,.2f} (Live Yahoo Finance US)")
print(f"3. Holding Count:  {detail['summary']['holding_count']}")
print(f"4. PnL:            ${detail['summary']['pnl']:,.2f}")
print(f"5. PnL %:          {detail['summary']['pnl_percent']:.2f}%")
print("\nHoldings Table:")
for item in detail['items']:
    sym = item['symbol']
    qty = item['quantity']
    avg = item['avg_buy_price']
    lp = item['live_current_price']
    inv = item['invested_value']
    cur = item['current_value']
    pnl = item['pnl']
    pct = item['pnl_percent']
    print(f"- {sym:<8} | Qty: {qty:<6} | Avg: ${avg:<8.2f} | Live US Price: ${lp:<8.2f} | Invested: ${inv:<10.2f} | Current: ${cur:<10.2f} | PnL: ${pnl:<10.2f} ({pct:.2f}%)")
