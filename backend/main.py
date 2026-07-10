"""
FastAPI backend for Delta IDP - Document Key Information Extraction Demo.

Two technical paths:
1. MinerU: Document parsing → structured text → template-based extraction
2. Qwen3.6-27B: End-to-end vision-based extraction from document images

Supports:
- Generic templates (per document type)
- Vendor-specific templates (e.g., Samsung)
- Agent-based chat interface
"""

import os
import json
import shutil
import uuid
from pathlib import Path
from typing import Optional, List, Dict, Any
from datetime import datetime

import httpx
from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Request
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from backend.config import UPLOAD_DIR, TEMPLATES_DIR
from backend.utils import (
    parse_xlsx_to_structured_text,
    xlsx_to_markdown_table,
    xlsx_to_plain_text,
    xlsx_to_images,
    xlsx_to_image_base64,
    xlsx_to_pdf,
)
from backend.extractors import TemplateExtractor
from backend.parsers.mineru import MinerUParser
from backend.parsers.qwen import QwenExtractor
from backend import storage

app = FastAPI(
    title="Delta IDP - 单据关键信息抽取",
    description="智能单据关键信息抽取Demo - 支持发票和装箱单的自动化信息提取",
    version="1.0.0",
)

# CORS: same-origin (the SPA is served by this backend) needs no CORS at all.
# Only allow explicitly-listed cross-origin callers via ALLOWED_ORIGINS
# (comma-separated). Wildcard "*" + credentials is an invalid/insecure combo.
_allowed_origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=bool(_allowed_origins),
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Authentication (HTTP Basic) ─────────────────────────────────────────────
# Enabled only when BASIC_AUTH_PASS is set. Protects every endpoint except the
# health probe. The SPA is served same-origin, so the browser replays the
# Basic credentials automatically after the initial prompt — no frontend change.
#
# IMPORTANT: implemented as a *pure ASGI* middleware, NOT Starlette's
# BaseHTTPMiddleware (@app.middleware("http")). BaseHTTPMiddleware buffers/breaks
# long-lived streaming responses, which killed the agent SSE stream (and the
# /api/agent/* reverse proxy). A pure ASGI middleware passes send/receive through
# untouched, so streaming/SSE works.
import base64
import secrets as _secrets
from starlette.responses import Response as _Response

_BASIC_AUTH_USER = os.environ.get("BASIC_AUTH_USER", "admin")
_BASIC_AUTH_PASS = os.environ.get("BASIC_AUTH_PASS", "")
_AUTH_ENABLED = bool(_BASIC_AUTH_PASS)
if not _AUTH_ENABLED:
    import warnings as _warnings
    _warnings.warn(
        "BASIC_AUTH_PASS is not set — API authentication is DISABLED and every "
        "endpoint is publicly reachable. Set BASIC_AUTH_USER/BASIC_AUTH_PASS.",
        RuntimeWarning,
    )


class BasicAuthMiddleware:
    """Pure-ASGI HTTP Basic auth. Streams-safe (no response buffering)."""

    def __init__(self, app, user: str, password: str):
        self.app = app
        self.user = user
        self.password = password

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("path") == "/api/health":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers") or [])
        auth = headers.get(b"authorization", b"").decode("latin-1")
        if auth.startswith("Basic "):
            try:
                user, _, pw = base64.b64decode(auth[6:]).decode("utf-8").partition(":")
            except Exception:
                user, pw = "", ""
            if _secrets.compare_digest(user, self.user) and _secrets.compare_digest(pw, self.password):
                return await self.app(scope, receive, send)
        resp = _Response(
            status_code=401,
            headers={"WWW-Authenticate": 'Basic realm="Delta IDP"'},
            content="Unauthorized",
        )
        return await resp(scope, receive, send)


if _AUTH_ENABLED:
    app.add_middleware(BasicAuthMiddleware, user=_BASIC_AUTH_USER, password=_BASIC_AUTH_PASS)

# Initialize components (lazy init for API-dependent ones)
template_extractor = TemplateExtractor()
mineru_parser = None  # Lazy init
qwen_extractor = None  # Lazy init

def get_mineru():
    global mineru_parser
    if mineru_parser is None:
        mineru_parser = MinerUParser()
    return mineru_parser

def get_qwen():
    global qwen_extractor
    if qwen_extractor is None:
        qwen_extractor = QwenExtractor()
    return qwen_extractor


# ─── Path confinement ────────────────────────────────────────────────────────
# Client-supplied file_path / folder_path / filename must stay inside the data
# directories we own (uploads + bundled samples). This blocks arbitrary file
# read/parse (e.g. /etc/passwd) and path-traversal via "..". Symlinks are
# resolved before the check, so a symlink escaping a root is rejected too.
_PROJECT_ROOT = Path(__file__).resolve().parents[1]
_ALLOWED_DATA_ROOTS = [
    Path(UPLOAD_DIR).resolve(),
    (_PROJECT_ROOT / "samples").resolve(),
]


def _is_within_allowed_roots(p: str) -> bool:
    if not p:
        return False
    try:
        rp = Path(p).resolve()
    except (OSError, ValueError, RuntimeError):
        return False
    for root in _ALLOWED_DATA_ROOTS:
        try:
            rp.relative_to(root)
            return True
        except ValueError:
            continue
    return False


def _require_safe_path(p: str) -> None:
    """Raise 403 if the path escapes the allowed data directories."""
    if not _is_within_allowed_roots(p):
        raise HTTPException(status_code=403, detail="Path is outside the allowed data directories")

# Frontend directory (Vite build output of the Vue SPA)
FRONTEND_DIR = os.environ.get(
    "FRONTEND_DIR",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend-vue", "dist"),
)
# Static assets (JS/CSS/etc.) produced by `vite build`
FRONTEND_ASSETS_DIR = os.path.join(FRONTEND_DIR, "assets")


# ─── API Endpoints ───────────────────────────────────────────────────────────

@app.get("/api/health")
async def health_check():
    return {"status": "ok", "time": datetime.now().isoformat()}


@app.get("/api/templates")
async def list_templates():
    """List all available extraction templates."""
    templates = template_extractor.list_templates()
    return {"templates": templates}


@app.get("/api/templates/tree")
async def get_template_tree():
    """Get templates organized as a tree grouped by document type."""
    tree = template_extractor.get_template_tree()
    return {"tree": tree}


