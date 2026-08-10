"""Pydantic models for the map-agent API."""

from __future__ import annotations

from pydantic import BaseModel, Field


class AgentMapContext(BaseModel):
    """Snapshot of the Solar Detections page, sent with every agent turn.

    The agent has no memory of the map between turns, so anything it needs to
    resolve a phrase like "this square" or "these arrays" has to be in here.
    """

    mapTool: str = "single"  # single | multi | erase
    squares: list[list[float]] = Field(default_factory=list)  # [[lat, lng], ...]
    radiusM: float = 200.0
    selectedDetectionIds: list[int] = Field(default_factory=list)
    focusedDetectionId: int | None = None
    viewportBbox: list[float] | None = None  # [west, south, east, north]
    mapCenter: list[float] | None = None  # [lat, lng]
    mapZoom: float | None = None
    queueLength: int = 0
    busy: bool = False
    sam3Ready: bool = True
    stats: dict = Field(default_factory=dict)


class AgentChatRequest(BaseModel):
    session_id: str | None = None
    message: str
    map_context: AgentMapContext


class AgentContinueRequest(BaseModel):
    session_id: str
    tool_call_id: str
    map_context: AgentMapContext
    result: dict = Field(default_factory=dict)


class AgentConfirmRequest(BaseModel):
    approved: bool = True
    map_context: AgentMapContext


class PendingConfirmation(BaseModel):
    action_id: str
    session_id: str
    tool: str
    tool_input: dict = Field(default_factory=dict)
    summary: str
    impact: dict = Field(default_factory=dict)
    created_at: float = 0.0


class PendingClientTool(BaseModel):
    tool_call_id: str
    tool: str
    tool_input: dict = Field(default_factory=dict)
    # False when the work was started from a confirmation rather than a live tool
    # call: there is no open tool_call_id to answer, so the outcome goes back to
    # the model as a plain message instead.
    as_tool_message: bool = True


class AgentSession(BaseModel):
    session_id: str
    llm_messages: list[dict] = Field(default_factory=list)
    pending_client_tool: PendingClientTool | None = None
    cancelled: bool = False


class ToolResult(BaseModel):
    """Outcome of one tool call.

    A tool either answers on the server (``data``), asks the browser to do
    something visible (``client_actions``), defers to the browser and waits for
    a result (``deferred_client``), or stops for the user's say-so
    (``requires_confirmation``).
    """

    ok: bool = True
    data: dict = Field(default_factory=dict)
    error: str | None = None
    client_actions: list[dict] = Field(default_factory=list)
    requires_confirmation: PendingConfirmation | None = None
    deferred_client: bool = False
