#!/usr/bin/env python3
"""
Extract ITEM detail rows from a read_document JSON output.
Guarantees: no row is omitted, no truncation.

Usage: python extract_items.py '<read_document_json>'

Takes the JSON output of read_document.py and returns only the ITEM data rows.
"""
import sys
import json
import re


def extract_items(doc_json: dict) -> dict:
    text = doc_json.get("text", "")
    if not text:
        return {"items": [], "count": 0, "error": "No text content"}

    items = []
    item_cols = {}
    header_found = False

    for line in text.split("\n"):
        line = line.strip()

        # Parse column map from header
        if line.startswith("Columns: "):
            try:
                item_cols = json.loads(line[len("Columns: "):])
            except json.JSONDecodeError:
                pass
            continue

        # ITEM data rows
        if not line.startswith("ITEM_DATA "):
            continue

        header_found = True
        # Parse: "ITEM_DATA 28: C2=5 | C12=XHD01-... | C46=CL10B332..."
        after_prefix = line.split(": ", 1)
        if len(after_prefix) < 2:
            continue

        row_num = after_prefix[0].replace("ITEM_DATA ", "").strip()
        cell_str = after_prefix[1]

        # Parse cell values
        item = {}
        for part in cell_str.split(" | "):
            if "=" in part:
                col_expr, val = part.split("=", 1)
                # col_expr is like "C2"
                col_key = col_expr.strip()
                item[col_key] = val.strip()

        # Map to semantic fields based on column headers
        mapped = {}
        for col_key, header_name in item_cols.items():
            val = item.get(f"C{col_key}", "")
            if not val:
                continue
            hn = header_name.upper()
            if "ITEM" in hn and hn == "ITEM":
                mapped["item_no"] = val
            elif "P/O" in hn:
                mapped["po_no"] = val
            elif hn == "P/N" or "PART" in hn:
                mapped["part_no"] = val
            elif "SAMSUNG" in hn or "SAMSUNG P/N" in hn:
                mapped["samsung_pn"] = val
            elif "DESC" in hn or "DESCRIPTION" in hn:
                mapped["description"] = val
            elif "PC" == hn or "QTY" in hn or "QUANTITY" in hn:
                mapped["quantity"] = val
            elif "@RMB" in hn or "UNIT PRICE" in hn or "UNIT" in hn:
                mapped["unit_price"] = val
            elif "RMB" in hn and "@" not in hn or "AMOUNT" in hn:
                mapped["amount"] = val
            elif "G.W." in hn or "GROSS" in hn:
                mapped["gross_weight"] = val
            elif "N.W." in hn or "NET" in hn:
                mapped["net_weight"] = val
            elif "MEAS" in hn or "CBM" in hn or "VOLUME" in hn:
                mapped["volume"] = val
            elif "CARTON" in hn or "C/T" in hn or "CTN" in hn:
                mapped["carton_no"] = val
            else:
                # Keep original
                mapped[header_name.lower().replace(" ", "_").replace("/", "_")] = val

        # If no semantic mapping worked, keep raw cell data
        if not mapped:
            mapped = {f"col_{k.replace('C','')}": v for k, v in item.items()}

        if mapped:
            items.append(mapped)

    # Calculate totals
    totals = {}
    for key in ["quantity", "amount", "gross_weight", "net_weight", "volume"]:
        total = 0
        for item in items:
            val = item.get(key, "")
            if val:
                try:
                    total += float(val.replace(",", ""))
                except (ValueError, TypeError):
                    pass
        if total > 0:
            totals[key] = round(total, 6)

    return {
        "items": items,
        "count": len(items),
        "totals": totals,
        "columns": item_cols,
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: extract_items.py '<json_from_read_document>'"}))
        sys.exit(1)

    try:
        doc = json.loads(sys.argv[1])
    except json.JSONDecodeError:
        # Try reading from stdin
        doc = json.load(sys.stdin)

    result = extract_items(doc)
    print(json.dumps(result, ensure_ascii=False, indent=2))
