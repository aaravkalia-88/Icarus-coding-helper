import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.storage import LocalStore

LIMIT = 2 * 1024 * 1024
HEADERS = {"Authorization": "Bearer " + "s" * 64}


@pytest.fixture
def api(monkeypatch):
    saved = LocalStore()
    monkeypatch.setattr(main, "store", saved)
    monkeypatch.setattr(main, "session_token", "s" * 64)
    with TestClient(main.app) as client:
        yield client
    saved.close()


@pytest.mark.parametrize("declared", [None, "1", str(LIMIT + 1)])
def test_oversized_body_is_rejected_before_storage(api, declared):
    body = b'{"notes":"private-fixture"}' + b" " * LIMIT
    headers = {**HEADERS, "Content-Type": "application/json"}
    if declared is not None:
        headers["Content-Length"] = declared
    response = api.put("/v1/memory", headers=headers, content=body)
    assert response.status_code == 413
    assert response.json() == {"detail": "Request too large"}
    assert "private-fixture" not in response.text
    assert main.store.get("memory", {}) == {}


def test_chunked_body_is_bounded_without_content_length(api):
    async def chunks():
        yield b'{"notes":"private-fixture"}'
        for _ in range(33):
            yield b" " * 65536

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
            return await client.put("/v1/memory", headers={**HEADERS, "Content-Type": "application/json"}, content=chunks())

    response = asyncio.run(run())
    assert response.status_code == 413
    assert main.store.get("memory", {}) == {}


def test_body_at_limit_and_authentication_still_work(api):
    body = b'{"notes":"fixture"}'
    body += b" " * (LIMIT - len(body))
    assert api.put("/v1/memory", headers={**HEADERS, "Content-Type": "application/json"}, content=body).json()["notes"] == "fixture"
    assert api.put("/v1/memory", content=body + b" ").status_code == 401


@pytest.mark.parametrize("headers,expected", [({}, 401), (HEADERS, 200)])
def test_private_api_responses_are_never_cached(api, headers, expected):
    response = api.get("/v1/memory", headers=headers)
    assert response.status_code == expected
    assert response.headers.get("cache-control") == "no-store"


def test_maximum_valid_unicode_fields_fit_the_request_budget(api, monkeypatch):
    class Provider:
        async def stream(self, *_):
            yield "fixture answer"

    monkeypatch.setattr(main, "get_provider", lambda _: Provider())
    payload = {"mode": "ask_icarus", "provider": "ollama", "model": "fixture",
               "text": "🪶" * 65536, "prompt": "🪶" * 8192, "building": "🪶" * 500,
               "memory": {"project": "🪶" * 160, "goal": "🪶" * 500, "notes": "🪶" * 8000},
               "conversation": [{"role": "user" if index % 2 == 0 else "assistant", "content": "🪶" * 8192}
                                for index in range(6)]}
    body = json.dumps(payload).encode()
    assert len(body) < LIMIT
    response = api.post("/v1/chat/stream", headers={**HEADERS, "Content-Type": "application/json"}, content=body)
    assert response.status_code == 200
    assert "event: done" in response.text


def test_provider_deadline_preserves_partial_answer_with_safe_recovery(api, monkeypatch):
    class Provider:
        async def stream(self, *_):
            yield "partial answer"
            raise TimeoutError("private-fixture-timeout")

    monkeypatch.setattr(main, "get_provider", lambda _: Provider())
    response = api.post("/v1/chat/stream", headers=HEADERS, json={
        "mode": "ask_icarus", "provider": "ollama", "model": "fixture", "prompt": "fixture"})
    assert "partial answer" in response.text and "event: error" in response.text
    assert providers_message() in response.text
    assert "private-fixture-timeout" not in response.text
    assert main.store.history()[0]["status"] == "error"


def providers_message():
    return "Model response was interrupted. Retry to complete the answer."
