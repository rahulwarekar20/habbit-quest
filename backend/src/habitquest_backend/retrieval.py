"""One masked-query embedding and one Pinecone Documents search, with local verification.

Adapted from hq_planner retrieval/filters.py, retrieval/pipeline.py and reranking/ranker.py.
The explicit fixture path uses deterministic lexical ranking; live failures never fall back to it.
"""

import math
import re
import ssl
from collections import Counter
from contextlib import contextmanager, nullcontext
from time import monotonic
from typing import Any

import httpx
import openai

from habitquest_backend import llm, tokenomics_usage
from habitquest_backend.config import Settings
from habitquest_backend.generation_progress import report_stage
from habitquest_backend.planning_catalog import (
    CHILD_INTENTS,
    CONTEXTS,
    METADATA_FIELDS,
    CatalogError,
    CatalogRepository,
)

STOP = set(
    "a an and are as at be can do for from get has have help how i in is it me my of on one or our that the their them they this to us want we with would year old child kids together".split()
)


class RetrievalError(RuntimeError):
    """Sanitized failure code, never a query, credential, or raw provider response."""


def remaining(deadline: float | None, maximum: float) -> float:
    seconds = maximum if deadline is None else min(maximum, deadline - monotonic())
    if seconds <= 0:
        raise RetrievalError("retrieval_timeout")
    return seconds


def words(text: str) -> list[str]:
    return [token for token in re.findall(r"[a-z0-9]+", text.lower()) if token not in STOP and len(token) > 1]


def metadata_matches(actual: Any, expected: Any) -> bool:
    """Documents numeric fields are floats even when canonical JSON uses integers.

    Permit the identical finite integral value, never bool, a numeric string,
    fractional values or coercion of any nonnumeric canonical field.
    """
    if type(expected) is int:
        return (type(actual) is int and actual == expected) or (
            type(actual) is float and math.isfinite(actual) and actual.is_integer() and actual == expected
        )
    return type(actual) is type(expected) and actual == expected


def eligibility_filter(age: int, context: str, version: str, excluded_concepts: set[str]) -> dict:
    clauses = [
        {"age_min": {"$lte": age}},
        {"age_max": {"$gte": age}},
        {"contexts": {"$in": [context]}},
        {"available_by_default": {"$eq": True}},
        {"catalog_version": {"$eq": version}},
        {"language": {"$eq": "en"}},
        {"intent_class": {"$in": sorted(CHILD_INTENTS)}},
    ]
    if excluded_concepts:
        clauses.append({"concept_id": {"$nin": sorted(excluded_concepts)}})
    return {"$and": clauses}


