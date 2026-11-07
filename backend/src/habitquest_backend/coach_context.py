"""Bounded server-owned Coach context, with database fingerprints on every use.

The cache never authorizes a request. Callers first resolve the child through RLS;
fingerprints then detect writes made by another device/process, including deletes.
Only changed sections are reloaded. Returned values are deep copies because legacy
tools mutate their request snapshot. No conversation or graph is shared by children.
"""

import re
from collections import OrderedDict
from copy import deepcopy
from dataclasses import dataclass, field
from threading import RLock
from time import monotonic
from typing import Any
from uuid import UUID

from habitquest_backend.coach_tools import Snapshot
from habitquest_backend.onboarding import candidates, progress

HISTORY_LIMIT = 20
RESET_NOTE = "[App] A new conversation was started."
AI_TITLE = "CASE WHEN h.family_id IS NULL THEN h.title ELSE 'A family habit for '||(SELECT title FROM hq.goals WHERE id=h.goal_id) END"


TOPIC_SWITCH = re.compile(
    r"^\s*(?:(?:new|different|another)\s+(?:topic|problem|issue|concern)"
    r"|(?:let['’]?s|let us)\s+(?:switch|talk)\s+(?:to|about)|switch(?:ing)?\s+to)\s*[:;,.-]?\s*",
    re.I,
)
REFINEMENT = re.compile(r"\b(easier|harder|smaller|simpler|shorter|longer|simplify|adapt|adjust|refine)\b")
REFERENCE = re.compile(r"\b(it|that|this|those|these|them)\b")
SHORT_REFINEMENT = re.compile(
    r"^(?:please )?(?:(?:even|much|a little|a bit|something|anything|a|one) )?"
    r"(?:easier|harder|smaller|simpler|shorter|longer)(?: (?:one|step|steps|please|option|idea|ideas))*$"
)


def resolve_retrieval_query(history: list[dict], text: str) -> str:
    """Keep an explicit objective across refinement-only turns without a rewriting model.

    Explicit topic markers reset it. Refinement feedback stays in the full Coach
    conversation; omitting words such as 'easier' from search avoids ranking goals
    merely because their title uses that word. This is bounded, deterministic
    conversation handling, not a claim of complete semantic intent recognition.
    """
    objective = ""
    for value in [*(row["content"] for row in history if row["role"] == "parent"), text]:
        switched = TOPIC_SWITCH.match(value)
        if switched:
            objective = value[switched.end() :].strip() or value.strip()
            continue
        normalized = re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()
        followup = (
            SHORT_REFINEMENT.fullmatch(normalized)
            or (REFERENCE.search(normalized) and REFINEMENT.search(normalized))
            or re.search(
                r"\b(?:another|different|other) (?:option|idea|step|habit|goal|plan)s?\b", normalized
            )
            or re.search(r"^try .+ again$", normalized)
            or (
                REFERENCE.search(normalized)
                and re.search(
                    r"\b(?:too hard|too easy|doesn t work|won t work|not help|not fit)\b", normalized
                )
            )
        )
        if not objective or not followup:
            objective = value.strip()
    return objective[-4000:]


def reset_marker(conn: Any, child_id: UUID) -> int:
    """Read the durable reset fence, including an empty/new conversation."""
    return conn.execute(
        "SELECT coalesce(max(id),0) AS reset_id FROM hq.coach_messages"
        " WHERE child_id=%s AND role='note' AND content=%s",
        (child_id, RESET_NOTE),
    ).fetchone()["reset_id"]


