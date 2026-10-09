import asyncio
import gzip
import json

import httpx
import pytest

from backend import providers


class Chunks(httpx.AsyncByteStream):
    def __init__(self, chunks, delay=0):
        self.chunks = chunks
        self.delay = delay
        self.closed = False

    async def __aiter__(self):
        for chunk in self.chunks:
            if self.delay:
                await asyncio.sleep(self.delay)
            yield chunk

    async def aclose(self):
        self.closed = True


def upstream(monkeypatch, stream, headers=None):
    real_client = httpx.AsyncClient
    monkeypatch.setattr(providers.httpx, "AsyncClient", lambda **kwargs: real_client(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, stream=stream, headers=headers)), **kwargs))


def collect(name):
    async def run():
        return [part async for part in providers.get_provider(name).stream(
            [{"role": "user", "content": "fixture"}], "fixture", "fixture-token" if name == "openai" else None)]
    return asyncio.run(run())


@pytest.mark.parametrize("name", ["ollama", "openai"])
def test_oversized_provider_line_is_rejected_even_when_answer_is_short(monkeypatch, name):
    payload = {"ignored": "x" * (1024 * 1024 + 1)}
    payload.update({"message": {"content": "ok"}, "done": True} if name == "ollama" else
                   {"choices": [{"delta": {"content": "ok"}, "finish_reason": "stop"}]})
    line = json.dumps(payload).encode()
    stream = Chunks([(b"data: " if name == "openai" else b"") + line + b"\n"])
    upstream(monkeypatch, stream)
    with pytest.raises(providers.ProviderResponseError):
        collect(name)
    assert stream.closed


def test_upstream_metadata_has_a_total_budget(monkeypatch):
    stream = Chunks([b": ignored " + b"x" * 65536 + b"\n"] * 129 + [b"data: [DONE]\n"])
    upstream(monkeypatch, stream)
    with pytest.raises(providers.ProviderResponseError):
        collect("openai")
    assert stream.closed


@pytest.mark.parametrize("name", ["ollama", "openai"])
def test_connection_probe_has_a_body_budget(monkeypatch, name):
    payload = {"ignored": "x" * (1024 * 1024 + 1), "models": [{"name": "fixture"}],
               "choices": [{"message": {"content": "OK"}}]}
    stream = Chunks([json.dumps(payload).encode()])
    upstream(monkeypatch, stream)
    with pytest.raises(providers.ProviderResponseError):
        asyncio.run(providers.get_provider(name).test("fixture", "fixture-token"))
    assert stream.closed


def test_unsolicited_compressed_provider_response_is_rejected(monkeypatch):
    payload = b'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n'
    stream = Chunks([gzip.compress(payload)])
    upstream(monkeypatch, stream, {"Content-Encoding": "gzip"})
    with pytest.raises(providers.ProviderResponseError):
        collect("openai")
    assert stream.closed


@pytest.mark.parametrize("operation", ["stream", "test"])
def test_continuous_upstream_activity_cannot_exceed_total_deadline(monkeypatch, operation):
    monkeypatch.setattr(providers, "PROBE_DEADLINE" if operation == "test" else "PROVIDER_DEADLINE", 0.02, raising=False)
    chunks = ([b": heartbeat\n"] * 20 + [b"data: [DONE]\n"] if operation == "stream" else
              [b" "] * 20 + [b'{"choices":[{"message":{"content":"OK"}}]}'])
    stream = Chunks(chunks, delay=0.005)
    upstream(monkeypatch, stream)
    with pytest.raises(TimeoutError):
        if operation == "stream":
            collect("openai")
        else:
            asyncio.run(providers.get_provider("openai").test("fixture", "fixture-token"))
    assert stream.closed


@pytest.mark.parametrize("operation", ["stream", "test"])
def test_ready_upstream_data_cannot_skip_expired_deadline(monkeypatch, operation):
    monkeypatch.setattr(providers, "PROBE_DEADLINE" if operation == "test" else "PROVIDER_DEADLINE", 0, raising=False)
    body = (b'data: {"choices":[{"delta":{"content":"OK"},"finish_reason":"stop"}]}\n' if operation == "stream" else
            b'{"choices":[{"message":{"content":"OK"}}]}')
    stream = Chunks([body])
    upstream(monkeypatch, stream)
    with pytest.raises(TimeoutError):
        if operation == "stream":
            collect("openai")
        else:
            asyncio.run(providers.get_provider("openai").test("fixture", "fixture-token"))


def test_fragmented_oversized_line_is_rejected(monkeypatch):
    stream = Chunks([b'data: {"ignored":"'] + [b"x" * 65536] * 17 + [b'"}\n'])
    upstream(monkeypatch, stream)
    with pytest.raises(providers.ProviderResponseError):
        collect("openai")
    assert stream.closed


def test_buffered_frames_expire_after_a_consumer_pause(monkeypatch):
    monkeypatch.setattr(providers, "PROVIDER_DEADLINE", 0.02)
    stream = Chunks([b'data: {"choices":[{"delta":{"content":"OK"}}]}\ndata: [DONE]\n'])
    upstream(monkeypatch, stream)

    async def run():
        answer = providers.get_provider("openai").stream([], "fixture", "fixture-token")
        try:
            assert await anext(answer) == "OK"
            await asyncio.sleep(0.05)
            with pytest.raises(TimeoutError):
                await anext(answer)
        finally:
            await answer.aclose()

    asyncio.run(run())
    assert stream.closed


def test_valid_utf8_and_crlf_frames_survive_chunk_boundaries(monkeypatch):
    body = 'data: {"choices":[{"delta":{"content":"🪶界"}}]}\r\n\r\ndata: [DONE]\r\n'.encode()
    stream = Chunks([body[index:index + 1] for index in range(len(body))])
    upstream(monkeypatch, stream)
    assert collect("openai") == ["🪶界"]
    assert stream.closed
