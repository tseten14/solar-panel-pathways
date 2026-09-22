"""OpenAI adapter for the map agent — streaming chat completions with tools.

Uses raw httpx rather than the OpenAI SDK, matching solar_ai.py, so the agent
adds no new Python dependency. Like solar_ai.py this sends
``max_completion_tokens`` and no ``temperature``: newer OpenAI models reject
``max_tokens`` and any non-default temperature on Chat Completions.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Any, AsyncIterator

import httpx

OPENAI_URL = "https://api.openai.com/v1/chat/completions"
STREAM_TIMEOUT_S = 180.0


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any]


@dataclass
class LLMTurn:
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    stop: str = "stop"


class MissingApiKey(RuntimeError):
    pass


def agent_model() -> str:
    return (
        os.environ.get("AGENT_MODEL")
        or os.environ.get("OPENAI_MODEL")
        or "gpt-5.6-sol"
    ).strip()


def reasoning_effort() -> str:
    return (os.environ.get("AGENT_REASONING_EFFORT") or "none").strip()


def _api_key() -> str:
    key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if not key:
        raise MissingApiKey(
            "The map agent needs OPENAI_API_KEY — add it to the .env at the repo root "
            "and restart the backend."
        )
    return key


def to_openai_tools(definitions: list[dict]) -> list[dict]:
    return [
        {
            "type": "function",
            "function": {
                "name": d["name"],
                "description": d["description"],
                "parameters": d["input_schema"],
            },
        }
        for d in definitions
    ]


def _finish_tool_calls(acc: dict[int, dict]) -> list[ToolCall]:
    calls: list[ToolCall] = []
    for part in acc.values():
        args: dict[str, Any] = {}
        if part["arguments"]:
            try:
                args = json.loads(part["arguments"])
            except json.JSONDecodeError:
                # A truncated or malformed argument blob is better reported to the
                # model as an empty call than crashing the whole turn.
                args = {}
        calls.append(ToolCall(id=part["id"], name=part["name"], arguments=args))
    return calls


async def stream_turn(
    *,
    system: str,
    messages: list[dict],
    tools: list[dict],
    max_tokens: int = 2048,
) -> AsyncIterator[tuple[str, LLMTurn | None]]:
    """Yield ``(text_delta, None)`` as the reply streams, then ``("", turn)`` once."""
    api_key = _api_key()
    payload = {
        "model": agent_model(),
        "messages": [{"role": "system", "content": system}, *_strip_internal(messages)],
        "tools": to_openai_tools(tools),
        "tool_choice": "auto",
        "max_completion_tokens": max_tokens,
        # Reasoning models reject function tools on /v1/chat/completions unless
        # reasoning is off ("use /v1/responses or set reasoning_effort to
        # 'none'"). Every agent turn offers tools, so this has to be sent.
        # Override with AGENT_REASONING_EFFORT if you point AGENT_MODEL at a
        # model with different rules.
        "reasoning_effort": reasoning_effort(),
        "stream": True,
    }

    text_parts: list[str] = []
    tool_acc: dict[int, dict] = {}
    finish_reason = "stop"

    async with httpx.AsyncClient(timeout=STREAM_TIMEOUT_S) as client:
        async with client.stream(
            "POST",
            OPENAI_URL,
            headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
            json=payload,
        ) as response:
            if response.status_code != 200:
                raise RuntimeError(await _error_message(response))

            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                blob = line[6:].strip()
                if blob == "[DONE]":
                    break
                try:
                    chunk = json.loads(blob)
                except json.JSONDecodeError:
                    continue

                choices = chunk.get("choices") or []
                if not choices:
                    continue
                choice = choices[0]
                finish_reason = choice.get("finish_reason") or finish_reason
                delta = choice.get("delta") or {}

                content = delta.get("content")
                if content:
                    text_parts.append(content)
                    yield content, None

                for tc in delta.get("tool_calls") or []:
                    idx = tc.get("index", 0)
                    part = tool_acc.setdefault(idx, {"id": "", "name": "", "arguments": ""})
                    if tc.get("id"):
                        part["id"] = tc["id"]
                    fn = tc.get("function") or {}
                    if fn.get("name"):
                        part["name"] = fn["name"]
                    if fn.get("arguments"):
                        part["arguments"] += fn["arguments"]

    tool_calls = _finish_tool_calls(tool_acc)
    yield "", LLMTurn(
        text="".join(text_parts),
        tool_calls=tool_calls,
        stop="tool_use" if tool_calls else finish_reason,
    )


def _strip_internal(messages: list[dict]) -> list[dict]:
    """Drop bookkeeping keys (``_ts``) the API would reject."""
    return [{k: v for k, v in m.items() if not k.startswith("_")} for m in messages]


async def _error_message(response: httpx.Response) -> str:
    try:
        body = json.loads((await response.aread()).decode())
        msg = ((body.get("error") or {}).get("message")) or ""
    except Exception:  # noqa: BLE001
        msg = ""
    if response.status_code == 429:
        return "The AI service rate limit has been reached. Wait a moment and try again."
    if response.status_code == 401:
        return "OpenAI rejected the API key — check OPENAI_API_KEY in your .env."
    return f"OpenAI {response.status_code}: {msg or 'request failed'}"
