import io
import re
from typing import List, Dict, Any

import numpy as np
from PIL import Image

from services.symbols import normalize_symbol

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


class PortfolioOCREngine:

    @classmethod
    def extract_text_boxes(cls, image_bytes: bytes) -> List[Dict[str, Any]]:
        boxes = []
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
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
        holdings = []
        seen_symbols = set()

        # --- Strategy A: INDmoney / Web Desktop Table View ---
        # The broker prints, per row, two stacked lines:
        #
        #   <logo> Company Name    $market   $invested   $current value   +$pnl
        #          TICKER          chg%      qty Qty | $avg Avg.          pnl%
        #
        # Column positions are read off the row itself rather than hard-coded:
        # the same table is captured at anything from ~840px to ~1600px wide,
        # and absolute pixel windows silently match nothing at the wrong scale.
        # Distances are expressed in `unit`, the height of the qty box, which
        # scales with the capture.
        money_re = re.compile(r'^\$\s*([\d,]+\.\d{2})$')

        qty_boxes = []
        for b in sorted_boxes:
            m = re.search(r'([\d.]+)\s*Qty', b['text'], re.IGNORECASE)
            if m:
                try:
                    qval = float(m.group(1))
                    if qval > 0:
                        qty_boxes.append((qval, b))
                except ValueError:
                    pass

        for qty, qbox in qty_boxes:
            qy = qbox['y']
            qx = qbox['min_x']
            unit = max(qbox['max_y'] - qbox['min_y'], 1.0)

            def on_row(box, lo, hi):
                return qy + lo * unit <= box['y'] <= qy + hi * unit

            # Plain amounts (no +/- sign, which is what marks the P&L column)
            # sitting on the line above the qty text: market price, invested,
            # current value.
            upper = []
            for b in sorted_boxes:
                if not on_row(b, -2.2, -0.3):
                    continue
                m = money_re.match(b['text'].strip())
                if m:
                    upper.append((b, clean_currency(m.group(1))))
            upper.sort(key=lambda t: t[0]['min_x'])

            # Invested shares a left edge with the qty text underneath it; the
            # current value is the next amount to its right, the market price
            # the one to its left.
            invested = current_value = market_price = 0.0
            inv_idx = None
            for i, (b, val) in enumerate(upper):
                if abs(b['min_x'] - qx) <= 3 * unit:
                    inv_idx, invested = i, val
                    break
            if inv_idx is not None:
                if inv_idx + 1 < len(upper):
                    current_value = upper[inv_idx + 1][1]
                if inv_idx > 0:
                    market_price = upper[inv_idx - 1][1]

            name_limit = upper[0][0]['min_x'] if upper else qx - 2 * unit

            company_box = None
            for b in sorted_boxes:
                if on_row(b, -2.2, -0.3) and b['min_x'] < name_limit:
                    txt = b['text'].strip()
                    if re.search(r'[A-Za-z]{3,}', txt) and not any(
                            k in txt.lower() for k in
                            ['stock name', 'qty', 'avg', 'current', 'invested', 'reports']):
                        company_box = b
                        break
            company_name = company_box['text'].strip() if company_box else ""

            # The ticker sits on the lower line, left-aligned with the company
            # name. The row's logo also lands in this band and further left, so
            # candidates are ranked by how well they line up with the name
            # rather than taken in reading order — a VISA wordmark must not win
            # over the "V" underneath it.
            symbol = ""
            anchor = company_box['min_x'] if company_box else qx
            candidates = []
            for b in sorted_boxes:
                if on_row(b, -0.3, 2.2) and b['min_x'] < name_limit:
                    txt = b['text'].strip()
                    # One character is a real ticker (V, F, C); requiring two
                    # dropped them onto the company-name fallback.
                    if re.match(r'^[A-Z][A-Z0-9.\-]{0,5}$', txt) and not any(
                            k in txt.lower() for k in ['stock', 'qty', 'avg', 'current', 'reports']):
                        candidates.append(b)
            if candidates:
                symbol = min(candidates, key=lambda b: abs(b['min_x'] - anchor))['text'].strip()

            if not symbol and company_name:
                symbol = normalize_symbol(company_name)

            # Clean company name trailing prices / truncated text
            if company_name:
                company_name = re.sub(r"\s+\$?[\d\.,]+$", "", company_name).strip()
                company_name = re.sub(r"\s*Clas\.\.\.$", "", company_name).strip()
                company_name = re.sub(r"\s*Class\s*[AB]?$", "", company_name, flags=re.IGNORECASE).strip()

            # Two full decimals are required: OCR splits "$280.91 Avg." often
            # enough that a looser pattern happily returned "$280", which was
            # then stored as a cost basis of 280.00.
            avg_price = 0.0
            for b in [qbox] + sorted_boxes:
                if b is not qbox and not on_row(b, -0.8, 0.8):
                    continue
                am = re.search(r'\$\s*([\d,]+\.\d{2})\s*Avg', b['text'], re.IGNORECASE)
                if am:
                    avg_price = clean_currency(am.group(1))
                    break

            # The broker prints Invested and Current value, so neither the cost
            # basis nor the price has to be trusted to OCR alone: both are
            # recoverable by division, and disagreement means the read is wrong.
            if invested > 0 and qty > 0:
                derived_avg = round(invested / qty, 2)
                if avg_price <= 0 or abs(avg_price - derived_avg) > max(0.01 * derived_avg, 0.01):
                    avg_price = derived_avg

            ltp = round(current_value / qty, 2) if (current_value > 0 and qty > 0) else market_price

            if symbol and symbol not in seen_symbols:
                seen_symbols.add(symbol)
                # current_price is left at 0.0 when the screenshot does not
                # yield one; the live quote fills it in later. Never fall back
                # to avg_price, which would report zero P&L as fact.
                holdings.append({
                    "symbol": symbol,
                    "company_name": company_name or symbol,
                    "quantity": qty,
                    "avg_buy_price": avg_price,
                    "current_price": ltp if ltp > 0 else 0.0
                })

        # --- Strategy B: Groww Desktop Table Single-Line Matching ---
        if not holdings:
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

        # --- Strategy C: Groww Mobile / Cropped Multi-Line Spatial Matching ---
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

        return holdings

    @classmethod
    def process_image(cls, image_bytes: bytes) -> List[Dict[str, Any]]:
        return cls.parse_holdings_from_boxes(cls.extract_text_boxes(image_bytes))
