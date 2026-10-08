import argparse
from contextlib import aclosing
import json
import logging
import secrets
import sys
import sqlite3
import traceback
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.responses import StreamingResponse
import httpx
from pydantic import BaseModel, ConfigDict, Field, model_validator
import uvicorn

if __package__:
    from .modes import Mode, Mood, messages_for
    from .providers import ProviderName, ProviderResponseError, STREAM_ERRORS, get_provider
    from .redaction import redact
    from .storage import LocalStore
else:
    from modes import Mode, Mood, messages_for
    from providers import ProviderName, ProviderResponseError, STREAM_ERRORS, get_provider
    from redaction import redact
    from storage import LocalStore

app = FastAPI()
session_token: str | None = None
store = LocalStore()
REMOTE_PROVIDERS = ("openai", "huggingface")
logger = logging.getLogger("icarus")


def log_failure(operation: str, error: Exception):
    # Exception messages and locals can contain provider tokens or submitted code.
    frames = "\n".join(f"{frame.f_code.co_filename}:{line} in {frame.f_code.co_name}"
                       for frame, line in traceback.walk_tb(error.__traceback__))
    logger.error("%s failed (%s)\n%s", operation, type(error).__name__, frames)


@app.middleware("http")
async def authenticate(request: Request, call_next):
    authorization = request.headers.get("authorization", "")
    if not session_token or not secrets.compare_digest(
        authorization.encode(), f"Bearer {session_token}".encode()
    ):
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    try:
        return await call_next(request)
    except Exception as error:
        # Handle before Uvicorn can log an unsanitized exception message.
        return await unexpected_error(request, error)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.exception_handler(RequestValidationError)
async def invalid_request(_request: Request, _error: RequestValidationError):
    return JSONResponse({"detail": "Invalid request"}, status_code=422)


@app.exception_handler(sqlite3.Error)
async def storage_unavailable(_request: Request, error: sqlite3.Error):
    log_failure("Local storage", error)
    return JSONResponse({"detail": "Local storage unavailable. Retry or restart Icarus."}, status_code=503)


@app.exception_handler(Exception)
async def unexpected_error(_request: Request, error: Exception):
    log_failure("Request", error)
    return JSONResponse({"detail": "Something went wrong. Retry or restart Icarus."}, status_code=500)


class ConnectionSettings(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: ProviderName = "huggingface"
    model: str = Field(default="Qwen/Qwen3.8-27B", min_length=1, max_length=128, pattern=r"^[^\s\x00-\x1f]+$")


class ProjectMemory(BaseModel):
    model_config = ConfigDict(extra="forbid")
    project: str = Field(default="", max_length=160)
    goal: str = Field(default="", max_length=500)
    notes: str = Field(default="", max_length=8000)


class ProviderTest(ConnectionSettings):
    api_key: str | None = Field(default=None, max_length=4096)

    @model_validator(mode="after")
    def check_key(self):
        if self.provider in REMOTE_PROVIDERS and (not self.api_key or not self.api_key.strip()):
            raise ValueError("API key required")
        if self.api_key and any(char in self.api_key for char in "\r\n\0"):
            raise ValueError("Invalid key")
        if self.provider not in REMOTE_PROVIDERS and self.api_key:
            raise ValueError("Local provider does not need a key")
        return self


@app.get("/v1/settings")
def read_settings():
    return store.get("connection", ConnectionSettings().model_dump())


@app.put("/v1/settings")
def save_settings(settings: ConnectionSettings):
    return store.put("connection", settings.model_dump())


@app.get("/v1/memory")
def read_memory():
    return store.get("memory", ProjectMemory().model_dump())


@app.put("/v1/memory")
def save_memory(memory: ProjectMemory):
    return store.put("memory", memory.model_dump())


@app.get("/v1/history")
def read_history():
    return store.history()


@app.delete("/v1/history")
def clear_history():
    store.clear_history()
    return {"status": "ok"}


def provider_error(error):
    if isinstance(error, ProviderResponseError):
        return STREAM_ERRORS.get(error.reason, "Model response failed")
    if isinstance(error, httpx.HTTPStatusError):
        status = error.response.status_code
        if status in (401, 403):
            return "Provider rejected the token. Check its permissions or replace it."
        if status == 429:
            return "Provider quota or rate limit reached. Check your account and retry."
        if status in (400, 404, 422):
            return "This model is unavailable or unsupported. Check the model ID."
    return "Could not reach the model server. Check the connection and retry."


@app.post("/v1/provider/test")
async def test_provider(request: ProviderTest):
    try:
        await get_provider(request.provider).test(request.model, request.api_key)
        return {"status": "connected"}
    except Exception as error:
        log_failure("Connection test", error)
        return {"status": "error", "message": provider_error(error)}


class ConversationTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=8192)


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Mode
    text: str = Field(default="", max_length=65536)
    prompt: str = Field(default="", max_length=8192)
    provider: ProviderName
    model: str = Field(min_length=1, max_length=128, pattern=r"^[^\s\x00-\x1f]+$")
    api_key: str | None = Field(default=None, max_length=4096)
    building: str = Field(default="", max_length=500)
    memory: ProjectMemory | None = None
    mood: Mood = "friendly"
    conversation: list[ConversationTurn] = Field(default_factory=list, max_length=6)

    @model_validator(mode="after")
    def validate_request(self):
        if len(self.conversation) % 2 or any(
            turn.role != ("assistant" if index % 2 else "user") or not turn.content.strip()
            for index, turn in enumerate(self.conversation)
        ):
            raise ValueError("Conversation must contain user/assistant pairs")
        if not self.text.strip() and not self.prompt.strip():
            raise ValueError("Text or prompt required")
        if not self.model.strip():
            raise ValueError("Model required")
        remote = self.provider in REMOTE_PROVIDERS
        if remote and (not self.api_key or not self.api_key.strip()):
            raise ValueError("Remote API key required")
        if self.api_key and any(char in self.api_key for char in "\r\n\0"):
            raise ValueError("Invalid key")
        if not remote and self.api_key:
            raise ValueError("API key only allowed for remote provider")
        return self


