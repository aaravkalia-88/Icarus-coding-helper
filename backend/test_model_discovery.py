import json
import socket

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import main, providers
from backend.storage import LocalStore

HEADERS = {"Authorization": "Bearer " + "n" * 64}


@pytest.fixture
def api(monkeypatch):
    saved = LocalStore()
    monkeypatch.setattr(main, "store", saved)
    monkeypatch.setattr(main, "session_token", "n" * 64)
    with TestClient(main.app) as client:
        yield client
    saved.close()


def upstream(monkeypatch, respond):
    real_client = httpx.AsyncClient
    monkeypatch.setattr(providers.httpx, "AsyncClient", lambda **kwargs: real_client(
        transport=httpx.MockTransport(respond), **kwargs))


def test_new_install_has_no_provider_or_model_and_saved_connections_are_preserved(api):
    assert api.get("/v1/settings", headers=HEADERS).json() == {"provider": "none", "model": ""}
    selected = {"provider": "openai", "model": "selected-model"}
    assert api.put("/v1/settings", headers=HEADERS, json=selected).json() == selected
    assert api.get("/v1/settings", headers=HEADERS).json() == selected
    assert api.put("/v1/settings", headers=HEADERS, json={"provider": "none", "model": ""}).status_code == 200
    assert api.post("/v1/chat/stream", headers=HEADERS, json={
        "mode": "ask_icarus", "provider": "none", "model": "", "prompt": "fixture"}).status_code == 422


@pytest.mark.parametrize("provider,url,key", [
    ("huggingface", "https://router.huggingface.co/v1/models", "fixture-token"),
    ("openai", "https://api.openai.com/v1/models", "fixture-token"),
    ("groq", "https://api.groq.com/openai/v1/models", "fixture-token"),
    ("openrouter", "https://openrouter.ai/api/v1/models", "fixture-token"),
    ("gemini", "https://generativelanguage.googleapis.com/v1beta/openai/models", "fixture-token"),
    ("ollama", "http://127.0.0.1:11434/api/tags", None),
    ("lm_studio", "http://127.0.0.1:1234/v1/models", None),
])
def test_discovery_uses_only_selected_provider_and_never_saves_keys(api, monkeypatch, provider, url, key):
    calls = []

    def respond(request):
        calls.append(request)
        items = ["fixture-model", "fixture-model", "bad model"]
        return httpx.Response(200, json={"models": [{"name": item} for item in items]} if provider == "ollama" else
                              {"data": [{"id": item} for item in items]})

    upstream(monkeypatch, respond)
    payload = {"provider": provider, **({"api_key": key} if key else {})}
    assert api.post("/v1/provider/models", json=payload).status_code == 401
    response = api.post("/v1/provider/models", headers=HEADERS, json=payload)
    assert response.json() == {"status": "ok", "models": ["fixture-model"]}
    assert len(calls) == 1 and str(calls[0].url) == url
    assert calls[0].headers.get("authorization") == ("Bearer " + key if key else None)
    assert key is None or key not in response.text
    assert main.store.get("connection", {}) == {}


def test_probe_returns_the_actual_reply_and_model_with_enough_budget_for_text(api, monkeypatch):
    calls = []

    def respond(request):
        calls.append(json.loads(request.content))
        return httpx.Response(200, json={"model": "actual-model", "choices": [{"message": {
            "content": "OK fixture-token"}}]})

    upstream(monkeypatch, respond)
    response = api.post("/v1/provider/test", headers=HEADERS, json={
        "provider": "groq", "model": "fixture-model", "api_key": "fixture-token"})
    assert response.json() == {"status": "connected", "model": "actual-model", "reply": "OK [REDACTED CREDENTIAL]"}
    assert calls[0]["max_tokens"] >= 256
    assert main.store.get("connection", {}) == {}


@pytest.mark.parametrize("status", [401, 429, 404])
def test_discovery_failure_is_safe_and_keeps_the_previous_connection(api, monkeypatch, status):
    previous = {"provider": "openai", "model": "keep-me"}
    api.put("/v1/settings", headers=HEADERS, json=previous)
    upstream(monkeypatch, lambda _: httpx.Response(status, json={"error": "private-upstream-fixture"}))
    response = api.post("/v1/provider/models", headers=HEADERS, json={"provider": "groq", "api_key": "fixture-token"})
    assert response.json()["status"] == "error"
    assert "private-upstream-fixture" not in response.text
    assert api.get("/v1/settings", headers=HEADERS).json() == previous


@pytest.mark.parametrize("url", ["http://api.example.com/v1", "https://127.0.0.1/v1", "https://[::1]/v1",
    "https://169.254.169.254/v1", "https://user:pass@api.example.com/v1", "https://api.example.com/v1?key=fixture",
    "https://api.example.com/v1#fragment", "https://localhost/v1"])
def test_custom_endpoint_rejects_unsafe_urls_before_network(api, monkeypatch, url):
    upstream(monkeypatch, lambda _: pytest.fail("Invalid endpoint must not receive a key"))
    response = api.post("/v1/provider/models", headers=HEADERS, json={
        "provider": "custom", "base_url": url, "api_key": "fixture-token"})
    assert response.status_code == 422


def test_custom_endpoint_discovers_and_streams_through_the_same_adapter(api, monkeypatch):
    # Resolve the fixture name without contacting an external service.
    monkeypatch.setattr(providers, "public_endpoint", lambda url: _async_value(url), raising=False)
    calls = []

    def respond(request):
        calls.append(request)
        if request.method == "GET":
            return httpx.Response(200, json={"data": [{"id": "custom-model"}]})
        if json.loads(request.content).get("stream"):
            return httpx.Response(200, text='data: {"choices":[{"delta":{"content":"custom answer"},"finish_reason":"stop"}]}\n')
        return httpx.Response(200, json={"choices": [{"message": {"content": "OK"}}]})

    upstream(monkeypatch, respond)
    target = {"provider": "custom", "base_url": "https://api.example.com/v1", "api_key": "fixture-token"}
    assert api.post("/v1/provider/models", headers=HEADERS, json=target).json() == {"status": "ok", "models": ["custom-model"]}
    response = api.post("/v1/chat/stream", headers=HEADERS, json={
        **target, "model": "custom-model", "mode": "ask_icarus", "prompt": 'api_key="genericCredentialValue1234567890"'})
    assert "custom answer" in response.text and "event: done" in response.text
    assert str(calls[0].url) == "https://api.example.com/v1/models"
    assert str(calls[1].url) == "https://api.example.com/v1/chat/completions"
    assert "genericCredentialValue1234567890" not in calls[1].content.decode()


async def _async_value(value):
    return value


def test_custom_endpoint_rejects_private_dns_before_sending_a_key(api, monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *_args, **_kwargs: [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.1", 443))])
    upstream(monkeypatch, lambda _: pytest.fail("Private DNS must not receive a key"))
    response = api.post("/v1/provider/models", headers=HEADERS, json={
        "provider": "custom", "base_url": "https://api.example.com/v1", "api_key": "fixture-token"})
    assert response.status_code == 200 and response.json()["status"] == "error"
