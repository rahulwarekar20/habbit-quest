"""Rate limits for sign-in and PIN attempts."""

import time
from collections import deque
from collections.abc import Sequence
from ipaddress import IPv4Network, IPv6Network, ip_address

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


def client_address(request: Request, alb_proxies: Sequence[IPv4Network | IPv6Network] = ()) -> str:
    """Trust only the last ALB-appended IP from a configured socket peer.

    Requires uvicorn --no-proxy-headers, ALB XFF append mode without client ports,
    and task ingress restricted to the ALB security group. Empty configuration
    uses the direct peer. Vendor headers and caller-supplied earlier IPs are ignored.
    """
    peer = request.client.host if request.client else "unknown"
    try:
        if any(ip_address(peer) in network for network in alb_proxies):
            forwarded = request.headers.getlist("x-forwarded-for")
            # Do not guess which duplicate header an upstream proxy modified.
            if len(forwarded) == 1:
                candidate = forwarded[0].rsplit(",", 1)[-1].strip()
                if "%" not in candidate:
                    return str(ip_address(candidate))
    except ValueError:
        pass  # Missing/invalid headers or peer: conservative shared peer bucket.
    return peer