@app.get("/api/templates/{template_id}")
async def get_template(template_id: str):
    """Get a specific template by ID."""
    template = template_extractor.load_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@app.get("/api/templates/{template_id}/fields")
async def get_template_fields(template_id: str):
    """Get just the extraction fields and line-item fields for a template (used by prompt builder)."""
    template = template_extractor.load_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return {
        "id": template_id,
        "name": template.get("name", template_id),
        "extraction_fields": template.get("extraction_fields", []),
        "line_item_fields": template.get("line_item_fields", []),
        "system_prompt": template.get("system_prompt", ""),
        "prompt_template": template.get("prompt_template", ""),
        "prompt_config": template.get("prompt_config", None),
    }


@app.post("/api/templates")
async def create_template(data: Dict[str, Any]):
    """Create a new template."""
    template_id = data.get("id") or data.get("name", "").replace(" ", "_").lower()
    if not template_id:
        raise HTTPException(status_code=400, detail="Template id or name is required")
    success = template_extractor.save_template(template_id, data)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to save template")
    return {"status": "created", "id": template_id}


@app.put("/api/templates/{template_id}")
async def update_template(template_id: str, data: Dict[str, Any]):
    """Update an existing template."""
    # Ensure the template exists
    if not os.path.exists(os.path.join(TEMPLATES_DIR, f"{template_id}.json")):
        raise HTTPException(status_code=404, detail="Template not found")
    success = template_extractor.save_template(template_id, data)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to update template")
    return {"status": "updated", "id": template_id}


@app.delete("/api/templates/{template_id}")
async def delete_template(template_id: str):
    """Delete a template."""
    success = template_extractor.delete_template(template_id)
    if not success:
        raise HTTPException(status_code=404, detail="Template not found or could not be deleted")
    return {"status": "deleted", "id": template_id}


@app.post("/api/templates/{template_id}/duplicate")
async def duplicate_template(template_id: str):
    """Duplicate an existing template."""
    original = template_extractor.load_template(template_id)
    if not original:
        raise HTTPException(status_code=404, detail="Template not found")
    new_id = f"{template_id}_copy"
    original["name"] = original.get("name", template_id) + " (副本)"
    success = template_extractor.save_template(new_id, original)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to duplicate template")
    return {"status": "duplicated", "id": new_id, "name": original["name"]}


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload a document file (XLSX or image)."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    ext = Path(file.filename).suffix.lower()
    if ext not in (".xlsx", ".xls", ".png", ".jpg", ".jpeg", ".pdf", ".txt", ".csv", ".md"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext}. Supported: .xlsx, .xls, .png, .jpg, .pdf, .txt",
        )

    # Save file
    file_id = str(uuid.uuid4())[:8]
    safe_name = f"{file_id}_{file.filename}"
    file_path = os.path.join(UPLOAD_DIR, safe_name)

    with open(file_path, "wb") as f:
        content = await file.read()
        f.write(content)

    # Determine document type from filename
    filename_upper = file.filename.upper()
    if "_IV" in filename_upper or "INVOICE" in filename_upper:
        doc_type = "invoice"
    elif "_PL" in filename_upper or "PACKING" in filename_upper:
        doc_type = "packing_list"
    else:
        doc_type = "unknown"

    # Detect vendor from filename
    vendor = "generic"
    if "DS" in filename_upper or "ES" in filename_upper:
        vendor = "samsung"

    return {
        "file_id": file_id,
        "filename": file.filename,
        "file_path": file_path,
        "document_type": doc_type,
        "vendor": vendor,
        "size": len(content),
    }


@app.post("/api/upload-set")
async def upload_document_set(files: List[UploadFile] = File(...)):
    """Upload a complete document set (multiple files grouped together)."""
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    set_id = str(uuid.uuid4())[:8]
    set_dir = os.path.join(UPLOAD_DIR, f"set_{set_id}")
    os.makedirs(set_dir, exist_ok=True)

    file_list = []
    for file in files:
        if not file.filename:
            continue
        file_path = os.path.join(set_dir, file.filename)
        content = await file.read()
        with open(file_path, "wb") as f:
            f.write(content)
        file_list.append(file.filename)

    return {
        "set_id": set_id,
        "folder_path": set_dir,
        "files": file_list,
        "file_count": len(file_list),
    }


@app.post("/api/extract/mineru")
async def extract_with_mineru(
    file_path: str = Form(...),
    template_id: str = Form("auto"),
    document_type: str = Form("invoice"),
    vendor: str = Form("generic"),
):
    """
    Parse document and return structured content.

    Pipeline for XLSX:
    1. Convert XLSX to PDF (fpdf2)
    2. Send PDF to MinerU for parsing → Markdown
    3. Return parsed markdown for downstream pi agent extraction

    Pipeline for other formats:
    1. Send directly to MinerU for parsing → Markdown
    2. Return parsed markdown
    """
    _require_safe_path(file_path)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    ext = Path(file_path).suffix.lower()

    if ext in (".xlsx", ".xls"):
        # Step 1: Convert XLSX to PDF
        print(f"[Extract] Converting XLSX to PDF: {file_path}")
        try:
            pdf_path = xlsx_to_pdf(file_path)
            print(f"[Extract] PDF generated: {pdf_path}")
        except Exception as e:
            print(f"[Extract] XLSX to PDF conversion failed: {e}")
            raise HTTPException(status_code=500, detail=f"XLSX to PDF conversion failed: {e}")

        # Step 2: Send PDF to MinerU for parsing
        print(f"[Extract] Sending PDF to MinerU for parsing...")
        result = await get_mineru().parse_and_wait(pdf_path)

        if result:
            content = result.get("content", "")
            print(f"[Extract] MinerU parsing complete, content length: {len(content)}")
            return {
                "method": "mineru_structured",
                "file_info": {
                    "filename": os.path.basename(file_path),
                    "document_type": document_type,
                    "vendor": vendor,
                },
                "parsed_content": {
                    "markdown_preview": content[:8000],
                    "image_base64": "",
                },
                "status": "success",
            }
        else:
            # Fallback: if MinerU fails, use direct parsing
            print(f"[Extract] MinerU failed, falling back to direct parsing")
            markdown_text = xlsx_to_markdown_table(file_path)
            return {
                "method": "mineru_structured",
                "file_info": {
                    "filename": os.path.basename(file_path),
                    "document_type": document_type,
                    "vendor": vendor,
                },
                "parsed_content": {
                    "markdown_preview": markdown_text[:8000],
                    "image_base64": "",
                },
                "status": "fallback",
                "message": "MinerU parsing timed out, using direct parsing fallback.",
            }

    else:
        # For non-XLSX: use MinerU API to parse directly
        result = await get_mineru().parse_and_wait(file_path)
        if result:
            content = result.get("content", "")
            return {
                "method": "mineru_api",
                "parsed_content": {
                    "markdown_preview": content[:8000],
                    "image_base64": "",
                },
                "status": "success",
            }
        else:
            return {
                "method": "mineru_api",
                "status": "fallback",
                "message": "MinerU parsing timed out.",
                "parsed_content": {
                    "markdown_preview": "",
                    "image_base64": "",
                },
            }


