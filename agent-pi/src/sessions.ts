/**
 * Session persistence for Delta IDP agent.
 * Uses the same JSON file format as the Python backend for compatibility.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORAGE_DIR = path.resolve(__dirname, "../../storage");
const SESSIONS_FILE = "agent_sessions.json";

function ensureDir() {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function loadSessionsFile() {
  ensureDir();
  const filePath = path.join(STORAGE_DIR, SESSIONS_FILE);
  if (fs.existsSync(filePath)) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      return [];
    }
  }
  return [];
}

function saveSessionsFile(sessions) {
  ensureDir();
  fs.writeFileSync(
    path.join(STORAGE_DIR, SESSIONS_FILE),
    JSON.stringify(sessions, null, 2),
    "utf-8"
  );
}

export function listSessions() {
  const sessions = loadSessionsFile();
  sessions.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  return sessions.map((s) => ({
    id: s.id,
    name: s.name || "未命名会话",
    message_count: (s.messages || []).length,
    created_at: s.created_at,
    updated_at: s.updated_at,
  }));
}

export function getSession(sessionId) {
  return loadSessionsFile().find((s) => s.id === sessionId) || null;
}

export function createSession(name = "新会话") {
  const sessions = loadSessionsFile();
  const now = new Date().toISOString();
  const session = {
    id: randomUUID().slice(0, 8),
    name,
    messages: [],
    created_at: now,
    updated_at: now,
  };
  sessions.push(session);
  saveSessionsFile(sessions);
  return session;
}

export function updateSession(sessionId, { messages, name } = {}) {
  const sessions = loadSessionsFile();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return null;
  if (messages !== undefined) session.messages = messages;
  if (name !== undefined) session.name = name;
  session.updated_at = new Date().toISOString();
  saveSessionsFile(sessions);
  return session;
}

export function deleteSession(sessionId) {
  const sessions = loadSessionsFile();
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx === -1) return false;
  sessions.splice(idx, 1);
  saveSessionsFile(sessions);
  return true;
}
