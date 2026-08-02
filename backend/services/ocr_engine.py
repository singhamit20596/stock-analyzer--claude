import io
import re
from typing import List, Dict, Any, Optional
from PIL import Image

RAPIDOCR_AVAILABLE = False
try:
    from rapidocr_onnxruntime import RapidOCR
    rapid_ocr_engine = RapidOCR()
    RAPIDOCR_AVAILABLE = True
except Exception as e:
    print(f"[OCREngine] RapidOCR init warning: {e}")

PYTESSERACT_AVAILABLE = False
try:
    import pytesseract
    PYTESSERACT_AVAILABLE = True
except Exception:
    pass

EASYOCR_AVAILABLE = False
try:
    import easyocr
    easy_reader = easyocr.Reader(['en'], gpu=False)
    EASYOCR_AVAILABLE = True
except Exception:
    pass


def clean_currency(val_str: str) -> float:
    """Converts strings like '$2,450.50', '₹2,450.50', '2450', 'Rs. 2,450' to float."""
    if not val_str:
        return 0.0
    cleaned = re.sub(r"[^\d.]", "", str(val_str).replace(",", ""))
    try:
        return float(cleaned) if cleaned else 0.0
    except ValueError:
        return 0.0


# US Stock Ticker dictionary for automatic resolution
US_STOCK_TICKER_MAP = {
    "APPLE": "AAPL",
    "APPLE INC": "AAPL",
    "NVIDIA": "NVDA",
    "NVIDIA CORP": "NVDA",
    "NVIDIA CORPORATION": "NVDA",
    "TESLA": "TSLA",
    "TESLA INC": "TSLA",
    "MICROSOFT": "MSFT",
    "MICROSOFT CORP": "MSFT",
    "AMAZON": "AMZN",
    "AMAZON.COM": "AMZN",
    "ALPHABET": "GOOGL",
    "GOOGLE": "GOOGL",
    "META": "META",
    "META PLATFORMS": "META",
    "FACEBOOK": "META",
    "PALANTIR": "PLTR",
    "PALANTIR TECHNOLOGIES": "PLTR",
    "AMD": "AMD",
    "ADVANCED MICRO DEVICES": "AMD",
    "NETFLIX": "NFLX",
    "BERKSHIRE HATHAWAY": "BRK-B",
    "COINBASE": "COIN",
    "MICROSTRATEGY": "MSTR",
    "DISNEY": "DIS",
    "WALT DISNEY": "DIS",
    "INTEL": "INTC",
    "BROADCOM": "AVGO",
    "QUALCOMM": "QCOM",
}

# Expanded dictionary mapping for Indian Stock Market Ticker symbols & ETFs
STOCK_SYMBOL_MAPPING = {
    "ICICI PRUDENT.NIFTY": "NIFTYIETF",
    "ICICI PRUDENTIAL NIFTY": "NIFTYIETF",
    "NIPPON INDIA ETF IT": "ITBEES",
    "NIPPON INDIA ETF NIFTY IT": "ITBEES",
    "NIPPON INDIA ETF BANK": "BANKBEES",
    "MAX HEALTHCARE": "MAXHEALTH",
    "MAXHEALTH": "MAXHEALTH",
    "DCBBANK": "DCBBANK",
    "DCB BANK": "DCBBANK",
    "SBI CARDS AND PAY": "SBICARD",
    "SBI CARDS": "SBICARD",
    "SBI CARD": "SBICARD",
    "STATE BANK OF INDIA": "SBIN",
    "SBI": "SBIN",
    "HOME FIRST FINANCE": "HOMEFIRST",
    "HOME FIRST": "HOMEFIRST",
    "IDFC FIRST BANK": "IDFCFIRSTB",
    "JIO FINANCIAL SERV": "JIOFIN",
    "JIO FINANCIAL SERVICES": "JIOFIN",
    "JIO FINANCIAL": "JIOFIN",
    "JIOFIN": "JIOFIN",
    "KOVAI MEDICAL CENTER": "KOVAI",
    "KOVAI MEDICAL": "KOVAI",
    "AAVAS FINANCIERS": "AAVAS",
    "AAVAS": "AAVAS",
    "RELIANCE INDUSTRIES": "RELIANCE",
    "RELIANCE IND": "RELIANCE",
    "TATA CONSULTANCY SERVICES": "TCS",
    "INFOSYS": "INFY",
    "HDFC BANK": "HDFCBANK",
    "ICICI BANK": "ICICIBANK",
    "TATA MOTORS": "TATAMOTORS",
    "BHARTI AIRTEL": "BHARTIARTL",
    "ITC": "ITC",
    "LARSEN & TOUBRO": "LT",
    "KOTAK MAHINDRA BANK": "KOTAKBANK",
    "AXIS BANK": "AXISBANK",
    "HINDUSTAN UNILEVER": "HINDUNILVR",
    "JUPITER LIFE LINE": "JLHL",
    "MEDI ASSIST HEALTH": "MEDIASSIST",
    "HERO MOTOCORP": "HEROMOTOCO",
    "GLOBAL HEALTH": "MEDANTA",
    "ANANT RAJ": "ANANTRAJ",
    "OBEROI REALTY": "OBEROIRLTY",
    "CAPRI GLOBAL CAPITAL": "CGCL",
    "MOREALTY": "MOREALTY",
    "TECHNO ELECTRIC": "TECHNOE",
}


