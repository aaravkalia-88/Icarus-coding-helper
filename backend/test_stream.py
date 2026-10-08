import asyncio
import json
import subprocess
import sys

import httpx
from fastapi.testclient import TestClient

from backend import main


TOKEN = "c" * 64
REQUEST = {
    "mode": "hint",
    "text": "def add(a, b): return a - b",
    "prompt": "Help me find the mistake",
    "provider": "ollama",
    "model": "qwen2.5-coder",
}


def test_authenticated_stream_assembles_deltas_and_done(monkeypatch):
    seen = []

    class FakeProvider:
        async def stream(self, messages, model, api_key):
            seen.append((messages, model, api_key))
            yield "First clue"
            yield ": inspect the operator."

    monkeypatch.setattr(main, "session_token", TOKEN)
    monkeypatch.setattr(main, "get_provider", lambda name: FakeProvider(), raising=False)
    with TestClient(main.app) as client:
        assert client.post("/v1/chat/stream", json=REQUEST).status_code == 401
        response = client.post(
            "/v1/chat/stream", json=REQUEST, headers={"Authorization": f"Bearer {TOKEN}"}
        )

    assert response.status_code == 200
    events = [event.split("\n", 1) for event in response.text.strip().split("\n\n")]
    assert [event[0] for event in events] == ["event: delta", "event: delta", "event: done"]
    assert "".join(json.loads(event[1][6:])["text"] for event in events[:2]) == (
        "First clue: inspect the operator."
    )
    assert seen[0][1:] == ("qwen2.5-coder", None)
    assert "full solution" in seen[0][0][0]["content"].lower()
    assert REQUEST["text"] in seen[0][0][1]["content"]


def test_invalid_requests_are_rejected_without_echoing_key(monkeypatch):
    class NoNetworkProvider:
        async def stream(self, messages, model, api_key):
            if False:
                yield ""

    monkeypatch.setattr(main, "session_token", TOKEN)
    monkeypatch.setattr(main, "get_provider", lambda name: NoNetworkProvider())
    headers = {"Authorization": f"Bearer {TOKEN}"}
    with TestClient(main.app) as client:
        assert client.post("/v1/chat/stream", json={**REQUEST, "mode": "unknown"}, headers=headers).status_code == 422
        assert client.post("/v1/chat/stream", json={**REQUEST, "provider": "openai"}, headers=headers).status_code == 422
        assert client.post("/v1/chat/stream", json={**REQUEST, "provider": "openai", "api_key": " "}, headers=headers).status_code == 422
        assert client.post("/v1/chat/stream", json={**REQUEST, "provider": "huggingface", "model": "Qwen/Qwen3.8-27B"}, headers=headers).status_code == 422
        assert client.post("/v1/chat/stream", json={**REQUEST, "provider": "huggingface", "model": "Qwen/Qwen3.8-27B", "api_key": "dummy-key"}, headers=headers).status_code == 200
        assert client.post("/v1/chat/stream", json={**REQUEST, "base_url": "https://example.test"}, headers=headers).status_code == 422
        secret = "s" * 4097
        response = client.post("/v1/chat/stream", json={**REQUEST, "api_key": secret}, headers=headers)
    assert response.status_code == 422
    assert secret not in response.text


