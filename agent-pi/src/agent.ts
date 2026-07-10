/**
 * Delta IDP Agent powered by pi-agent-core + pi-ai.
 * Uses Qwen via DashScope (OpenAI-compatible API).
 * Loads document extraction skills from the skills/ directory.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  registerApiProvider,
  streamOpenAICompletions,
  streamSimpleOpenAICompletions,
  Type,
} from "@earendil-works/pi-ai";
import type { Model, Tool } from "@earendil-works/pi-ai";
import { summaryTools, type SummaryContext } from "./tools/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Configuration ─────────────────────────────────────────────────

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY || "";
if (!DASHSCOPE_API_KEY) {
  console.warn(
    "[agent] DASHSCOPE_API_KEY is not set — Qwen calls will fail until it is provided via the environment.",
  );
}
const DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
const QWEN_MODEL_ID = "qwen3.6-27b";

// ─── Register DashScope provider ───────────────────────────────────

registerApiProvider({
  api: "openai-completions",
  stream: streamOpenAICompletions as any,
  streamSimple: streamSimpleOpenAICompletions as any,
}, "dashscope");

const qwenModel: Model<"openai-completions"> = {
  id: QWEN_MODEL_ID,
  name: "Qwen3.6 (DashScope)",
  api: "openai-completions",
  provider: "dashscope",
  baseUrl: DASHSCOPE_BASE_URL,
  reasoning: false,
  input: ["text", "image"],
  cost: { input: 0.0008, output: 0.002, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 131072,
  maxTokens: 8192,
  headers: { Authorization: `Bearer ${DASHSCOPE_API_KEY}` },
};

// ─── Skill Loading ─────────────────────────────────────────────────

interface Skill {
  name: string;
  description: string;
  content: string;
  filePath: string;
}

/** Load all SKILL.md files from the skills directory. */
function loadSkillsFromDir(skillsDir: string): Skill[] {
  const skills: Skill[] = [];
  if (!existsSync(skillsDir)) return skills;

  for (const entry of readdirSync(skillsDir, { recursive: true })) {
    const fullPath = resolve(skillsDir, entry);
    if (entry.endsWith("SKILL.md") || entry.endsWith("SKILL.md")) {
      try {
        const content = readFileSync(fullPath, "utf-8");
        // Parse name + description from first heading
        const lines = content.split("\n");
        const name = lines[0]?.replace(/^#\s+/, "").trim() || entry;
        // Find first non-heading, non-empty line as description
        let description = "";
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (line && !line.startsWith("#") && !line.startsWith("##")) {
            description = line;
            break;
          }
        }
        skills.push({ name, description, content, filePath: fullPath });
      } catch { /* skip unreadable files */ }
    }
  }
  return skills;
}

function formatSkillForPrompt(skill: Skill): string {
  return `<skill name="${skill.name}" location="${skill.filePath}">\n${skill.content}\n</skill>`;
}

const SKILLS_DIR = resolve(__dirname, "../skills");
let _cachedSkills: Skill[] | null = null;

function getSkills(): Skill[] {
  if (!_cachedSkills) _cachedSkills = loadSkillsFromDir(SKILLS_DIR);
  return _cachedSkills;
}

// ─── Tools ──────────────────────────────────────────────────────────

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8080";

// Backend enforces HTTP Basic auth; forward the same credentials on internal calls.
const _BACKEND_AUTH =
  process.env.BASIC_AUTH_USER && process.env.BASIC_AUTH_PASS
    ? "Basic " + Buffer.from(`${process.env.BASIC_AUTH_USER}:${process.env.BASIC_AUTH_PASS}`).toString("base64")
    : "";
function backendFetch(url: string, init: Record<string, any> = {}) {
  const headers: Record<string, string> = { ...(init.headers || {}) };
  if (_BACKEND_AUTH) headers["Authorization"] = _BACKEND_AUTH;
  return fetch(url, { ...init, headers });
}

