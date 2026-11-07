"""Request-local progress for existing generation operations; never streams model drafts.

Opt-in SSE clients get fixed stage identifiers, elapsed time, then the same final
JSON result. Authorization, budgets, validation and persistence stay in the original
handler. Disconnection cannot undo a dispatched provider call or committed write.
"""

import asyncio
import json
from collections.abc import Callable
from contextvars import ContextVar
from time import monotonic

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from starlette.concurrency import run_in_threadpool
from starlette.responses import StreamingResponse

_reporter: ContextVar[Callable[[str], None] | None] = ContextVar("generation_progress", default=None)


def report_stage(stage: str) -> None:
    """Emit a server-owned stage name only when this request has a progress listener."""
    reporter = _reporter.get()
    if reporter is not None:
        reporter(stage)


def stream_operation(operation: Callable) -> StreamingResponse:
    """Run an existing synchronous handler once, with optional live progress and safe final output."""

    async def events():
        queue: asyncio.Queue = asyncio.Queue()
        loop = asyncio.get_running_loop()
        started = monotonic()
        connected = True

        def emit(event: str, data: dict) -> None:
            if connected:
                loop.call_soon_threadsafe(queue.put_nowait, (event, data))

        def work() -> None:
            token = _reporter.set(
                lambda stage: emit("stage", {"stage": stage, "elapsed_ms": (monotonic() - started) * 1000})
            )
            try:
                result = operation()
                report_stage("complete")
                emit("result", jsonable_encoder(result))
            except HTTPException as exc:
                emit("error", {"status": exc.status_code, "detail": exc.detail})
            except Exception:
                emit("error", {"status": 500, "detail": "The server could not finish this request."})
            finally:
                _reporter.reset(token)

        task = asyncio.create_task(run_in_threadpool(work))
        try:
            while True:
                try:
                    event, data = await asyncio.wait_for(queue.get(), timeout=10)
                except TimeoutError:
                    yield ": keep-alive\n\n"
                    continue
                yield f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
                if event in {"result", "error"}:
                    break
        finally:
            connected = False
            task.cancel()

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )
