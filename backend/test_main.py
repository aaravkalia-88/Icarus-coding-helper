import io
import sys

from fastapi.testclient import TestClient

from backend import main


def test_health_requires_session_token(monkeypatch):
    token = "a" * 64
    monkeypatch.setattr(main, "session_token", token, raising=False)

    with TestClient(main.app) as client:
        assert client.get("/health").status_code == 401
        assert client.get("/health", headers={"Authorization": "Bearer wrong"}).status_code == 401
        response = client.get("/health", headers={"Authorization": f"Bearer {token}"})

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_startup_reads_token_from_stdin_and_binds_loopback(monkeypatch):
    token = "b" * 64
    calls = []
    monkeypatch.setattr(main, "session_token", None, raising=False)
    monkeypatch.setattr(sys, "stdin", io.StringIO(f'{{"token":"{token}"}}\n'))
    monkeypatch.setattr(sys, "argv", ["main.py", "--port", "48123"])
    monkeypatch.setattr(main.uvicorn, "run", lambda *args, **kwargs: calls.append((args, kwargs)))

    main.run()

    assert main.session_token == token
    assert calls[0][0] == (main.app,)
    assert calls[0][1]["host"] == "127.0.0.1"
    assert calls[0][1]["port"] == 48123