/** Tool: read and parse an uploaded document via scripts/read_document.py */
const readDocumentTool: AgentTool = {
  name: "read_document",
  label: "读取单据文件",
  description:
    "读取已上传的单据文件（.xlsx/.xls），调用 scripts/read_document.py 完整解析，" +
    "输出包含所有行列的结构化文本，ITEM 明细行标记为 ITEM_DATA 保证不漏行。" +
    "当用户提到单据文件路径或文件名时，必须先调用此工具获取文件内容。",
  parameters: Type.Object({
    file_path: Type.String({ description: "单据文件的完整路径，如 /home/qqr/delta_idp/uploads/xxx.xlsx" }),
  }),
  async execute(_toolCallId, params) {
    const { file_path } = params;
    const { execFileSync } = await import("node:child_process");
    try {
      const scriptPath = new URL("../skills/doc-extraction/scripts/read_document.py", import.meta.url).pathname;
      // execFileSync (argv array) — file_path is passed as a literal argument,
      // never interpreted by a shell, so it cannot inject commands.
      // PYTHON_BIN pins the project's .venv python (which has openpyxl); relying
      // on PATH is fragile because `pm2 restart <name> --update-env` can clobber it.
      const result = execFileSync(process.env.PYTHON_BIN || "python3", [scriptPath, file_path], {
        encoding: "utf-8",
        timeout: 30000,
        env: { ...process.env, http_proxy: "", https_proxy: "", HTTP_PROXY: "", HTTPS_PROXY: "" },
      });
      const data = JSON.parse(result);
      if (data.error) throw new Error(data.error);
      const text = data.text || "";
      return {
        content: [{ type: "text", text: `${text}\n\nITEM 明细行数: ${data.item_rows || 0}` }],
        details: data,
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: `读取文件失败: ${e.message}` }],
        details: {},
        isError: true,
      };
    }
  },
};

/** Tool: list all available extraction templates from the system. */
const listTemplatesTool: AgentTool = {
  name: "list_extraction_templates",
  label: "列出抽取模板",
  description:
    "列出系统中所有可用的单据抽取模板（模板ID、名称、字段数、说明）。" +
    "用于在抽取前确定应该使用哪个模板，或回答用户“有哪些模板”。无参数。",
  parameters: Type.Object({}),
  async execute(_toolCallId, _params) {
    try {
      const resp = await backendFetch(`${BACKEND_URL}/api/templates/tree`);
      if (!resp.ok) throw new Error(`Backend error: ${resp.status}`);
      const data = await resp.json();
      // Tree is a flat list of templates (id/name/description/field_count).
      const tpls = (data.tree || []).filter((t: any) => !t.is_group);
      if (!tpls.length) {
        return { content: [{ type: "text", text: "系统中暂无可用的抽取模板。" }], details: { templates: [] } };
      }
      const lines = [`系统中共有 ${tpls.length} 个可用抽取模板：`, ""];
      for (const tpl of tpls) {
        lines.push(`- **${tpl.id}**：${tpl.name}（${tpl.field_count || 0} 个字段）`);
        if (tpl.description) lines.push(`  ${tpl.description}`);
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { templates: tpls },
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: `获取模板列表失败: ${e.message}` }],
        details: {},
        isError: true,
      };
    }
  },
};

/** Tool: fetch one template's field definitions so the agent can explain / use it. */
const getTemplateTool: AgentTool = {
  name: "get_template",
  label: "查看模板字段",
  description:
    "获取指定抽取模板的字段定义（字段序号、名称、数据来源、类型等），用于向用户解释模板或据此从单据中抽取字段。参数 template_id（先用 list_extraction_templates 查到 ID）。",
  parameters: Type.Object({
    template_id: Type.String({ description: "模板ID，如 customs_declaration" }),
  }),
  async execute(_toolCallId, params) {
    const id = (params as { template_id: string }).template_id;
    try {
      const resp = await backendFetch(`${BACKEND_URL}/api/templates/${id}/fields`);
      if (!resp.ok) throw new Error(`Backend ${resp.status}`);
      const d = await resp.json();
      const fields = (d.extraction_fields || [])
        .map((f: any) => `- ${f.field_no ?? ""} ${f.label || f.name}（来源: ${f.data_source || "—"}）`)
        .join("\n");
      return {
        content: [{ type: "text", text: `模板「${d.name || id}」共 ${(d.extraction_fields || []).length} 个字段：\n${fields}` }],
        details: d,
      };
    } catch (e: any) {
      return { content: [{ type: "text", text: `获取模板失败: ${e.message}` }], details: {}, isError: true };
    }
  },
};