@app.post("/api/extract/qwen")
async def extract_with_qwen(
    file_path: str = Form(...),
    template_id: str = Form("auto"),
    document_type: str = Form("invoice"),
    vendor: str = Form("generic"),
    mode: str = Form("vision"),  # "vision" or "text"
):
    """
    Parse document and return structured content for Qwen extraction.

    Extraction is handled by the agent-pi service using qwen3.6-27b multimodal model.
    This endpoint provides the parsed document content.
    """
    _require_safe_path(file_path)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    ext = Path(file_path).suffix.lower()

    if ext in (".xlsx", ".xls"):
        markdown_text = xlsx_to_markdown_table(file_path)
        plain_text = xlsx_to_plain_text(file_path)
        image_base64 = xlsx_to_image_base64(file_path)

        return {
            "method": f"qwen_{mode}",
            "file_info": {
                "filename": os.path.basename(file_path),
                "document_type": document_type,
                "vendor": vendor,
            },
            "parsed_content": {
                "markdown_preview": markdown_text[:8000],
                "plain_text": plain_text[:8000],
                "image_base64": image_base64,
            },
            "status": "success",
        }
    else:
        result = await get_mineru().parse_and_wait(file_path)
        content = result.get("content", "") if result else ""
        return {
            "method": f"qwen_{mode}",
            "parsed_content": {
                "markdown_preview": content[:8000],
                "image_base64": "",
            },
            "status": "success" if result else "fallback",
        }


@app.post("/api/extract/hybrid")
async def extract_hybrid(
    file_path: str = Form(...),
    template_id: str = Form("auto"),
    document_type: str = Form("invoice"),
    vendor: str = Form("generic"),
):
    """
    Parse document and return structured content.

    Extraction is handled by the agent-pi service using qwen3.6-27b multimodal model.
    This endpoint provides the parsed document content.
    """
    _require_safe_path(file_path)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    ext = Path(file_path).suffix.lower()

    if ext in (".xlsx", ".xls"):
        structured_data = parse_xlsx_to_structured_text(file_path)
        markdown_text = xlsx_to_markdown_table(file_path)
        plain_text = xlsx_to_plain_text(file_path)
        image_base64 = xlsx_to_image_base64(file_path)

        return {
            "method": "hybrid",
            "file_info": {
                "filename": os.path.basename(file_path),
                "document_type": document_type,
                "vendor": vendor,
            },
            "parsed_content": {
                "sheets": len(structured_data.get("sheets", [])),
                "markdown_preview": markdown_text[:8000],
                "plain_text": plain_text[:8000],
                "image_base64": image_base64,
            },
            "status": "success",
        }
    else:
        result = await get_mineru().parse_and_wait(file_path)
        content = result.get("content", "") if result else ""
        return {
            "method": "hybrid",
            "parsed_content": {
                "markdown_preview": content[:8000],
                "image_base64": "",
            },
            "status": "success" if result else "fallback",
        }


@app.post("/api/extract/batch")
async def extract_batch(
    file_paths: str = Form(...),  # JSON array of file paths
    template_id: str = Form("auto"),
    method: str = Form("hybrid"),  # "mineru", "qwen", "hybrid"
):
    """Batch extraction for multiple files."""
    import json as json_mod
    try:
        paths = json_mod.loads(file_paths)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid file_paths JSON")

    results = []
    for fp in paths:
        if not _is_within_allowed_roots(fp):
            results.append({"file": fp, "error": "Path is outside the allowed data directories"})
            continue
        if not os.path.exists(fp):
            results.append({"file": fp, "error": "File not found"})
            continue

        doc_type = "unknown"
        fp_upper = os.path.basename(fp).upper()
        if "_IV" in fp_upper:
            doc_type = "invoice"
        elif "_PL" in fp_upper:
            doc_type = "packing_list"

        vendor = "samsung" if ("DS" in fp_upper or "ES" in fp_upper) else "generic"

        try:
            if method == "mineru":
                r = await extract_with_mineru(fp, template_id, doc_type, vendor)
            elif method == "qwen":
                r = await extract_with_qwen(fp, template_id, doc_type, vendor)
            else:
                r = await extract_hybrid(fp, template_id, doc_type, vendor)
            results.append({"file": os.path.basename(fp), "result": r})
        except Exception as e:
            results.append({"file": os.path.basename(fp), "error": str(e)})

    return {"batch_results": results, "method": method}


# ─── Tasks API (Background Extraction Jobs) ─────────────────────────────────

@app.post("/api/tasks")
async def create_task_endpoint(data: Dict[str, Any]):
    """Create a background extraction task and start it."""
    method = data.get("method", "standard")
    template_id = data.get("template_id", "customs_declaration")
    input_data = data.get("input", {})

    task = storage.create_task(method=method, template_id=template_id, input_data=input_data)
    task_id = task["id"]

    if method == "standard":
        import asyncio
        asyncio.create_task(_run_standard_pipeline(task_id, template_id, input_data))
    # For agent mode, the agent-pi server handles execution and updates this task

    return {"task": task}


@app.get("/api/tasks")
async def list_tasks_endpoint():
    """List all tasks (summaries)."""
    return {"tasks": storage.list_tasks()}


@app.get("/api/tasks/{task_id}")
async def get_task_endpoint(task_id: str):
    """Get full task details including result."""
    task = storage.get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.put("/api/tasks/{task_id}")
async def update_task_endpoint(task_id: str, data: Dict[str, Any]):
    """Update task status/progress/result (used by agent-pi)."""
    task = storage.update_task(task_id, **data)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@app.delete("/api/tasks/{task_id}")
async def delete_task_endpoint(task_id: str):
    """Delete a task."""
    success = storage.delete_task(task_id)
    if not success:
        raise HTTPException(status_code=404, detail="Task not found")
    return {"status": "deleted"}


