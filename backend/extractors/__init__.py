"""Template-based and LLM-based key information extractors."""

import json
import os
import re
from typing import Dict, Any, List, Optional
from backend.config import TEMPLATES_DIR


class TemplateExtractor:
    """Extract key information using predefined templates with regex pattern matching."""

    def __init__(self):
        self.templates_cache: Dict[str, Dict] = {}

    def load_template(self, template_name: str) -> Optional[Dict[str, Any]]:
        """Load a template JSON file."""
        if template_name in self.templates_cache:
            return self.templates_cache[template_name]

        template_path = os.path.join(TEMPLATES_DIR, f"{template_name}.json")
        if os.path.exists(template_path):
            with open(template_path, "r", encoding="utf-8") as f:
                template = json.load(f)
                self.templates_cache[template_name] = template
                return template
        return None

    def list_templates(self) -> List[Dict[str, str]]:
        """List all available templates (flat list)."""
        templates = []
        if os.path.exists(TEMPLATES_DIR):
            for fname in os.listdir(TEMPLATES_DIR):
                if fname.endswith(".json"):
                    name = fname[:-5]
                    template = self.load_template(name)
                    if template:
                        field_count = len(template.get("extraction_fields", []))
                        templates.append({
                            "id": name,
                            "name": template.get("name", name),
                            "description": template.get("description", ""),
                            "field_count": field_count,
                        })
        return templates

    def get_template_tree(self) -> List[Dict[str, Any]]:
        """Return templates as a flat list (no longer grouped by vendor/doc_type)."""
        flat = self.list_templates()
        return [{
            "id": t["id"],
            "name": t["name"],
            "description": t["description"],
            "field_count": t["field_count"],
            "is_group": False,
            "children": [],
        } for t in flat]

    def save_template(self, template_id: str, data: Dict[str, Any]) -> bool:
        """Save a template (create or update)."""
        if not template_id or "/" in template_id or "\\" in template_id:
            return False
        file_path = os.path.join(TEMPLATES_DIR, f"{template_id}.json")
        try:
            with open(file_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            self.templates_cache.pop(template_id, None)
            return True
        except Exception:
            return False

    def delete_template(self, template_id: str) -> bool:
        """Delete a template."""
        if "/" in template_id or "\\" in template_id:
            return False
        file_path = os.path.join(TEMPLATES_DIR, f"{template_id}.json")
        try:
            if os.path.exists(file_path):
                os.remove(file_path)
                self.templates_cache.pop(template_id, None)
                return True
            return False
        except Exception:
            return False

    def extract_with_template(
        self, text: str, template_name: str
    ) -> Dict[str, Any]:
        """
        Extract fields from document text using a template's search patterns.

        Args:
            text: The document text to search in
            template_name: Name of the template to use

        Returns:
            Dict with extracted fields and line items
        """
        template = self.load_template(template_name)
        if not template:
            return {"error": f"Template not found: {template_name}", "fields": [], "line_items": []}

        fields = template.get("extraction_fields", [])
        line_item_fields = template.get("line_item_fields", [])

        results = []
        for field in fields:
            value = None
            confidence = "low"

            # Try each search pattern
            for pattern in field.get("search_patterns", []):
                match = self._find_field_value(text, pattern)
                if match:
                    value = match
                    confidence = "low"  # Template text matching is less reliable
                    break

            # Also try special Samsung-specific extraction
            if field.get("samsung_location") and not value:
                value = self._extract_samsung_field(text, field)

            if value:
                # Upgrade confidence for Samsung-specific extraction or long values
                if field.get("samsung_location") or len(value) > 10:
                    confidence = "medium"

            results.append({
                "name": field["name"],
                "label": field["label"],
                "value": value,
                "confidence": confidence,
            })

        # Extract line items from tabular data
        line_items = self._extract_line_items(text, line_item_fields)

        return {
            "template": template_name,
            "template_name": template.get("name", template_name),
            "document_type": template.get("document_type", ""),
            "vendor": template.get("vendor", "generic"),
            "fields": results,
            "line_items": line_items,
        }

    def _find_field_value(self, text: str, pattern: str) -> Optional[str]:
        """Find a value associated with a label pattern in the text."""
        escaped = re.escape(pattern)

        # Clean markdown artifacts from text before matching
        clean_text = re.sub(r'\*\*\[[A-Z]+\d+\]\*\*', '', text)
        clean_text = re.sub(r'^-\s*Row\s*\d+:\s*', '', clean_text, flags=re.MULTILINE)
        clean_text = re.sub(r'\*\*\[[A-Z]+\d+\]\*\*', '', clean_text)
        clean_text = re.sub(r'\|', ' ', clean_text)  # Remove table pipe separators

        # Pattern: Label followed by value on same line (tightly)
        matches = re.findall(
            rf'{escaped}[：:\s]+([^\n]+?)(?:\n|\Z)',
            clean_text, re.IGNORECASE
        )
        if matches:
            val = self._clean_value(matches[0])
            if val:
                return val

        # Pattern as label on one line, value on next line
        matches = re.findall(
            rf'{escaped}\s*\n\s*([^\n]+)',
            clean_text, re.IGNORECASE
        )
        if matches:
            val = self._clean_value(matches[0])
            if val:
                return val

        # For short, distinctive keywords (like DAP, RMB), find them anywhere
        if len(pattern) <= 8 and pattern.isalpha():
            m = re.search(rf'\b{escaped}\b', clean_text, re.IGNORECASE)
            if m:
                return pattern

        return None

    @staticmethod
    def _clean_value(val: str) -> Optional[str]:
        """Clean extracted value, reject markdown artifacts and noise."""
        if not val:
            return None
        val = val.strip()
        # Reject values that are purely markdown syntax
        if val.startswith('Row ') or val.startswith('**[') or val.startswith('|'):
            return None
        # Reject values that contain markdown table separators or formatting
        if '|' in val or '**[C' in val:
            return None
        # Reject values that are just table header labels
        if val.strip() in ('ITEM', 'P/O', 'P/N', 'PC', 'TOTAL', 'PAGE', 'SAMSUNG',
                           'ITEM P/O P/N SAMSUNG P/N PC @RMB/1000 RMB'):
            return None
        # Reject values that start with digit+parenthesized-label (like "5)Final")
        if re.match(r'^\d+\)', val):
            return None
        # Clean remaining markdown
        val = re.sub(r'\*\*\[[A-Z]+\d+\]\*\*', '', val)
        val = val.strip()
        if len(val) < 2:
            return None
        return val

    def _extract_samsung_field(self, text: str, field: Dict) -> Optional[str]:
        """Samsung-specific field extraction using layout knowledge."""
        name = field.get("name", "")

        if name == "currency":
            if "@RMB" in text or "RMB" in text:
                return "RMB"
            if "@USD" in text:
                return "USD"

        if name == "goods_description":
            match = re.search(r'MULTI LAYER CERAMIC CAPACITOR', text, re.IGNORECASE)
            if match:
                return match.group(0)

        if name == "country_of_origin":
            match = re.search(r'made in (\w+(?:\s+\w+)?)', text, re.IGNORECASE)
            if match:
                return match.group(1)

        if name == "incoterms":
            match = re.search(r'(DAP|FOB|CIF|EXW|FCA)\s*(\w+)?', text)
            if match:
                result = match.group(1)
                if match.group(2):
                    result += " " + match.group(2)
                return result

        if name == "invoice_no":
            # Samsung invoice numbers: DSxxxxx or ESxxxxx
            match = re.search(r'([DE]S\d{8})', text)
            if match:
                return match.group(1)

        if name == "invoice_date":
            # Samsung date format: MAY.11,2026 or MAY.11 2026
            match = re.search(
                r'(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\.(\d{1,2}),?\s*(\d{4})',
                text, re.IGNORECASE
            )
            if match:
                month_map = {
                    "JAN": "01", "FEB": "02", "MAR": "03", "APR": "04",
                    "MAY": "05", "JUN": "06", "JUL": "07", "AUG": "08",
                    "SEP": "09", "OCT": "10", "NOV": "11", "DEC": "12",
                }
                month = month_map.get(match.group(1).upper(), "01")
                day = match.group(2).zfill(2)
                year = match.group(3)
                return f"{year}-{month}-{day}"

        if name == "shipper":
            match = re.search(
                r'SAMSUNG ELECTRO-MECHANICS[^(]*\([^)]+\)[^,\n]*(?:[^\n]{0,100})',
                text, re.IGNORECASE
            )
            if match:
                return match.group(0).strip()[:200]

        if name == "page":
            match = re.search(r'PAGE\s*:\s*(\d+)', text, re.IGNORECASE)
            if match:
                return match.group(1)

        return None

    def _extract_line_items(
        self, text: str, line_item_fields: List[Dict]
    ) -> List[Dict[str, Any]]:
        """Extract line items from tabular data in the text."""
        items = []

        # Try to find Samsung-style line items (ITEM / P/O / P/N / SAMSUNG P/N / PC / @RMB / RMB)
        # Pattern: line with item number, PO, part number
        lines = text.split("\n")
        in_table = False
        header_found = False

        for line in lines:
            # Detect table header
            if "ITEM" in line and ("P/O" in line or "P/N" in line):
                header_found = True
                in_table = True
                continue

            # Detect end of table
            if in_table and ("TOTAL" in line.upper() or "PAGE" in line.upper()):
                in_table = False
                continue

            if in_table and header_found:
                # Try to parse as a line item
                # Samsung format: ITEM | P/O | ... | P/N | ... | SAMSUNG P/N | ... | PC | @RMB | RMB
                # The actual parsing depends on column positions
                item = self._parse_samsung_line_item(line)
                if item:
                    items.append(item)

        # If we didn't find structured items, try generic approach
        if not items:
            items = self._parse_generic_line_items(text, line_item_fields)

        return items

    def _parse_samsung_line_item(self, line: str) -> Optional[Dict[str, Any]]:
        """Parse a Samsung-format line item row."""
        # Samsung rows look like:
        # "5 XHD01-20251009-015 ... CL10B332KB8WPNC ... 164,000 1 =BQ28*CE28"
        # Pattern: ITEM_NO PO_NO ... P/N ... SAMSUNG_PN ... QTY UNIT_PRICE AMOUNT

        # Check if line starts with a number (ITEM number)
        parts = line.strip().split()
        if not parts:
            return None

        # First part should be a small integer (ITEM number)
        try:
            item_no = int(parts[0])
        except ValueError:
            return None

        if item_no > 100:  # sanity check
            return None

        # Find PO number (looks like XHD01-YYYYMMDD-NNN)
        po_match = re.search(r'(XHD\d{2}-\d{8}-\d{3})', line)
        po_no = po_match.group(1) if po_match else ""

        # Find Samsung P/N (looks like CLxx... or CLxx...)
        pn_matches = re.findall(r'(CL\d{2}[A-Z]\d{3}[A-Z0-9]{2,}[A-Z0-9]*)', line)
        samsung_pn = pn_matches[0] if pn_matches else ""

        # Find quantity (number with commas or plain number, after the PN area)
        qty_match = re.search(r'([\d,]{3,})\s+\d+\s+', line)
        quantity = qty_match.group(1) if qty_match else ""

        # Find unit price (small integer, before the formula-like amount)
        up_match = re.search(r'(\d{1,2})\s+=', line)
        unit_price = up_match.group(1) if up_match else ""

        if item_no and (po_no or samsung_pn):
            return {
                "item_no": item_no,
                "po_no": po_no,
                "part_no": "",  # Would need column-based parsing
                "samsung_pn": samsung_pn,
                "quantity": quantity,
                "unit_price": unit_price,
                "amount": "",  # Formula, not resolved
            }

        return None

    def _parse_generic_line_items(
        self, text: str, fields: List[Dict]
    ) -> List[Dict[str, Any]]:
        """Generic line item extraction from tabular text."""
        # Try to find any tabular format in the text
        items = []

        # Look for rows that appear to be data (not headers, not totals)
        lines = text.split("\n")
        data_pattern = re.compile(r'^\d+\s+')  # Starts with a number

        for line in lines:
            if data_pattern.match(line.strip()):
                parts = line.strip().split()
                if len(parts) >= 3:
                    item = {}
                    for i, field in enumerate(fields[:len(parts)]):
                        if i < len(parts):
                            item[field["name"]] = parts[i]
                    if item:
                        items.append(item)

        return items


class RuleBasedExtractor:
    """Pure rule-based extraction using regex patterns, no API calls needed."""

    @staticmethod
    def extract_from_structured_data(structured_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Extract key information directly from parsed XLSX structured data.
        Uses positional heuristics for Samsung-format documents.
        """
        fields = []
        grid: Dict[tuple, str] = {}

        # Build a complete grid from all sheets
        for sheet in structured_data.get("sheets", []):
            for cell in sheet.get("cells", []):
                grid[(cell["row"], cell["col"])] = cell["value"]

        # Extract common fields
        # Invoice number: near "No. & date of invoice" label
        inv_no = RuleBasedExtractor._find_after_label(grid, "No. & date of invoice")
        if inv_no:
            fields.append({"name": "invoice_no", "label": "发票号码", "value": inv_no, "confidence": "high"})

        # Extract date from invoice number field
        date_val = RuleBasedExtractor._find_date_in_text(inv_no if inv_no else "")
        if date_val:
            fields.append({"name": "invoice_date", "label": "发票日期", "value": date_val, "confidence": "high"})

        # Shipper
        shipper = RuleBasedExtractor._find_after_label(grid, "Shipper/Export")
        if shipper:
            fields.append({"name": "shipper", "label": "发货单位", "value": shipper, "confidence": "high"})

        # Consignee
        consignee = RuleBasedExtractor._find_after_label(grid, "For Account & Risk")
        if consignee:
            fields.append({"name": "consignee", "label": "收货单位", "value": consignee, "confidence": "high"})

        # Notify party
        notify = RuleBasedExtractor._find_after_label(grid, "Notify party")
        if notify:
            fields.append({"name": "notify_party", "label": "通知方", "value": notify, "confidence": "high"})

        # Port of loading
        pol = RuleBasedExtractor._find_after_label(grid, "Port of loading")
        if pol:
            fields.append({"name": "port_of_loading", "label": "装货港", "value": pol, "confidence": "high"})

        # Final destination
        dest = RuleBasedExtractor._find_after_label(grid, "Final destination")
        if dest:
            fields.append({"name": "final_destination", "label": "目的地", "value": dest, "confidence": "high"})

        # Carrier
        carrier = RuleBasedExtractor._find_after_label(grid, "Carrier")
        if carrier:
            fields.append({"name": "carrier", "label": "承运人", "value": carrier, "confidence": "medium"})

        # Currency - detect from table headers
        currency = RuleBasedExtractor._detect_currency(grid)
        if currency:
            fields.append({"name": "currency", "label": "币制", "value": currency, "confidence": "high"})

        # Country of origin
        coo = RuleBasedExtractor._find_pattern_in_grid(grid, r"made in (\w+)")
        if coo:
            fields.append({"name": "country_of_origin", "label": "原产国", "value": coo, "confidence": "medium"})

        # Incoterms
        # Incoterms: look for DAP/FOB/CIF/EXW/FCA followed by optional location
        for (r, c), val in grid.items():
            m = re.search(r'\b(DAP|FOB|CIF|EXW|FCA)\s+\w+', str(val), re.IGNORECASE)
            if m:
                fields.append({"name": "incoterms", "label": "贸易术语", "value": m.group(0), "confidence": "high"})
                break

        # L/C No
        lc = RuleBasedExtractor._find_after_label(grid, "No. & date of L/C")
        if lc:
            fields.append({"name": "lc_no", "label": "信用证号", "value": lc, "confidence": "high"})

        # L/C Issuing Bank
        lc_bank = RuleBasedExtractor._find_after_label(grid, "L/C Issuing Bank")
        if lc_bank:
            fields.append({"name": "lc_issuing_bank", "label": "开证行", "value": lc_bank, "confidence": "medium"})

        # Goods description (e.g., MULTI LAYER CERAMIC CAPACITOR)
        for (r, c), val in grid.items():
            if "MULTI LAYER" in str(val).upper() or "DESCRIPTION" in str(val).upper():
                # Try to find the actual description value (might be on same or next row)
                desc_val = grid.get((r + 1, c)) or grid.get((r, c + 1))
                if desc_val and len(str(desc_val)) > 5:
                    fields.append({"name": "goods_description", "label": "货物描述", "value": str(desc_val)[:200], "confidence": "high"})
                else:
                    fields.append({"name": "goods_description", "label": "货物描述", "value": str(val)[:200], "confidence": "medium"})
                break

        # Marks and numbers
        marks = RuleBasedExtractor._find_after_label(grid, "Marks and numbers")
        if marks:
            fields.append({"name": "marks_and_numbers", "label": "唛头", "value": marks, "confidence": "high"})

        # Page number
        page_no = RuleBasedExtractor._find_pattern_in_grid(grid, r"PAGE\s*:\s*(\d+)")
        if page_no:
            fields.append({"name": "page", "label": "页码", "value": page_no, "confidence": "high"})

        # Extract line items
        line_items = RuleBasedExtractor._extract_samsung_line_items_from_grid(grid)

        # Total amount and quantity from TOTAL row
        total_row = None
        for (r, c), val in grid.items():
            if "TOTAL" in str(val).upper() and c < 5:
                total_row = r
                break
        if total_row:
            # Try to get total quantity (usually column 64-69 area in Samsung)
            total_qty_val = grid.get((total_row, 64)) or grid.get((total_row, 69))
            if total_qty_val:
                fields.append({"name": "total_quantity", "label": "总数量", "value": str(total_qty_val), "confidence": "high"})
            # Try to get total amount (usually column 93-98 area)
            total_amt_val = grid.get((total_row, 93)) or grid.get((total_row, 98))
            if total_amt_val:
                fields.append({"name": "total_amount", "label": "总价", "value": str(total_amt_val), "confidence": "high"})

        return {
            "method": "rule_based",
            "fields": fields,
            "line_items": line_items,
        }

    @staticmethod
    def _find_after_label(grid: Dict[tuple, str], label: str) -> Optional[str]:
        """Find a value appearing after a label in the grid.
        Priority: same-row nearby columns, then next-row same column within 2 rows.
        Skips known labels to avoid picking up other field names.
        """
        known_labels = ["No. & date", "L/C", "Shipper", "For Account",
                       "Notify", "Port of", "Final destination", "Carrier",
                       "Sailing", "Marks", "Description", "ITEM", "PAGE"]

        def _is_label(v: str) -> bool:
            return any(lbl.lower() in v.lower() for lbl in known_labels)

        for (r, c), val in grid.items():
            if label.lower() in val.lower():
                # Phase 1: same row, nearby columns (priority within 5 cols)
                for offset in range(1, 6):
                    next_val = grid.get((r, c + offset), "")
                    if next_val and not _is_label(next_val) and len(next_val) > 2:
                        return next_val

                # Phase 2: same row, wider (6-15 cols) - but prefer shorter text
                best_val = None
                for offset in range(6, 16):
                    next_val = grid.get((r, c + offset), "")
                    if next_val and not _is_label(next_val) and len(next_val) > 2:
                        if best_val is None or len(next_val) < len(best_val):
                            best_val = next_val

                if best_val:
                    return best_val

                # Phase 3: next row, same column (up to 3 rows down)
                for row_offset in range(1, 4):
                    next_val = grid.get((r + row_offset, c), "")
                    if next_val and not _is_label(next_val) and len(next_val) > 3:
                        return next_val

                # Phase 4: next row, rightward columns
                for row_offset in range(1, 3):
                    for col_offset in range(1, 6):
                        next_val = grid.get((r + row_offset, c + col_offset), "")
                        if next_val and not _is_label(next_val) and len(next_val) > 3:
                            return next_val

        return None

    @staticmethod
    def _find_date_in_text(text: str) -> Optional[str]:
        """Extract date from text like 'DS12650253               MAY.11,2026'."""
        import re
        match = re.search(
            r'(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\.(\d{1,2}),?\s*(\d{4})',
            text, re.IGNORECASE
        )
        if match:
            month_map = {
                "JAN": "01", "FEB": "02", "MAR": "03", "APR": "04",
                "MAY": "05", "JUN": "06", "JUL": "07", "AUG": "08",
                "SEP": "09", "OCT": "10", "NOV": "11", "DEC": "12",
            }
            month = month_map.get(match.group(1).upper(), "01")
            day = match.group(2).zfill(2)
            year = match.group(3)
            return f"{year}-{month}-{day}"
        return None

    @staticmethod
    def _detect_currency(grid: Dict[tuple, str]) -> Optional[str]:
        """Detect currency from table headers or values."""
        full_text = " ".join(grid.values())
        if "@RMB" in full_text or "RMB" in full_text:
            return "RMB"
        if "@USD" in full_text or "USD" in full_text:
            return "USD"
        if "@KRW" in full_text or "KRW" in full_text:
            return "KRW"
        return None

    @staticmethod
    def _find_pattern_in_grid(grid: Dict[tuple, str], pattern: str) -> Optional[str]:
        """Search for a regex pattern across all grid values."""
        import re
        for val in grid.values():
            match = re.search(pattern, val, re.IGNORECASE)
            if match:
                return match.group(1) if match.lastindex else match.group(0)
        return None

    @staticmethod
    def _extract_samsung_line_items_from_grid(
        grid: Dict[tuple, str]
    ) -> List[Dict[str, Any]]:
        """Extract Samsung line items from the grid layout.
        Samsung table headers: ITEM | P/O | P/N | SAMSUNG P/N | PC | @RMB/1000 | RMB
        Data rows start with a small integer (ITEM number) in the ITEM column.
        """
        items = []

        # Find the table header row
        header_row = None
        for (r, c), val in grid.items():
            v = val.upper().strip()
            if "ITEM" in v and ("P/O" in v or "P/N" in v):
                header_row = r
                break

        if not header_row:
            # Fallback: look for any cell containing "ITEM" and "P/O" / "P/N"
            return items

        # Map columns from the header row
        col_map = {}
        for (r, c), val in grid.items():
            if r == header_row:
                vu = val.upper().strip()
                if vu == "ITEM":
                    col_map["item"] = c
                elif "P/O" in vu:
                    col_map["po"] = c
                elif vu == "P/N":
                    col_map["pn"] = c
                elif "SAMSUNG" in vu and "P/N" in vu:
                    col_map["samsung_pn"] = c
                elif vu in ("PC",):
                    col_map["qty"] = c
                elif "@RMB" in vu:
                    col_map["unit_price"] = c
                elif "RMB" in vu and "@" not in vu and "RMB/1000" not in vu:
                    col_map["amount"] = c

        # Collect data rows: rows below header where first column is a small integer
        data_rows = set()
        item_col = col_map.get("item", 2)
        for (r, c), val in grid.items():
            if r <= header_row:
                continue
            vu = val.upper().strip()
            # Skip non-data rows
            if "TOTAL" in vu or "PAGE" in vu or "MULTI LAYER" in vu:
                continue
            if "ITEM" in vu or "P/O" in vu or "P/N" in vu:
                continue
            # Detect data row by integer in item column
            if c == item_col:
                try:
                    n = int(str(val).strip())
                    if 0 < n < 200:
                        data_rows.add(r)
                except (ValueError, TypeError):
                    pass

        # Build line items
        for row in sorted(data_rows):
            item = {}
            if col_map.get("item"):
                v = grid.get((row, col_map["item"]))
                if v:
                    item["item_no"] = str(v).strip()
            if col_map.get("po"):
                v = grid.get((row, col_map["po"]))
                if v:
                    item["po_no"] = str(v).strip()
            if col_map.get("pn"):
                v = grid.get((row, col_map["pn"]))
                if v:
                    item["part_no"] = str(v).strip()
            if col_map.get("samsung_pn"):
                v = grid.get((row, col_map["samsung_pn"]))
                if v:
                    item["samsung_pn"] = str(v).strip()
            if col_map.get("qty"):
                v = grid.get((row, col_map["qty"]))
                if v:
                    item["quantity"] = str(v).strip()
            if col_map.get("unit_price"):
                v = grid.get((row, col_map["unit_price"]))
                if v:
                    item["unit_price"] = str(v).strip()
            if col_map.get("amount"):
                v = grid.get((row, col_map["amount"]))
                if v:
                    item["amount"] = str(v).strip()

            if item.get("item_no"):
                items.append(item)

        return items
