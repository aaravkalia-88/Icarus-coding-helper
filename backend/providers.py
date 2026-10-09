import asyncio
from contextlib import asynccontextmanager
import json
from typing import AsyncIterator, Literal, Protocol

import httpx

ProviderName = Literal["ollama", "lm_studio", "openai", "huggingface"]
Messages = list[dict[str, str]]
TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=30.0, pool=10.0)
PROVIDER_DEADLINE = 120.0
PROBE_DEADLINE = 15.0
MAX_LINE_BYTES = 1024 * 1024
MAX_STREAM_BYTES = 8 * 1024 * 1024
HUGGINGFACE_URL = "https://router.huggingface.co/v1/chat/completions"
QWEN_MODEL = "Qwen/Qwen3.8-27B"
STREAM_ERRORS = {
    "invalid": "Model returned an invalid response. Try another model or retry.",
    "unavailable": "This model is unavailable or unsupported. Check the model ID.",
    "interrupted": "Model response was interrupted. Retry to complete the answer.",
    "empty": "Model returned no answer. Try another model or retry.",
    "limit": "Model reached its response limit. Ask a shorter question or continue from the partial answer.",
    "filtered": "Provider filtered this response. Rephrase the request and retry.",
    "unsupported": "Model requested an unsupported action. Try another model.",
    "oversized": "Model answer exceeded the size limit. Ask for a shorter response.",
}


class ProviderResponseError(ValueError):
    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


@asynccontextmanager
async def provider_response(method: str, url: str, seconds: float, **kwargs):
    deadline = asyncio.get_running_loop().time() + seconds
    async with httpx.AsyncClient(
        timeout=TIMEOUT, trust_env=False, follow_redirects=False,
        headers={"Accept-Encoding": "identity"},
    ) as client:
        async with asyncio.timeout_at(deadline):
            response = await client.send(client.build_request(method, url, **kwargs), stream=True)
        try:
            response.raise_for_status()
            # Reject unsolicited compression before HTTPX can expand untrusted bytes.
            if response.headers.get("content-encoding", "identity").strip().lower() not in ("", "identity"):
                raise ProviderResponseError("invalid")
            yield response, deadline
        finally:
            await response.aclose()


async def bounded_chunks(response, deadline, limit):
    size = 0
    loop = asyncio.get_running_loop()
    chunks = response.aiter_bytes().__aiter__()
    while True:
        if loop.time() >= deadline:
            raise TimeoutError
        try:
            async with asyncio.timeout_at(deadline):
                chunk = await anext(chunks)
        except StopAsyncIteration:
            return
        if loop.time() >= deadline:
            raise TimeoutError
        size += len(chunk)
        if size > limit:
            raise ProviderResponseError("oversized")
        yield chunk


async def response_json(response, deadline):
    content = bytearray()
    async for chunk in bounded_chunks(response, deadline, MAX_LINE_BYTES):
        content.extend(chunk)
    return json.loads(content)


async def response_lines(response, deadline):
    pending = bytearray()
    skip_lf = False
    async for chunk in bounded_chunks(response, deadline, MAX_STREAM_BYTES):
        if not chunk:
            continue
        if skip_lf and chunk.startswith(b"\n"):
            chunk = chunk[1:]
        skip_lf = chunk.endswith(b"\r")
        for line in chunk.splitlines(keepends=True):
            complete = line.endswith((b"\r", b"\n"))
            line = line.rstrip(b"\r\n") if complete else line
            if len(pending) + len(line) > MAX_LINE_BYTES:
                raise ProviderResponseError("oversized")
            pending.extend(line)
            if complete:
                yield pending.decode("utf-8")
                pending.clear()
    if pending:
        yield pending.decode("utf-8")


def check_finish(reason):
    if reason not in (None, "stop"):
        code = "limit" if reason == "length" else "filtered" if reason == "content_filter" else "unsupported"
        raise ProviderResponseError(code)


class AIProvider(Protocol):
    def stream(self, messages: Messages, model: str, api_key: str | None) -> AsyncIterator[str]: ...
    async def test(self, model: str, api_key: str | None): ...