def build_prompt_from_config(
    prompt_config: Dict,
    extraction_fields: List[Dict],
    line_item_fields: List[Dict],
    combined_content: str,
    summary_mode: bool = False,
    doc_stats: Optional[Dict] = None,
) -> tuple:
    """
    Assemble a (system_prompt, user_prompt) tuple from a structured prompt_config.
    Returns (system_prompt: str, user_prompt: str).

    When summary_mode is True, the prompt instructs the model to merge multiple
    invoices/packing lists into a single consolidated customs declaration
    (numeric fields summed, all line items preserved, string fields joined).
    """
    role = prompt_config.get("role", "专业报关员")
    doc_types = prompt_config.get("doc_types", "")
    rules = prompt_config.get("rules", [])
    fmt = prompt_config.get("format", {})
    additional_notes = prompt_config.get("additional_notes", "")

    field_count = len(extraction_fields)
    line_item_cols = "|".join(
        [f.get("label", f.get("name", "")) for f in line_item_fields]
    ) if line_item_fields else "序号|产品编号|品名|申报数量|单位|单价|金额|原产国"

    field_table_rows = "\n".join([
        f"| {f.get('field_no', '')} | {f.get('label', f.get('name', ''))} | {f.get('data_source', '')} | {f.get('source_original_text', '')} |"
        for f in extraction_fields
    ])

    # --- system prompt ---
    sys_prompt = f"你是一位{role}，擅长从国际物流单据中提取结构化信息。"
    if summary_mode:
        sys_prompt += "本次为多票合并申报场景，你需要把多张发票和箱单的数据合并成一份汇总报关单。"

    # --- user prompt ---
    parts = []
    if summary_mode:
        iv_count = (doc_stats or {}).get("invoice_count", 0)
        pl_count = (doc_stats or {}).get("packing_list_count", 0)
        header = (
            f"你是一位{role}，本次任务为**多票合并申报**："
            f"以下资料共包含 {iv_count} 张发票（INVOICE）和 {pl_count} 张箱单（PACKING LIST），"
            f"需要合并为一份汇总的报关单，综合提取 {field_count} 个字段。"
        )
        parts.append(header)
    else:
        parts.append(
            f"你是一位{role}，请从以下整套报关资料中综合提取报关单所需的{field_count}个字段信息。"
        )

    if doc_types:
        parts.append(f"\n这套资料包含：{doc_types}。")
        parts.append("请交叉引用所有文件内容，准确填写每个字段。")

    # Field table
    parts.append(f"\n## 需要提取的{field_count}个字段：\n")
    parts.append("| 序号 | 字段 | 数据来源 | 来源中原文表述 |")
    parts.append("|------|------|----------|----------------|")
    parts.append(field_table_rows)

    # Enabled rules
    enabled_rules = [r for r in rules if r.get("enabled", True)]
    if enabled_rules:
        parts.append("\n## 抽取规则：\n")
        for i, r in enumerate(enabled_rules, 1):
            parts.append(f"{i}. {r['label']}")

    # Summary-mode-specific merging rules (appended after template rules)
    if summary_mode:
        parts.append("\n## 多票合并规则（必须严格遵守）：\n")
        parts.append("1. **数量类字段累加**：总金额、发票总额、总毛重、总净重、总件数、总体积——把所有发票/箱单中对应的数值**相加**后填入，不能只取其中一票")
        parts.append("2. **文本类字段合并**：发票号、合同号、发票日期等每票各不相同的字段，用 `/` 连接，例如 `INV001/INV002/INV003`")
        parts.append("3. **一致性字段取值**：收发货人、贸易方式、运输方式、目的国、币制等三票应当一致的字段，取任一票的值即可；若发现不一致，在数据来源列备注冲突")
        parts.append("4. **商品明细全部保留**：所有发票的所有明细行必须按发票顺序**纵向全部拼接**到一张商品明细表中，一行都不能省略")
        parts.append("5. **明细中标注来源发票**：在商品明细表中新增一列「来源发票」，标注该行来自哪张发票（例如 `INV001`）")
        parts.append("6. **数据来源列写明**：在报关单主要信息表的「数据来源」列注明是来自哪张单据以及是否为累加值（例如 `INV001+INV002+INV003 累加`）")

    # Output format
    parts.append("\n## 输出格式要求：\n")
    parts.append("1. 先输出「报关单主要信息」表格（序号|字段|值|置信度|数据来源|来源中原文表述），字段\"产品编号\"的值填\"见商品明细\"")
    if summary_mode:
        parts.append(f"2. 再输出「商品明细」表格，列头保留发票中的所有属性列，并额外增加「来源发票」列，至少包含：{line_item_cols}|来源发票")
    else:
        parts.append(f"2. 再输出「商品明细」表格，列头保留发票中的所有属性列，至少包含：{line_item_cols}")

    weight_dec = fmt.get("weight_decimals", 3)
    volume_dec = fmt.get("volume_decimals", 4)
    amount_dec = fmt.get("amount_decimals", 2)
    parts.append(f"3. 重量保留{weight_dec}位小数，体积保留{volume_dec}位小数，金额保留{amount_dec}位小数")
    parts.append("4. **绝对禁止省略、合并、截断明细行或使用\"...\"代替**")

    # Additional notes
    if additional_notes:
        parts.append(f"\n## 附加说明：\n{additional_notes}")

    # Content
    parts.append(f"\n## 整套报关资料内容如下：\n{combined_content}")

    return sys_prompt, "\n".join(parts)


def _history_file_names(folder_path: str) -> List[str]:
    """Return stable display names for files in an extraction folder."""
    if not folder_path or not os.path.isdir(folder_path):
        return []
    return [
        p.name
        for p in sorted(Path(folder_path).iterdir())
        if p.is_file()
    ]


def _preview_path_ref(file_path: str) -> str:
    """Return a path reference accepted by preview APIs without exposing absolute paths."""
    if not file_path:
        return ""
    project_root = Path(__file__).resolve().parents[1]
    try:
        return Path(file_path).resolve().relative_to(project_root).as_posix()
    except ValueError:
        return file_path