def fingerprints(conn: Any, child: dict) -> dict:
    """Compact authoritative revisions, not a cached authorization decision.

    Each digest includes every relevant row identity and PostgreSQL tuple revision,
    so an update/deletion is detected even when counts/max IDs stay unchanged. This
    still performs indexed database reads; the optimization avoids re-materializing
    the whole snapshot and repeatedly loading its text/facts in application queries.
    """
    return conn.execute(
        "SELECT hq.child_today(k.id)::text AS day,k.xmin::text AS profile,"
        "(SELECT md5(coalesce(string_agg(g.id||':'||g.xmin::text,',' ORDER BY g.id),''))"
        " FROM hq.goals g)||':'||"
        "(SELECT md5(coalesce(string_agg(h.id||':'||h.xmin::text,',' ORDER BY h.id),''))"
        " FROM hq.habits h WHERE h.family_id IS NULL) AS catalog,"
        "(SELECT md5(coalesce(string_agg(ch.id::text||':'||ch.xmin::text||':'||h.xmin::text,','"
        " ORDER BY ch.id),'')) FROM hq.child_habits ch JOIN hq.habits h ON h.id=ch.habit_id"
        " WHERE ch.child_id=k.id) AS plan,"
        "(SELECT md5(coalesce(string_agg(c.id::text||':'||c.xmin::text,',' ORDER BY c.id),''))"
        " FROM hq.completions c JOIN hq.child_habits ch ON ch.id=c.child_habit_id"
        " WHERE ch.child_id=k.id)||':'||"
        "(SELECT md5(coalesce(string_agg(ci.day::text||':'||ci.xmin::text,',' ORDER BY ci.day),''))"
        " FROM hq.checkins ci WHERE ci.child_id=k.id) AS progress,"
        "(SELECT md5(coalesce(string_agg(m.id::text||':'||m.xmin::text,',' ORDER BY m.id),''))"
        " FROM hq.coach_messages m WHERE m.child_id=k.id) AS history,"
        "(SELECT md5(coalesce(string_agg(s.id::text||':'||s.xmin::text,',' ORDER BY s.id),''))"
        " FROM hq.children s WHERE s.family_id=k.family_id)||':'||"
        "(SELECT md5(coalesce(string_agg(cg.xmin::text||':'||cg.display_name,','"
        " ORDER BY cg.user_id),'')) FROM hq.caregivers cg WHERE cg.family_id=k.family_id) AS people,"
        "(SELECT coalesce(max(m.id),0) FROM hq.coach_messages m WHERE m.child_id=k.id"
        " AND m.role='note' AND m.content=%s) AS reset_id"
        " FROM hq.children k WHERE k.id=%s",
        (RESET_NOTE, child["id"]),
    ).fetchone()


@dataclass
class Context:
    """Trusted, isolated inputs prepared for one request."""

    snapshot: Snapshot
    history: list[dict]
    names: list[str]
    caregivers: list[str]
    reset_id: int
    as_of_local_date: str
    refreshed: list[str]


@dataclass
class _Entry:
    revisions: dict = field(default_factory=dict)
    snapshot: Snapshot | None = None
    history: list[dict] = field(default_factory=list)
    shown: set[str] = field(default_factory=set)
    names: list[str] = field(default_factory=list)
    caregivers: list[str] = field(default_factory=list)
    tier: int = 1
    loaded_at: float = 0


