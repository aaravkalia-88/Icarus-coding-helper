import logging
import sqlite3

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import main, providers
from backend.storage import LocalStore

HEADERS = {"Authorization": "Bearer " + "e" * 64}
REQUEST = {"mode": "ask_icarus", "prompt": "fixture question", "provider": "ollama", "model": "fixture"}
PRIVATE = "fixture-token-and-private-project-notes"


@pytest.fixture
def api(monkeypatch, caplog):
    saved = LocalStore()
    monkeypatch.setattr(main, "store", saved)
    monkeypatch.setattr(main, "session_token", "e" * 64)
    caplog.set_level(logging.WARNING, logger="icarus")
    with TestClient(main.app, raise_server_exceptions=False) as client:
        yield client
    saved.close()


def assert_safe_log(caplog, operation, kind):
    logs = "\n".join(record.getMessage() for record in caplog.records if record.name == "icarus")
    assert operation in logs and kind in logs
    assert PRIVATE not in logs


def test_unexpected_api_failure_is_safe_and_diagnosable(api, monkeypatch, caplog):
    def fail(*_):
        raise RuntimeError(PRIVATE)
    monkeypatch.setattr(main.store, "get", fail)
    response = api.get("/v1/memory", headers=HEADERS)
    assert response.status_code == 500
    assert response.json() == {"detail": "Something went wrong. Retry or restart Icarus."}
    assert_safe_log(caplog, "Request", "RuntimeError")
    assert "fail" in caplog.text  # Sanitized traceback still identifies the failing function.


def test_storage_failure_is_logged_without_private_details(api, monkeypatch, caplog):
    def fail(*_):
        raise sqlite3.OperationalError(PRIVATE)
    monkeypatch.setattr(main.store, "history", fail)
    assert api.get("/v1/history", headers=HEADERS).status_code == 503
    assert_safe_log(caplog, "Local storage", "OperationalError")


def test_failed_connection_test_is_logged_without_the_token(api, monkeypatch, caplog):
    class Provider:
        async def test(self, *_):
            raise RuntimeError(PRIVATE)
    monkeypatch.setattr(main, "get_provider", lambda _: Provider())
    response = api.post("/v1/provider/test", headers=HEADERS, json={"provider": "ollama", "model": "fixture"})
    assert response.json()["status"] == "error"
    assert PRIVATE not in response.text
    assert_safe_log(caplog, "Connection test", "RuntimeError")


def test_failed_stream_keeps_partial_answer_and_logs_safe_context(api, monkeypatch, caplog):
    class Provider:
        async def stream(self, *_):
            yield "partial answer"
            raise RuntimeError(PRIVATE)
    monkeypatch.setattr(main, "get_provider", lambda _: Provider())
    response = api.post("/v1/chat/stream", headers=HEADERS, json=REQUEST)
    assert "event: error" in response.text and "event: done" not in response.text
    assert PRIVATE not in response.text
    assert main.store.history()[0]["answer"] == "partial answer"
    assert_safe_log(caplog, "Generation", "RuntimeError")


def test_history_write_failure_is_logged_without_losing_delivered_answer(api, monkeypatch, caplog):
    class Provider:
        async def stream(self, *_):
            yield "fixture answer"
    def fail(*_):
        raise sqlite3.OperationalError(PRIVATE)
    monkeypatch.setattr(main, "get_provider", lambda _: Provider())
    monkeypatch.setattr(main.store, "add_history", fail)
    response = api.post("/v1/chat/stream", headers=HEADERS, json=REQUEST)
    assert "fixture answer" in response.text and "event: done" in response.text
    assert_safe_log(caplog, "History save", "OperationalError")


@pytest.mark.parametrize("provider,payload,message", [
    ("openai", {"choices": [{}]}, "Model returned an invalid response. Try another model or retry."),
    ("ollama", {"models": []}, "This model is unavailable or unsupported. Check the model ID."),
])
def test_probe_failure_distinguishes_invalid_response_and_missing_model(api, monkeypatch, provider, payload, message):
    real_client = httpx.AsyncClient
    monkeypatch.setattr(providers.httpx, "AsyncClient", lambda **kwargs: real_client(
        transport=httpx.MockTransport(lambda _: httpx.Response(404 if provider == "ollama" else 200, json=payload)), **kwargs))
    response = api.post("/v1/provider/test", headers=HEADERS, json={
        "provider": provider, "model": "fixture", **({"api_key": "fixture-token"} if provider == "openai" else {})})
    assert response.json() == {"status": "error", "message": message}