def _find_uploaded_file_by_original_name(filename: str) -> str:
    """Find newest uploaded file matching either exact name or UUID-prefixed upload name."""
    if not filename or filename.startswith("["):
        return ""

    matches = []
    for path in Path(UPLOAD_DIR).rglob(filename):
        if path.is_file():
            matches.append(path)
    suffix = f"_{filename}"
    for path in Path(UPLOAD_DIR).rglob(f"*{suffix}"):
        if path.is_file():
            matches.append(path)

    if not matches:
        return ""
    newest = max(matches, key=lambda p: p.stat().st_mtime)
    return _preview_path_ref(str(newest))


def _infer_uploaded_folder(folder_name: str) -> tuple[str, List[str]]:
    """Infer uploaded set folder data for old history entries like '[资料集] 846eb8eb'."""
    if not folder_name:
        return "", []
    candidates = [
        Path(UPLOAD_DIR) / folder_name,
        Path(UPLOAD_DIR) / f"set_{folder_name}",
    ]
    for folder in candidates:
        if folder.is_dir():
            return _preview_path_ref(str(folder)), _history_file_names(str(folder))
    return "", []


def _enrich_history_entry(entry: Dict[str, Any], deep: bool = False) -> Dict[str, Any]:
    """Backfill preview metadata for older history entries saved without input paths.

    `deep=True` enables the expensive filesystem lookups (rglob over uploads/) and
    should only be used for a single-entry fetch. The list endpoint passes
    deep=False so it doesn't scan the whole uploads dir once per history row
    (that was O(entries × files) on every /api/history call)."""
    enriched = dict(entry)
    filename = enriched.get("filename", "")

    if not enriched.get("folder_path") and isinstance(filename, str) and filename.startswith("["):
        folder_name = filename.replace("[资料集]", "", 1).strip()
        folder_path, folder_files = _infer_uploaded_folder(folder_name)
        if folder_path:
            enriched["folder_path"] = folder_path
            enriched["folder_files"] = folder_files

    if deep and not enriched.get("file_path") and isinstance(filename, str) and not filename.startswith("["):
        file_path = _find_uploaded_file_by_original_name(filename)
        if file_path:
            enriched["file_path"] = file_path

    if enriched.get("folder_path") and not enriched.get("folder_files"):
        enriched["folder_files"] = _history_file_names(enriched["folder_path"])

    return enriched


