"""Configuration for Delta IDP Demo."""

import os

# MinerU API (OpenXLab)
MINERU_API_KEY = "eyJ0eXBlIjoiSldUIiwiYWxnIjoiSFM1MTIifQ.eyJqdGkiOiI3MjAwNjY1OCIsInJvbCI6IlJPTEVfUkVHSVNURVIiLCJpc3MiOiJPcGVuWExhYiIsImlhdCI6MTc3MjYwOTM3MSwiY2xpZW50SWQiOiJsa3pkeDU3bnZ5MjJqa3BxOXgydyIsInBob25lIjoiMTMzNzIxNzc0MjAiLCJvcGVuSWQiOm51bGwsInV1aWQiOiI5YzQ5YThiMi1iMTliLTRlMzYtYmIzMS05MGRiYTQxMTdlMjYiLCJlbWFpbCI6IiIsImV4cCI6MTc4MDM4NTM3MX0.shcTkrDG_GTPlPzPM_lqmmdVT4nPJE4OqE6-XLXA2uNQ8F-MpNvO2KA926FNdTJz6-ZN2UsYRhAugPL2h7zw8Q"
MINERU_BASE_URL = "https://mineru.openxlab.org.cn"

# Qwen via Bailian (DashScope)
DASHSCOPE_API_KEY = "sk-17a229bf21204572b5bf1d00d16d558d"
QWEN_MODEL = "qwen-vl-max"  # DashScope multimodal model for vision extraction

# File storage
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Templates directory
TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "templates")
