import asyncio
import json
import sqlite3

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import main, providers
from backend.storage import LocalStore

HEADERS = {"Authorization": "Bearer " + "r" * 64}
REQUEST = {"mode": "ask_icarus", "prompt": "Explain recursion", "provider": "ollama", "model": "fixture"}


def mock_upstream(monkeypatch, response):
    real_client = httpx.AsyncClient
    monkeypatch.setattr(providers.httpx, "AsyncClient", lambda **kwargs: real_client(
        transport=httpx.MockTransport(lambda _: response), **kwargs))


def collect(provider):
    async def run():
        return [part async for part in providers.get_provider(provider).stream(
            [{"role": "user", "content": "fixture"}], "fixture", "fixture-token" if provider == "openai" else None)]
    return asyncio.run(run())


@pytest.mark.parametrize("provider,body", [
    ("ollama", '{"message":{"content":"partial"},"done":false}\n'),
    ("openai", 'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
])
def test_upstream_eof_without_completion_is_not_success(monkeypatch, provider, body):
    mock_upstream(monkeypatch, httpx.Response(200, text=body))
    with pytest.raises(ValueError):
        collect(provider)


@pytest.mark.parametrize("provider,body", [
    ("ollama", '{"message":{"content":"partial"},"done":true,"done_reason":"length"}\n'),
    ("openai", 'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n'),
    ("openai", 'data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}\n\ndata: [DONE]\n\n'),
    ("openai", 'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n'),
])
def test_unsuccessful_finish_is_not_marked_complete(monkeypatch, provider, body):
    mock_upstream(monkeypatch, httpx.Response(200, text=body))
    with pytest.raises(ValueError):
        collect(provider)


@pytest.mark.parametrize("provider,body", [
    ("ollama", '{"message":{"content":["invalid"]},"done":true}\n'),
    ("openai", 'data: {"choices":[{"delta":{"content":["invalid"]}}]}\n\ndata: [DONE]\n\n'),
])
def test_non_text_provider_content_is_rejected(monkeypatch, provider, body):
    mock_upstream(monkeypatch, httpx.Response(200, text=body))
    with pytest.raises(ValueError):
        collect(provider)


@pytest.mark.parametrize("payload", [
    {"choices": [{}]}, {"choices": [{"message": {"content": None}}]},
    {"choices": [{"message": {"content": " "}}]},
    {"choices": [{"message": {"content": ["invalid"]}}]},
    {"error": "private upstream detail", "choices": [{"message": {"content": "OK"}}]},
])
def test_connection_probe_requires_a_real_text_answer(monkeypatch, payload):
    mock_upstream(monkeypatch, httpx.Response(200, json=payload))
    monkeypatch.setattr(main, "session_token", "r" * 64)
    with TestClient(main.app) as client:
        response = client.post("/v1/provider/test", headers=HEADERS, json={
            "provider": "openai", "model": "fixture", "api_key": "fixture-token"})
    assert response.json()["status"] == "error"
    assert "private upstream detail" not in response.text


@pytest.fixture
def api(monkeypatch, tmp_path):
    with_store = LocalStore(tmp_path / "test.sqlite")
    monkeypatch.setattr(main, "store", with_store)
    monkeypatch.setattr(main, "session_token", "r" * 64)
    with TestClient(main.app) as client:
        yield client
    with_store.close()


@pytest.mark.parametrize("parts", [[], ["", " \n"]])
def test_empty_generation_is_error_and_history_matches(api, monkeypatch, parts):
    class Provider:
        async def stream(self, *_):
            for part in parts:
                yield part
    monkeypatch.setattr(main, "get_provider", lambda _: Provider())
    response = api.post("/v1/chat/stream", headers=HEADERS, json=REQUEST)
    assert "event: error" in response.text
    assert "event: done" not in response.text
    assert "Model returned no answer. Try another model or retry." in response.text
    assert api.get("/v1/history", headers=HEADERS).json()[0]["status"] == "error"


def test_interrupted_upstream_keeps_partial_answer_as_error(api, monkeypatch):
    mock_upstream(monkeypatch, httpx.Response(200, text='{"message":{"content":"partial"},"done":false}\n'))
    response = api.post("/v1/chat/stream", headers=HEADERS, json=REQUEST)
    assert "event: delta" in response.text
    assert "event: error" in response.text
    assert "event: done" not in response.text
    assert "Model response was interrupted. Retry to complete the answer." in response.text
    row = api.get("/v1/history", headers=HEADERS).json()[0]
    assert row["answer"] == "partial" and row["status"] == "error"


def test_history_is_written_before_terminal_event_and_cancellation_closes_provider(monkeypatch, tmp_path):
    saved = LocalStore(tmp_path / "history.sqlite")
    monkeypatch.setattr(main, "store", saved)
    closed = []
    class Provider:
        async def stream(self, *_):
            try:
                yield "partial"
                yield " answer"
            finally:
                closed.append(True)
    monkeypatch.setattr(main, "get_provider", lambda _: Provider())

    async def run():
        response = await main.chat_stream(main.ChatRequest(**REQUEST))
        iterator = response.body_iterator
        await anext(iterator)
        await anext(iterator)
        assert "event: done" in await anext(iterator)
        assert saved.history()[0]["status"] == "complete"
        await iterator.aclose()
        assert len(saved.history()) == 1
        stopped = await main.chat_stream(main.ChatRequest(**REQUEST))
        await anext(stopped.body_iterator)
        await stopped.body_iterator.aclose()
        assert len(closed) == 2
        assert saved.history()[0]["answer"] == "partial"
        assert saved.history()[0]["status"] == "stopped"
    try:
        asyncio.run(run())
    finally:
        saved.close()


def test_oversized_delta_is_not_emitted_or_saved(api, monkeypatch):
    class Provider:
        async def stream(self, *_):
            yield "valid"
            yield "界" * (256 * 1024 // 3 + 1)
    monkeypatch.setattr(main, "get_provider", lambda _: Provider())
    response = api.post("/v1/chat/stream", headers=HEADERS, json=REQUEST)
    assert "event: error" in response.text and "event: done" not in response.text
    row = api.get("/v1/history", headers=HEADERS).json()[0]
    assert row["answer"] == "valid"


def test_large_unicode_delta_fits_desktop_frames_without_losing_text(api, monkeypatch):
    content = "🪶" * 8192
    class Provider:
        async def stream(self, *_):
            yield content
    monkeypatch.setattr(main, "get_provider", lambda _: Provider())
    response = api.post("/v1/chat/stream", headers=HEADERS, json=REQUEST)
    frames = response.text.strip().split("\n\n")
    assert all(len(frame) <= 65536 for frame in frames)
    assert "".join(json.loads(frame.split("data: ", 1)[1])["text"]
                   for frame in frames if frame.startswith("event: delta")) == content
    assert frames[-1].startswith("event: done")


def test_stop_midway_through_large_delta_saves_only_delivered_text(api, monkeypatch):
    class Provider:
        async def stream(self, *_):
            yield "x" * 8192
    monkeypatch.setattr(main, "get_provider", lambda _: Provider())
    async def stop():
        response = await main.chat_stream(main.ChatRequest(**REQUEST))
        first = await anext(response.body_iterator)
        await response.body_iterator.aclose()
        return json.loads(first.split("data: ", 1)[1])["text"]
    delivered = asyncio.run(stop())
    row = api.get("/v1/history", headers=HEADERS).json()[0]
    assert row["answer"] == delivered
    assert row["status"] == "stopped"


@pytest.mark.parametrize("method,path,payload", [
    ("GET", "/v1/settings", None), ("PUT", "/v1/settings", {"provider": "ollama", "model": "fixture"}),
    ("GET", "/v1/memory", None), ("PUT", "/v1/memory", {"notes": "fixture"}),
    ("GET", "/v1/history", None), ("DELETE", "/v1/history", None),
])
def test_storage_failure_returns_safe_service_error(api, monkeypatch, method, path, payload):
    def fail(*_):
        raise sqlite3.OperationalError("private database path and payload")
    for name in ("get", "put", "history", "clear_history"):
        monkeypatch.setattr(main.store, name, fail)
    response = api.request(method, path, headers=HEADERS, **({"json": payload} if payload else {}))
    assert response.status_code == 503
    assert response.json() == {"detail": "Local storage unavailable. Retry or restart Icarus."}


def test_clearing_history_during_generation_keeps_it_cleared(api, monkeypatch):
    class Provider:
        async def stream(self, *_):
            yield "partial"
            main.store.clear_history()
            yield " answer"
    monkeypatch.setattr(main, "get_provider", lambda _: Provider())
    assert "event: done" in api.post("/v1/chat/stream", headers=HEADERS, json=REQUEST).text
    assert api.get("/v1/history", headers=HEADERS).json() == []
