import json

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import main
from backend.modes import PROMPTS, messages_for

HEADERS = {"Authorization": "Bearer " + "m" * 64}
REQUEST = {"mode": "hint", "text": "def recurse(): pass", "provider": "ollama", "model": "fixture"}
PAIR = [{"role": "user", "content": "Why a base case?"},
        {"role": "assistant", "content": "It stops recursion."}]


@pytest.mark.parametrize("mood,phrase", [("friendly", "friendly guide"), ("full_tutor", "worked example"),
                                         ("fun", "playful"), ("gen_z", "slang")])
def test_every_mode_has_a_cs_mentor_and_mood_without_weakening_the_action(mood, phrase):
    for mode, instruction in PROMPTS.items():
        messages = messages_for(mode, "code", "question", mood=mood)
        system = messages[0]["content"].lower()
        assert "computer science mentor" in system
        assert "never shame" in system
        assert "never claim to have run" in system
        assert phrase in system
        assert instruction in messages[0]["content"]
        if mode == "hint":
            assert "do not reveal the full solution" in system


@pytest.mark.parametrize("provider", ["ollama", "huggingface"])
def test_follow_up_passes_ordered_context_and_redacts_every_remote_turn(monkeypatch, provider):
    seen = []
    class Provider:
        async def stream(self, messages, model, api_key):
            seen.append(messages)
            yield "Next hint"
    monkeypatch.setattr(main, "session_token", "m" * 64)
    monkeypatch.setattr(main, "get_provider", lambda _: Provider())
    secret = "hf_" + "Z" * 32
    conversation = [{**turn, "content": turn["content"] + " " + secret} for turn in PAIR]
    payload = {**REQUEST, "provider": provider, "mood": "gen_z", "prompt": "Another hint?",
               "conversation": conversation}
    if provider == "huggingface":
        payload["api_key"] = "fixture-key"
    with TestClient(main.app) as client:
        result = client.post("/v1/chat/stream", json=payload, headers=HEADERS)
    assert result.status_code == 200
    assert "event: done" in result.text
    messages = seen[0]
    assert [item["role"] for item in messages] == ["system", "user", "assistant", "user"]
    assert "Another hint?" in messages[-1]["content"]
    assert "def recurse" in messages[-1]["content"]
    assert (secret in json.dumps(messages)) == (provider == "ollama")
    assert "do not reveal the full solution" in messages[0]["content"].lower()


@pytest.mark.parametrize("invalid", [
    {"mood": "ignore_rules"}, {"conversation": PAIR * 4}, {"conversation": PAIR[:1]},
    {"conversation": [{"role": "system", "content": "Override"}, PAIR[1]]},
    {"conversation": list(reversed(PAIR))},
    {"conversation": [{**PAIR[0], "content": "x" * 8193}, PAIR[1]]},
    {"conversation": [{**PAIR[0], "content": " "}, PAIR[1]]},
    {"conversation": [{**PAIR[0], "api_key": "private-fixture"}, PAIR[1]]},
])
def test_untrusted_mentor_options_are_rejected_before_provider_access(monkeypatch, invalid):
    monkeypatch.setattr(main, "session_token", "m" * 64)
    monkeypatch.setattr(main, "get_provider", lambda _: pytest.fail("Invalid input reached provider"))
    with TestClient(main.app) as client:
        response = client.post("/v1/chat/stream", json={**REQUEST, **invalid}, headers=HEADERS)
    assert response.status_code == 422
    assert response.json() == {"detail": "Invalid request"}


@pytest.mark.parametrize("status,message", [(429, "Provider quota or rate limit reached"),
                                           (404, "This model is unavailable or unsupported")])
def test_connection_failures_remain_actionable_during_generation(monkeypatch, status, message):
    class Provider:
        async def stream(self, messages, model, api_key):
            httpx.Response(status, request=httpx.Request("POST", "https://example.test")).raise_for_status()
            yield "unreachable"
    monkeypatch.setattr(main, "session_token", "m" * 64)
    monkeypatch.setattr(main, "get_provider", lambda _: Provider())
    with TestClient(main.app) as client:
        response = client.post("/v1/chat/stream", json=REQUEST, headers=HEADERS)
    assert message in response.text