class OllamaProvider:
    async def test(self, model: str, api_key: str | None):
        async with provider_response("GET", "http://127.0.0.1:11434/api/tags", PROBE_DEADLINE) as (response, deadline):
            payload = await response_json(response, deadline)
            if not any(item.get("name") in (model, model + ":latest") for item in payload.get("models", [])):
                raise ProviderResponseError("unavailable")

    async def stream(self, messages: Messages, model: str, api_key: str | None) -> AsyncIterator[str]:
        async with provider_response(
            "POST", "http://127.0.0.1:11434/api/chat", PROVIDER_DEADLINE,
            json={"model": model, "messages": messages, "stream": True},
        ) as (response, deadline):
            async for line in response_lines(response, deadline):
                if not line:
                    continue
                item = json.loads(line)
                if not isinstance(item, dict):
                    raise ProviderResponseError("invalid")
                if item.get("error"):
                    raise ValueError("Local model error")
                content = item.get("message", {}).get("content")
                if content is not None and not isinstance(content, str):
                    raise ProviderResponseError("invalid")
                if content:
                    yield content
                if item.get("done") is True:
                    check_finish(item.get("done_reason"))
                    return
            raise ProviderResponseError("interrupted")


class OpenAICompatibleProvider:
    def __init__(self, url: str, local: bool):
        self.url = url
        self.local = local

    async def test(self, model: str, api_key: str | None):
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        limit = 'max_completion_tokens' if self.url.startswith('https://api.openai.com/') else 'max_tokens'
        async with provider_response("POST", self.url, PROBE_DEADLINE, headers=headers, json={
            "model": model, "messages": [{"role": "user", "content": "Reply OK."}],
            "stream": False, limit: 16,
        }) as (response, deadline):
            payload = await response_json(response, deadline)
            if not isinstance(payload, dict) or payload.get("error"):
                raise ProviderResponseError("invalid")
            choices = payload.get("choices")
            if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
                raise ProviderResponseError("invalid")
            message = choices[0].get("message")
            if not isinstance(message, dict) or not isinstance(message.get("content"), str) or not message["content"].strip():
                raise ProviderResponseError("invalid")

    async def stream(self, messages: Messages, model: str, api_key: str | None) -> AsyncIterator[str]:
        if not self.local and not api_key:
            raise ValueError("Remote API key required")
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        payload = {"model": model, "messages": messages, "stream": True}
        async with provider_response(
            "POST", self.url, PROVIDER_DEADLINE, headers=headers, json=payload,
        ) as (response, deadline):
            async for line in response_lines(response, deadline):
                if not line.startswith("data:"):
                    continue
                data = line[5:].strip()
                if not data:
                    continue
                if data == "[DONE]":
                    return
                item = json.loads(data)
                if not isinstance(item, dict):
                    raise ProviderResponseError("invalid")
                if item.get("error"):
                    raise ValueError("Provider error")
                choices = item.get("choices") or []
                if not isinstance(choices, list):
                    raise ProviderResponseError("invalid")
                if not choices:
                    continue
                if not isinstance(choices[0], dict):
                    raise ProviderResponseError("invalid")
                content = choices[0].get("delta", {}).get("content")
                if content is not None and not isinstance(content, str):
                    raise ProviderResponseError("invalid")
                if content:
                    yield content
                reason = choices[0].get("finish_reason")
                if reason is not None:
                    check_finish(reason)
                    return
            raise ProviderResponseError("interrupted")


PROVIDERS: dict[ProviderName, AIProvider] = {
    "ollama": OllamaProvider(),
    "lm_studio": OpenAICompatibleProvider("http://127.0.0.1:1234/v1/chat/completions", local=True),
    "openai": OpenAICompatibleProvider("https://api.openai.com/v1/chat/completions", local=False),
    "huggingface": OpenAICompatibleProvider(HUGGINGFACE_URL, local=False),
}


def get_provider(name: ProviderName) -> AIProvider:
    return PROVIDERS[name]
