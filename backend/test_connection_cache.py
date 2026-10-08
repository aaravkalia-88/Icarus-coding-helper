import json

import httpx
from fastapi.testclient import TestClient

from backend import main, providers


HEADERS = {"Authorization": "Bearer " + "e" * 64}


def test_connection_probe_authenticates_and_reports_provider_failures(monkeypatch):
    monkeypatch.setattr(main, "session_token", "e" * 64)
    calls = []

    def respond(request):
        calls.append(request)
        if request.headers.get("authorization") == "Bearer rejected-token":
            return httpx.Response(401, json={"error": "secret upstream detail"})
        return httpx.Response(200, json={"choices": [{"message": {"content": "OK"}}]})

    real_client = httpx.AsyncClient
    monkeypatch.setattr(providers.httpx, "AsyncClient", lambda **kwargs: real_client(
        transport=httpx.MockTransport(respond), **kwargs
    ))
    payload = {"provider": "huggingface", "model": "Qwen/test-model", "api_key": "test-token"}
    with TestClient(main.app) as client:
        assert client.post("/v1/provider/test", json=payload).status_code == 401
        result = client.post("/v1/provider/test", json=payload, headers=HEADERS)
        assert result.status_code == 200
        assert result.json()["status"] == "connected"
        rejected = client.post("/v1/provider/test", json={**payload, "api_key": "rejected-token"}, headers=HEADERS)
        assert rejected.json()["status"] == "error"
        assert "secret upstream detail" not in rejected.text
        invalid = client.post("/v1/provider/test", json={**payload, "url": "http://example.com"}, headers=HEADERS)
        assert invalid.status_code == 422
    assert len(calls) == 2
    assert str(calls[0].url) == providers.HUGGINGFACE_URL
    body = json.loads(calls[0].content)
    assert body["model"] == "Qwen/test-model"
    assert body["stream"] is False
    assert "api_key" not in body
    assert "Selected code" not in str(body)


def test_local_cache_persists_settings_and_memory_without_credentials(tmp_path, monkeypatch):
    from backend.storage import LocalStore

    filename = tmp_path / "icarus.sqlite"
    monkeypatch.setattr(main, "store", LocalStore(filename))
    monkeypatch.setattr(main, "session_token", "e" * 64)
    memory = {"project": "ICARUS", "goal": "Understand recursion", "notes": "Keep a base case."}
    with TestClient(main.app) as client:
        assert client.get("/v1/memory").status_code == 401
        assert client.put("/v1/memory", json=memory, headers=HEADERS).json() == memory
        settings = {"provider": "openai", "model": "my-model"}
        assert client.put("/v1/settings", json=settings, headers=HEADERS).json() == settings
        assert client.put("/v1/settings", json={**settings, "api_key": "do-not-store"}, headers=HEADERS).status_code == 422
        assert client.put("/v1/memory", json={**memory, "notes": "x" * 8001}, headers=HEADERS).status_code == 422
    monkeypatch.setattr(main, "store", LocalStore(filename))
    with TestClient(main.app) as client:
        assert client.get("/v1/memory", headers=HEADERS).json() == memory
        assert client.get("/v1/settings", headers=HEADERS).json() == settings
    assert b"do-not-store" not in filename.read_bytes()


def test_context_is_explicit_and_remote_context_is_redacted(monkeypatch):
    seen = []
    class FakeProvider:
        async def stream(self, messages, model, api_key):
            seen.append(messages)
            yield "Answer"
    monkeypatch.setattr(main, "get_provider", lambda name: FakeProvider())
    monkeypatch.setattr(main, "session_token", "e" * 64)
    request = {"mode": "hint", "text": "def recurse(): pass", "provider": "huggingface",
               "model": "test-model", "api_key": "test-token", "building": "A recursion lesson",
               "memory": {"project": "Lesson", "goal": "Learn", "notes": "hf_" + "A" * 32}}
    with TestClient(main.app) as client:
        response = client.post("/v1/chat/stream", json=request, headers=HEADERS)
    assert response.status_code == 200
    assert "A recursion lesson" in seen[0][1]["content"]
    assert "hf_" + "A" * 32 not in seen[0][1]["content"]
    assert "[REDACTED" in seen[0][1]["content"]


def test_analysis_mode_returns_a_suggestion_without_executing_code(monkeypatch):
    seen = []
    class FakeProvider:
        async def stream(self, messages, model, api_key):
            seen.append(messages)
            yield "This appears to build a list. Try Hint Mode."
    monkeypatch.setattr(main, "get_provider", lambda name: FakeProvider())
    monkeypatch.setattr(main, "session_token", "e" * 64)
    with TestClient(main.app) as client:
        response = client.post("/v1/chat/stream", json={"mode": "analyze", "text": "items = []",
            "provider": "ollama", "model": "local-model"}, headers=HEADERS)
    assert response.status_code == 200
    assert "appears to build" in response.text
    assert "infer" in seen[0][0]["content"].lower()


def test_history_is_bounded_and_redacts_secrets(tmp_path):
    from backend.storage import LocalStore
    store = LocalStore(tmp_path / "cache.sqlite")
    for i in range(55):
        store.add_history("hint", "hf_" + "Z" * 32, f"answer {i}", "complete")
    rows = store.history()
    assert len(rows) == 50
    assert rows[0]["answer"] == "answer 54"
    assert all("hf_" + "Z" * 32 not in row["input"] for row in rows)


def test_openai_connection_probe_uses_supported_completion_limit(monkeypatch):
    requests = []
    def respond(request):
        requests.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "OK"}}]})
    real_client = httpx.AsyncClient
    monkeypatch.setattr(providers.httpx, "AsyncClient", lambda **kwargs: real_client(
        transport=httpx.MockTransport(respond), **kwargs))
    monkeypatch.setattr(main, "session_token", "e" * 64)
    with TestClient(main.app) as client:
        result = client.post('/v1/provider/test', headers=HEADERS,
            json={"provider": "openai", "model": "test-model", "api_key": "fixture-token"})
    assert result.json()["status"] == "connected"
    assert requests[0]["max_completion_tokens"] == 16
    assert "max_tokens" not in requests[0]


def test_generation_rejects_malformed_model_and_token_without_echoing_secrets(monkeypatch):
    monkeypatch.setattr(main, "session_token", "e" * 64)
    payload = {"mode": "analyze", "text": "print(1)", "provider": "huggingface",
               "model": "test-model", "api_key": "fixture-token"}
    with TestClient(main.app) as client:
        for invalid in [{"api_key": "fixture\nprivate-key"}, {"model": "bad model"},
                        {"model": "bad\x00model"}]:
            result = client.post('/v1/chat/stream', headers=HEADERS, json={**payload, **invalid})
            assert result.status_code == 422
            assert "private-key" not in result.text
