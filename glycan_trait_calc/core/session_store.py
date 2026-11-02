"""Privacy-Compliant In-Memory Session Store with TTL Expiration and User-Controlled Deletion.

Implements Section 20 of the GAREG Glycomic Trait Analyzer Specification:
- User session isolation via UUID tokens.
- Automatic deletion of temporary datasets after configured retention period (SESSION_TTL_SECONDS).
- User-controlled immediate deletion.
- Zero external data transmission.
"""

from __future__ import annotations

import threading
import time
import uuid
from typing import Any, Dict, Optional

from glycan_trait_calc.core.config import SESSION_TTL_SECONDS


class SessionStore:
    """Thread-safe in-memory session store with automatic TTL cleanup."""

    def __init__(self, ttl_seconds: int = SESSION_TTL_SECONDS) -> None:
        self._ttl = ttl_seconds
        self._lock = threading.Lock()
        self._sessions: Dict[str, Dict[str, Any]] = {}

    def _cleanup_expired_unlocked(self) -> None:
        now = time.time()
        expired = [
            sid for sid, data in self._sessions.items()
            if (now - data.get("_updated_at", now)) > self._ttl
        ]
        for sid in expired:
            del self._sessions[sid]

    def create_session(self, initial_data: Dict[str, Any]) -> str:
        with self._lock:
            self._cleanup_expired_unlocked()
            sid = str(uuid.uuid4())
            payload = dict(initial_data)
            payload["session_id"] = sid
            payload["_created_at"] = time.time()
            payload["_updated_at"] = time.time()
            self._sessions[sid] = payload
            return sid

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        with self._lock:
            self._cleanup_expired_unlocked()
            data = self._sessions.get(session_id)
            if data is not None:
                data["_updated_at"] = time.time()
            return data

    def update_session(self, session_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        with self._lock:
            self._cleanup_expired_unlocked()
            data = self._sessions.get(session_id)
            if data is None:
                return None
            data.update(updates)
            data["_updated_at"] = time.time()
            return data

    def delete_session(self, session_id: str) -> bool:
        with self._lock:
            self._cleanup_expired_unlocked()
            if session_id in self._sessions:
                del self._sessions[session_id]
                return True
            return False


GLOBAL_SESSION_STORE = SessionStore()