def sse(event: Literal["delta", "done", "error"], data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


@app.post("/v1/chat/stream")
async def chat_stream(request: ChatRequest):
    provider = get_provider(request.provider)
    text, prompt = request.text, request.prompt
    if request.provider in REMOTE_PROVIDERS:
        text, prompt = redact(text), redact(prompt)
    context = request.building
    if request.memory:
        context += "\nProject notes:\n" + json.dumps(request.memory.model_dump(), ensure_ascii=False)
    if request.provider in REMOTE_PROVIDERS:
        context = redact(context)
    conversation = [turn.model_dump() for turn in request.conversation]
    if request.provider in REMOTE_PROVIDERS:
        conversation = [{**turn, "content": redact(turn["content"])} for turn in conversation]
    messages = messages_for(request.mode, text, prompt, context, request.mood, conversation)
    history_store = store
    history_revision = history_store.history_revision

    async def events():
        answer = ""
        answer_bytes = 0
        status = "stopped"
        terminal = None
        try:
            async with aclosing(provider.stream(messages, request.model, request.api_key)) as stream:
                async for content in stream:
                    if not isinstance(content, str):
                        raise ValueError("Invalid provider response")
                    if not content:
                        continue
                    answer_bytes += len(content.encode("utf-8"))
                    if answer_bytes > 256 * 1024:
                        raise ProviderResponseError("oversized")
                    # Match the desktop's per-delta bound, including JSON escaping.
                    for offset in range(0, len(content), 4096):
                        part = content[offset:offset + 4096]
                        answer += part
                        yield sse("delta", {"text": part})
            if not answer.strip():
                raise ProviderResponseError("empty")
            status = "complete"
            terminal = sse("done", {})
        except httpx.HTTPStatusError as error:
            log_failure("Generation", error)
            status = "error"
            message = "Provider authentication failed" if error.response.status_code in (401, 403) else provider_error(error)
            terminal = sse("error", {"message": message})
        except httpx.RequestError as error:
            log_failure("Generation", error)
            status = "error"
            terminal = sse("error", {"message": "Model unavailable"})
        except ProviderResponseError as error:
            log_failure("Generation", error)
            status = "error"
            terminal = sse("error", {"message": provider_error(error)})
        except Exception as error:
            log_failure("Generation", error)
            status = "error"
            terminal = sse("error", {"message": "Model response failed"})
        finally:
            try:
                history_store.add_history(request.mode, text + "\n" + prompt, answer, status, history_revision)
            except sqlite3.Error as error:
                log_failure("History save", error)
        if terminal:
            yield terminal

    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-store"})


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--data-dir", type=Path)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("Invalid port")

    line = sys.stdin.readline(4097)
    try:
        payload = json.loads(line) if len(line) <= 4096 else None
    except json.JSONDecodeError:
        payload = None
    token = payload.get("token") if isinstance(payload, dict) else None
    if not isinstance(token, str) or len(token) < 32 or not token.isascii() or not token.isprintable():
        parser.error("Missing or invalid session token")

    global session_token, store
    session_token = token
    if args.data_dir:
        store.close()
        store = LocalStore(args.data_dir / "icarus.sqlite")
    uvicorn.run(app, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    run()
