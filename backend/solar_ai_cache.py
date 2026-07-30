# Minimal in-memory TTL cache for Solar-AI responses, matching the reference's
# node-cache usage (stdTTL: 1800s). Process-local — resets on restart and is
# not shared across multiple uvicorn workers; fine for a single-process deploy.
from __future__ import annotations

import time

_TTL_S = 1800
_store: dict[str, tuple[float, dict]] = {}


def get(key: str) -> dict | None:
    entry = _store.get(key)
    if entry is None:
        return None
    expires_at, value = entry
    if time.monotonic() > expires_at:
        _store.pop(key, None)
        return None
    return value


def set(key: str, value: dict) -> None:
    _store[key] = (time.monotonic() + _TTL_S, value)
