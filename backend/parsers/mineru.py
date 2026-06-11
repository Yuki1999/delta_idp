"""MinerU Official API integration for document parsing.

MinerU (https://mineru.net) provides document parsing services that extract
structured content (markdown, tables, text) from documents.

API v4 Flow (local file upload):
1. POST /api/v4/file-urls/batch → get pre-signed upload URL + batch_id
2. PUT file to the upload URL
3. GET /api/v4/extract-results/batch/{batch_id} → poll until done
4. Download full_zip_url → extract full.md (markdown result)
"""

import os
import io
import time
import zipfile
import httpx
from typing import Dict, Any, Optional
from backend.config import MINERU_API_KEY, MINERU_BASE_URL


class MinerUParser:
    """Client for MinerU official v4 API."""

    def __init__(self):
        self.api_key = MINERU_API_KEY
        self.base_url = MINERU_BASE_URL
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

    async def request_upload_url(self, filename: str, model_version: str = "vlm") -> Optional[Dict[str, Any]]:
        """
        Request a pre-signed upload URL for local file.
        POST /api/v4/file-urls/batch

        Returns dict with batch_id and file_urls on success.
        """
        url = f"{self.base_url}/api/v4/file-urls/batch"
        payload = {
            "files": [{"name": filename}],
            "enable_table": True,
            "model_version": model_version,
        }

        async with httpx.AsyncClient(timeout=60.0, proxy=None) as client:
            try:
                response = await client.post(url, headers=self.headers, json=payload)
                if response.status_code == 200:
                    data = response.json()
                    if data.get("code") == 0:
                        return data.get("data", {})
                    else:
                        print(f"[MinerU] Request upload URL failed: code={data.get('code')}, msg={data.get('msg')}")
                else:
                    print(f"[MinerU] Request upload URL HTTP {response.status_code}: {response.text[:300]}")
            except Exception as e:
                print(f"[MinerU] Request upload URL exception: {type(e).__name__}: {e}")
        return None

    async def upload_file(self, file_path: str, upload_url: str) -> bool:
        """
        Upload file to the pre-signed URL via PUT.
        No Content-Type header needed for PUT upload.
        """
        async with httpx.AsyncClient(timeout=120.0, proxy=None) as client:
            try:
                with open(file_path, "rb") as f:
                    file_data = f.read()
                response = await client.put(upload_url, content=file_data)
                if response.status_code == 200:
                    print(f"[MinerU] File uploaded successfully")
                    return True
                else:
                    print(f"[MinerU] File upload HTTP {response.status_code}: {response.text[:200]}")
            except Exception as e:
                print(f"[MinerU] File upload exception: {type(e).__name__}: {e}")
        return False

    async def get_batch_result(self, batch_id: str) -> Optional[Dict[str, Any]]:
        """
        Poll for batch extraction result.
        GET /api/v4/extract-results/batch/{batch_id}
        """
        url = f"{self.base_url}/api/v4/extract-results/batch/{batch_id}"

        async with httpx.AsyncClient(timeout=60.0, proxy=None) as client:
            try:
                response = await client.get(url, headers=self.headers)
                if response.status_code == 200:
                    data = response.json()
                    if data.get("code") == 0:
                        return data.get("data", {})
                    else:
                        print(f"[MinerU] Get result failed: code={data.get('code')}, msg={data.get('msg')}")
                else:
                    print(f"[MinerU] Get result HTTP {response.status_code}: {response.text[:200]}")
            except Exception as e:
                print(f"[MinerU] Get result exception: {type(e).__name__}: {e}")
        return None

    async def download_and_extract_markdown(self, zip_url: str) -> str:
        """
        Download the result ZIP and extract full.md content.
        Tries CDN URL first, falls back to OSS direct URL if CDN fails.
        """
        # Try multiple URL variants in case CDN is blocked
        urls_to_try = [zip_url]
        # Fallback: replace CDN domain with direct OSS domain
        if "cdn-mineru.openxlab.org.cn" in zip_url:
            oss_url = zip_url.replace(
                "https://cdn-mineru.openxlab.org.cn",
                "https://mineru.oss-cn-shanghai.aliyuncs.com"
            )
            urls_to_try.append(oss_url)

        for url in urls_to_try:
            async with httpx.AsyncClient(timeout=120.0, proxy=None, follow_redirects=True) as client:
                try:
                    print(f"[MinerU] Trying to download ZIP from: {url[:80]}...")
                    response = await client.get(url)
                    if response.status_code == 200:
                        zip_data = io.BytesIO(response.content)
                        with zipfile.ZipFile(zip_data, "r") as zf:
                            # Look for full.md in the ZIP
                            for name in zf.namelist():
                                if name.endswith("full.md"):
                                    content = zf.read(name).decode("utf-8")
                                    print(f"[MinerU] Extracted markdown from {name}, length: {len(content)}")
                                    return content
                            # If no full.md, try any .md file
                            for name in zf.namelist():
                                if name.endswith(".md"):
                                    content = zf.read(name).decode("utf-8")
                                    print(f"[MinerU] Extracted markdown from {name}, length: {len(content)}")
                                    return content
                            print(f"[MinerU] No markdown file found in ZIP. Files: {zf.namelist()}")
                            return ""
                    else:
                        print(f"[MinerU] Download ZIP HTTP {response.status_code} from {url[:60]}")
                except Exception as e:
                    print(f"[MinerU] Download ZIP exception ({url[:60]}): {type(e).__name__}: {e}")

        return ""

    async def parse_and_wait(
        self, file_path: str, max_wait: int = 180, poll_interval: int = 5,
        model_version: str = "vlm"
    ) -> Optional[Dict[str, Any]]:
        """
        Full pipeline: request upload URL → upload file → poll result → download markdown.
        Returns dict with 'content' key containing the markdown text.
        """
        filename = os.path.basename(file_path)
        print(f"[MinerU] Starting pipeline for: {filename}")

        # Step 1: Request pre-signed upload URL
        upload_data = await self.request_upload_url(filename, model_version=model_version)
        if not upload_data:
            print("[MinerU] Failed to get upload URL")
            return None

        batch_id = upload_data.get("batch_id")
        file_urls = upload_data.get("file_urls", [])
        if not file_urls:
            print("[MinerU] No upload URL returned")
            return None

        upload_url = file_urls[0]
        print(f"[MinerU] Got upload URL, batch_id: {batch_id}")

        # Step 2: Upload file to pre-signed URL
        success = await self.upload_file(file_path, upload_url)
        if not success:
            print("[MinerU] File upload failed")
            return None

        # Step 3: Poll for result
        print(f"[MinerU] Polling for result (batch_id: {batch_id})...")
        start_time = time.time()
        while time.time() - start_time < max_wait:
            await asyncio_sleep(poll_interval)
            result_data = await self.get_batch_result(batch_id)
            if result_data:
                extract_results = result_data.get("extract_result", [])
                if extract_results:
                    item = extract_results[0]
                    state = item.get("state", "")
                    if state == "done":
                        full_zip_url = item.get("full_zip_url", "")
                        if full_zip_url:
                            print(f"[MinerU] Parsing complete, downloading result...")
                            # Step 4: Download and extract markdown
                            markdown = await self.download_and_extract_markdown(full_zip_url)
                            if markdown:
                                return {"content": markdown, "zip_url": full_zip_url}
                            else:
                                print("[MinerU] Failed to extract markdown from ZIP")
                                return None
                        else:
                            print("[MinerU] Done but no zip URL")
                            return None
                    elif state == "failed":
                        err_msg = item.get("err_msg", "unknown error")
                        print(f"[MinerU] Parsing failed: {err_msg}")
                        return None
                    else:
                        progress = item.get("extract_progress", {})
                        extracted = progress.get("extracted_pages", "?")
                        total = progress.get("total_pages", "?")
                        print(f"[MinerU] State: {state}, progress: {extracted}/{total}")
            else:
                print(f"[MinerU] Poll returned None, retrying...")

        print("[MinerU] Timeout waiting for result")
        return None


async def asyncio_sleep(seconds: float):
    """Async sleep utility."""
    import asyncio
    await asyncio.sleep(seconds)
