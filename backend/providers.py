import json
from typing import AsyncIterator, Literal, Protocol

import httpx

ProviderName = Literal["ollama", "lm_studio", "openai", "huggingface"]
Messages = list[dict[str, str]]
TIMEOUT = httpx.Timeout(connect=10.0, read=60.0, write=30.0, pool=10.0)
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


def check_finish(reason):
    if reason not in (None, "stop"):
        code = "limit" if reason == "length" else "filtered" if reason == "content_filter" else "unsupported"
        raise ProviderResponseError(code)


class AIProvider(Protocol):
    def stream(self, messages: Messages, model: str, api_key: str | None) -> AsyncIterator[str]: ...
    async def test(self, model: str, api_key: str | None): ...


class OllamaProvider:
    async def test(self, model: str, api_key: str | None):
        async with httpx.AsyncClient(timeout=TIMEOUT, trust_env=False, follow_redirects=False) as client:
            response = await client.get("http://127.0.0.1:11434/api/tags")
            response.raise_for_status()
            if not any(item.get("name") in (model, model + ":latest") for item in response.json().get("models", [])):
                raise ProviderResponseError("unavailable")

    async def stream(self, messages: Messages, model: str, api_key: str | None) -> AsyncIterator[str]:
        async with httpx.AsyncClient(timeout=TIMEOUT, trust_env=False, follow_redirects=False) as client:
            async with client.stream(
                "POST", "http://127.0.0.1:11434/api/chat",
                json={"model": model, "messages": messages, "stream": True},
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
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
        async with httpx.AsyncClient(timeout=TIMEOUT, trust_env=False, follow_redirects=False) as client:
            limit = 'max_completion_tokens' if self.url.startswith('https://api.openai.com/') else 'max_tokens'
            response = await client.post(self.url, headers=headers, json={
                "model": model, "messages": [{"role": "user", "content": "Reply OK."}],
                "stream": False, limit: 16,
            })
            response.raise_for_status()
            payload = response.json()
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
        async with httpx.AsyncClient(timeout=TIMEOUT, trust_env=False, follow_redirects=False) as client:
            async with client.stream(
                "POST", self.url, headers=headers,
                json=payload,
            ) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
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