async def _run_standard_pipeline(task_id: str, template_id: str, input_data: Dict):
    """
    Standard mode pipeline (runs in background):
    1. Excel -> PDF (skip if already PDF)
    2. PDF -> MinerU -> Markdown
    3. Concat all files
    4. Build prompt from template fields
    5. Call Qwen3.6 directly
    6. Save result
    """
    try:
        folder_path = input_data.get("folder_path", "")
        file_path = input_data.get("file_path", "")
        summary_mode = bool(input_data.get("summary_mode", False))

        # Reject any client-supplied path outside the allowed data directories.
        if folder_path and not _is_within_allowed_roots(folder_path):
            storage.update_task(task_id, status="failed", progress="Path is outside the allowed data directories")
            return
        if file_path and not _is_within_allowed_roots(file_path):
            storage.update_task(task_id, status="failed", progress="Path is outside the allowed data directories")
            return

        # Determine files to process
        files_to_process = []
        if folder_path and os.path.isdir(folder_path):
            for f in sorted(Path(folder_path).iterdir()):
                if f.is_file():
                    files_to_process.append(str(f))
        elif file_path and os.path.exists(file_path):
            files_to_process.append(file_path)
        else:
            storage.update_task(task_id, status="failed", progress="No valid input files")
            return

        total_files = len(files_to_process)
        # Count invoice / packing-list files by filename convention (_IV / _PL suffix)
        doc_stats = {"invoice_count": 0, "packing_list_count": 0}
        for fp in files_to_process:
            up = os.path.basename(fp).upper()
            if "_IV" in up or "INVOICE" in up:
                doc_stats["invoice_count"] += 1
            elif "_PL" in up or "PACKING" in up:
                doc_stats["packing_list_count"] += 1

        # Only enable summary_mode when there really are multiple files
        if summary_mode and total_files < 2:
            summary_mode = False

        combined_sections = []

        # Step 1+2: Convert and parse each file
        for idx, fp in enumerate(files_to_process, 1):
            filename = os.path.basename(fp)
            ext = Path(fp).suffix.lower()

            storage.update_task(task_id, progress=f"正在解析文件 {idx}/{total_files}: {filename}")

            section_header = f"\n\n## 文件：{filename}\n\n"

            if ext in (".xlsx", ".xls"):
                # Excel -> PDF -> MinerU
                try:
                    pdf_path = xlsx_to_pdf(fp)
                    result = await get_mineru().parse_and_wait(pdf_path)
                    if result:
                        content = result.get("content", "")
                        combined_sections.append(section_header + content)
                    else:
                        markdown_text = xlsx_to_markdown_table(fp)
                        combined_sections.append(section_header + markdown_text)
                except Exception as e:
                    try:
                        markdown_text = xlsx_to_markdown_table(fp)
                        combined_sections.append(section_header + markdown_text)
                    except Exception:
                        combined_sections.append(section_header + f"[解析失败: {e}]")

            elif ext in (".pdf",):
                # PDF -> MinerU directly
                try:
                    result = await get_mineru().parse_and_wait(fp)
                    if result:
                        content = result.get("content", "")
                        combined_sections.append(section_header + content)
                    else:
                        combined_sections.append(section_header + "[MinerU解析超时]")
                except Exception as e:
                    combined_sections.append(section_header + f"[解析失败: {e}]")

            elif ext in (".txt", ".md"):
                try:
                    text_content = open(fp, encoding="utf-8").read()
                except UnicodeDecodeError:
                    text_content = open(fp, encoding="gbk", errors="replace").read()
                combined_sections.append(section_header + text_content)
            else:
                combined_sections.append(section_header + "[不支持的文件格式]")

        # Step 3: Concat
        storage.update_task(task_id, progress="正在拼接文档内容...")
        combined_content = "\n".join(combined_sections)

        # Step 4: Build prompt from template
        if summary_mode:
            storage.update_task(
                task_id,
                progress=f"正在构建汇总模式提示（{doc_stats['invoice_count']} 张发票 + {doc_stats['packing_list_count']} 张箱单）...",
            )
        else:
            storage.update_task(task_id, progress="正在构建抽取提示...")
        template = template_extractor.load_template(template_id)
        if not template:
            template = template_extractor.load_template("customs_declaration")

        extraction_fields = template.get("extraction_fields", []) if template else []
        line_item_fields = template.get("line_item_fields", []) if template else []
        template_name = template.get("name", template_id) if template else template_id
        field_count = len(extraction_fields)

        # Priority: prompt_config > prompt_template > hardcoded default
        prompt_config = template.get("prompt_config") if template else None
        if prompt_config:
            system_prompt, prompt = build_prompt_from_config(
                prompt_config, extraction_fields, line_item_fields, combined_content,
                summary_mode=summary_mode, doc_stats=doc_stats,
            )
        else:
            field_table_rows = "\n".join([
                f"| {f.get('field_no', '')} | {f.get('label', f.get('name', ''))} | {f.get('data_source', '')} | {f.get('source_original_text', '')} |"
                for f in extraction_fields
            ])
            line_item_cols = "|".join([f.get("label", f.get("name", "")) for f in line_item_fields]) if line_item_fields else "序号|产品编号|品名|申报数量|单位|单价|金额|原产国"

            summary_block = ""
            if summary_mode:
                iv_count = doc_stats["invoice_count"]
                pl_count = doc_stats["packing_list_count"]
                summary_block = (
                    f"\n\n## 本次为多票合并申报（共 {iv_count} 张发票 + {pl_count} 张箱单）\n"
                    "合并规则：\n"
                    "1. 总金额、总毛重、总净重、总件数、总体积等**数量类字段必须累加**所有发票/箱单的对应数值\n"
                    "2. 发票号、合同号等每票不同的**文本字段用 `/` 拼接**（例如 INV001/INV002）\n"
                    "3. 收发货人、贸易方式、目的国等**一致字段取任一票的值**，不一致时在数据来源列备注\n"
                    "4. 所有发票的**商品明细行必须纵向全部拼接**到一张表，一行不能省略；额外增加「来源发票」列标注来源\n"
                    "5. 数据来源列注明来自哪张单据以及是否为累加值\n"
                )

            prompt_tpl = template.get("prompt_template", "") if template else ""
            if prompt_tpl:
                prompt = prompt_tpl.replace("{field_count}", str(field_count))
                prompt = prompt.replace("{field_table}", field_table_rows)
                prompt = prompt.replace("{line_item_cols}", line_item_cols)
                prompt = prompt.replace("{content}", combined_content)
                if summary_block:
                    prompt = summary_block + "\n" + prompt
            else:
                prompt = f"""你是一位专业报关员，请从以下整套报关资料中综合提取报关单所需的{field_count}个字段信息。{summary_block}

## 需要提取的{field_count}个字段：

| 序号 | 字段 | 数据来源 | 来源中原文表述 |
|------|------|----------|----------------|
{field_table_rows}

## 输出格式要求：
1. 输出「主要信息」表格（序号|字段|值|置信度|数据来源|来源中原文表述）
2. 再输出「商品明细」表格，列头至少包含：{line_item_cols}{"|来源发票" if summary_mode else ""}
3. 缺失字段填 null，不得编造
4. **绝对禁止省略、合并、截断明细行**

## 资料内容如下：
{combined_content}"""

            system_prompt = (template.get("system_prompt", "") if template else "") or "你是一位专业报关员，擅长从国际物流单据中提取结构化信息。"
            if summary_mode:
                system_prompt += "本次为多票合并申报场景，你需要把多张发票和箱单的数据合并成一份汇总报关单。"

        # Step 5: Call Qwen directly
        storage.update_task(task_id, progress="正在调用 Qwen 抽取字段...")

        qwen = get_qwen()
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": prompt},
        ]

        # The OpenAI client's create() is synchronous and blocks for the whole
        # LLM call (tens of seconds). This runs inside an asyncio background task,
        # so calling it directly would block the FastAPI event loop and freeze
        # every other request. Offload it to a worker thread.
        import asyncio
        response = await asyncio.to_thread(
            qwen.client.chat.completions.create,
            model=qwen.model,
            messages=messages,
            max_tokens=8192,
            temperature=0.1,
        )
        choice = response.choices[0]
        reply = (choice.message.content or "").strip()

        # The model can hit the 8192-token output cap and silently drop line
        # items even though the prompt forbids truncation. Surface it instead of
        # returning a partial declaration that looks complete.
        truncated = getattr(choice, "finish_reason", None) == "length"
        if truncated:
            reply += (
                "\n\n> ⚠️ **输出被截断**：本次结果达到模型最大输出长度，商品明细可能不完整。"
                "建议对多票场景使用「汇总模式」（由工具确定性合并、不受长度限制），"
                "或减少单次处理的文件数量后重试。"
            )

        # Step 6: Save result
        result_data = {
            "markdown": reply,
            "fields": [],
            "line_items": [],
            "field_count": field_count,
            "summary_mode": summary_mode,
            "doc_stats": doc_stats,
            "truncated": truncated,
        }
        storage.update_task(
            task_id,
            status="complete",
            progress="",
            result=result_data,
            completed_at=datetime.now().isoformat(),
        )

        # Also save to extraction history for backward compat
        input_name = input_data.get("filename", "")
        if not input_name and folder_path:
            input_name = f"[资料集] {os.path.basename(folder_path)}"
        elif not input_name and file_path:
            input_name = os.path.basename(file_path)

        storage.save_extraction_history({
            "id": task_id,
            "filename": input_name,
            "file_path": _preview_path_ref(file_path) if file_path else "",
            "folder_path": _preview_path_ref(folder_path) if folder_path else "",
            "folder_files": _history_file_names(folder_path),
            "input": input_data,
            "document_type": template_id,
            "vendor": "",
            "method": "standard",
            "fields": [],
            "line_items": [],
            "markdown": reply,
            "field_count": field_count,
        })

    except Exception as e:
        storage.update_task(
            task_id,
            status="failed",
            progress=f"失败: {str(e)}",
            completed_at=datetime.now().isoformat(),
        )


# ─── Extraction History API ──────────────────────────────────────────────────

@app.get("/api/history")
async def list_history():
    """List all extraction history entries."""
    entries = storage.list_extraction_history()
    return {"history": [_enrich_history_entry(entry) for entry in entries]}


@app.get("/api/history/{history_id}")
async def get_history(history_id: str):
    """Get a specific extraction history entry."""
    entry = storage.get_extraction_history(history_id)
    if not entry:
        raise HTTPException(status_code=404, detail="History entry not found")
    return _enrich_history_entry(entry, deep=True)


