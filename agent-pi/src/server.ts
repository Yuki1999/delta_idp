/**
 * Delta IDP Agent Server - Express + SSE
 * Bridges the pi agent to the Vue frontend via HTTP/SSE.
 */
import express from "express";
import { createAgent, createSummaryAgent } from "./agent.js";
import * as reviews from "./review.js";
import { readdirSync, statSync } from "node:fs";
import { join as pathJoin, resolve as pathResolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8080";

// Confine client-supplied folder_path / file_path to the project data root
// (delta_idp/). dist/server.js -> agent-pi -> delta_idp. Blocks arbitrary
// filesystem access even if the backend proxy is somehow bypassed.
const _DATA_ROOT = pathResolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
function isPathAllowed(p: string): boolean {
  if (!p || typeof p !== "string") return false;
  const rp = pathResolve(p);
  return rp === _DATA_ROOT || rp.startsWith(_DATA_ROOT + "/");
}

// The backend now enforces HTTP Basic auth. agent-pi is an internal client of
// the backend (task tracking, history save, document parsing), so it must send
// the same credentials on every backend call or it gets 401.
const _BACKEND_AUTH =
  process.env.BASIC_AUTH_USER && process.env.BASIC_AUTH_PASS
    ? "Basic " + Buffer.from(`${process.env.BASIC_AUTH_USER}:${process.env.BASIC_AUTH_PASS}`).toString("base64")
    : "";
function backendFetch(url: string, init: Record<string, any> = {}) {
  const headers: Record<string, string> = { ...(init.headers || {}) };
  if (_BACKEND_AUTH) headers["Authorization"] = _BACKEND_AUTH;
  return fetch(url, { ...init, headers });
}
import * as sessions from "./sessions.js";

const PORT = parseInt(process.env.PORT || "3002", 10);

const app = express();
app.use(express.json());

// ─── Agent Chat (SSE Streaming) ────────────────────────────────────

app.post("/api/agent/chat", async (req, res) => {
  const { message, history = [], session_id, document_context } = req.body;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const agent = createAgent();

    // Build initial messages from history and convert to pi format
    const messages = [];
    for (const msg of history.slice(-20)) {
      // pi expects content as array of content blocks
      const content = Array.isArray(msg.content)
        ? msg.content
        : [{ type: "text", text: String(msg.content || "") }];
      messages.push({ role: msg.role, content });
    }

    // If user has uploaded a file, auto-read it via read_document.py script
    if (document_context && document_context.startsWith("file:")) {
      const filePath = document_context.slice(5);
      const { execFileSync } = await import("node:child_process");
      try {
        const scriptPath = new URL("../skills/doc-extraction/scripts/read_document.py", import.meta.url).pathname;
        // execFileSync (argv array) — never routes filePath through a shell,
        // so a path containing shell metacharacters cannot inject commands.
        const result = execFileSync("python3", [scriptPath, filePath], {
          encoding: "utf-8", timeout: 30000,
          env: { ...process.env, http_proxy: "", https_proxy: "", HTTP_PROXY: "", HTTPS_PROXY: "" },
        });
        const data = JSON.parse(result);
        if (data.text) {
          send("status", { message: `已解析文件：${data.filename}（${data.item_rows || 0} 行明细）` });
          agent.state.systemPrompt += `\n\n当前单据文件内容：\n${data.text}`;
        }
      } catch { /* parse failed, continue without */ }
    } else if (document_context) {
      agent.state.systemPrompt += `\n\n当前处理的单据内容：\n${document_context}`;
    }

    // Restore history messages
    agent.state.messages = messages;

    // Track full reply across multiple turns (tool calls may span turns)
    let fullReply = "";

    // Subscribe to streaming events
    let toolName = "";
    agent.subscribe((event) => {
      switch (event.type) {
        case "message_start":
          break;
        case "message_update": {
          const evt = (event as any).assistantMessageEvent;
          if (evt?.type === "text_delta" && evt.delta) {
            fullReply += evt.delta;
            send("text_delta", { delta: evt.delta });
          }
          break;
        }
        case "tool_execution_start":
          toolName = (event as any).toolName || "";
          send("tool_start", { tool: toolName, message: `正在调用 ${toolName}...` });
          break;
        case "tool_execution_end":
          send("tool_end", { tool: toolName });
          toolName = "";
          break;
        case "agent_end":
          if (fullReply) {
            send("message_end", { reply: fullReply });
          }
          // Persist to session
          if (session_id) {
            const session = sessions.getSession(session_id);
            if (session) {
              const updated = [
                ...(session.messages || []),
                { role: "user", content: [{ type: "text", text: message }] },
                { role: "assistant", content: [{ type: "text", text: fullReply }] },
              ];
              sessions.updateSession(session_id, { messages: updated });
            }
          }
          // Auto-save to review center if reply contains extraction tables
          const hasTable = /\|.+\|.+\n\|[-| ]+\|/.test(fullReply);
          if (hasTable) {
            try {
              const fileName = document_context?.replace("file:", "").split("/").pop() || `agent-${session_id}`;
              reviews.createReview({
                filename: fileName,
                file_path: document_context?.replace("file:", "") || "",
                document_type: "unknown",
                vendor: "generic",
                method: "agent",
                fields: [],
                line_items: [],
                markdown: fullReply,
                source: "agent",
              });
            } catch {}
          }
          send("done", {});
          break;
      }
    });

    await agent.prompt(message);
  } catch (err: any) {
    send("error", { message: err.message || String(err) });
  } finally {
    res.end();
  }
});