def normalize_symbol(name_str: str) -> str:
    """Converts company name strings to simplified uppercase stock symbol tickers."""
    cleaned = name_str.strip().upper()
    
    # Check US Ticker map first
    for key, sym in US_STOCK_TICKER_MAP.items():
        if key in cleaned:
            return sym

    # Check Indian Ticker map
    for key, sym in STOCK_SYMBOL_MAPPING.items():
        if key in cleaned:
            return sym

    # Remove generic suffixes
    cleaned_name = re.sub(r"\b(LTD|LIMITED|CORP|CORPORATION|INC|SERV|SERVICES|ETF|INDEX|REIT|AND|PAY)\b", "", cleaned).strip()

    for key, sym in US_STOCK_TICKER_MAP.items():
        if key in cleaned_name:
            return sym

    for key, sym in STOCK_SYMBOL_MAPPING.items():
        if key in cleaned_name:
            return sym

    subbed = re.sub(r"[^A-Z0-9]", "", cleaned_name)
    return subbed[:10] if subbed else "STOCK"


class PortfolioOCREngine:
    """
    High-Precision Multi-Engine OCR Processor for Groww, INDmoney (Indian & US Stocks), Zerodha, and Upstox Screenshots.
    """

    @classmethod
    def extract_text_boxes(cls, image_bytes: bytes) -> List[Dict[str, Any]]:
        boxes = []
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        import numpy as np
        img_np = np.array(image)

        if RAPIDOCR_AVAILABLE:
            try:
                results, _ = rapid_ocr_engine(img_np)
                if results:
                    for item in results:
                        poly, text, score = item[0], item[1], item[2]
                        xs = [p[0] for p in poly]
                        ys = [p[1] for p in poly]
                        min_x, max_x = min(xs), max(xs)
                        min_y, max_y = min(ys), max(ys)
                        boxes.append({
                            'text': text.strip(),
                            'bbox': [min_x, min_y, max_x, max_y],
                            'x': (min_x + max_x) / 2.0,
                            'y': (min_y + max_y) / 2.0,
                            'min_y': min_y,
                            'max_y': max_y,
                            'min_x': min_x,
                            'max_x': max_x
                        })
                    if boxes:
                        return boxes
            except Exception as e:
                print(f"[OCREngine] RapidOCR execution warning: {e}")

        if EASYOCR_AVAILABLE:
            try:
                results = easy_reader.readtext(img_np)
                for poly, text, score in results:
                    xs = [p[0] for p in poly]
                    ys = [p[1] for p in poly]
                    min_x, max_x = min(xs), max(xs)
                    min_y, max_y = min(ys), max(ys)
                    boxes.append({
                        'text': text.strip(),
                        'bbox': [min_x, min_y, max_x, max_y],
                        'x': (min_x + max_x) / 2.0,
                        'y': (min_y + max_y) / 2.0,
                        'min_y': min_y,
                        'max_y': max_y,
                        'min_x': min_x,
                        'max_x': max_x
                    })
                if boxes:
                    return boxes
            except Exception as e:
                print(f"[OCREngine] EasyOCR execution warning: {e}")

        if PYTESSERACT_AVAILABLE:
            try:
                data = pytesseract.image_to_data(image, output_type=pytesseract.Output.DICT)
                n_boxes = len(data['text'])
                for i in range(n_boxes):
                    text = data['text'][i].strip()
                    if text:
                        x, y, w, h = data['left'][i], data['top'][i], data['width'][i], data['height'][i]
                        boxes.append({
                            'text': text,
                            'bbox': [x, y, x + w, y + h],
                            'x': x + w / 2.0,
                            'y': y + h / 2.0,
                            'min_y': y,
                            'max_y': y + h,
                            'min_x': x,
                            'max_x': x + w
                        })
            except Exception as e:
                print(f"[OCREngine] PyTesseract execution warning: {e}")

        return boxes

    @classmethod
    def parse_holdings_from_boxes(cls, boxes: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not boxes:
            return []

        sorted_boxes = sorted(boxes, key=lambda b: (b['min_y'], b['min_x']))
        full_text_lines = [b['text'] for b in sorted_boxes]

        holdings = []
        seen_symbols = set()

        # --- Strategy A: Groww Desktop Table Single-Line Matching ---
        pattern_groww = r"(\d+(?:\.\d+)?)\s*shares?.*?(?:Avg|Average)\.?[^\d]*([\d,]+\.?\d*)"
        
        for idx, box in enumerate(sorted_boxes):
            text = box['text']
            m = re.search(pattern_groww, text, re.IGNORECASE)
            if m:
                qty = float(m.group(1))
                avg_price = clean_currency(m.group(2))
                box_y = box['y']

                company_name = ""
                for prev in reversed(sorted_boxes[:idx]):
                    if (box_y - 60 <= prev['y'] <= box_y - 5) and prev['min_x'] < 350:
                        ptext = prev['text']
                        if re.search(r'[A-Za-z]{2,}', ptext) and not any(k in ptext.lower() for k in ["company", "market price", "returns", "invested", "current"]):
                            company_name = ptext
                            break

                ltp = avg_price
                for candidate in sorted_boxes:
                    if (box_y - 60 <= candidate['y'] <= box_y + 15) and (350 <= candidate['x'] <= 650):
                        c_match = re.search(r"^(?:₹|Rs\.?|\$|\?)?\s*([\d,]+\.\d{2})$", candidate['text'])
                        if c_match:
                            price_val = clean_currency(c_match.group(1))
                            if price_val > 0:
                                ltp = price_val
                                break

                if company_name and qty > 0:
                    symbol = normalize_symbol(company_name)
                    if symbol not in seen_symbols:
                        seen_symbols.add(symbol)
                        holdings.append({
                            "symbol": symbol,
                            "company_name": company_name,
                            "quantity": qty,
                            "avg_buy_price": avg_price,
                            "current_price": ltp if ltp > 0 else avg_price
                        })

        # --- Strategy B: Groww Mobile / Cropped Multi-Line Spatial Matching ---
        if not holdings:
            for idx, box in enumerate(sorted_boxes):
                text = box['text']
                sm = re.search(r"^(\d+(?:\.\d+)?)\s*shares?", text, re.IGNORECASE)
                if sm:
                    qty = float(sm.group(1))
                    box_y = box['y']

                    company_name = ""
                    for prev in reversed(sorted_boxes[:idx]):
                        if (box_y - 65 <= prev['y'] <= box_y - 5) and prev['min_x'] < 200:
                            ptext = prev['text']
                            if re.search(r'[A-Za-z]{2,}', ptext) and not any(k in ptext.lower() for k in ['company', 'market price', 'returns', 'invested', 'current', 'shares']):
                                company_name = ptext
                                break

                    avg_price = 0.0
                    for candidate in sorted_boxes[idx:]:
                        if (box_y - 10 <= candidate['y'] <= box_y + 40) and candidate['min_x'] < 200:
                            ctext = candidate['text']
                            am = re.search(r'(?:Avg|Average)\.?[^\d]*([\d,]+\.?\d*)', ctext, re.IGNORECASE)
                            if am:
                                try:
                                    avg_price = float(am.group(1).replace(',', ''))
                                    break
                                except ValueError:
                                    pass

                    ltp = 0.0
                    for candidate in sorted_boxes:
                        if (box_y - 35 <= candidate['y'] <= box_y + 35) and (220 <= candidate['min_x'] < 360):
                            ctext = candidate['text']
                            pm = re.search(r'^(?:₹|Rs\.?|\$|\?)?\s*([\d,]+\.\d{2})$', ctext)
                            if pm:
                                try:
                                    val = float(pm.group(1).replace(',', ''))
                                    if val > 0:
                                        ltp = val
                                        break
                                except ValueError:
                                    pass

                    if company_name and qty > 0:
                        symbol = normalize_symbol(company_name)
                        if symbol not in seen_symbols:
                            seen_symbols.add(symbol)
                            holdings.append({
                                "symbol": symbol,
                                "company_name": company_name,
                                "quantity": qty,
                                "avg_buy_price": avg_price if avg_price > 0 else ltp,
                                "current_price": ltp if ltp > 0 else avg_price
                            })

        # --- Strategy C & D: INDmoney US Stocks & Generic App Card Parser ---
        if not holdings:
            lines = full_text_lines
            for idx, line in enumerate(lines):
                # Identify Company Name or Ticker Symbol (e.g. 'Apple Inc.', 'AAPL', 'NVIDIA', 'TSLA', 'Microsoft')
                if (re.search(r"^[A-Z]{2,5}$", line.strip()) or re.search(r"[A-Za-z]{3,}", line)) and not any(k in line.lower() for k in ["portfolio", "holdings", "invested", "returns", "total", "summary", "company", "market price", "account", "indmoney"]):
                    company_name = line.strip()
                    window_boxes = sorted_boxes[max(0, idx - 2): min(len(sorted_boxes), idx + 8)]
                    window_text = " ".join([b['text'] for b in window_boxes])

                    qty = 0.0
                    avg_price = 0.0
                    current_price = 0.0

                    # 1. Quantity matching (e.g. '0.45 shares', 'Shares: 2.5', 'Qty: 10', '10.5 shares')
                    qty_match = re.search(r"(?:Qty|Shares|Quantity)?[:\s]*([\d\.]+)\s*(?:shares|units)?", window_text, re.IGNORECASE)
                    if qty_match:
                        try:
                            val = float(qty_match.group(1))
                            if val > 0 and val < 100000:
                                qty = val
                        except ValueError:
                            pass

                    # 2. Avg Price matching (e.g. 'Avg: $185.50', 'Avg Cost: $200', 'Buy: $150')
                    avg_match = re.search(r"(?:Avg|Average|Buy|Cost)[:\s]*(?:\$|₹|Rs\.?)?\s*([\d,]+\.?\d*)", window_text, re.IGNORECASE)
                    if avg_match:
                        avg_price = clean_currency(avg_match.group(1))

                    # 3. Market Price / LTP matching (e.g. '$220.30', 'LTP: $220.30', 'Price: $220')
                    curr_match = re.search(r"(?:Current|LTP|Market|Price)[:\s]*(?:\$|₹|Rs\.?)?\s*([\d,]+\.?\d*)", window_text, re.IGNORECASE)
                    if curr_match:
                        current_price = clean_currency(curr_match.group(1))

                    if qty > 0 and (avg_price > 0 or current_price > 0):
                        symbol = normalize_symbol(company_name)
                        if symbol not in seen_symbols and symbol != "STOCK":
                            seen_symbols.add(symbol)
                            holdings.append({
                                "symbol": symbol,
                                "company_name": company_name,
                                "quantity": qty,
                                "avg_buy_price": avg_price if avg_price > 0 else current_price,
                                "current_price": current_price if current_price > 0 else avg_price
                            })

        return holdings

    @classmethod
    def process_image(cls, image_bytes: bytes, broker_hint: Optional[str] = "GROWW") -> List[Dict[str, Any]]:
        boxes = cls.extract_text_boxes(image_bytes)
        holdings = cls.parse_holdings_from_boxes(boxes)
        return holdings
