import io
import json
import httpx
from PIL import Image, ImageDraw, ImageFont

BASE_URL = "http://127.0.0.1:8080"

def create_sample_indmoney_screenshot() -> bytes:
    """Generates a synthetic INDmoney mobile app portfolio screenshot image in memory."""
    img = Image.new("RGB", (600, 800), color=(15, 23, 42)) # Dark theme UI background
    draw = ImageDraw.Draw(img)
    
    # Title
    draw.text((20, 30), "INDmoney Stock Holdings", fill=(255, 255, 255))
    
    # Stock Item 1: RELIANCE
    draw.text((20, 100), "Reliance Industries Ltd", fill=(241, 245, 249))
    draw.text((20, 130), "Qty: 15 | Avg: Rs 2,450.00", fill=(148, 163, 184))
    draw.text((20, 160), "Current: Rs 2,580.00", fill=(52, 211, 153))

    # Stock Item 2: TCS
    draw.text((20, 220), "Tata Consultancy Services", fill=(241, 245, 249))
    draw.text((20, 250), "Qty: 8 | Avg: Rs 3,400.00", fill=(148, 163, 184))
    draw.text((20, 280), "Current: Rs 3,650.00", fill=(52, 211, 153))

    # Stock Item 3: INFY
    draw.text((20, 340), "Infosys Ltd", fill=(241, 245, 249))
    draw.text((20, 370), "Qty: 25 | Avg: Rs 1,400.00", fill=(148, 163, 184))
    draw.text((20, 400), "Current: Rs 1,520.00", fill=(52, 211, 153))

    img_byte_arr = io.BytesIO()
    img.save(img_byte_arr, format='PNG')
    return img_byte_arr.getvalue()

def run_tests():
    print("=== STOCKS ANALYZER FEATURE TEST SUITE ===")
    client = httpx.Client(base_url=BASE_URL, timeout=10.0)

    # 1. Fetch Accounts
    print("\n1. Testing GET /api/accounts...")
    res = client.get("/api/accounts")
    assert res.status_code == 200, f"Failed: {res.text}"
    accounts = res.json()
    print(f"   Success! Found {len(accounts)} accounts:")
    for acc in accounts:
        print(f"   - [{acc['broker']}] {acc['name']} (ID: {acc['id']})")
    
    account_id = accounts[0]['id']

    # 2. Upload OCR Image Screenshot with Account Deduplication
    print(f"\n2. Testing POST /api/upload-ocr-image for account '{accounts[0]['name']}'...")
    image_bytes = create_sample_indmoney_screenshot()

    files = {"file": ("test_portfolio.png", image_bytes, "image/png")}
    data = {"account_id": account_id, "broker_hint": "INDMONEY"}

    res = client.post("/api/upload-ocr-image", files=files, data=data)
    assert res.status_code == 200, f"Upload failed: {res.text}"
    ocr_result = res.json()
    print(f"   Success! Extracted {ocr_result['extracted_count']} holdings.")
    print("   Extracted Holdings Preview:")
    for h in ocr_result['holdings']:
        print(f"   - {h['symbol']} ({h['company_name']}): Qty={h['quantity']}, AvgPrice=₹{h['avg_buy_price']}, Current=₹{h['current_price']}")
    
    if ocr_result.get('warnings'):
        print("\n   Deduplication Warnings:")
        for w in ocr_result['warnings']:
            print(f"   - {w}")

    # 3. Verify & Commit Holdings with MERGE strategy
    print("\n3. Testing POST /api/verify-save-holdings with MERGE strategy...")
    verify_payload = {
        "account_id": account_id,
        "holdings": ocr_result['holdings']
    }
    res = client.post("/api/verify-save-holdings?strategy=MERGE", json=verify_payload)
    assert res.status_code == 200, f"Verify save failed: {res.text}"
    print("   Success!", res.json())

    # 4. Fetch Consolidated Portfolio View
    print("\n4. Testing GET /api/portfolio/consolidated...")
    res = client.get("/api/portfolio/consolidated")
    assert res.status_code == 200, f"Consolidated failed: {res.text}"
    portfolio = res.json()
    print(f"   Total Portfolio Investment: ₹{portfolio['summary']['total_invested']:,.2f}")
    print(f"   Total Current Value:       ₹{portfolio['summary']['current_value']:,.2f}")
    print(f"   Total P&L:                ₹{portfolio['summary']['total_pnl']:,.2f} ({portfolio['summary']['total_pnl_percent']:.2f}%)")

    print(f"   Total Unique Holdings:     {len(portfolio['items'])}")

    # 5. Fetch Portfolio Rebalancing View
    print("\n5. Testing GET /api/rebalance...")
    res = client.get("/api/rebalance")
    assert res.status_code == 200, f"Rebalance failed: {res.text}"
    rebalance = res.json()
    print("   Rebalance Plan Summary:")
    for item in rebalance['matrix']:
        print(f"   - {item['symbol']}: Current={item['current_pct']:.1f}%, Target={item['target_pct']:.1f}%, Action={item['action']} (₹{item['action_amount']:,.2f})")


    print("\nALL TESTS PASSED SUCCESSFULLY! 🎉")

if __name__ == "__main__":
    run_tests()
