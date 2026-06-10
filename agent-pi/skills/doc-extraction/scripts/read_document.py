#!/usr/bin/env python3
"""
Read an xlsx/xls file and output fully expanded structured text.

Usage: python read_document.py <file_path>

Output: plain text with:
- Sheet names
- All rows with cell values (no truncation)
- ITEM table rows fully expanded, one line per data row
- Total row count and ITEM data row count
"""
import sys
import json
import os

# Add project root to path so 'backend' package is importable
_script_file = os.path.abspath(__file__)
# Walk up 5 levels: scripts/ -> doc-extraction/ -> skills/ -> agent-pi/ -> delta_idp/
_project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(_script_file)))))
if not os.path.exists(os.path.join(_project_root, "backend")):
    _project_root = "/home/qqr/delta_idp"
sys.path.insert(0, _project_root)

from backend.utils import parse_xlsx_to_structured_text


def read_document(file_path: str) -> dict:
    if not os.path.exists(file_path):
        return {"error": f"File not found: {file_path}"}

    try:
        data = parse_xlsx_to_structured_text(file_path)
    except Exception as e:
        return {"error": f"Parse failed: {str(e)}"}

    # Build full expanded output
    lines = []
    lines.append(f"# Document: {data['filename']}")
    lines.append(f"Sheets: {len(data.get('sheets', []))}")

    total_item_rows = 0

    for sheet in data.get("sheets", []):
        lines.append(f"\n## Sheet: {sheet['name']}")

        # Group cells by row
        rows = {}
        max_col = 0
        for cell in sheet.get("cells", []):
            r, c = cell["row"], cell["col"]
            if r not in rows:
                rows[r] = {}
            rows[r][c] = cell["value"]
            max_col = max(max_col, c)

        # Detect ITEM header row
        item_header_row = None
        item_cols = {}  # col_index -> header_name
        for row_num in sorted(rows.keys()):
            row_cells = rows[row_num]
            # Check if this looks like an ITEM table header
            header_text = " ".join(str(row_cells.get(c, "")) for c in range(1, max_col + 1))
            if "ITEM" in header_text.upper() and any(
                kw in header_text.upper() for kw in ["P/N", "P/O", "PART", "QTY", "QUANTITY", "PC", "DESCRIPTION"]
            ):
                item_header_row = row_num
                # Map column names
                for col in range(1, max_col + 1):
                    val = str(row_cells.get(col, "")).strip().upper()
                    if val:
                        item_cols[col] = val
                lines.append(f"\n### ITEM TABLE HEADER (Row {row_num})")
                lines.append(f"Columns: {json.dumps({k: v for k, v in sorted(item_cols.items())})}")
                break

        # Output all rows
        for row_num in sorted(rows.keys()):
            row_cells = rows[row_num]
            row_parts = []
            for col in range(1, max_col + 1):
                val = str(row_cells.get(col, "")).strip()
                if val:
                    row_parts.append(f"C{col}={val}")
            if row_parts:
                item_col = min(item_cols.keys()) if item_cols else 1
                is_item = (item_header_row and row_num > item_header_row and
                          str(row_cells.get(int(item_col), "")).strip().isdigit())
                prefix = "ITEM_DATA" if is_item else "ROW"
                if prefix == "ITEM_DATA":
                    total_item_rows += 1
                lines.append(f"{prefix} {row_num}: " + " | ".join(row_parts))

    lines.append(f"\n# Summary: {len(rows)} total rows, {total_item_rows} ITEM data rows")
    return {
        "text": "\n".join(lines),
        "filename": data["filename"],
        "total_rows": len(rows) if 'rows' in dir() else 0,
        "item_rows": total_item_rows,
    }


if __name__ == "__main__":
    import json
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: read_document.py <file_path>"}))
        sys.exit(1)
    result = read_document(sys.argv[1])
    print(json.dumps(result, ensure_ascii=False))
