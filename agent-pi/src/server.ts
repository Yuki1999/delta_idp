/**
 * Delta IDP Agent Server - Express + SSE
 * Bridges the pi agent to the Vue frontend via HTTP/SSE.
 */
import express from "express";
import { createAgent } from "./agent.js";
import * as reviews from "./review.js";

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8080";
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
      const { execSync } = await import("node:child_process");
      try {
        const scriptPath = new URL("../skills/doc-extraction/scripts/read_document.py", import.meta.url).pathname;
        const result = execSync(`python3 "${scriptPath}" "${filePath}"`, {
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

app.post("/api/agent/extract-folder", async (req, res) => {
  const { folder_path, method = "agent", template_id = "customs_declaration", task_id: existingTaskId } = req.body;

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
      const taskResp = await fetch(`${BACKEND_URL}/api/tasks`, {
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
      await fetch(`${BACKEND_URL}/api/tasks/${taskId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
    } catch {}
  };

  try {
    // Step 1: Parse all documents in the folder via Python backend
    send("status", { message: "正在解析文件夹中所有文档..." });
    await updateTask({ progress: "正在解析文件夹中所有文档..." });

    const parseResp = await fetch(`${BACKEND_URL}/api/extract/folder`, {
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
      const tplResp = await fetch(`${BACKEND_URL}/api/templates/${template_id}/fields`);
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
      return `| ${f.field_no || ''} | ${f.label || f.name} | ${f.data_source || ''} |`;
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

| 序号 | 字段 | 数据来源 |
|------|------|----------|
${fieldTableRows}

## 输出格式要求：
1. 输出「主要信息」表格（序号|字段|值|置信度|数据来源）
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
      await fetch(`${BACKEND_URL}/api/history/save`, {
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
      const taskResp = await fetch(`${BACKEND_URL}/api/tasks`, {
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
      await fetch(`${BACKEND_URL}/api/tasks/${taskId}`, {
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

    const parseResp = await fetch(`${BACKEND_URL}/api/extract/mineru`, {
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

请提取所有可用字段，包括字段表（字段|值|置信度）和商品明细表（如有），最后注明单据类型、厂商、使用的模板。`;

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