@app.delete("/api/history/{history_id}")
async def delete_history(history_id: str):
    """Delete an extraction history entry."""
    success = storage.delete_extraction_history(history_id)
    if not success:
        raise HTTPException(status_code=404, detail="History entry not found")
    return {"status": "deleted"}


@app.post("/api/history/save")
async def save_history(entry: Dict[str, Any]):
    """Save an extraction history entry from external sources (e.g., pi agent)."""
    entry_id = storage.save_extraction_history(entry)
    return {"status": "saved", "id": entry_id}


# ─── Agent API (reverse-proxy to agent-pi service) ───────────────────────────
#
# All /api/agent/* requests are proxied to the agent-pi service (Express + SSE).
# agent-pi provides streaming chat, session management and the pi-agent-core
# powered extraction workflow. Backend no longer implements these endpoints
# directly (the old non-streaming versions have been superseded).

AGENT_PI_URL = os.environ.get("AGENT_PI_URL", "http://localhost:3002")


@app.api_route(
    "/api/agent/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH"],
)
async def proxy_agent(request: Request, path: str):
    """Reverse-proxy /api/agent/* to the agent-pi service.

    Streams the response body so SSE (text/event-stream) works end-to-end.
    """
    target = f"{AGENT_PI_URL}/api/agent/{path}"
    # Forward query string
    if request.url.query:
        target = f"{target}?{request.url.query}"

    body = await request.body()

    # NOTE: do NOT wrap this in `async with httpx.AsyncClient() as client: ... return`.
    # Returning the StreamingResponse from inside the context manager closes the
    # client immediately, so the streaming body iterates over a closed transport
    # and only the first buffered chunk gets through (SSE dies after one event).
    # Keep the client open for the whole stream and close it in body_iter's finally.
    client = httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0))
    upstream_req = client.build_request(
        request.method,
        target,
        headers={
            k: v for k, v in request.headers.items()
            if k.lower() not in ("host", "content-length", "transfer-encoding")
        },
        content=body if body else None,
    )
    try:
        upstream = await client.send(upstream_req, stream=True)
    except Exception:
        await client.aclose()
        raise

    # Filter hop-by-hop headers
    hop_by_hop = {
        "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
        "te", "trailers", "transfer-encoding", "upgrade", "content-length",
        "content-encoding",
    }
    resp_headers = {
        k: v for k, v in upstream.headers.items()
        if k.lower() not in hop_by_hop
    }

    async def body_iter():
        try:
            async for chunk in upstream.aiter_raw():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        body_iter(),
        status_code=upstream.status_code,
        headers=resp_headers,
    )


# ─── Document Preview & Serve ─────────────────────────────────────────────────

def _resolve_upload_path(filename: str) -> str:
    """Resolve a client-supplied filename to a real file, but ONLY within the
    allowed data directories (uploads + samples). Every candidate is validated
    with _is_within_allowed_roots so absolute paths / '..' cannot escape."""
    if not filename:
        return ""

    raw_path = Path(filename)
    if raw_path.is_absolute():
        if raw_path.exists() and raw_path.is_file() and _is_within_allowed_roots(str(raw_path)):
            return str(raw_path)
        return ""

    project_root = os.path.dirname(os.path.dirname(__file__))
    candidates = [
        os.path.join(UPLOAD_DIR, filename),
        os.path.join(project_root, "samples", filename),
    ]
    for cand in candidates:
        if os.path.exists(cand) and _is_within_allowed_roots(cand):
            return cand

    # Older history entries only stored the original filename, while uploads are
    # stored as UUID-prefixed files. Pick the newest matching upload.
    inferred = _find_uploaded_file_by_original_name(os.path.basename(filename))
    if inferred:
        file_path = os.path.join(project_root, inferred)
        if os.path.exists(file_path) and _is_within_allowed_roots(file_path):
            return file_path

    return ""


@app.get("/api/document/serve/{filename:path}")
async def serve_document(filename: str):
    """Serve the raw uploaded file for iframe/image embedding (inline, not download)."""
    file_path = _resolve_upload_path(filename)
    if not file_path:
        raise HTTPException(status_code=404, detail="File not found")

    # Determine media type for inline display
    ext = Path(file_path).suffix.lower()
    media_types = {
        ".pdf": "application/pdf",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
    }
    media_type = media_types.get(ext, "application/octet-stream")

    # Use headers to force inline display (not download)
    headers = {"Content-Disposition": "inline"}
    return FileResponse(file_path, media_type=media_type, headers=headers)


@app.get("/api/document/preview")
async def document_preview(filename: str):
    """
    Return document preview data.
    - For XLSX: returns structured cell data for spreadsheet rendering.
    - For PDF/images: returns file_type and serve URL.
    """
    file_path = _resolve_upload_path(filename)
    if not file_path:
        raise HTTPException(status_code=404, detail="File not found")

    ext = Path(file_path).suffix.lower()
    base_filename = os.path.basename(file_path)
    serve_url = f"/api/document/serve/{base_filename}"

    # For PDF and images, just return file_type and URL
    if ext in (".pdf",):
        return {
            "filename": base_filename,
            "file_type": "pdf",
            "serve_url": serve_url,
        }
    if ext in (".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"):
        return {
            "filename": base_filename,
            "file_type": "image",
            "serve_url": serve_url,
        }

    # For XLSX: convert to PDF and show PDF preview
    if ext in (".xlsx", ".xls"):
        # Generate PDF preview (cached in uploads dir)
        pdf_name = Path(base_filename).stem + "_preview.pdf"
        pdf_path = os.path.join(UPLOAD_DIR, pdf_name)
        if not os.path.exists(pdf_path):
            try:
                xlsx_to_pdf(file_path, output_path=pdf_path)
                print(f"[Preview] Generated PDF preview: {pdf_path}")
            except Exception as e:
                print(f"[Preview] PDF conversion failed: {e}")
                raise HTTPException(status_code=500, detail=f"PDF preview generation failed: {e}")
        pdf_serve_url = f"/api/document/serve/{pdf_name}"
        return {
            "filename": base_filename,
            "file_type": "pdf",
            "serve_url": pdf_serve_url,
        }

    # For text files: return content directly
    if ext in (".txt", ".csv", ".md"):
        try:
            text_content = open(file_path, encoding="utf-8").read()
        except UnicodeDecodeError:
            text_content = open(file_path, encoding="gbk", errors="replace").read()
        return {
            "filename": base_filename,
            "file_type": "text",
            "content": text_content,
        }

    raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")


