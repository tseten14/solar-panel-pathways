"""FastAPI routes for the Solar Detections map agent.

Every turn is streamed to the browser as Server-Sent Events so the user sees the
reply appear word by word and watches each tool run.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import AsyncIterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from agent import session as sessions
from agent.executor import execute_tool
from agent.llm import LLMTurn, MissingApiKey, agent_model, stream_turn
from agent.prompts import build_system_prompt
from agent.schemas import (
    AgentChatRequest,
    AgentConfirmRequest,
    AgentContinueRequest,
    AgentMapContext,
    PendingClientTool,
    PendingConfirmation,
)
from agent.tools import TOOL_DEFINITIONS

router = APIRouter(prefix="/agent", tags=["agent"])
_log = logging.getLogger("uvicorn.error")

MAX_TOOL_TURNS = int(os.environ.get("AGENT_MAX_TOOL_TURNS", "8"))
MAX_TOKENS = int(os.environ.get("AGENT_MAX_TOKENS_PER_TURN", "2048"))
CONFIRMATION_TTL_S = 15 * 60

# Confirmations awaiting a yes/no, keyed by action id.
_pending_confirmations: dict[str, PendingConfirmation] = {}


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _label_for(tool: str) -> str:
    return tool.replace("_", " ").capitalize()


def _remember_confirmation(pending: PendingConfirmation) -> None:
    cutoff = time.time() - CONFIRMATION_TTL_S
    for action_id, item in [*_pending_confirmations.items()]:
        if item.created_at < cutoff:
            _pending_confirmations.pop(action_id, None)
    _pending_confirmations[pending.action_id] = pending


def _assistant_message(turn: LLMTurn) -> dict:
    if turn.tool_calls:
        return {
            "role": "assistant",
            "content": turn.text or None,
            "tool_calls": [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {"name": tc.name, "arguments": json.dumps(tc.arguments)},
                }
                for tc in turn.tool_calls
            ],
        }
    return {"role": "assistant", "content": turn.text}


async def _run_loop(
    session_id: str,
    ctx: AgentMapContext,
    messages: list[dict],
) -> AsyncIterator[str]:
    system = build_system_prompt(ctx)

    for _ in range(MAX_TOOL_TURNS):
        if sessions.is_cancelled(session_id):
            yield _sse("error", {"message": "Cancelled."})
            break

        turn: LLMTurn | None = None
        try:
            async for delta, final in stream_turn(
                system=system,
                messages=messages,
                tools=TOOL_DEFINITIONS,
                max_tokens=MAX_TOKENS,
            ):
                if delta:
                    yield _sse("assistant_delta", {"text": delta})
                if final is not None:
                    turn = final
        except MissingApiKey as exc:
            yield _sse("error", {"message": str(exc)})
            break
        except Exception as exc:  # noqa: BLE001
            _log.exception("agent turn failed")
            yield _sse("error", {"message": str(exc)})
            break

        if turn is None:
            yield _sse("error", {"message": "The model returned no response."})
            break

        messages.append(_assistant_message(turn))

        if not turn.tool_calls:
            sessions.set_llm_messages(session_id, messages)
            break

        stop_turn = False
        for call in turn.tool_calls:
            started = time.time()
            yield _sse("tool_start", {"tool": call.name, "label": _label_for(call.name)})

            result = await execute_tool(call.name, call.arguments, ctx, session_id=session_id)

            if result.requires_confirmation:
                _remember_confirmation(result.requires_confirmation)
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": call.id,
                        "content": json.dumps(
                            {
                                "status": "awaiting_user_confirmation",
                                "summary": result.requires_confirmation.summary,
                            }
                        ),
                    }
                )
                sessions.set_llm_messages(session_id, messages)
                yield _sse(
                    "confirmation_required",
                    {"confirmation": result.requires_confirmation.model_dump()},
                )
                stop_turn = True
                break

            if result.deferred_client:
                for action in result.client_actions:
                    yield _sse("client_action", {**action, "tool_call_id": call.id})
                sessions.set_pending_client_tool(
                    session_id,
                    PendingClientTool(
                        tool_call_id=call.id, tool=call.name, tool_input=call.arguments
                    ),
                )
                sessions.set_llm_messages(session_id, messages)
                yield _sse(
                    "awaiting_client",
                    {"tool_call_id": call.id, "tool": call.name, "session_id": session_id},
                )
                stop_turn = True
                break

            for action in result.client_actions:
                yield _sse("client_action", action)

            payload = result.data if result.ok else {"error": result.error}
            yield _sse(
                "tool_result",
                {"tool": call.name, "ok": result.ok, "result": payload},
            )
            messages.append(
                {"role": "tool", "tool_call_id": call.id, "content": json.dumps(payload)}
            )
            _log.info(
                "agent tool=%s ok=%s ms=%d session=%s",
                call.name,
                result.ok,
                int((time.time() - started) * 1000),
                session_id,
            )

        sessions.set_llm_messages(session_id, messages)
        if stop_turn:
            break

    yield _sse("done", {"sessionId": session_id})


def _stream_response(generator: AsyncIterator[str]) -> StreamingResponse:
    return StreamingResponse(
        generator,
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/health")
async def agent_health() -> dict:
    return {
        "configured": bool((os.environ.get("OPENAI_API_KEY") or "").strip()),
        "model": agent_model(),
    }


@router.post("/chat")
async def agent_chat(body: AgentChatRequest):
    session = sessions.get_or_create(body.session_id)
    session.cancelled = False
    sessions.save(session)

    messages = [*session.llm_messages, {"role": "user", "content": body.message}]

    async def stream() -> AsyncIterator[str]:
        try:
            async for chunk in _run_loop(session.session_id, body.map_context, messages):
                yield chunk
        except Exception as exc:  # noqa: BLE001
            _log.exception("agent chat stream failed")
            yield _sse("error", {"message": str(exc)})
            yield _sse("done", {"sessionId": session.session_id})

    return _stream_response(stream())


@router.post("/continue")
async def agent_continue(body: AgentContinueRequest):
    """Resume after the browser finished a scan the agent asked for."""
    session = sessions.get(body.session_id)
    if not session:
        raise HTTPException(404, "unknown agent session")

    pending = session.pending_client_tool
    if not pending or pending.tool_call_id != body.tool_call_id:
        raise HTTPException(409, "no matching pending map action")

    # Give the model the fresh totals alongside the scan outcome, so it can report
    # the new queue length without a second round trip.
    payload = dict(body.result)
    stats = await execute_tool("get_detection_stats", {}, body.map_context, session_id=body.session_id)
    if stats.ok:
        payload["stats"] = stats.data.get("stats")

    messages = list(session.llm_messages)
    if pending.as_tool_message:
        messages.append(
            {
                "role": "tool",
                "tool_call_id": body.tool_call_id,
                "content": json.dumps(payload),
            }
        )
    else:
        messages.append(
            {
                "role": "user",
                "content": f"[{pending.tool} finished] {json.dumps(payload)}",
            }
        )

    sessions.set_pending_client_tool(body.session_id, None)
    session.cancelled = False
    sessions.save(session)

    async def stream() -> AsyncIterator[str]:
        yield _sse("tool_result", {"tool": pending.tool, "ok": payload.get("ok", True), "result": payload})
        try:
            async for chunk in _run_loop(body.session_id, body.map_context, messages):
                yield chunk
        except Exception as exc:  # noqa: BLE001
            _log.exception("agent continue stream failed")
            yield _sse("error", {"message": str(exc)})
            yield _sse("done", {"sessionId": body.session_id})

    return _stream_response(stream())


@router.post("/confirm/{action_id}")
async def agent_confirm(action_id: str, body: AgentConfirmRequest):
    pending = _pending_confirmations.pop(action_id, None)
    if not pending:
        raise HTTPException(404, "that confirmation has expired")

    session = sessions.get(pending.session_id)
    if not session:
        raise HTTPException(404, "unknown agent session")

    if not body.approved:
        messages = [
            *session.llm_messages,
            {"role": "user", "content": f"[cancelled] I declined: {pending.summary}"},
        ]

        async def declined() -> AsyncIterator[str]:
            async for chunk in _run_loop(pending.session_id, body.map_context, messages):
                yield chunk

        return _stream_response(declined())

    result = await execute_tool(
        pending.tool,
        pending.tool_input,
        body.map_context,
        session_id=pending.session_id,
        skip_confirmation=True,
    )

    async def approved() -> AsyncIterator[str]:
        yield _sse("tool_start", {"tool": pending.tool, "label": _label_for(pending.tool)})

        if result.deferred_client:
            for action in result.client_actions:
                yield _sse("client_action", {**action, "tool_call_id": action_id})
            sessions.set_pending_client_tool(
                pending.session_id,
                PendingClientTool(
                    tool_call_id=action_id,
                    tool=pending.tool,
                    tool_input=pending.tool_input,
                    as_tool_message=False,
                ),
            )
            yield _sse(
                "awaiting_client",
                {
                    "tool_call_id": action_id,
                    "tool": pending.tool,
                    "session_id": pending.session_id,
                },
            )
            yield _sse("done", {"sessionId": pending.session_id})
            return

        for action in result.client_actions:
            yield _sse("client_action", action)

        payload = result.data if result.ok else {"error": result.error}
        yield _sse("tool_result", {"tool": pending.tool, "ok": result.ok, "result": payload})

        # The tool_call this came from was already answered with
        # "awaiting_user_confirmation", so the outcome goes back as a message.
        messages = [
            *session.llm_messages,
            {
                "role": "user",
                "content": f"[approved: {pending.summary}] Result: {json.dumps(payload)}",
            },
        ]
        async for chunk in _run_loop(pending.session_id, body.map_context, messages):
            yield chunk

    return _stream_response(approved())


@router.post("/cancel/{session_id}")
async def agent_cancel(session_id: str) -> dict:
    if not sessions.cancel(session_id):
        raise HTTPException(404, "unknown agent session")
    return {"status": "cancelled", "session_id": session_id}


@router.delete("/session/{session_id}")
async def agent_delete_session(session_id: str) -> dict:
    sessions.delete(session_id)
    return {"status": "deleted", "session_id": session_id}
