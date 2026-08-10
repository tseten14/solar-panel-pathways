"""Agent chat sessions — in-memory, persisted to the same SQLite file as scans.

Persistence matters in dev: `uvicorn --reload` restarts the process whenever a
file changes, and an in-memory-only session would drop a half-finished scan
conversation every time.
"""

from __future__ import annotations

import json
import logging
import time
import uuid

import solar_store
from agent.schemas import AgentSession, PendingClientTool

_log = logging.getLogger("uvicorn.error")

TTL_SECONDS = 6 * 60 * 60

_sessions: dict[str, AgentSession] = {}
_touched: dict[str, float] = {}
_table_ready = False


def _connect():
    global _table_ready
    con = solar_store.connect()
    if not _table_ready:
        con.execute(
            """
            CREATE TABLE IF NOT EXISTS agent_session (
                session_id TEXT PRIMARY KEY,
                llm_messages TEXT NOT NULL DEFAULT '[]',
                pending_client TEXT,
                cancelled INTEGER NOT NULL DEFAULT 0,
                updated_at REAL NOT NULL
            )
            """
        )
        con.commit()
        _table_ready = True
    return con


def _persist(session: AgentSession) -> None:
    try:
        con = _connect()
        try:
            con.execute(
                """
                INSERT INTO agent_session
                    (session_id, llm_messages, pending_client, cancelled, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    llm_messages = excluded.llm_messages,
                    pending_client = excluded.pending_client,
                    cancelled = excluded.cancelled,
                    updated_at = excluded.updated_at
                """,
                (
                    session.session_id,
                    json.dumps(session.llm_messages),
                    json.dumps(session.pending_client_tool.model_dump())
                    if session.pending_client_tool
                    else None,
                    int(session.cancelled),
                    time.time(),
                ),
            )
            con.commit()
        finally:
            con.close()
    except Exception as exc:  # noqa: BLE001
        # A conversation that cannot be written to disk is still usable in memory.
        _log.warning("agent session persist failed: %s", exc)


def _load(session_id: str) -> AgentSession | None:
    try:
        con = _connect()
        try:
            row = con.execute(
                "SELECT session_id, llm_messages, pending_client, cancelled, updated_at"
                " FROM agent_session WHERE session_id = ?",
                (session_id,),
            ).fetchone()
        finally:
            con.close()
    except Exception as exc:  # noqa: BLE001
        _log.warning("agent session load failed: %s", exc)
        return None

    if not row or time.time() - row["updated_at"] > TTL_SECONDS:
        return None
    pending = json.loads(row["pending_client"]) if row["pending_client"] else None
    return AgentSession(
        session_id=row["session_id"],
        llm_messages=json.loads(row["llm_messages"]),
        pending_client_tool=PendingClientTool(**pending) if pending else None,
        cancelled=bool(row["cancelled"]),
    )


def _prune() -> None:
    cutoff = time.time() - TTL_SECONDS
    for sid, seen in [*_touched.items()]:
        if seen < cutoff:
            _sessions.pop(sid, None)
            _touched.pop(sid, None)


def get(session_id: str) -> AgentSession | None:
    session = _sessions.get(session_id)
    if session is None:
        session = _load(session_id)
        if session is not None:
            _sessions[session_id] = session
    if session is not None:
        _touched[session_id] = time.time()
    return session


def get_or_create(session_id: str | None) -> AgentSession:
    _prune()
    if session_id:
        existing = get(session_id)
        if existing:
            return existing
    session = AgentSession(session_id=session_id or str(uuid.uuid4()))
    save(session)
    return session


def save(session: AgentSession) -> None:
    _sessions[session.session_id] = session
    _touched[session.session_id] = time.time()
    _persist(session)


def set_llm_messages(session_id: str, messages: list[dict]) -> None:
    session = get(session_id)
    if session:
        session.llm_messages = messages
        save(session)


def set_pending_client_tool(session_id: str, pending: PendingClientTool | None) -> None:
    session = get(session_id)
    if session:
        session.pending_client_tool = pending
        save(session)


def cancel(session_id: str) -> bool:
    session = get(session_id)
    if not session:
        return False
    session.cancelled = True
    save(session)
    return True


def is_cancelled(session_id: str) -> bool:
    session = get(session_id)
    return bool(session and session.cancelled)


def delete(session_id: str) -> bool:
    existed = _sessions.pop(session_id, None) is not None
    _touched.pop(session_id, None)
    try:
        con = _connect()
        try:
            cur = con.execute("DELETE FROM agent_session WHERE session_id = ?", (session_id,))
            con.commit()
            return existed or cur.rowcount > 0
        finally:
            con.close()
    except Exception:  # noqa: BLE001
        return existed
