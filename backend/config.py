"""Configuration for Delta IDP Demo."""

import os

# MinerU API (Official)
MINERU_API_KEY = os.environ.get(
    "MINERU_API_KEY",
    "eyJ0eXBlIjoiSldUIiwiYWxnIjoiSFM1MTIifQ.eyJqdGkiOiI3MjAwNjY1OCIsInJvbCI6IlJPTEVfUkVHSVNURVIiLCJpc3MiOiJPcGVuWExhYiIsImlhdCI6MTc4MTExMjQzNCwiY2xpZW50SWQiOiJsa3pkeDU3bnZ5MjJqa3BxOXgydyIsInBob25lIjoiMTMzNzIxNzc0MjAiLCJvcGVuSWQiOm51bGwsInV1aWQiOiJmZjQ3MzRiNy0wNDY4LTQ2MzItOTJmNS04M2M5OTY1NjQzZTYiLCJlbWFpbCI6IiIsImV4cCI6MTc4ODg4ODQzNH0.XC1b2lEiYCu8UW1lx5d-5sD37HQODoMC-ZNpadnks6TaoyFrtSg54RNA-XO34K4ymu7XTEHIvz7fqrHAxAu3OQ",
)
MINERU_BASE_URL = os.environ.get("MINERU_BASE_URL", "https://mineru.net")

# Qwen via Bailian (DashScope)
DASHSCOPE_API_KEY = os.environ.get(
    "DASHSCOPE_API_KEY", "sk-17a229bf21204572b5bf1d00d16d558d"
)
QWEN_MODEL = os.environ.get("QWEN_MODEL", "qwen-vl-max")  # DashScope multimodal model for vision extraction

# File storage
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Templates directory
TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "templates")