// ─── Session CRUD ──────────────────────────────────────────────────

app.get("/api/agent/sessions", (_req, res) => {
  res.json({ sessions: sessions.listSessions() });
});

app.post("/api/agent/sessions", (req, res) => {
  const { name } = req.body;
  const session = sessions.createSession(name || "新会话");
  res.json(session);
});

app.get("/api/agent/sessions/:id", (req, res) => {
  const session = sessions.getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(session);
});

app.put("/api/agent/sessions/:id", (req, res) => {
  const { messages, name } = req.body;
  const session = sessions.updateSession(req.params.id, { messages, name });
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(session);
});

app.delete("/api/agent/sessions/:id", (req, res) => {
  const ok = sessions.deleteSession(req.params.id);
  if (!ok) return res.status(404).json({ error: "Session not found" });
  res.json({ success: true });
});

// ─── Folder Extraction (SSE) ────────────────────────────────────────────

/**
 * Summary-mode folder extraction: multi-invoice merged declaration.
 * Uses createSummaryAgent() which is wired with 5 deterministic tools.
 * SSE bridge additionally forwards `tool_call` / `tool_result` events so
 * the frontend can render a step-by-step tool-invocation trace.
 */
async function runSummaryModeAgent(opts: {
  folder_path: string;
  method: string;
  template_id: string;
  taskId: string;
  send: (event: string, data: unknown) => void;
  updateTask: (fields: Record<string, unknown>) => Promise<void>;
}) {
  const { folder_path, method, template_id, taskId, send, updateTask } = opts;

  // ── 1) Enumerate _IV and _PL files in the folder ──
  send("status", { message: "识别资料集中的发票 (_IV) 和箱单 (_PL) 文件..." });
  await updateTask({ progress: "识别 IV/PL 文件..." });

  let ivFiles: string[] = [];
  let plFiles: string[] = [];
  let otherFiles: string[] = [];
  try {
    const entries = readdirSync(folder_path).sort();
    for (const name of entries) {
      const full = pathJoin(folder_path, name);
      try {
        if (!statSync(full).isFile()) continue;
      } catch { continue; }
      const upper = name.toUpperCase();
      if (upper.includes("_IV") || upper.includes("INVOICE")) ivFiles.push(full);
      else if (upper.includes("_PL") || upper.includes("PACKING")) plFiles.push(full);
      else otherFiles.push(full);
    }
  } catch (e: any) {
    throw new Error(`无法读取文件夹 ${folder_path}: ${e.message}`);
  }

  if (ivFiles.length === 0 && plFiles.length === 0) {
    throw new Error(
      `文件夹 ${folder_path} 中未识别到 _IV / _PL 文件。合并模式需要至少一份发票和一份箱单。`,
    );
  }

  send("status", {
    message: `识别到 ${ivFiles.length} 张发票 + ${plFiles.length} 张箱单，正在启动合并申报 agent...`,
  });
  await updateTask({
    progress: `合并模式：${ivFiles.length} 张发票 + ${plFiles.length} 张箱单`,
  });

  // ── 2) Build agent + prompt ──
  const { agent, ctx } = createSummaryAgent();

  const ivList = ivFiles.map((p) => `  - ${p}`).join("\n") || "  (无)";
  const plList = plFiles.map((p) => `  - ${p}`).join("\n") || "  (无)";
  const prompt = `请对以下多张发票和箱单执行**合并申报**流程（按 customs-merge skill 的 4 步工作流）。

发票文件（共 ${ivFiles.length} 份）：
${ivList}

箱单文件（共 ${plFiles.length} 份）：
${plList}

请立即开始：
1) 对每份 _IV 调用一次 read_invoice、对每份 _PL 调用一次 read_packing_list（可在同一响应里并行发起）
2) 全部抽完后调用 check_consistency
3) 调用 merge_declarations
4) 调用 render_declaration 得到最终报关单 Markdown

最终回复请以 render_declaration 返回的 Markdown 为主体，前面加一句概述（例如"已合并 3 张发票"）。`;

  // ── 3) Subscribe events → SSE bridge ──
  let fullReply = "";
  const toolCallLabels = new Map<string, string>();
  agent.subscribe((event: any) => {
    switch (event.type) {
      case "message_update": {
        const evt = event.assistantMessageEvent;
        if (evt?.type === "text_delta" && evt.delta) {
          fullReply += evt.delta;
          send("text_delta", { delta: evt.delta });
        }
        break;
      }
      case "tool_execution_start": {
        const id = event.toolCallId || "";
        const name = event.toolName || "";
        // Look up the tool's `label` from the agent's registered tools.
        const toolDef = (agent as any).state?.tools?.find((t: any) => t.name === name);
        const label = toolDef?.label || name;
        toolCallLabels.set(id, label);
        send("tool_call", {
          id,
          name,
          label,
          args: event.args || {},
        });
        break;
      }
      case "tool_execution_end": {
        const id = event.toolCallId || "";
        const name = event.toolName || "";
        const result = event.result || {};
        const preview = Array.isArray(result.content)
          ? (result.content.find((c: any) => c.type === "text")?.text || "").slice(0, 300)
          : "";
        send("tool_result", {
          id,
          name,
          label: toolCallLabels.get(id) || name,
          isError: !!event.isError,
          preview,
        });
        break;
      }
    }
  });

  // ── 4) Run agent ──
  try {
    await agent.prompt(prompt);
  } catch (e: any) {
    send("error", { message: `Agent 执行失败: ${e.message}` });
    throw e;
  }

  // ── 5) Persist results ──
  const folderName = folder_path.split("/").pop() || folder_path;
  const reviewItem = reviews.createReview({
    filename: `[合并申报] ${folderName}`,
    file_path: folder_path,
    document_type: template_id,
    vendor: "",
    method,
    fields: [],
    line_items: [],
    markdown: fullReply,
    source: "summary_mode",
  });

  try {
    await backendFetch(`${BACKEND_URL}/api/history/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: reviewItem.id,
        filename: `[合并申报] ${folderName}`,
        document_type: template_id,
        vendor: "",
        method: "summary_mode",
        fields: [],
        line_items: [],
        markdown: fullReply,
        field_count: 0,
        summary_mode: true,
        doc_stats: {
          invoice_count: ivFiles.length,
          packing_list_count: plFiles.length,
        },
        merged_totals: ctx.merged?.totals,
        created_at: new Date().toISOString(),
      }),
    }).catch(() => {});
  } catch {}

  send("message_end", { reply: fullReply });
  send("done", { review_id: reviewItem.id, task_id: taskId });

  await updateTask({
    status: "complete",
    progress: "",
    result: {
      markdown: fullReply,
      fields: [],
      line_items: [],
      summary_mode: true,
      merged_totals: ctx.merged?.totals,
    },
    completed_at: new Date().toISOString(),
  });
}

app.get("/api/debug/sse-stream", async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.socket?.setNoDelay(true);
  for (let i = 0; i < 10; i++) {
    const ok = res.write(`event: tick\ndata: ${JSON.stringify({ i })}\n\n`);
    console.log(`[debug-sse] wrote tick=${i} ok=${ok}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  res.end();
});

app.post("/api/agent/extract-folder", async (req, res) => {
  const {
    folder_path,
    method = "agent",
    template_id = "customs_declaration",
    task_id: existingTaskId,
    summary_mode = false, // NEW: multi-invoice merged declaration mode
  } = req.body || {};

  if (!folder_path || typeof folder_path !== "string") {
    res.status(400).json({ error: "folder_path is required" });
    return;
  }
  if (!isPathAllowed(folder_path)) {
    res.status(403).json({ error: "folder_path is outside the allowed data directory" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.socket?.setNoDelay(true);

  // Track client connection state.
  // IMPORTANT: use res.on('close'), NOT req.on('close') — the latter fires
  // when the request body is fully consumed by Express (~immediately after
  // POST body is read), not when the client socket disconnects, which would
  // incorrectly abort our long-running SSE stream.
  let clientConnected = true;
  res.on("close", () => { clientConnected = false; });

  const send = (event: string, data: unknown) => {
    if (!clientConnected || res.destroyed) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {}
  };

  // Use existing task (created by frontend) or create one as fallback
  let taskId = existingTaskId || "";
  if (!taskId) {
    try {
      const taskResp = await backendFetch(`${BACKEND_URL}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "agent",
          template_id,
          input: { folder_path, filename: `[资料集] ${folder_path.split("/").pop()}` },
        }),
      });
      if (taskResp.ok) {
        const taskData = await taskResp.json();
        taskId = taskData.task?.id || "";
      } else {
        console.error(`[extract-folder] Task creation failed: ${taskResp.status}`);
      }
    } catch (e) {
      console.error("[extract-folder] Task creation error:", e);
    }
  }

  const updateTask = async (fields: Record<string, unknown>) => {
    if (!taskId) return;
    try {
      await backendFetch(`${BACKEND_URL}/api/tasks/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
    } catch {}
  };

  try {
    // ── Summary mode: multi-invoice merged declaration via tool orchestration ──
    if (summary_mode) {
      await runSummaryModeAgent({
        folder_path,
        method,
        template_id,
        taskId,
        send,
        updateTask,
      });
      if (clientConnected && !res.destroyed) {
        try { res.end(); } catch {}
      }
      return;
    }

    // Step 1: Parse all documents in the folder via Python backend
    send("status", { message: "正在解析文件夹中所有文档..." });
    await updateTask({ progress: "正在解析文件夹中所有文档..." });

    const parseResp = await backendFetch(`${BACKEND_URL}/api/extract/folder`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ folder_path }),
    });
    const parseData = await parseResp.json();

    if (parseData.status !== "success") {
      throw new Error("Folder parsing failed");
    }

    send("status", {
      message: `已解析 ${parseData.file_count} 个文件，正在综合抽取报关信息...`
    });

    // Step 2: Fetch template fields dynamically
    let templateFields: any[] = [];
    let lineItemFields: any[] = [];
    let templateName = template_id;
    let promptTemplate = "";
    try {
      const tplResp = await backendFetch(`${BACKEND_URL}/api/templates/${template_id}/fields`);
      if (tplResp.ok) {
        const tplData = await tplResp.json();
        templateFields = tplData.extraction_fields || [];
        lineItemFields = tplData.line_item_fields || [];
        templateName = tplData.name || template_id;
        promptTemplate = tplData.prompt_template || "";
      }
    } catch {}

    // Build dynamic field table for the prompt
    const fieldTableRows = templateFields.map((f: any) => {
      return `| ${f.field_no || ''} | ${f.label || f.name} | ${f.data_source || ''} | ${f.source_original_text || ''} |`;
    }).join('\n');

    const fieldCount = templateFields.length;

    // Build line-item columns description
    const lineItemCols = lineItemFields.length > 0
      ? lineItemFields.map((f: any) => f.label || f.name).join('|')
      : '序号|产品编号|品名|申报数量|单位|单价|金额|原产国';

    // Step 3: Use pi agent to extract fields from combined content
    const agent = createAgent({ skipTemplateTool: true });

    const combinedContent = parseData.combined_content || "";

    // Use template's prompt_template if available, otherwise use default
    let prompt: string;
    if (promptTemplate) {
      prompt = promptTemplate
        .replace(/\{field_count\}/g, String(fieldCount))
        .replace(/\{field_table\}/g, fieldTableRows)
        .replace(/\{line_item_cols\}/g, lineItemCols)
        .replace(/\{content\}/g, combinedContent);
    } else {
      prompt = `你是一位专业报关员，请从以下整套报关资料中综合提取报关单所需的${fieldCount}个字段信息。

## 需要提取的${fieldCount}个字段：

| 序号 | 字段 | 数据来源 | 来源中原文表述 |
|------|------|----------|----------------|
${fieldTableRows}

## 输出格式要求：
1. 输出「主要信息」表格（序号|字段|值|置信度|数据来源|来源中原文表述）
2. 再输出「商品明细」表格，列头至少包含：${lineItemCols}
3. 缺失字段填 null，不得编造
4. **绝对禁止省略、合并、截断明细行**

## 资料内容如下：
${combinedContent}`;
    }

    let fullReply = "";
    agent.subscribe((event) => {
      if (event.type === "message_update") {
        const evt = (event as any).assistantMessageEvent;
        if (evt?.type === "text_delta" && evt.delta) {
          fullReply += evt.delta;
          send("text_delta", { delta: evt.delta });
        }
      }
    });

    await agent.prompt(prompt);

    // Auto-save to review center
    const folderName = folder_path.split("/").pop() || folder_path;
    const reviewItem = reviews.createReview({
      filename: `[资料集] ${folderName}`,
      file_path: folder_path,
      document_type: template_id,
      vendor: "",
      method,
      fields: [],
      line_items: [],
      markdown: fullReply,
      source: "folder_extraction",
    });

    // Save to Python backend history
    try {
      const histEntry = {
        id: reviewItem.id,
        filename: `[资料集] ${folderName}`,
        document_type: template_id,
        vendor: "",
        method: "folder_extraction",
        fields: [],
        line_items: [],
        markdown: fullReply,
        field_count: fieldCount,
        created_at: new Date().toISOString(),
      };
      await backendFetch(`${BACKEND_URL}/api/history/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(histEntry),
      }).catch(() => {});
    } catch {}

    send("message_end", { reply: fullReply });
    send("done", { review_id: reviewItem.id, task_id: taskId });

    // Update task to complete
    await updateTask({
      status: "complete",
      progress: "",
      result: { markdown: fullReply, fields: [], line_items: [], field_count: fieldCount },
      completed_at: new Date().toISOString(),
    });
  } catch (e: any) {
    send("error", { message: e.message || String(e) });
    await updateTask({
      status: "failed",
      progress: `失败: ${e.message || String(e)}`,
      completed_at: new Date().toISOString(),
    });
  } finally {
    if (clientConnected && !res.destroyed) {
      try { res.end(); } catch {}
    }
  }
});

// ─── Single File Extraction (SSE) ───────────────────────────────────────────────────

app.post("/api/agent/extract", async (req, res) => {
  const { file_path, method = "agent", document_type = "invoice", vendor = "generic", task_id: existingTaskId } = req.body;

  if (!isPathAllowed(file_path)) {
    res.status(403).json({ error: "file_path is outside the allowed data directory" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  // Track client connection state for graceful disconnect handling
  let clientConnected = true;
  req.on("close", () => { clientConnected = false; });

  const send = (event: string, data: unknown) => {
    if (!clientConnected || res.destroyed) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {}
  };

  // Use existing task (created by frontend) or create one as fallback
  let taskId = existingTaskId || "";
  if (!taskId) {
    try {
      const taskResp = await backendFetch(`${BACKEND_URL}/api/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "agent",
          template_id: "auto",
          input: { file_path, filename: file_path.split("/").pop() },
        }),
      });
      if (taskResp.ok) {
        const taskData = await taskResp.json();
        taskId = taskData.task?.id || "";
      } else {
        console.error(`[extract] Task creation failed: ${taskResp.status}`);
      }
    } catch (e) {
      console.error("[extract] Task creation error:", e);
    }
  }

  const updateTask = async (fields: Record<string, unknown>) => {
    if (!taskId) return;
    try {
      await backendFetch(`${BACKEND_URL}/api/tasks/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
    } catch {}
  };

  try {
    // Step 1: Parse document via Python backend (XLSX→PDF→MinerU→Markdown)
    send("status", { message: "正在解析文档（Excel→PDF→MinerU解析）..." });
    await updateTask({ progress: "正在解析文档..." });

    const parseResp = await backendFetch(`${BACKEND_URL}/api/extract/mineru`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ file_path, template_id: "auto", document_type, vendor }),
    });
    const parseData = await parseResp.json();

    const isFallback = parseData.status === "fallback";
    send("status", {
      message: isFallback
        ? "MinerU解析超时，使用备用解析，正在提取..."
        : "文档解析完成，正在根据模板配置提取..."
    });

    // Step 2: Use pi agent + skill to extract and format
    const isExplicit = document_type !== "auto" && vendor !== "generic";
    const agent = createAgent({ skipTemplateTool: isExplicit });

    const matchingHint = isExplicit
      ? `⚠️ 用户已指定单据类型「${document_type}」、厂商「${vendor}」。直接提取，不要重新识别或调用工具。`
      : "请先调用 list_extraction_templates 工具查询可用模板，再匹配。";

    const preview = parseData.parsed_content?.markdown_preview || "";
    let prompt = `请从以下已解析的单据中提取关键信息，用Markdown表格展示。

单据类型: ${document_type}
厂商: ${vendor}
${matchingHint}

已解析的文档内容：
${preview}

请提取所有可用字段，包括字段表（字段|值|置信度|数据来源|来源中原文表述）和商品明细表（如有），最后注明单据类型、厂商、使用的模板。`;

    let fullReply = "";
    agent.subscribe((event) => {
      if (event.type === "message_update") {
        const evt = (event as any).assistantMessageEvent;
        if (evt?.type === "text_delta" && evt.delta) {
          fullReply += evt.delta;
          send("text_delta", { delta: evt.delta });
        }
      }
    });

    await agent.prompt(prompt);

    // Auto-save to review center
    const fileName = file_path.split("/").pop() || file_path;
    const reviewItem = reviews.createReview({
      filename: fileName,
      file_path,
      document_type,
      vendor,
      method,
      fields: [],
      line_items: [],
      markdown: fullReply,
      source: "extraction",
    });

    // Also save to Python backend's extraction history
    try {
      const histEntry = {
        id: reviewItem.id,
        filename: fileName,
        document_type,
        vendor,
        method: "agent",
        fields: [],
        line_items: [],
        markdown: fullReply,
        field_count: 0,
        created_at: new Date().toISOString(),
      };
      const histUrl = `${BACKEND_URL}/api/history/save`;
      await fetch(histUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(histEntry),
      }).catch(() => {}); // ignore if backend doesn't support this endpoint yet
    } catch {}

    send("message_end", { reply: fullReply });
    send("done", { review_id: reviewItem.id, task_id: taskId });

    // Update task to complete
    await updateTask({
      status: "complete",
      progress: "",
      result: { markdown: fullReply, fields: [], line_items: [] },
      completed_at: new Date().toISOString(),
    });
  } catch (e: any) {
    send("error", { message: e.message || String(e) });
    await updateTask({
      status: "failed",
      progress: `失败: ${e.message || String(e)}`,
      completed_at: new Date().toISOString(),
    });
  } finally {
    if (clientConnected && !res.destroyed) {
      try { res.end(); } catch {}
    }
  }
});

// ─── Review Center ─────────────────────────────────────────────────────────

app.get("/api/review/items", (req, res) => {
  const status = req.query.status as string | undefined;
  res.json({ items: reviews.listReviews(status) });
});

app.get("/api/review/items/:id", (req, res) => {
  const item = reviews.getReview(req.params.id);
  if (!item) return res.status(404).json({ error: "Not found" });
  // Also return the document image if available
  res.json(item);
});

app.put("/api/review/items/:id", (req, res) => {
  const { status, fields, corrections } = req.body;
  const item = reviews.updateReview(req.params.id, { status, fields, corrections });
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
});

app.delete("/api/review/items/:id", (req, res) => {
  const ok = reviews.deleteReview(req.params.id);
  if (!ok) return res.status(404).json({ error: "Not found" });
  res.json({ success: true });
});

// ─── Health ────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "delta-idp-agent-pi" });
});

// ─── Start ─────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Delta IDP Agent (pi) running on http://localhost:${PORT}`);
});
