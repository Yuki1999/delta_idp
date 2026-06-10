"""Qwen3.6-27B via Bailian (DashScope) for end-to-end key information extraction.

Uses DashScope multimodal API to send document images + extraction prompt
and get structured JSON results.
"""

import os
import json
import base64
from typing import Dict, Any, List, Optional
import httpx
from openai import OpenAI
from backend.config import DASHSCOPE_API_KEY, QWEN_MODEL


class QwenExtractor:
    """Extract key information from documents using Qwen3.6-27B via Bailian."""

    def __init__(self):
        self.api_key = DASHSCOPE_API_KEY
        self.model = QWEN_MODEL
        # DashScope OpenAI-compatible endpoint
        # Bypass system SOCKS proxy by unsetting proxy env vars
        for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY", "all_proxy"):
            os.environ.pop(key, None)
        self.client = OpenAI(
            api_key=self.api_key,
            base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        )

    def extract_from_image(
        self,
        image_base64: str,
        prompt: str,
        extraction_fields: List[Dict[str, str]],
        document_type: str = "invoice",
    ) -> Dict[str, Any]:
        """
        Extract fields from a document image using Qwen vision.

        Args:
            image_base64: Base64-encoded PNG/JPEG image
            prompt: System prompt describing the extraction task
            extraction_fields: List of fields to extract with their descriptions
            document_type: "invoice" or "packing_list"

        Returns:
            Dictionary of extracted fields
        """
        # Build the extraction prompt
        fields_desc = "\n".join([
            f"- {f['name']} ({f['label']}): {f.get('description', '')}"
            for f in extraction_fields
        ])

        system_prompt = f"""你是一个专业的国际物流单据信息抽取专家。你需要从{document_type}中提取关键信息。

请仔细阅读图片中的单据内容，提取以下字段的信息，并以JSON格式返回：

{fields_desc}

注意事项：
1. 如果某字段在单据中找不到，值设为null
2. 对于表格中的多行数据（如产品编号、数量、金额等），请以数组形式返回
3. 金额保留原始格式，币制单独提取
4. 日期格式统一为YYYY-MM-DD
5. 只返回JSON，不要有任何其他文字说明

返回格式示例：
{{
  "fields": [
    {{"name": "invoice_no", "value": "DS12650253", "confidence": "high"}},
    {{"name": "invoice_date", "value": "2026-05-11", "confidence": "high"}},
    {{"name": "shipper", "value": "SAMSUNG ELECTRO-MECHANICS(SHENZHEN) CO., LTD", "confidence": "high"}},
    ...
  ],
  "line_items": [
    {{"item_no": "5", "po_no": "XHD01-20251009-015", "part_no": "CL10B332KB8WPNC", "quantity": "164,000", "unit_price": "1", "amount": "164,000"}},
    ...
  ]
}}"""

        messages = [
            {
                "role": "system",
                "content": [{"type": "text", "text": system_prompt}],
            },
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{image_base64}"}},
                    {"type": "text", "text": prompt},
                ],
            },
        ]

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                max_tokens=4096,
                temperature=0.1,
            )
            content = response.choices[0].message.content.strip()

            # Try to parse JSON from response
            # Remove markdown code blocks if present
            if content.startswith("```json"):
                content = content[7:]
            if content.startswith("```"):
                content = content[3:]
            if content.endswith("```"):
                content = content[:-3]

            return json.loads(content.strip())
        except json.JSONDecodeError as e:
            print(f"[Qwen] JSON parse error: {e}")
            print(f"[Qwen] Raw content: {content[:500]}")
            return {"fields": [], "line_items": [], "raw_output": content, "error": str(e)}
        except Exception as e:
            print(f"[Qwen] API error: {e}")
            return {"fields": [], "line_items": [], "error": str(e)}

    def extract_from_text(
        self,
        text: str,
        extraction_fields: List[Dict[str, str]],
        document_type: str = "invoice",
    ) -> Dict[str, Any]:
        """
        Extract fields from document text (when MinerU parsing is available).

        Args:
            text: Structured text from document parsing
            extraction_fields: List of fields to extract
            document_type: "invoice" or "packing_list"
        """
        fields_desc = "\n".join([
            f"- {f['name']} ({f['label']}): {f.get('description', '')}"
            for f in extraction_fields
        ])

        system_prompt = f"""你是一个专业的国际物流单据信息抽取专家。从以下{document_type}文本内容中提取关键信息。

需要提取的字段：
{fields_desc}

请以JSON格式返回提取结果。如果字段找不到，值设为null。
格式：{{"fields": [{{"name": "...", "value": "...", "confidence": "high/medium/low"}}], "line_items": [...]}}"""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"单据文本内容：\n\n{text}"},
        ]

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                max_tokens=4096,
                temperature=0.1,
            )
            content = response.choices[0].message.content.strip()

            if content.startswith("```json"):
                content = content[7:]
            if content.startswith("```"):
                content = content[3:]
            if content.endswith("```"):
                content = content[:-3]

            return json.loads(content.strip())
        except json.JSONDecodeError as e:
            print(f"[Qwen] JSON parse error: {e}")
            return {"fields": [], "line_items": [], "raw_output": content, "error": str(e)}
        except Exception as e:
            print(f"[Qwen] API error: {e}")
            return {"fields": [], "line_items": [], "error": str(e)}
