"""MinerU API integration for document parsing.

MinerU (OpenXLab) provides document parsing services that extract
structured content (markdown, tables, text) from documents.
"""

import os
import json
import time
import httpx
from typing import Dict, Any, Optional
from backend.config import MINERU_API_KEY, MINERU_BASE_URL


class MinerUParser:
    """Client for MinerU document parsing API."""

    def __init__(self):
        self.api_key = MINERU_API_KEY
        self.base_url = MINERU_BASE_URL
        self.headers = {
            "Authorization": f"Bearer {self.api_key}",
        }

    async def upload_file(self, file_path: str) -> Optional[str]:
        """Upload a file to MinerU and get a file ID."""
        url = f"{self.base_url}/api/v1/file/upload"

        async with httpx.AsyncClient(timeout=60.0) as client:
            with open(file_path, "rb") as f:
                files = {"file": (os.path.basename(file_path), f)}
                try:
                    response = await client.post(url, headers=self.headers, files=files)
                    if response.status_code == 200:
                        data = response.json()
                        if data.get("code") == 0:
                            return data.get("data", {}).get("file_id")
                        else:
                            print(f"[MinerU] Upload failed: {data.get('msg')}")
                    else:
                        print(f"[MinerU] Upload HTTP {response.status_code}: {response.text[:200]}")
                except Exception as e:
                    print(f"[MinerU] Upload exception: {e}")
        return None

    async def parse_document(self, file_id: str, output_format: str = "markdown") -> Optional[Dict[str, Any]]:
        """Submit a parsing task for the uploaded file."""
        url = f"{self.base_url}/api/v1/parse/submit"

        payload = {
            "file_id": file_id,
            "output_format": output_format,
        }

        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                response = await client.post(url, headers=self.headers, json=payload)
                if response.status_code == 200:
                    data = response.json()
                    if data.get("code") == 0:
                        return data.get("data", {})
                    else:
                        print(f"[MinerU] Parse submit failed: {data.get('msg')}")
                else:
                    print(f"[MinerU] Parse submit HTTP {response.status_code}: {response.text[:200]}")
            except Exception as e:
                print(f"[MinerU] Parse submit exception: {e}")
        return None

    async def get_result(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Poll for parsing result."""
        url = f"{self.base_url}/api/v1/parse/result"

        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                response = await client.get(
                    url, headers=self.headers, params={"task_id": task_id}
                )
                if response.status_code == 200:
                    data = response.json()
                    if data.get("code") == 0:
                        return data.get("data", {})
                    else:
                        print(f"[MinerU] Get result failed: {data.get('msg')}")
                else:
                    print(f"[MinerU] Get result HTTP {response.status_code}: {response.text[:200]}")
            except Exception as e:
                print(f"[MinerU] Get result exception: {e}")
        return None

    async def parse_and_wait(
        self, file_path: str, max_wait: int = 120, poll_interval: int = 3
    ) -> Optional[Dict[str, Any]]:
        """
        Full pipeline: upload → submit → poll → get result.
        Returns parsed content as dict.
        """
        print(f"[MinerU] Starting pipeline for: {file_path}")

        # Step 1: Upload
        file_id = await self.upload_file(file_path)
        if not file_id:
            print("[MinerU] Upload failed")
            return None
        print(f"[MinerU] File uploaded, file_id: {file_id}")

        # Step 2: Submit parse task
        task_info = await self.parse_document(file_id)
        if not task_info:
            print("[MinerU] Parse submit failed")
            return None
        task_id = task_info.get("task_id")
        print(f"[MinerU] Parse submitted, task_id: {task_id}")

        # Step 3: Poll for result
        start_time = time.time()
        while time.time() - start_time < max_wait:
            await asyncio_sleep(poll_interval)
            result = await self.get_result(task_id)
            if result:
                status = result.get("status", "")
                if status == "done":
                    print(f"[MinerU] Parsing complete")
                    return result
                elif status == "failed":
                    print(f"[MinerU] Parsing failed: {result}")
                    return None
                print(f"[MinerU] Status: {status}, waiting...")
            else:
                print(f"[MinerU] Poll returned None, retrying...")

        print("[MinerU] Timeout waiting for result")
        return None


def asyncio_sleep(seconds: float):
    """Import-free async sleep using asyncio."""
    import asyncio
    return asyncio.sleep(seconds)
