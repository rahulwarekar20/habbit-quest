"""Rate limits for sign-in and PIN attempts."""

import time
from collections import deque

from fastapi import HTTPException, Request

MAX_KEYS = 10_000  # past this, idle keys are dropped


class RateLimiter:
    """A sliding window per key, in memory: enough for one instance, and it resets on restart."""

    def __init__(self, limit: int, seconds: float = 60) -> None:
        self.limit = limit
        self.seconds = seconds
        self.hits: dict[str, deque[float]] = {}

    def check(self, key: str) -> None:
        now = time.monotonic()
        if len(self.hits) > MAX_KEYS:
            self.forget_idle(now)
        hits = self.hits.setdefault(key, deque())
        while hits and hits[0] <= now - self.seconds:
            hits.popleft()
        if len(hits) >= self.limit:
            raise HTTPException(429, "Too many attempts. Please wait a minute and try again.")
        hits.append(now)

    def forget_idle(self, now: float) -> None:
        """Drops keys with no attempt inside the window, so many one-off keys cannot use up memory."""
        for key in [k for k, hits in self.hits.items() if not hits or hits[-1] <= now - self.seconds]:
            del self.hits[key]


def client_address(request: Request) -> str:
    """The caller's address. Cloudflare, in front of Render, sets CF-Connecting-IP itself, so it cannot be faked.
    The first X-Forwarded-For entry can be (Render keeps one a caller sends), so it is only a fallback.
    """
    for header in ("cf-connecting-ip", "true-client-ip"):
        if found := request.headers.get(header, "").strip():
            return found
    forwarded = request.headers.get("x-forwarded-for", "")
    return forwarded.split(",")[0].strip() or (request.client.host if request.client else "unknown")