class CatalogRetriever:
    """Read-only retrieval; callers supply already name-masked text and current child context."""

    def __init__(
        self,
        settings: Settings,
        repository: CatalogRepository | None = None,
        *,
        embeddings: Any = None,
        client: httpx.Client | None = None,
    ):
        self.settings = settings
        self.repository = repository or CatalogRepository()
        self.embeddings = embeddings
        self.client = client
        self.timings: dict[str, float] = {}

    @contextmanager
    def _stage(self, name: str):
        report_stage(name.removesuffix("_ms"))
        started = monotonic()
        try:
            yield
        finally:
            self.timings[name] = self.timings.get(name, 0.0) + (monotonic() - started) * 1000

    def _client(self):
        if self.client is not None:
            return nullcontext(self.client)
        context = ssl.create_default_context(cafile=self.settings.ssl_cert_file or None)
        return httpx.Client(verify=context, follow_redirects=False)

    @property
    def headers(self) -> dict[str, str]:
        key = self.settings.pinecone_api_key
        if key is None:
            raise RetrievalError("retrieval_not_configured")
        return {
            "Api-Key": key.get_secret_value(),
            "X-Pinecone-Api-Version": self.settings.pinecone_api_version,
        }

    def retrieve(
        self, masked_query: str, age: int, context: str, deadline: float | None = None, excluded_goal_ids=()
    ) -> list[dict]:
        """At most six distinct concepts, using one embedding/search pair in live mode.

        No family text is logged. Goal exclusions are converted to concept exclusions
        using server-owned canonical records, never accepted as Pinecone predicates.
        """
        self.timings.clear()
        self.timings.update({"embedding_ms": 0.0, "pinecone_ms": 0.0, "hydration_ms": 0.0})
        remaining(deadline, self.settings.pinecone_timeout_seconds)
        if (
            not isinstance(masked_query, str)
            or not masked_query.strip()
            or len(masked_query) > 4000
            or type(age) is not int
            or not 3 <= age <= 13
            or context not in CONTEXTS
        ):
            raise RetrievalError("retrieval_invalid_context")
        excluded = set()
        for ident in excluded_goal_ids:
            try:
                excluded.add(self.repository.get(ident).concept_id)
            except CatalogError:
                # Legacy goal IDs have no source concept to exclude.
                continue
        try:
            if self.settings.retrieval_mode == "fixture":
                with self._stage("fixture_ranking_ms"):
                    ranked = self._fixture(masked_query, age, context, excluded)
            elif self.settings.retrieval_mode == "pinecone":
                ranked = self._live(masked_query, age, context, deadline, excluded)
            else:
                raise RetrievalError("retrieval_disabled")
            with self._stage("hydration_ms"):
                selected = []
                concepts = set()
                for source_id in ranked:
                    goal = self.repository.from_source(source_id)
                    if not self.repository.eligible(goal.goal_id, age, context):
                        raise RetrievalError("retrieval_ineligible_match")
                    if goal.concept_id in concepts or goal.concept_id in excluded:
                        continue
                    concepts.add(goal.concept_id)
                    selected.append(goal.candidate())
                    if len(selected) == 6:
                        break
            remaining(deadline, self.settings.pinecone_timeout_seconds)
            return selected
        except (CatalogError, httpx.HTTPError, openai.OpenAIError, ValueError, TypeError, KeyError) as exc:
            raise RetrievalError("retrieval_unavailable") from exc

    def _fixture(self, query: str, age: int, context: str, excluded: set[str]) -> list[str]:
        """BM25 with a title boost, used only by the explicitly selected fixture mode."""
        goals = self.repository.all()
        documents = [words(goal.text) for goal in goals]
        frequencies = Counter(term for terms in documents for term in set(terms))
        average = sum(map(len, documents)) / len(documents)
        idf = {term: math.log(1 + (len(documents) - n + 0.5) / (n + 0.5)) for term, n in frequencies.items()}
        ranked = []
        for goal, document in zip(goals, documents, strict=True):
            if goal.concept_id in excluded or not self.repository.eligible(goal.goal_id, age, context):
                continue
            terms, title = Counter(document), set(words(goal.title))
            length_factor = 1.2 * (0.25 + 0.75 * len(document) / average)
            score = sum(
                idf.get(t, 0) * (terms[t] * 2.2 / (terms[t] + length_factor)) * (2 if t in title else 1)
                for t in set(words(query))
                if terms[t]
            )
            if score > 0:
                ranked.append((goal.source_id, score))
        return [ident for ident, _ in sorted(ranked, key=lambda item: (-item[1], item[0]))[:12]]

    def _live(
        self, query: str, age: int, context: str, deadline: float | None, excluded: set[str]
    ) -> list[str]:
        self.settings.validate_planning_features()
        timeout = remaining(deadline, self.settings.embedding_timeout_seconds)
        with self._stage("embedding_ms"):
            model = self.embeddings or llm.embedding_model(
                self.settings.model_copy(update={"embedding_timeout_seconds": timeout})
            )
            vector = model.embed_query(query)
        if (
            len(vector) != 512
            or any(type(x) not in {int, float} or not math.isfinite(x) for x in vector)
            or not any(vector)
        ):
            raise RetrievalError("retrieval_invalid_embedding")
        timeout = remaining(deadline, self.settings.pinecone_timeout_seconds)
        with self._stage("pinecone_ms"), self._client() as client:
            llm.check_provider_deadline()
            request = client.build_request(
                "POST",
                f"https://{self.settings.pinecone_host}/namespaces/{self.settings.pinecone_namespace}/documents/search",
                headers=self.headers,
                timeout=timeout,
                json={
                    "top_k": 12,
                    "score_by": [{"type": "dense_vector", "field": "embedding", "values": vector}],
                    "filter": eligibility_filter(age, context, self.repository.version, excluded),
                    "include_fields": [*METADATA_FIELDS, "embedding_model", "embedding_dimensions"],
                },
            )
            ticket = tokenomics_usage.start("pinecone", request, search=True)
            llm.record_provider_attempt("pinecone", check_deadline=False)
            try:
                response = client.send(request)
            except Exception as exc:
                tokenomics_usage.finish(ticket, None, exc)
                raise
            tokenomics_usage.finish(ticket, response)
        remaining(deadline, self.settings.pinecone_timeout_seconds)
        response.raise_for_status()
        with self._stage("hydration_ms"):
            return self._hydrate(response)

    def _hydrate(self, response: httpx.Response) -> list[str]:
        """Check the returned Documents identities and fields against the pinned release."""
        if len(response.content) > 200_000:
            raise RetrievalError("retrieval_oversized_response")
        matches = response.json()["matches"]
        if not isinstance(matches, list) or len(matches) > 12:
            raise RetrievalError("retrieval_invalid_matches")
        seen = set()
        ranked = []
        for match in matches:
            goal = self.repository.from_source(match["_id"])
            score = match["_score"]
            if (
                goal.source_id in seen
                or type(score) not in {float, int}
                or not math.isfinite(score)
                or any(not metadata_matches(match.get(key), goal.metadata[key]) for key in METADATA_FIELDS)
                or match.get("embedding_model") != "text-embedding-3-small"
                or not metadata_matches(match.get("embedding_dimensions"), 512)
            ):
                raise RetrievalError("retrieval_match_mismatch")
            seen.add(goal.source_id)
            ranked.append(goal.source_id)
        return ranked

    def verify_target(self, deadline: float | None = None) -> None:
        """Optional explicit read-only deployment preflight; never called on the Coach path."""
        self.settings.validate_planning_features()
        if self.settings.retrieval_mode != "pinecone":
            raise RetrievalError("retrieval_disabled")
        with self._client() as client:
            for kind, url in (
                ("index", f"https://api.pinecone.io/indexes/{self.settings.pinecone_index_name}"),
                (
                    "namespace",
                    f"https://{self.settings.pinecone_host}/namespaces/{self.settings.pinecone_namespace}",
                ),
            ):
                timeout = remaining(deadline, self.settings.pinecone_timeout_seconds)
                llm.record_provider_attempt("pinecone")
                try:
                    response = client.get(url, headers=self.headers, timeout=timeout)
                    response.raise_for_status()
                    value = response.json()
                    if kind == "index":
                        schema = value.get("schema", {}).get("fields", {}).get("embedding", {})
                        valid = (
                            value.get("host") == self.settings.pinecone_host
                            and value.get("status", {}).get("ready") is True
                            and all(
                                schema.get(key) == value
                                for key, value in {
                                    "type": "dense_vector",
                                    "dimension": 512,
                                    "metric": "cosine",
                                }.items()
                            )
                            and value.get("tags", {}).get("application") == "habitquest"
                            and value.get("tags", {}).get("embedding-model") == "text-embedding-3-small"
                        )
                    else:
                        count = value.get("record_count")
                        valid = (type(count) is int and count == 381) or (
                            isinstance(count, str)
                            and re.fullmatch(r"[0-9]{1,20}", count) is not None
                            and int(count) == 381
                        )
                    if not valid:
                        raise RetrievalError("retrieval_target_mismatch")
                except (httpx.HTTPError, ValueError, TypeError, AttributeError) as exc:
                    raise RetrievalError("retrieval_preflight_unavailable") from exc
        remaining(deadline, self.settings.pinecone_timeout_seconds)
