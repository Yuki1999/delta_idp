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
      const result = execFileSync("python3", [scriptPath, file_path], {
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
    "列出系统中所有可用的单据抽取模板，包括模板ID、名称、适用单据类型和厂商。" +
    "用于在抽取前确定应该使用哪个模板。返回按单据类型分组的模板树。",
  parameters: Type.Object({}),
  async execute(_toolCallId, _params) {
    try {
      const resp = await fetch(`${BACKEND_URL}/api/templates/tree`);
      if (!resp.ok) throw new Error(`Backend error: ${resp.status}`);
      const data = await resp.json();
      const tree = data.tree || [];
      // Format a readable summary
      const lines = ["当前系统可用的抽取模板：", ""];
      for (const group of tree) {
        const docType = group.document_type === "invoice" ? "发票 (Invoice)" : "装箱单 (Packing List)";
        lines.push(`## ${docType}`);
        for (const tpl of group.children || []) {
          const vendorLabel = tpl.vendor === "generic" ? "通用" : `厂商: ${tpl.vendor}`;
          lines.push(`- **${tpl.id}**: ${tpl.name} (${vendorLabel})`);
          if (tpl.description) lines.push(`  ${tpl.description}`);
        }
        lines.push("");
      }
      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: { templates: tree },
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

export type { Agent, Skill };
export { qwenModel, getSkills, formatSkillForPrompt, buildSystemPrompt, DASHSCOPE_API_KEY };