/** Tool: list recent extraction history so the agent can reference past results. */
const listHistoryTool: AgentTool = {
  name: "list_history",
  label: "查抽取历史",
  description:
    "列出最近的抽取历史记录（id、文件名、方法、时间、字段数），用于回顾或定位某次抽取结果。无参数。要看某条的完整内容再调用 get_history_result。",
  parameters: Type.Object({}),
  async execute() {
    try {
      const resp = await backendFetch(`${BACKEND_URL}/api/history`);
      if (!resp.ok) throw new Error(`Backend ${resp.status}`);
      const d = await resp.json();
      const items = (d.history || []).slice(0, 15);
      const lines = items.map(
        (h: any) => `- [${h.id}] ${h.filename}（${h.method || "—"}, ${h.field_count || 0} 字段, ${(h.created_at || "").slice(0, 16).replace("T", " ")}）`,
      );
      return {
        content: [{ type: "text", text: items.length ? `最近 ${items.length} 条抽取历史：\n${lines.join("\n")}` : "暂无抽取历史。" }],
        details: { history: items },
      };
    } catch (e: any) {
      return { content: [{ type: "text", text: `获取历史失败: ${e.message}` }], details: {}, isError: true };
    }
  },
};

/** Tool: fetch a past extraction result (declaration Markdown) by history id. */
const getHistoryResultTool: AgentTool = {
  name: "get_history_result",
  label: "读取历史结果",
  description:
    "根据历史记录 id 读取该次抽取的完整结果（报关单 Markdown 表格）。先用 list_history 找到 id。参数 history_id。",
  parameters: Type.Object({
    history_id: Type.String({ description: "历史记录ID" }),
  }),
  async execute(_toolCallId, params) {
    const id = (params as { history_id: string }).history_id;
    try {
      const resp = await backendFetch(`${BACKEND_URL}/api/history/${id}`);
      if (!resp.ok) throw new Error(`Backend ${resp.status}`);
      const d = await resp.json();
      const md = d.markdown || "（该记录没有 Markdown 结果）";
      return { content: [{ type: "text", text: md.slice(0, 6000) }], details: d };
    } catch (e: any) {
      return { content: [{ type: "text", text: `读取结果失败: ${e.message}` }], details: {}, isError: true };
    }
  },
};

// ─── System Prompt Builder ─────────────────────────────────────────

function buildSystemPrompt(): string {
  const skills = getSkills();
  const skillsBlock = skills.map(formatSkillForPrompt).join("\n\n");

  return `你是Delta IDP智能助手，专门帮助用户处理国际物流单据（商业发票、装箱单等）。

你可以：
- 解释单据中的字段含义
- 帮助用户理解提取的信息
- 回答关于报关资料的问题
- 从已上传的单据中提取关键信息
- 对比不同技术路径的抽取结果

${skillsBlock}

请用专业、友好的中文回答。当用户上传了单据文件并请求提取信息时，优先使用上述 skill 中的抽取规范进行回答。`;
}

// ─── Agent Factory ─────────────────────────────────────────────────

export function createAgent(options?: { systemPrompt?: string; skipTemplateTool?: boolean }) {
  const skills = getSkills();

  const tools = options?.skipTemplateTool ? [readDocumentTool] : [readDocumentTool, listTemplatesTool];

  return new Agent({
    initialState: {
      systemPrompt: options?.systemPrompt || buildSystemPrompt(),
      model: qwenModel,
      thinkingLevel: "off",
      tools,
      messages: [],
    },
    getApiKey: (provider) => {
      if (provider === "dashscope") return DASHSCOPE_API_KEY;
      return undefined;
    },
  });
}

export function reloadSkills() {
  _cachedSkills = null;
  return getSkills();
}

// ─── Summary-mode Agent Factory ─────────────────────────────────────
// Special-purpose agent for "multi-invoice merged declaration" workflow.
// The 5 tools in tools/index.ts are bound to a fresh per-request SummaryContext,
// so parallel/concurrent requests do not share state.

