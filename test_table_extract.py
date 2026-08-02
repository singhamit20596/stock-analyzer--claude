import sys, re
sys.path.insert(0, './backend')
from services.ocr_engine import PortfolioOCREngine, clean_currency, normalize_symbol

with open('/Users/amitsingh/.gemini/antigravity/brain/6fd473db-775f-457c-bca9-d19d51acae83/.user_uploaded/media__1785655274242.png', 'rb') as f:
    img_bytes = f.read()

boxes = PortfolioOCREngine.extract_text_boxes(img_bytes)

qty_boxes = []
for b in boxes:
    m = re.search(r'([\d.]+)\s*Qty', b['text'], re.IGNORECASE)
    if m:
        qty_boxes.append((float(m.group(1)), b))

holdings = []
for qty, qbox in qty_boxes:
    qy = qbox['y']
    
    company_name = ""
    symbol = ""
    for candidate in boxes:
        if (qy - 35 <= candidate['y'] <= qy + 5) and candidate['min_x'] < 160:
            txt = candidate['text'].strip()
            if re.match(r'^[A-Z]{2,6}$', txt) and not any(k in txt.lower() for k in ['stock', 'qty', 'avg', 'current', 'reports']):
                symbol = txt
            elif re.search(r'[A-Za-z]{3,}', txt) and not any(k in txt.lower() for k in ['stock name', 'qty', 'avg', 'current', 'invested', 'reports']):
                company_name = txt

    if not symbol and company_name:
        for candidate in boxes:
            if (qy - 5 <= candidate['y'] <= qy + 25) and candidate['min_x'] < 100:
                txt = candidate['text'].strip()
                if re.match(r'^[A-Z0-9]{2,6}$', txt):
                    symbol = txt
                    break

    if not symbol and company_name:
        symbol = normalize_symbol(company_name)

    avg_price = 0.0
    avg_m = re.search(r'\$([\d,]+\.?\d*)\s*Avg', qbox['text'], re.IGNORECASE)
    if avg_m:
        avg_price = clean_currency(avg_m.group(1))
    else:
        for candidate in boxes:
            if (qy - 15 <= candidate['y'] <= qy + 15) and (400 <= candidate['min_x'] <= 550):
                am = re.search(r'\$([\d,]+\.?\d*)', candidate['text'])
                if am:
                    avg_price = clean_currency(am.group(1))
                    break

    ltp = 0.0
    for candidate in boxes:
        if (qy - 25 <= candidate['y'] <= qy + 10) and (150 <= candidate['min_x'] <= 250):
            pm = re.search(r'\$([\d,]+\.?\d*)', candidate['text'])
            if pm:
                ltp = clean_currency(pm.group(1))
                break

    holdings.append({
        "symbol": symbol,
        "company_name": company_name or symbol,
        "quantity": qty,
        "avg_buy_price": avg_price,
        "current_price": ltp if ltp > 0 else avg_price
    })

print(f"\n=== EXTRACTED {len(holdings)} HOLDINGS ===")
for h in holdings:
    print(f"Symbol: {h['symbol']:<6} | Name: {h['company_name']:<30} | Qty: {h['quantity']:<10} | Avg: ${h['avg_buy_price']:<8.2f} | Market: ${h['current_price']:<8.2f}")
