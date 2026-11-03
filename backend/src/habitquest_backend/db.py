"""Database access: one transaction per request, with row-level security doing the access control.

`transaction` connects, switches to the `hq_api` role (a caregiver) or `hq_kid` (a kid token), and sets
`app.user_id` / `app.child_id`, which the RLS policies in `db/migrations` read. A query can therefore only ever see
the caller's own family's rows, even if the Python code forgets a WHERE clause.
"""

from contextlib import contextmanager
from typing import Any
from uuid import UUID

import psycopg
from fastapi import HTTPException
from psycopg.rows import dict_row

from habitquest_backend.config import Settings


@contextmanager
def transaction(settings: Settings, user: UUID | None = None, *, kid: UUID | None = None):
    """One transaction with row-level security: as `hq_api` scoped to `user`'s families, or with `kid`, as
    `hq_kid` scoped to that one child.
    """
    with psycopg.connect(settings.database_url, row_factory=dict_row, connect_timeout=3) as conn:
        conn.execute("SET LOCAL ROLE hq_kid" if kid else "SET LOCAL ROLE hq_api")
        conn.execute("SET LOCAL statement_timeout='10s'")
        conn.execute(
            "SELECT set_config('app.user_id',%s,true),set_config('app.child_id',%s,true)",
            (str(user or ""), str(kid or "")),
        )
        yield conn


def one(conn: Any, sql: str, params: tuple = ()) -> dict:
    """The first row of a query, or 404. Under row-level security another family's row is simply not there,
    so this also answers "not yours" with 404 rather than revealing that it exists.
    """
    row = conn.execute(sql, params).fetchone()
    if row is None:
        raise HTTPException(404, "Record not found")
    return row
