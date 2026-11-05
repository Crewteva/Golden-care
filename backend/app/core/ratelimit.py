"""Simple in-memory sliding-window limits per IP address (one API process)."""
import threading
import time
from collections import defaultdict, deque

from app.core.errors import AppError


class SlidingWindow:
    def __init__(self, limit: int, seconds: int):
        self.limit = limit
        self.seconds = seconds
        self._hits: dict[str, deque] = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str | None) -> None:
        key = key or "unknown"
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > self.seconds:
                hits.popleft()
            if len(hits) >= self.limit:
                retry = int(self.seconds - (now - hits[0])) + 1
                raise AppError(429, "rate_limited", retry_after=retry)
            hits.append(now)


login_limit = SlidingWindow(limit=20, seconds=600)
register_limit = SlidingWindow(limit=5, seconds=3600)
forgot_limit = SlidingWindow(limit=5, seconds=3600)
