import pytest
from fastapi.testclient import TestClient

from backend import main


TOKEN = "d" * 64
HF_TOKEN = "hf_" + "A" * 32
API_KEY = "sk-" + "B" * 32
PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\n" + "QUJD" * 16 + "\n-----END PRIVATE KEY-----"


@pytest.mark.parametrize("remote_provider", ["openai", "huggingface"])
def test_remote_redacts_obvious_credentials_but_local_keeps_text(monkeypatch, remote_provider):
    seen = []

    class FakeProvider:
        async def stream(self, messages, model, api_key):
            seen.append(messages)
            yield "ok"

    monkeypatch.setattr(main, "session_token", TOKEN)
    monkeypatch.setattr(main, "get_provider", lambda name: FakeProvider())
    request = {
        "mode": "ask_icarus",
        "text": f"Review this: {HF_TOKEN}\n{PRIVATE_KEY}",
        "prompt": f"This is an api_key = {API_KEY}. What is wrong?",
        "provider": remote_provider,
        "model": "Qwen/Qwen3.8-27B",
        "api_key": "dummy-provider-key",
    }
    headers = {"Authorization": f"Bearer {TOKEN}"}
    with TestClient(main.app) as client:
        remote = client.post("/v1/chat/stream", json=request, headers=headers)
        local = client.post(
            "/v1/chat/stream",
            json={**request, "provider": "ollama", "api_key": None},
            headers=headers,
        )

    assert remote.status_code == local.status_code == 200
    remote_text = seen[0][1]["content"]
    local_text = seen[1][1]["content"]
    for secret in (HF_TOKEN, API_KEY, PRIVATE_KEY):
        assert secret not in remote_text
        assert secret in local_text
    assert "[REDACTED" in remote_text
    assert "What is wrong?" in remote_text


def test_redaction_covers_common_key_shapes_and_preserves_surrounding_code():
    from backend.redaction import redact

    github_key = "ghp_" + "G" * 36
    aws_key = "AKIA" + "Z" * 16
    google_key = "AIza" + "X" * 35
    rsa_key = "-----BEGIN RSA PRIVATE KEY-----\nQUJD\n-----END RSA PRIVATE KEY-----"
    source = f"before {github_key} {aws_key} {google_key}\n{rsa_key}\nafter"

    cleaned = redact(source)

    for secret in (github_key, aws_key, google_key, rsa_key):
        assert secret not in cleaned
    assert cleaned.startswith("before ")
    assert cleaned.endswith("\nafter")


@pytest.mark.parametrize("prefix,suffix", [
    ('"api_key": "', '"'),
    ("'access_token': '", "'"),
    ('SERVICE_API_KEY="', '"'),
    ("SERVICE_ACCESS_TOKEN=", ""),
    ("SERVICE_SECRET_KEY=", ""),
])
def test_redaction_covers_quoted_keys_and_prefixed_environment_names(prefix, suffix):
    from backend.redaction import redact

    secret = "genericCredentialValue1234567890"
    source = "before\n" + prefix + secret + suffix + "\nafter"

    assert redact(source) == "before\n" + prefix + "[REDACTED CREDENTIAL]" + suffix + "\nafter"


def test_redaction_preserves_ordinary_assignments_and_already_redacted_values():
    from backend.redaction import redact

    source = 'cache_key = "ordinaryCacheIdentifier1234567890"\napi_key = "[REDACTED CREDENTIAL]"'

    assert redact(source) == source
