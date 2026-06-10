/**
 * Delta IDP Agent Server - Express + SSE
 * Bridges the pi agent to the Vue frontend via HTTP/SSE.
 */
import express from "express";
import { createAgent, getSkills, formatSkillForPrompt } from "./agent.js";
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

// ─── Extraction (SSE) ────────────────────────────────────────────

app.post("/api/agent/extract", async (req, res) => {
  const { file_path, method = "mineru", document_type = "invoice", vendor = "generic" } = req.body;

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
    // Step 1: Parse document via Python backend
    send("status", { message: "正在解析文档..." });

    const parseResp = await fetch(`${BACKEND_URL}/api/extract/mineru`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ file_path, template_id: "auto", document_type, vendor }),
    });
    const parseData = await parseResp.json();

    if (parseData.status === "fallback" || !parseData.extraction?.fields?.length) {
      send("status", { message: "文档解析完成，正在提取..." });
    }

    // Step 2: Use pi agent + skill to extract and format
    const isExplicit = document_type !== "auto" && vendor !== "generic";
    const agent = createAgent({ skipTemplateTool: isExplicit });
    const skillsBlock = getSkills().map(formatSkillForPrompt).join("\n\n");

    // For Qwen mode, try native Qwen extraction; fall back to rule-based
    if (method === "qwen") {
      try {
        const qwenResp = await fetch(`${BACKEND_URL}/api/extract/qwen`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ file_path, template_id: "auto", document_type, vendor, mode: "text" }),
        });
        if (qwenResp.ok) {
          const qwenData = await qwenResp.json();
          if (qwenData.extraction) {
            parseData.extraction = qwenData.extraction;
          }
        }
      } catch { /* Qwen API unavailable, use rule-based fallback */ }
    }

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
    const extFields = (parseData.extraction?.fields || []).map((f: any) => ({
      name: f.name || "",
      label: f.label || f.name || "",
      value: f.value ?? "",
      confidence: f.confidence || "medium",
      location: f.location || "",
    }));
    const reviewItem = reviews.createReview({
      filename: fileName,
      file_path,
      document_type,
      vendor,
      method,
      fields: extFields,
      line_items: parseData.extraction?.line_items || [],
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
        method: method === "qwen" ? "qwen_vision" : "mineru_structured",
        fields: extFields,
        line_items: parseData.extraction?.line_items || [],
        markdown: fullReply,
        field_count: extFields.length,
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
    send("done", { extraction: parseData.extraction, review_id: reviewItem.id });
  } catch (e: any) {
    send("error", { message: e.message || String(e) });
  } finally {
    res.end();
  }
});

// ─── Review Center ─────────────────────────────────────────────────

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
