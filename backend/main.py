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

from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from backend.config import UPLOAD_DIR, TEMPLATES_DIR
from backend.utils import (
    parse_xlsx_to_structured_text,
    xlsx_to_markdown_table,
    xlsx_to_plain_text,
    xlsx_to_images,
    xlsx_to_image_base64,
)
from backend.extractors import TemplateExtractor, RuleBasedExtractor
from backend.parsers.mineru import MinerUParser
from backend.parsers.qwen import QwenExtractor
from backend import storage

app = FastAPI(
    title="Delta IDP - 单据关键信息抽取",
    description="智能单据关键信息抽取Demo - 支持发票和装箱单的自动化信息提取",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize components (lazy init for API-dependent ones)
template_extractor = TemplateExtractor()
rule_extractor = RuleBasedExtractor()
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

# Frontend directory
FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")


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
    if ext not in (".xlsx", ".xls", ".png", ".jpg", ".jpeg", ".pdf"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {ext}. Supported: .xlsx, .xls, .png, .jpg, .pdf",
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


@app.post("/api/extract/mineru")
async def extract_with_mineru(
    file_path: str = Form(...),
    template_id: str = Form("auto"),
    document_type: str = Form("invoice"),
    vendor: str = Form("generic"),
):
    """
    Extract key information using MinerU document parsing + template matching.

    Pipeline:
    1. Parse XLSX to structured data (no MinerU API call for XLSX - use direct parsing)
    2. Apply template-based extraction on structured text
    3. Return extracted fields
    """
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    # For XLSX files, use direct structured parsing (fast path)
    # MinerU is primarily for PDF/images; for XLSX we use our own parser
    ext = Path(file_path).suffix.lower()

    if ext in (".xlsx", ".xls"):
        # Direct structured parsing
        structured_data = parse_xlsx_to_structured_text(file_path)
        markdown_text = xlsx_to_markdown_table(file_path)
        plain_text = xlsx_to_plain_text(file_path)

        # Also generate images for reference
        image_base64 = xlsx_to_image_base64(file_path)

        # Apply rule-based extraction on structured grid data
        rule_result = rule_extractor.extract_from_structured_data(structured_data)

        # Also apply template-based extraction on the markdown text
        if template_id == "auto":
            # Auto-select template
            if document_type == "invoice":
                template_id = "samsung_invoice" if vendor == "samsung" else "invoice_generic"
            else:
                template_id = "samsung_packinglist" if vendor == "samsung" else "packinglist_generic"

        template_result = template_extractor.extract_with_template(markdown_text, template_id)

        # Merge results
        merged_fields = _merge_extraction_results(
            rule_result.get("fields", []),
            template_result.get("fields", []),
        )

        return {
            "method": "mineru_structured",
            "file_info": {
                "filename": os.path.basename(file_path),
                "document_type": document_type,
                "vendor": vendor,
            },
            "parsed_content": {
                "sheets": len(structured_data.get("sheets", [])),
                "markdown_preview": markdown_text[:2000],
                "image_base64": image_base64,
            },
            "extraction": {
                "fields": merged_fields,
                "line_items": template_result.get("line_items", []),
            },
            "template_used": template_id,
            "status": "success",
        }

    else:
        # For non-XLSX: use MinerU API to parse, then template extraction
        # Convert to image first if needed
        result = await get_mineru().parse_and_wait(file_path)
        if result:
            content = result.get("content", "")
            if template_id == "auto":
                template_id = f"{document_type}_generic"
            template_result = template_extractor.extract_with_template(content, template_id)
            return {
                "method": "mineru_api",
                "extraction": template_result,
                "template_used": template_id,
                "status": "success",
            }
        else:
            return {
                "method": "mineru_api",
                "status": "fallback",
                "message": "MinerU parsing timed out. Using rule-based extraction instead.",
                "extraction": rule_extractor.extract_from_structured_data(
                    parse_xlsx_to_structured_text(file_path)
                ),
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
    Extract key information using Qwen3.6-27B end-to-end.

    Two modes:
    - vision: Send document image directly to Qwen vision model
    - text: Send Minerva-parsed text to Qwen for extraction
    """
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    if template_id == "auto":
        if document_type == "invoice":
            template_id = "samsung_invoice" if vendor == "samsung" else "invoice_generic"
        else:
            template_id = "samsung_packinglist" if vendor == "samsung" else "packinglist_generic"

    template = template_extractor.load_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail=f"Template not found: {template_id}")

    extraction_fields = template.get("extraction_fields", [])

    image_base64 = ""
    if mode == "vision":
        # Vision mode: send image to Qwen
        image_base64 = xlsx_to_image_base64(file_path)
        if not image_base64:
            # Fallback: send structured text
            mode = "text"

    if mode == "text" or not image_base64:
        # Text mode: parse first, then send to Qwen
        parsed_text = xlsx_to_plain_text(file_path)
        result = get_qwen().extract_from_text(
            text=parsed_text,
            extraction_fields=extraction_fields,
            document_type=document_type,
        )
    else:
        # Vision mode
        result = get_qwen().extract_from_image(
            image_base64=image_base64,
            prompt=f"请从这份{document_type}单据中提取所有关键信息。",
            extraction_fields=extraction_fields,
            document_type=document_type,
        )

    # Also get rule-based result for comparison
    structured_data = parse_xlsx_to_structured_text(file_path)
    rule_result = rule_extractor.extract_from_structured_data(structured_data)

    return {
        "method": f"qwen_{mode}",
        "file_info": {
            "filename": os.path.basename(file_path),
            "document_type": document_type,
            "vendor": vendor,
        },
        "qwen_extraction": result,
        "rule_extraction": {
            "fields": rule_result.get("fields", []),
            "line_items": rule_result.get("line_items", []),
        },
        "template_used": template_id,
        "status": "success",
    }


@app.post("/api/extract/hybrid")
async def extract_hybrid(
    file_path: str = Form(...),
    template_id: str = Form("auto"),
    document_type: str = Form("invoice"),
    vendor: str = Form("generic"),
):
    """
    Hybrid extraction: Combine MinerU structured parsing + Qwen LLM extraction.

    This is the recommended approach:
    1. Structured parsing extracts what it can with high confidence
    2. Qwen fills in gaps and validates
    """
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    if template_id == "auto":
        if document_type == "invoice":
            template_id = "samsung_invoice" if vendor == "samsung" else "invoice_generic"
        else:
            template_id = "samsung_packinglist" if vendor == "samsung" else "packinglist_generic"

    template = template_extractor.load_template(template_id)

    # Step 1: Structured parsing
    structured_data = parse_xlsx_to_structured_text(file_path)
    rule_result = rule_extractor.extract_from_structured_data(structured_data)

    # Step 2: Markdown text for template extraction
    markdown_text = xlsx_to_markdown_table(file_path)
    template_result = template_extractor.extract_with_template(markdown_text, template_id)

    # Step 3: Merge structured + template results
    merged_fields = _merge_extraction_results(
        rule_result.get("fields", []),
        template_result.get("fields", []),
    )

    # Step 4: Optional Qwen validation on low-confidence fields
    low_conf = [f for f in merged_fields if f.get("confidence") == "low"]
    qwen_result = None

    if low_conf:
        try:
            plain_text = xlsx_to_plain_text(file_path)
            low_conf_fields_desc = [
                {"name": f["name"], "label": f["label"], "description": f.get("value", "")}
                for f in low_conf
            ]
            if template:
                extraction_fields = template.get("extraction_fields", [])
                low_conf_fields_desc = [
                    f for f in extraction_fields
                    if f["name"] in [lc["name"] for lc in low_conf]
                ]
            if low_conf_fields_desc:
                qwen_result = get_qwen().extract_from_text(
                    text=plain_text,
                    extraction_fields=low_conf_fields_desc,
                    document_type=document_type,
                )
        except Exception as e:
            print(f"[Hybrid] Qwen validation failed: {e}")

    # Merge Qwen results if available
    if qwen_result and qwen_result.get("fields"):
        merged_fields = _merge_extraction_results(
            merged_fields, qwen_result["fields"], prefer_second=True
        )

    response = {
        "method": "hybrid",
        "file_info": {
            "filename": os.path.basename(file_path),
            "document_type": document_type,
            "vendor": vendor,
        },
        "extraction": {
            "fields": merged_fields,
            "line_items": template_result.get("line_items", []),
        },
        "template_used": template_id,
        "qwen_validated_fields": [f["name"] for f in low_conf] if low_conf else [],
        "status": "success",
    }
    _save_to_history(response, file_path, template_id)
    return response


def _save_to_history(result: Dict[str, Any], file_path: str, template_id: str):
    """Persist extraction result to history."""
    try:
        storage.save_extraction_history({
            "filename": os.path.basename(file_path),
            "document_type": result.get("extraction", {}).get("document_type", ""),
            "method": result.get("method", ""),
            "template_used": template_id,
            "fields": result.get("extraction", {}).get("fields", []),
            "line_items": result.get("extraction", {}).get("line_items", []),
            "field_count": len(result.get("extraction", {}).get("fields", [])),
        })
    except Exception as e:
        print(f"[History] Failed to save: {e}")


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


# ─── Extraction History API ──────────────────────────────────────────────────

@app.get("/api/history")
async def list_history():
    """List all extraction history entries."""
    entries = storage.list_extraction_history()
    return {"history": entries}


@app.get("/api/history/{history_id}")
async def get_history(history_id: str):
    """Get a specific extraction history entry."""
    entry = storage.get_extraction_history(history_id)
    if not entry:
        raise HTTPException(status_code=404, detail="History entry not found")
    return entry


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


# ─── Agent Sessions API ──────────────────────────────────────────────────────

@app.get("/api/agent/sessions")
async def list_sessions():
    """List all agent sessions."""
    sessions = storage.list_agent_sessions()
    return {"sessions": sessions}


@app.post("/api/agent/sessions")
async def create_session(data: Dict[str, Any] = None):
    """Create a new agent session."""
    name = (data or {}).get("name", "新会话")
    session = storage.create_agent_session(name)
    return session


@app.get("/api/agent/sessions/{session_id}")
async def get_session(session_id: str):
    """Get a full agent session with messages."""
    session = storage.get_agent_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.put("/api/agent/sessions/{session_id}")
async def update_session(session_id: str, data: Dict[str, Any]):
    """Update session name or messages."""
    messages = data.get("messages")
    name = data.get("name")
    result = storage.update_agent_session(session_id, messages=messages, name=name)
    if not result:
        raise HTTPException(status_code=404, detail="Session not found")
    return result


@app.delete("/api/agent/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete an agent session."""
    success = storage.delete_agent_session(session_id)
    if not success:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "deleted"}


# ─── Agent Chat (updated with session persistence) ───────────────────────────

@app.post("/api/agent/chat")
async def agent_chat(
    message: str = Form(...),
    history: str = Form(default="[]"),  # JSON array of previous messages
    document_context: str = Form(default=""),  # Optional: current document text
    use_qwen: bool = Form(default=True),
    session_id: str = Form(default=""),
):
    """
    Agent chat endpoint for document Q&A with session persistence.
    Uses Qwen to answer questions about documents.
    """
    import json as json_mod
    try:
        chat_history = json_mod.loads(history)
    except json.JSONDecodeError:
        chat_history = []

    system_prompt = """你是Delta IDP智能助手，专门帮助用户处理国际物流单据（发票和装箱单）。

你的能力包括：
1. 解释单据中的字段含义
2. 帮助用户理解提取的信息
3. 回答关于报关资料的问题
4. 指导用户如何使用系统

请用专业、友好的中文回答。"""

    if document_context:
        system_prompt += f"\n\n当前处理的单据内容：\n{document_context[:3000]}"

    # Build messages
    messages = [{"role": "system", "content": system_prompt}]
    for msg in chat_history[-10:]:
        messages.append(msg)
    messages.append({"role": "user", "content": message})

    if use_qwen:
        try:
            response = get_qwen().client.chat.completions.create(
                model=get_qwen().model,
                messages=messages,
                max_tokens=1024,
                temperature=0.7,
            )
            reply = response.choices[0].message.content.strip()
        except Exception as e:
            reply = f"[Qwen API 暂时不可用] {str(e)}"
    else:
        reply = "当前使用离线模式，我无法回答复杂问题。请上传单据文件开始提取。"

    # Persist to session if session_id provided
    if session_id:
        full_messages = list(chat_history) + [
            {"role": "user", "content": message},
            {"role": "assistant", "content": reply},
        ]
        storage.update_agent_session(session_id, messages=full_messages)

    return {
        "reply": reply,
        "timestamp": datetime.now().isoformat(),
    }


@app.post("/api/agent/extract")
async def agent_extract(
    message: str = Form(...),
    file_path: str = Form(default=""),
):
    """
    Agent-driven extraction: natural language instruction for extraction.
    Example: "提取发票号码和总金额" or "列出所有产品编号"
    """
    if not file_path or not os.path.exists(file_path):
        return {"reply": "请先上传一个单据文件。", "extraction": None}

    # Parse the document
    structured_data = parse_xlsx_to_structured_text(file_path)
    plain_text = xlsx_to_plain_text(file_path)

    # Use Qwen to understand user's intent and extract accordingly
    prompt = f"""用户要求：{message}

请根据用户的要求，从以下单据内容中提取信息，以JSON格式返回。

单据内容：
{plain_text[:4000]}

请返回JSON格式：
{{"reply": "对用户要求的理解", "extraction": {{"fields": [{{"name": "字段名", "value": "值"}}]}} }}"""

    try:
        response = get_qwen().client.chat.completions.create(
            model=get_qwen().model,
            messages=[
                {"role": "system", "content": "你是一个单据信息抽取助手。根据用户自然语言指令提取信息。"},
                {"role": "user", "content": prompt},
            ],
            max_tokens=2048,
            temperature=0.1,
        )
        content = response.choices[0].message.content.strip()
        if content.startswith("```json"):
            content = content[7:]
        if content.endswith("```"):
            content = content[:-3]
        result = json.loads(content)
    except Exception as e:
        result = {"reply": f"抽取过程出错: {e}", "extraction": None}

    return result


# ─── Sample Files ────────────────────────────────────────────────────────────

@app.get("/api/samples/{filename}")
async def get_sample_file(filename: str):
    """Serve sample document files from the project root directory."""
    project_root = os.path.dirname(os.path.dirname(__file__))
    file_path = os.path.join(project_root, filename)
    if os.path.exists(file_path) and os.path.isfile(file_path):
        return FileResponse(file_path, filename=filename)
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


# ─── Frontend Serving ────────────────────────────────────────────────────────

@app.get("/")
async def serve_index():
    """Serve the main demo page."""
    return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))


