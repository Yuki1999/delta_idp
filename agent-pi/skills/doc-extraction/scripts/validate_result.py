#!/usr/bin/env python3
"""
Validate extraction result: check totals, number formats, missing fields.

Usage: python validate_result.py '<extraction_json>'
"""
import sys
import json
import re
from decimal import Decimal, InvalidOperation


def validate(extraction: dict) -> dict:
    issues = []
    warnings = []

    fields = extraction.get("fields", [])
    items = extraction.get("line_items", [])
    totals = extraction.get("totals", {})

    # 1. Check mandatory fields
    mandatory = ["invoice_no", "shipper", "consignee", "currency", "total_amount"]
    field_names = [f.get("name", "") for f in fields]
    for m in mandatory:
        if m not in field_names:
            issues.append(f"缺少必填字段: {m}")

    # 2. Check null fields
    null_fields = [f for f in fields if f.get("value") is None]
    if null_fields:
        warnings.append(f"{len(null_fields)} 个字段值为空: {[f['name'] for f in null_fields]}")

    # 3. Validate number formats
    number_fields = {"total_amount": 2, "gross_weight": 3, "net_weight": 3, "measurement": 4}
    for field in fields:
        name = field.get("name", "")
        val = field.get("value")
        if name in number_fields and val is not None:
            try:
                d = Decimal(str(val).replace(",", ""))
                expected_decimals = number_fields[name]
                actual_decimals = abs(d.as_tuple().exponent)
                if actual_decimals > expected_decimals + 1:
                    warnings.append(f"{field.get('label', name)}: 数值精度不符（期望{expected_decimals}位，实际{actual_decimals}位）")
            except (InvalidOperation, ValueError):
                issues.append(f"{field.get('label', name)}: 非数值格式")

    # 4. Validate item totals
    if items and totals:
        calc_totals = {}
        for key in ["quantity", "amount", "gross_weight", "net_weight", "volume"]:
            total = 0
            for item in items:
                val = item.get(key, "")
                if val:
                    try:
                        total += float(str(val).replace(",", ""))
                    except (ValueError, TypeError):
                        pass
            if total > 0:
                calc_totals[key] = round(total, 6)

        for key, calc_val in calc_totals.items():
            if key in totals:
                claimed = totals[key]
                if abs(float(calc_val) - float(claimed)) > 0.01:
                    issues.append(f"合计校验不通过: {key} 计算={calc_val}, 声称={claimed}")

    # 5. Check item count
    if extraction.get("expected_item_count") and len(items) != extraction["expected_item_count"]:
        issues.append(f"明细行数不匹配: 期望{extraction['expected_item_count']}行, 实际{len(items)}行")

    return {
        "valid": len(issues) == 0,
        "issues": issues,
        "warnings": warnings,
        "field_count": len(fields),
        "item_count": len(items),
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: validate_result.py '<extraction_json>'"}))
        sys.exit(1)
    try:
        data = json.loads(sys.argv[1])
    except json.JSONDecodeError:
        data = json.load(sys.stdin)
    result = validate(data)
    print(json.dumps(result, ensure_ascii=False, indent=2))
