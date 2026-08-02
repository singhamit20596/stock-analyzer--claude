import httpx

# 1. Create account 'Preeti - US' with currency_type='US'
r_acc = httpx.post('http://127.0.0.1:8080/api/accounts', json={'name': 'Preeti - US Stocks', 'broker': 'INDMONEY', 'currency_type': 'US', 'sync_method': 'IMAGE_OCR'}).json()
acc_id = r_acc['id']

# 2. Save US Stock holdings (AAPL, NVDA, TSLA, MSFT, AMZN, PLTR)
payload = {
    'account_id': acc_id,
    'holdings': [
        {'symbol': 'AAPL', 'company_name': 'Apple Inc.', 'quantity': 15.0, 'avg_buy_price': 190.50, 'current_price': 308.91},
        {'symbol': 'NVDA', 'company_name': 'NVIDIA Corp', 'quantity': 25.0, 'avg_buy_price': 115.00, 'current_price': 200.75},
        {'symbol': 'TSLA', 'company_name': 'Tesla Inc', 'quantity': 10.0, 'avg_buy_price': 220.00, 'current_price': 311.21},
        {'symbol': 'MSFT', 'company_name': 'Microsoft Corp', 'quantity': 8.0, 'avg_buy_price': 410.00, 'current_price': 464.72},
        {'symbol': 'AMZN', 'company_name': 'Amazon.com', 'quantity': 12.0, 'avg_buy_price': 180.00, 'current_price': 271.58},
        {'symbol': 'PLTR', 'company_name': 'Palantir', 'quantity': 50.0, 'avg_buy_price': 25.00, 'current_price': 123.06}
    ]
}
r_save = httpx.post('http://127.0.0.1:8080/api/verify-save-holdings?strategy=OVERWRITE', json=payload).json()
print("Save holdings status:", r_save)

# 3. Fetch single account detail with live US market prices & USD -> INR conversion rate
detail = httpx.get(f'http://127.0.0.1:8080/api/accounts/{acc_id}/detail').json()
print("=== ACCOUNT PREETI - US LIVE METRICS & DUAL CURRENCY ===")
print(f"Currency Type:   {detail['currency_type']}")
print(f"USD to INR Rate: 1 USD = ₹{detail['summary']['usd_to_inr_rate']} INR")
print("\nSummary Metrics:")
print(f"1. Invested Value: ${detail['summary']['invested_value']:,.2f}  |  ₹{detail['summary']['invested_value_inr']:,.2f} INR")
print(f"2. Current Value:  ${detail['summary']['current_value']:,.2f}  |  ₹{detail['summary']['current_value_inr']:,.2f} INR")
print(f"3. Holding Count:  {detail['summary']['holding_count']}")
print(f"4. PnL:            ${detail['summary']['pnl']:,.2f}  |  ₹{detail['summary']['pnl_inr']:,.2f} INR")
print(f"5. PnL %:          {detail['summary']['pnl_percent']:.2f}%")

print("\nHoldings Table:")
for item in detail['items']:
    sym = item['symbol']
    qty = item['quantity']
    avg = item['avg_buy_price']
    lp = item['live_current_price']
    inv = item['invested_value']
    inv_inr = item['invested_value_inr']
    cur = item['current_value']
    cur_inr = item['current_value_inr']
    pnl = item['pnl']
    pnl_inr = item['pnl_inr']
    pct = item['pnl_percent']
    print(f"- {sym:<8} | Qty: {qty:<6} | Avg: ${avg:<8.2f} | Live US Price: ${lp:<8.2f} | Invested: ${inv:<10.2f} (₹{inv_inr:,.2f}) | Current: ${cur:<10.2f} (₹{cur_inr:,.2f}) | PnL: ${pnl:<10.2f} (₹{pnl_inr:,.2f}) [{pct:.2f}%]")