@app.get("/agent")
async def serve_agent():
    """Serve the agent page."""
    return FileResponse(os.path.join(FRONTEND_DIR, "agent.html"))


@app.get("/css/{filename}")
async def serve_css(filename: str):
    """Serve CSS files."""
    path = os.path.join(FRONTEND_DIR, "css", filename)
    if os.path.exists(path):
        return FileResponse(path)
    raise HTTPException(status_code=404, detail="File not found")


@app.get("/js/{filename}")
async def serve_js(filename: str):
    """Serve JS files."""
    path = os.path.join(FRONTEND_DIR, "js", filename)
    if os.path.exists(path):
        return FileResponse(path)
    raise HTTPException(status_code=404, detail="File not found")


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _merge_extraction_results(
    fields1: List[Dict[str, Any]],
    fields2: List[Dict[str, Any]],
    prefer_second: bool = False,
) -> List[Dict[str, Any]]:
    """Merge two extraction result field lists, deduplicating by name."""
    merged = {}
    for f in fields1:
        name = f.get("name", "")
        if name:
            merged[name] = f

    for f in fields2:
        name = f.get("name", "")
        if name:
            if name in merged:
                if prefer_second and f.get("value"):
                    merged[name] = f
                elif not merged[name].get("value") and f.get("value"):
                    merged[name] = f
                elif f.get("confidence") == "high" and merged[name].get("confidence") != "high":
                    merged[name] = f
            else:
                merged[name] = f

    return list(merged.values())


# ─── Startup ─────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8080, reload=True)
