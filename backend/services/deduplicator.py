from typing import List, Dict, Any, Tuple

class AccountDeduplicator:

    @classmethod
    def normalize_symbol(cls, symbol: str) -> str:
        return symbol.strip().upper().replace(" ", "").replace("-", "")

    @classmethod
    def deduplicate_holdings(cls, holdings: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        return cls._deduplicate_incoming_batch(holdings)

    @classmethod
    def process_deduplication(
        cls,
        existing_holdings: List[Dict[str, Any]],
        incoming_holdings: List[Dict[str, Any]],
        strategy: str = "MERGE"
    ) -> Tuple[List[Dict[str, Any]], List[str]]:
        warnings = []

        if strategy.upper() == "OVERWRITE":
            unique_incoming = cls._deduplicate_incoming_batch(incoming_holdings)
            return unique_incoming, ["Replaced existing account holdings with new uploaded screenshot data."]

        existing_map = {}
        for h in existing_holdings:
            norm_sym = cls.normalize_symbol(h["symbol"])
            existing_map[norm_sym] = dict(h)

        cleaned_incoming = cls._deduplicate_incoming_batch(incoming_holdings)

        for new_h in cleaned_incoming:
            norm_sym = cls.normalize_symbol(new_h["symbol"])

            if norm_sym in existing_map:
                curr_h = existing_map[norm_sym]
                warnings.append(
                    f"Updated existing stock '{curr_h['symbol']}' (Qty: {curr_h['quantity']} -> {new_h['quantity']})"
                )

                existing_map[norm_sym]["quantity"] = new_h["quantity"]
                existing_map[norm_sym]["avg_buy_price"] = new_h["avg_buy_price"]
                existing_map[norm_sym]["current_price"] = new_h["current_price"] or curr_h.get("current_price", 0.0)
                if new_h.get("company_name"):
                    existing_map[norm_sym]["company_name"] = new_h["company_name"]
            else:
                existing_map[norm_sym] = new_h

        final_holdings = list(existing_map.values())
        return final_holdings, warnings

    @classmethod
    def _deduplicate_incoming_batch(cls, incoming_holdings: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        seen = {}
        for item in incoming_holdings:
            norm_sym = cls.normalize_symbol(item["symbol"])
            if norm_sym not in seen:
                seen[norm_sym] = dict(item)
            else:
                if item.get("quantity", 0) > 0:
                    seen[norm_sym]["quantity"] = item["quantity"]
                if item.get("avg_buy_price", 0) > 0:
                    seen[norm_sym]["avg_buy_price"] = item["avg_buy_price"]
                if item.get("current_price", 0) > 0:
                    seen[norm_sym]["current_price"] = item["current_price"]
        return list(seen.values())
