"""
Simple JSON file-based storage for extraction history and agent sessions.
"""

import json
import os
import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional

STORAGE_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "storage")

def _ensure_dir():
    os.makedirs(STORAGE_DIR, exist_ok=True)

def _load_json(filename: str) -> List[Dict]:
    _ensure_dir()
    path = os.path.join(STORAGE_DIR, filename)
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return []
    return []

def _save_json(filename: str, data: List[Dict]):
    _ensure_dir()
    path = os.path.join(STORAGE_DIR, filename)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


# ─── Extraction History ───────────────────────────────────────────

EXTRACTION_HISTORY_FILE = "extraction_history.json"

def list_extraction_history() -> List[Dict]:
    """List extraction history, newest first."""
    items = _load_json(EXTRACTION_HISTORY_FILE)
    items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return items

def get_extraction_history(history_id: str) -> Optional[Dict]:
    """Get a specific extraction result by ID."""
    items = _load_json(EXTRACTION_HISTORY_FILE)
    for item in items:
        if item.get("id") == history_id:
            return item
    return None

def save_extraction_history(entry: Dict) -> str:
    """Save an extraction result. Returns the entry ID."""
    items = _load_json(EXTRACTION_HISTORY_FILE)
    entry["id"] = entry.get("id") or str(uuid.uuid4())[:8]
    entry["created_at"] = entry.get("created_at") or datetime.now().isoformat()
    items.append(entry)
    _save_json(EXTRACTION_HISTORY_FILE, items)
    return entry["id"]

def delete_extraction_history(history_id: str) -> bool:
    """Delete an extraction history entry."""
    items = _load_json(EXTRACTION_HISTORY_FILE)
    new_items = [i for i in items if i.get("id") != history_id]
    if len(new_items) == len(items):
        return False
    _save_json(EXTRACTION_HISTORY_FILE, new_items)
    return True


# ─── Agent Sessions ───────────────────────────────────────────────

AGENT_SESSIONS_FILE = "agent_sessions.json"

def list_agent_sessions() -> List[Dict]:
    """List agent sessions, newest first."""
    sessions = _load_json(AGENT_SESSIONS_FILE)
    sessions.sort(key=lambda x: x.get("updated_at", ""), reverse=True)
    # Return summary (without message history) for listing
    return [{
        "id": s.get("id"),
        "name": s.get("name", "未命名会话"),
        "message_count": len(s.get("messages", [])),
        "created_at": s.get("created_at"),
        "updated_at": s.get("updated_at"),
    } for s in sessions]

def get_agent_session(session_id: str) -> Optional[Dict]:
    """Get a full agent session with messages."""
    sessions = _load_json(AGENT_SESSIONS_FILE)
    for s in sessions:
        if s.get("id") == session_id:
            return s
    return None

def create_agent_session(name: str = "新会话") -> Dict:
    """Create a new agent session. Returns the full session object."""
    sessions = _load_json(AGENT_SESSIONS_FILE)
    now = datetime.now().isoformat()
    session = {
        "id": str(uuid.uuid4())[:8],
        "name": name,
        "messages": [],
        "created_at": now,
        "updated_at": now,
    }
    sessions.append(session)
    _save_json(AGENT_SESSIONS_FILE, sessions)
    return session

def update_agent_session(session_id: str, messages: List[Dict] = None,
                         name: str = None) -> Optional[Dict]:
    """Update session messages and/or name."""
    sessions = _load_json(AGENT_SESSIONS_FILE)
    for s in sessions:
        if s.get("id") == session_id:
            if messages is not None:
                s["messages"] = messages
            if name is not None:
                s["name"] = name
            s["updated_at"] = datetime.now().isoformat()
            _save_json(AGENT_SESSIONS_FILE, sessions)
            return s
    return None

def delete_agent_session(session_id: str) -> bool:
    """Delete an agent session."""
    sessions = _load_json(AGENT_SESSIONS_FILE)
    new_sessions = [s for s in sessions if s.get("id") != session_id]
    if len(new_sessions) == len(sessions):
        return False
    _save_json(AGENT_SESSIONS_FILE, new_sessions)
    return True


# ─── Tasks (Background Extraction Jobs) ───────────────────────────

TASKS_FILE = "tasks.json"

def create_task(method: str, template_id: str, input_data: Dict) -> Dict:
    """Create a new task with status=running. Returns the task object."""
    tasks = _load_json(TASKS_FILE)
    now = datetime.now().isoformat()
    task = {
        "id": str(uuid.uuid4())[:8],
        "status": "running",
        "progress": "",
        "method": method,
        "template_id": template_id,
        "input": input_data,
        "result": None,
        "created_at": now,
        "completed_at": None,
    }
    tasks.append(task)
    _save_json(TASKS_FILE, tasks)
    return task

def update_task(task_id: str, **kwargs) -> Optional[Dict]:
    """Update task fields (status, progress, result, completed_at)."""
    tasks = _load_json(TASKS_FILE)
    for t in tasks:
        if t.get("id") == task_id:
            for k, v in kwargs.items():
                t[k] = v
            _save_json(TASKS_FILE, tasks)
            return t
    return None

def get_task(task_id: str) -> Optional[Dict]:
    """Get a specific task by ID."""
    tasks = _load_json(TASKS_FILE)
    for t in tasks:
        if t.get("id") == task_id:
            return t
    return None

def list_tasks() -> List[Dict]:
    """List all tasks, newest first. Returns summaries (without full result)."""
    tasks = _load_json(TASKS_FILE)
    tasks.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    summaries = []
    for t in tasks:
        summaries.append({
            "id": t["id"],
            "status": t.get("status", "running"),
            "progress": t.get("progress", ""),
            "method": t.get("method", ""),
            "template_id": t.get("template_id", ""),
            "input": t.get("input", {}),
            "created_at": t.get("created_at"),
            "completed_at": t.get("completed_at"),
        })
    return summaries

def delete_task(task_id: str) -> bool:
    """Delete a task."""
    tasks = _load_json(TASKS_FILE)
    new_tasks = [t for t in tasks if t.get("id") != task_id]
    if len(new_tasks) == len(tasks):
        return False
    _save_json(TASKS_FILE, new_tasks)
    return True