class CoachContextCache:
    """Small per-application cache, with TTL only as an additional freshness bound."""

    def __init__(self, ttl: float = 30, max_entries: int = 128):
        self.ttl, self.max_entries = ttl, max_entries
        self._entries: OrderedDict[str, _Entry] = OrderedDict()
        self._lock = RLock()

    def invalidate(self, child_id: UUID | str) -> None:
        """Remove one child after reset; never clear a sibling's context."""
        with self._lock:
            self._entries.pop(str(child_id), None)

    def prime_history(self, child_id: UUID | str, rows: list[dict], shown: list[str], revision: str) -> None:
        """Reuse the history already read by the authenticated family bootstrap."""
        key = str(child_id)
        with self._lock:
            entry = self._entries.get(key, _Entry())
            entry.history, entry.shown = deepcopy(rows), set(shown)
            entry.revisions["history"] = revision
            entry.loaded_at = monotonic()
            self._put(key, entry)

    def _put(self, key: str, entry: _Entry) -> None:
        self._entries[key] = entry
        self._entries.move_to_end(key)
        while len(self._entries) > self.max_entries:
            self._entries.popitem(last=False)

    def load(self, conn: Any, child: dict) -> Context:
        """Reload changed sections only, after the caller authorized this child."""
        key = str(child["id"])
        current = fingerprints(conn, child)
        with self._lock:
            entry = deepcopy(self._entries.get(key, _Entry()))
        if monotonic() - entry.loaded_at > self.ttl:
            entry = _Entry()
        old = entry.revisions
        changed = [name for name in current if old.get(name) != current[name]]
        missing = entry.snapshot is None
        snapshot = entry.snapshot or Snapshot(child["age"], [], {}, {})
        snapshot.age = child["age"]
        if missing or any(name in changed for name in ("profile", "progress", "catalog", "day")):
            entry.tier = progress(conn, child["id"])["unlocked_tier"]
            snapshot.approved_days = {
                row["habit_id"]: row["n"]
                for row in conn.execute(
                    "SELECT ch.habit_id,count(DISTINCT c.day) AS n FROM hq.completions c"
                    " JOIN hq.child_habits ch ON ch.id=c.child_habit_id WHERE ch.child_id=%s"
                    " AND c.status='approved' AND c.day>hq.child_today(%s)-14 GROUP BY ch.habit_id",
                    (child["id"], child["id"]),
                ).fetchall()
            }
            snapshot.checkins = conn.execute(
                "SELECT day::text,mood,hardest,favorite,stickers FROM hq.checkins WHERE child_id=%s"
                " AND day>hq.child_today(%s)-14 ORDER BY day",
                (child["id"], child["id"]),
            ).fetchall()
        if missing or any(name in changed for name in ("profile", "progress", "catalog", "day")):
            snapshot.goals = candidates(conn, child["age"], entry.tier)
        if missing or "plan" in changed or "catalog" in changed:
            snapshot.plan = {
                row["habit_id"]: {"title": row["title"], "cue_time": row["cue_time"], "status": row["status"]}
                for row in conn.execute(
                    f"SELECT ch.habit_id,{AI_TITLE} AS title,to_char(ch.cue_time,'HH24:MI') AS cue_time,"
                    "ch.status FROM hq.child_habits ch JOIN hq.habits h ON h.id=ch.habit_id"
                    " WHERE ch.child_id=%s AND ch.status<>'removed'",
                    (child["id"],),
                ).fetchall()
            }
        if "history" in changed:
            entry.history = conn.execute(
                "SELECT role,content FROM (SELECT id,role,content FROM hq.coach_messages"
                " WHERE child_id=%s ORDER BY id DESC LIMIT %s) recent ORDER BY id",
                (child["id"], HISTORY_LIMIT),
            ).fetchall()
            entry.shown = set(
                conn.execute(
                    "SELECT coalesce(array_agg(DISTINCT h),'{}') AS ids FROM hq.coach_messages m,"
                    " unnest(m.shown_habits) h WHERE m.child_id=%s",
                    (child["id"],),
                ).fetchone()["ids"]
            )
        snapshot.shown = set(entry.shown)
        if missing or "people" in changed:
            siblings = conn.execute(
                "SELECT name FROM hq.children WHERE family_id=%s AND id<>%s ORDER BY created_at,id",
                (child["family_id"], child["id"]),
            ).fetchall()
            entry.names = [child["name"], *(row["name"] for row in siblings)]
            entry.caregivers = [
                row["display_name"]
                for row in conn.execute(
                    "SELECT display_name FROM hq.caregivers WHERE family_id=%s", (child["family_id"],)
                ).fetchall()
            ]
        entry.snapshot, entry.revisions, entry.loaded_at = snapshot, current, monotonic()
        with self._lock:
            self._put(key, deepcopy(entry))
        return Context(
            snapshot,
            entry.history,
            entry.names,
            entry.caregivers,
            current["reset_id"],
            current["day"],
            changed,
        )


def family_history(conn: Any, family_id: UUID) -> list[dict]:
    """One bounded history per child; shown IDs still cover the retained thread."""
    return conn.execute(
        "SELECT k.id AS child_id,coalesce(recent.messages,'[]'::jsonb) AS messages,"
        "(SELECT md5(coalesce(string_agg(m.id::text||':'||m.xmin::text,',' ORDER BY m.id),''))"
        " FROM hq.coach_messages m WHERE m.child_id=k.id) AS revision,"
        "ARRAY(SELECT DISTINCT h FROM hq.coach_messages m,unnest(m.shown_habits) h"
        " WHERE m.child_id=k.id) AS shown FROM hq.children k LEFT JOIN LATERAL ("
        " SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) AS messages FROM ("
        " SELECT id,role,content,sources,no_habit_match,created_at FROM hq.coach_messages"
        " WHERE child_id=k.id ORDER BY id DESC LIMIT %s) r) recent ON true"
        " WHERE k.family_id=%s ORDER BY k.created_at,k.id",
        (HISTORY_LIMIT, family_id),
    ).fetchall()