def test_stream_error_does_not_expose_provider_exception_or_key(monkeypatch):
    secret = "private-key-value"

    class BrokenProvider:
        async def stream(self, messages, model, api_key):
            raise RuntimeError(f"upstream rejected {api_key}")
            yield "unreachable"

    monkeypatch.setattr(main, "session_token", TOKEN)
    monkeypatch.setattr(main, "get_provider", lambda name: BrokenProvider())
    with TestClient(main.app) as client:
        response = client.post(
            "/v1/chat/stream",
            json={**REQUEST, "provider": "openai", "api_key": secret},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
    assert response.status_code == 200
    assert "event: error" in response.text
    assert secret not in response.text


def test_remote_auth_failure_emits_actionable_error(monkeypatch):
    class UnauthorizedProvider:
        async def stream(self, messages, model, api_key):
            response = httpx.Response(
                401, request=httpx.Request("POST", "https://api.openai.com/v1/chat/completions")
            )
            response.raise_for_status()
            yield "unreachable"

    monkeypatch.setattr(main, "session_token", TOKEN)
    monkeypatch.setattr(main, "get_provider", lambda name: UnauthorizedProvider())
    with TestClient(main.app) as client:
        response = client.post(
            "/v1/chat/stream",
            json={**REQUEST, "provider": "openai", "api_key": "private-key-value"},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )
    assert "event: error" in response.text
    assert json.loads(response.text.split("data: ", 1)[1])["message"] == "Provider authentication failed"
    assert "private-key-value" not in response.text


def test_provider_adapters_stream_fixed_endpoints(monkeypatch):
    from backend import providers

    requests = []

    def respond(request):
        requests.append(request)
        if request.url.port == 11434:
            return httpx.Response(200, text='{"message":{"content":"local"}}\n{"done":true}\n')
        return httpx.Response(
            200,
            text='data: {"choices":[{"delta":{"content":"remote"}}]}\n\ndata: {"choices":[],"usage":{"total_tokens":2}}\n\ndata: [DONE]\n\n',
        )

    real_client = httpx.AsyncClient
    monkeypatch.setattr(providers.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs))

    async def collect(name, key=None):
        return [part async for part in providers.get_provider(name).stream(
            [{"role": "user", "content": "hi"}], "model", key
        )]

    assert asyncio.run(collect("ollama")) == ["local"]
    assert asyncio.run(collect("lm_studio")) == ["remote"]
    assert asyncio.run(collect("openai", "ephemeral-key")) == ["remote"]
    assert [request.url.host for request in requests] == ["127.0.0.1", "127.0.0.1", "api.openai.com"]
    assert requests[2].headers["Authorization"] == "Bearer ephemeral-key"


def test_backend_script_entrypoint_loads_stream_modules():
    result = subprocess.run(
        [sys.executable, "backend/main.py", "--help"], capture_output=True, text=True
    )
    assert result.returncode == 0, result.stderr


def test_huggingface_qwen_fixed_router_body_and_answer_stream(monkeypatch):
    from backend import providers

    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(
            200,
            text=(
                'data: {"choices":[{"delta":{"reasoning_content":"private reasoning"}}]}\n\n'
                'data: {"choices":[{"delta":{"content":"The answer"}}]}\n\n'
                'data: {"choices":[{"delta":{"content":" is 42."}}]}\n\n'
                'data: {"choices":[],"usage":{"total_tokens":12}}\n\n'
                'data: [DONE]\n\n'
            ),
        )

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        providers.httpx, "AsyncClient",
        lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs),
    )
    messages = [{"role": "user", "content": "Explain this code"}]

    async def collect():
        return [part async for part in providers.get_provider("huggingface").stream(
            messages, "Qwen/Qwen3.8-27B", "dummy-key"
        )]

    assert "".join(asyncio.run(collect())) == "The answer is 42."
    assert str(requests[0].url) == "https://router.huggingface.co/v1/chat/completions"
    assert requests[0].headers["Authorization"] == "Bearer dummy-key"
    assert json.loads(requests[0].content) == {
        "model": "Qwen/Qwen3.8-27B",
        "messages": messages,
        "stream": True,
    }


def test_full_solve_stream_uses_complete_educational_solution_prompt(monkeypatch):
    seen = []

    class FakeProvider:
        async def stream(self, messages, model, api_key):
            seen.append(messages)
            yield "Complete solution"

    monkeypatch.setattr(main, "session_token", TOKEN)
    monkeypatch.setattr(main, "get_provider", lambda name: FakeProvider())
    with TestClient(main.app) as client:
        for text, prompt in ((REQUEST["text"], ""), ("", "Solve a sum of two numbers")):
            response = client.post(
                "/v1/chat/stream", json={**REQUEST, "mode": "full_solve", "text": text, "prompt": prompt},
                headers={"Authorization": f"Bearer {TOKEN}"},
            )
            assert response.status_code == 200
            assert "Complete solution" in response.text
            assert "event: done" in response.text
            assert (text or prompt) in seen[-1][1]["content"]
        empty = client.post(
            "/v1/chat/stream", json={**REQUEST, "mode": "full_solve", "text": " ", "prompt": " "},
            headers={"Authorization": f"Bearer {TOKEN}"},
        )

    assert empty.status_code == 422
    assert len(seen) == 2
    instruction = seen[0][0]["content"].lower()
    assert "complete solution" in instruction
    assert "explain" in instruction
    assert "step by step" in instruction
    assert "edge cases" in instruction
    assert "never claim to have run code" in instruction