export function createSummaryAgent(options?: { extraSystemPrompt?: string }) {
  const { ctx, tools: mergeTools } = summaryTools();

  // Load the customs-merge skill (falls back gracefully if missing).
  const allSkills = getSkills();
  const mergeSkill = allSkills.find((s) => s.filePath.includes("customs-merge"));
  const skillBlock = mergeSkill ? formatSkillForPrompt(mergeSkill) : "";

  const baseSystem = `你是 Delta IDP 报关专家 agent，专门处理**多票合并申报**场景。
以下是本次任务必须严格遵循的 Skill 规范：

${skillBlock}

关键行为准则：
1. 用户会告诉你有哪些 _IV 和 _PL 文件路径。你必须**分别**对每一份调用 read_invoice / read_packing_list（可并行），一份都不能漏。
2. 抽取完全部单据后，依次调用 check_consistency → merge_declarations → render_declaration。
3. **禁止**自己算加法、**禁止**跳过工具直接输出表格。合并数据必须来自 merge_declarations 工具。
4. 最终回复：直接呈现 render_declaration 返回的 Markdown，前面可以补一两句概述。
${options?.extraSystemPrompt || ""}`;

  const agent = new Agent({
    initialState: {
      systemPrompt: baseSystem,
      model: qwenModel,
      thinkingLevel: "off",
      tools: [readDocumentTool, ...mergeTools], // keep read_document as fallback
      messages: [],
    },
    getApiKey: (provider) => {
      if (provider === "dashscope") return DASHSCOPE_API_KEY;
      return undefined;
    },
  });

  return { agent, ctx };
}

// ─── Chat Assistant Factory ─────────────────────────────────────────
// The conversational "智能助手" agent. Unlike createAgent (thin: read + list
// templates), this wires the full toolset so the assistant can actually DO
// work in a conversation: read/extract documents, run a multi-invoice merge,
// look up past extraction results, and explain templates. A fresh merge
// SummaryContext is bound per request, so concurrent chats don't share state.

function buildChatSystemPrompt(): string {
  const skills = getSkills();
  const skillsBlock = skills.map(formatSkillForPrompt).join("\n\n");
  return `你是 Delta IDP 智能助手 —— 一个专业、友好的报关 AI 助手，帮用户处理国际物流单据（商业发票、装箱单、报关资料）。你可以调用工具真正完成工作，不要只凭空回答。

## 你的能力与对应工具
- **读单据/抽字段**：用户给出文件路径或上传文件时，先用 \`read_document\` 读取完整内容，再结合 \`get_template\`（用 \`list_extraction_templates\` 查模板ID）的字段定义抽取并用 Markdown 表格呈现。
- **多票合并申报**：用户要把多张发票(_IV)和箱单(_PL)合并成一份报关单时，严格按下方 customs-merge skill：对每份 _IV 调 \`read_invoice\`、每份 _PL 调 \`read_packing_list\`（可并行），再依次 \`check_consistency\` → \`merge_declarations\` → \`render_declaration\`。**禁止自己做加法**，合计必须来自工具。请在**同一轮**里完成全部读取与合并（工具的累积上下文不跨消息保留）。
- **查抽取历史/结果**：用户问“上次抽的那个/历史结果”时，用 \`list_history\` 找到记录ID，再用 \`get_history_result\` 读完整报关单。
- **模板问答**：用 \`list_extraction_templates\` / \`get_template\` 列出并解释模板字段。

## 行为准则
1. 能用工具拿到事实就用工具，不要编造字段值；工具返回什么就用什么，缺失就如实说“未识别/缺失”。
2. 回答用简洁专业的中文；涉及表格数据时用 Markdown 表格。
3. 一次只做用户要求的事；需要多步时先用一句话说明你要做什么，再调用工具。

${skillsBlock}`;
}

export function createChatAgent() {
  const { tools: mergeTools } = summaryTools();
  return new Agent({
    initialState: {
      systemPrompt: buildChatSystemPrompt(),
      model: qwenModel,
      thinkingLevel: "off",
      tools: [
        readDocumentTool,
        listTemplatesTool,
        getTemplateTool,
        listHistoryTool,
        getHistoryResultTool,
        ...mergeTools,
      ],
      messages: [],
    },
    getApiKey: (provider) => {
      if (provider === "dashscope") return DASHSCOPE_API_KEY;
      return undefined;
    },
  });
}

export type { Agent, Skill };
export { qwenModel, getSkills, formatSkillForPrompt, buildSystemPrompt, DASHSCOPE_API_KEY };