# ─── Sample Files ────────────────────────────────────────────────────────────

@app.get("/api/samples/{filename}")
async def get_sample_file(filename: str):
    """Serve sample document files from the project root directory."""
    project_root = os.path.dirname(os.path.dirname(__file__))
    # basename strips any path components so "../.." traversal is impossible.
    safe_name = os.path.basename(filename)
    file_path = os.path.join(project_root, safe_name)
    if safe_name and os.path.exists(file_path) and os.path.isfile(file_path):
        return FileResponse(file_path, filename=safe_name)
    raise HTTPException(status_code=404, detail="Sample file not found")


# ─── File Serving ────────────────────────────────────────────────────────────

@app.get("/api/files/{file_id}")
async def get_file(file_id: str):
    """Get file info or content."""
    # Look for the file
    for fname in os.listdir(UPLOAD_DIR):
        if fname.startswith(file_id):
            file_path = os.path.join(UPLOAD_DIR, fname)
            ext = Path(fname).suffix.lower()

            if ext in (".png", ".jpg", ".jpeg"):
                return FileResponse(file_path)

            # For XLSX, return structured info
            if ext in (".xlsx", ".xls"):
                data = parse_xlsx_to_structured_text(file_path)
                return {
                    "filename": fname,
                    "sheets": [s["name"] for s in data["sheets"]],
                    "total_cells": sum(len(s["cells"]) for s in data["sheets"]),
                }

    raise HTTPException(status_code=404, detail="File not found")


# ─── Sample Document Sets ─────────────────────────────────────────────────────

SAMPLES_DIR = Path(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))) / "samples"


@app.get("/api/samples")
async def list_samples():
    """List sample document set folders and their files."""
    if not SAMPLES_DIR.exists():
        return {"folders": []}
    folders = []
    for folder in sorted(SAMPLES_DIR.iterdir()):
        if folder.is_dir():
            files = [f.name for f in sorted(folder.iterdir()) if f.is_file()]
            folders.append({
                "name": folder.name,
                "path": str(folder.resolve()),
                "files": files,
            })
    return {"folders": folders}


@app.post("/api/extract/folder")
async def extract_folder(folder_path: str = Form(...)):
    """
    Parse all documents in a folder and return combined content.
    For XLSX: convert to PDF then MinerU parse (or fallback to direct markdown).
    For TXT: read directly.
    Returns concatenated markdown with section headers per file.
    """
    _require_safe_path(folder_path)
    folder = Path(folder_path)
    if not folder.exists() or not folder.is_dir():
        raise HTTPException(status_code=404, detail="Folder not found")

    combined_sections = []
    files = sorted(folder.iterdir())

    for file_item in files:
        if not file_item.is_file():
            continue

        ext = file_item.suffix.lower()
        section_header = f"\n\n## 文件：{file_item.name}\n\n"

        if ext in (".txt",):
            # Read text files directly
            try:
                text_content = file_item.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                text_content = file_item.read_text(encoding="gbk", errors="replace")
            combined_sections.append(section_header + text_content)

        elif ext in (".xlsx", ".xls"):
            # Convert XLSX to PDF then MinerU, or fallback
            file_path_str = str(file_item)
            try:
                pdf_path = xlsx_to_pdf(file_path_str)
                result = await get_mineru().parse_and_wait(pdf_path)
                if result:
                    content = result.get("content", "")
                    combined_sections.append(section_header + content)
                else:
                    # Fallback to direct markdown
                    markdown_text = xlsx_to_markdown_table(file_path_str)
                    combined_sections.append(section_header + markdown_text)
            except Exception as e:
                # Fallback to direct markdown
                try:
                    markdown_text = xlsx_to_markdown_table(file_path_str)
                    combined_sections.append(section_header + markdown_text)
                except Exception:
                    combined_sections.append(section_header + f"[解析失败: {e}]")

        elif ext in (".pdf",):
            # Send PDF directly to MinerU
            try:
                result = await get_mineru().parse_and_wait(str(file_item))
                if result:
                    content = result.get("content", "")
                    combined_sections.append(section_header + content)
                else:
                    combined_sections.append(section_header + "[MinerU解析超时]")
            except Exception as e:
                combined_sections.append(section_header + f"[解析失败: {e}]")

        else:
            # Try to read as text
            try:
                text_content = file_item.read_text(encoding="utf-8")
                combined_sections.append(section_header + text_content)
            except Exception:
                combined_sections.append(section_header + "[不支持的文件格式]")

    combined_content = "\n".join(combined_sections)

    return {
        "folder_name": folder.name,
        "file_count": len([f for f in files if f.is_file()]),
        "combined_content": combined_content,
        "status": "success",
    }


# ─── Frontend Serving (Vue SPA build output) ─────────────────────────────────

# Serve Vite build assets (hashed JS/CSS/images under /assets/)
if os.path.isdir(FRONTEND_ASSETS_DIR):
    app.mount("/assets", StaticFiles(directory=FRONTEND_ASSETS_DIR), name="assets")


def _spa_index() -> FileResponse:
    """Return the SPA index.html for client-side routing.

    index.html must never be cached: it references hashed asset filenames that
    change every build, so a stale cached index.html leaves users running an old
    bundle after a deploy. The hashed /assets/* are immutable and cache freely.
    """
    index_path = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(
            index_path,
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
        )
    raise HTTPException(status_code=404, detail="Frontend not built. Run `npm run build` in frontend-vue/.")


@app.get("/")
async def serve_index():
    """Serve the SPA entry point."""
    return _spa_index()


# SPA history fallback: any non-API, non-asset GET returns index.html so that
# client-side routes (e.g. /agent, /templates) survive a hard refresh.
@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    # Never intercept API calls or mounted static dirs
    if full_path.startswith("api/") or full_path.startswith("assets/"):
        raise HTTPException(status_code=404, detail="Not found")
    # If the path maps to a real file in the dist dir, serve it directly
    candidate = os.path.join(FRONTEND_DIR, full_path)
    if full_path and os.path.isfile(candidate):
        return FileResponse(candidate)
    # Otherwise fall back to the SPA shell
    return _spa_index()


# ─── Helpers ─────────────────────────────────────────────────────────────────



# ─── Startup ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host=os.environ.get("HOST", "0.0.0.0"),
        port=int(os.environ.get("PORT", "16005")),
        reload=bool(os.environ.get("RELOAD", "")),
    )
