"""Configuration for Delta IDP Demo.

Secrets are read from the environment only — never hardcode API keys in source.
Set them via the process environment (see .env.example / ecosystem.config.cjs).
"""

import os
import warnings

# MinerU API (Official)
MINERU_API_KEY = os.environ.get("MINERU_API_KEY", "")
MINERU_BASE_URL = os.environ.get("MINERU_BASE_URL", "https://mineru.net")

# Qwen via Bailian (DashScope)
DASHSCOPE_API_KEY = os.environ.get("DASHSCOPE_API_KEY", "")
QWEN_MODEL = os.environ.get("QWEN_MODEL", "qwen-vl-max")  # DashScope multimodal model for vision extraction

_missing = [name for name, val in (
    ("MINERU_API_KEY", MINERU_API_KEY),
    ("DASHSCOPE_API_KEY", DASHSCOPE_API_KEY),
) if not val]
if _missing:
    warnings.warn(
        f"Missing required API key env vars: {', '.join(_missing)}. "
        "Extraction will fail until these are set in the environment.",
        RuntimeWarning,
    )

# File storage
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Templates directory
TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "templates")
