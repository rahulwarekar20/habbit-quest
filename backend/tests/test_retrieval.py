"""Exactly one embedding/search pair, canonical result verification and explicit fixtures."""

import json
from pathlib import Path
from time import monotonic

import httpx
import pytest
from pydantic import SecretStr

from habitquest_backend import llm, retrieval
from habitquest_backend.planning_catalog import METADATA_FIELDS, CatalogRepository


def actual_documents_payload():
    """Sanitized read-only Documents response; no query, vectors or credentials."""
    return json.loads((Path(__file__).parent / "fixtures/pinecone_documents_search.json").read_text())


@pytest.fixture
def repository():
    return CatalogRepository()


@pytest.fixture
def live(settings):
    return settings.model_copy(
        update={
            "retrieval_mode": "pinecone",
            "ai_mode": "openai",
            "openai_base_url": "https://legacy.example/v1",
            "openai_api_key": SecretStr("legacy-test"),
            "openai_model": "legacy-model",
            "planning_openai_api_key": SecretStr("planning-test"),
            "pinecone_api_key": SecretStr("pinecone-test"),
            "pinecone_host": "hq-habits-v1.svc.test.pinecone.io",
        }
    )


def eligible(repository):
    return [g for g in repository.all() if repository.eligible(g.goal_id, 8, "home")]


def match(goal, score=0.8):
    return {
        "_id": goal.source_id,
        "_score": score,
        **{k: goal.metadata[k] for k in METADATA_FIELDS},
        "embedding_model": "text-embedding-3-small",
        "embedding_dimensions": 512,
    }


class Embeddings:
    def __init__(self, vector=None, callback=None):
        self.calls = []
        self.vector = [0.1] * 512 if vector is None else vector
        self.callback = callback

    def embed_query(self, query):
        self.calls.append(query)
        if self.callback:
            self.callback()
        return self.vector


def client_for(payload, status=200):
    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(status, json=payload)

    return httpx.Client(transport=httpx.MockTransport(handle)), calls


def test_live_one_masked_embedding_one_documents_search_and_local_verification(live, repository):
    goals = eligible(repository)[:8]
    client, calls = client_for({"matches": [match(g) for g in goals]})
    embeddings = Embeddings()
    with llm.track_provider_attempts() as counts:
        results = retrieval.CatalogRetriever(live, repository, embeddings=embeddings, client=client).retrieve(
            "Child A needs help beginning homework",
            8,
            "home",
            monotonic() + 10,
        )
    assert embeddings.calls == ["Child A needs help beginning homework"]
    assert len(calls) == 1 and counts.snapshot()["pinecone"] == 1 and len(results) == 6
    assert results[0] == goals[0].candidate()
    request = calls[0]
    assert request.url.path == "/namespaces/habits-0-1-0/documents/search"
    assert request.headers["X-Pinecone-Api-Version"] == "2026-07"
    body = json.loads(request.content)
    assert body["score_by"][0]["values"] == [0.1] * 512
    assert {"age_min": {"$lte": 8}} in body["filter"]["$and"]
    assert {"contexts": {"$in": ["home"]}} in body["filter"]["$and"]
    assert body["top_k"] == 12
    assert "canonical_record_sha256" in body["include_fields"]


def test_empty_live_results_are_not_local_fallback(live, repository):
    client, calls = client_for({"matches": []})
    model = Embeddings()
    assert (
        retrieval.CatalogRetriever(live, repository, embeddings=model, client=client).retrieve(
            "homework", 8, "home"
        )
        == []
    )
    assert len(calls) == len(model.calls) == 1


def test_failed_search_records_failed_attempt_without_automatic_retry(live, repository, monkeypatch):
    ticket = object()
    recorded = []
    monkeypatch.setattr(retrieval.tokenomics_usage, "start", lambda *args, **kwargs: ticket)
    monkeypatch.setattr(retrieval.tokenomics_usage, "finish", lambda *args: recorded.append(args))

    def timeout(request):
        raise httpx.ReadTimeout("Synthetic search timeout", request=request)

    client = httpx.Client(transport=httpx.MockTransport(timeout))
    with llm.track_provider_attempts() as counts:
        with pytest.raises(retrieval.RetrievalError, match="unavailable"):
            retrieval.CatalogRetriever(live, repository, embeddings=Embeddings(), client=client).retrieve(
                "Child A needs a homework starting routine", 8, "home"
            )
    assert counts.snapshot()["pinecone"] == 1
    assert len(recorded) == 1 and recorded[0][:2] == (ticket, None)
    assert isinstance(recorded[0][2], httpx.ReadTimeout)


def test_exclusions_are_server_owned_concepts_and_legacy_ids_ignored(live, repository):
    goals = eligible(repository)[:2]
    client, calls = client_for({"matches": [match(g) for g in goals]})
    results = retrieval.CatalogRetriever(live, repository, embeddings=Embeddings(), client=client).retrieve(
        "Child A",
        8,
        "home",
        excluded_goal_ids=[goals[0].goal_id, "legacy-goal"],
    )
    assert [g["goal_id"] for g in results] == [goals[1].goal_id]
    assert {"concept_id": {"$nin": [goals[0].concept_id]}} in json.loads(calls[0].content)["filter"]["$and"]


@pytest.mark.parametrize(
    "query,age,context",
    [
        ("", 8, "home"),
        (" " * 2, 8, "home"),
        ("x" * 4001, 8, "home"),
        (None, 8, "home"),
        ("q", True, "home"),
        ("q", 2, "home"),
        ("q", 14, "home"),
        ("q", 8, "mars"),
    ],
)
def test_invalid_context_fails_before_clients(live, repository, query, age, context):
    model = Embeddings()
    with pytest.raises(retrieval.RetrievalError, match="invalid_context"):
        retrieval.CatalogRetriever(live, repository, embeddings=model).retrieve(query, age, context)
    assert model.calls == []


@pytest.mark.parametrize(
    "vector", [[0.0] * 512, [0.1] * 511, [True] * 512, [float("nan")] * 512, [float("inf")] * 512, "wrong"]
)
def test_invalid_query_embedding_never_reaches_pinecone(live, repository, vector):
    client, calls = client_for({"matches": []})
    with pytest.raises(retrieval.RetrievalError, match="invalid_embedding"):
        retrieval.CatalogRetriever(live, repository, embeddings=Embeddings(vector), client=client).retrieve(
            "query", 8, "home"
        )
    assert calls == []


@pytest.mark.parametrize(
    "mutation,code",
    [
        (lambda m: m.update(_id="unknown"), "unavailable"),
        (lambda m: m.update(_score=float("nan")), "match_mismatch"),
        (lambda m: m.update(_score=True), "match_mismatch"),
        (lambda m: m.update(age_min=99), "match_mismatch"),
        (lambda m: m.update(canonical_record_sha256="wrong"), "match_mismatch"),
        (lambda m: m.update(catalog_version="future"), "match_mismatch"),
        (lambda m: m.update(contexts=["mars"]), "match_mismatch"),
        (lambda m: m.update(embedding_model="large"), "match_mismatch"),
        (lambda m: m.update(embedding_dimensions=True), "match_mismatch"),
        (lambda m: m.update(embedding_dimensions=1536), "match_mismatch"),
        (lambda m: m.pop("_score"), "unavailable"),
    ],
)
def test_untrusted_matches_fail_closed(live, repository, mutation, code):
    item = match(eligible(repository)[0])
    mutation(item)
    # Python's JSON reader accepts NaN, so model a malformed provider body directly.
    client = httpx.Client(
        transport=httpx.MockTransport(
            lambda r: httpx.Response(200, content=json.dumps({"matches": [item]}).encode())
        )
    )
    with pytest.raises(retrieval.RetrievalError, match=code):
        retrieval.CatalogRetriever(live, repository, embeddings=Embeddings(), client=client).retrieve(
            "query", 8, "home"
        )


@pytest.mark.parametrize(
    "kind", ["duplicate", "too_many", "wrong_shape", "missing_matches", "ineligible", "oversize", "http"]
)
def test_unusable_response_is_explicit_failure(live, repository, kind):
    item = match(eligible(repository)[0])
    payload = {"matches": [item]}
    status = 200
    if kind == "duplicate":
        payload = {"matches": [item, item]}
    elif kind == "too_many":
        payload = {"matches": [item] * 13}
    elif kind == "wrong_shape":
        payload = {"matches": {}}
    elif kind == "missing_matches":
        payload = {}
    elif kind == "ineligible":
        goal = next(g for g in repository.all() if g.metadata["age_min"] == 11)
        payload = {"matches": [match(goal)]}
    elif kind == "oversize":
        payload["extra"] = "x" * 200_001
    else:
        status = 503
    client, calls = client_for(payload, status)
    with pytest.raises(retrieval.RetrievalError):
        retrieval.CatalogRetriever(live, repository, embeddings=Embeddings(), client=client).retrieve(
            "query", 8, "home"
        )
    assert len(calls) == 1


def test_deadlines_prevent_embedding_and_late_search(live, repository, monkeypatch):
    clock = [1.0]
    monkeypatch.setattr(retrieval, "monotonic", lambda: clock[0])
    model = Embeddings(callback=lambda: clock.__setitem__(0, 3.0))
    client, calls = client_for({"matches": []})
    retriever = retrieval.CatalogRetriever(live, repository, embeddings=model, client=client)
    with pytest.raises(retrieval.RetrievalError, match="timeout"):
        retriever.retrieve("query", 8, "home", deadline=0.5)
    assert not model.calls
    with pytest.raises(retrieval.RetrievalError, match="timeout"):
        retriever.retrieve("query", 8, "home", deadline=2.0)
    assert len(model.calls) == 1 and not calls


def test_deadline_rechecked_after_search(live, repository, monkeypatch):
    clock = [1.0]
    monkeypatch.setattr(retrieval, "monotonic", lambda: clock[0])

    def handle(request):
        clock[0] = 3.0
        return httpx.Response(200, json={"matches": []})

    client = httpx.Client(transport=httpx.MockTransport(handle))
    with pytest.raises(retrieval.RetrievalError, match="timeout"):
        retrieval.CatalogRetriever(live, repository, embeddings=Embeddings(), client=client).retrieve(
            "query", 8, "home", 2.0
        )


def test_factory_receives_bounded_embedding_timeout(live, repository, monkeypatch):
    model = Embeddings()
    seen = []

    def factory(settings):
        seen.append(settings.embedding_timeout_seconds)
        return model

    monkeypatch.setattr(llm, "embedding_model", factory)
    client, _ = client_for({"matches": []})
    retrieval.CatalogRetriever(live, repository, client=client).retrieve(
        "query", 8, "home", monotonic() + 1.0
    )
    assert 0 < seen[0] <= 1


def test_owned_client_uses_tls_and_closes(live, repository, monkeypatch):
    client, _ = client_for({"matches": []})
    seen = []

    def factory(**kwargs):
        seen.append(kwargs)
        return client

    monkeypatch.setattr(httpx, "Client", factory)
    retrieval.CatalogRetriever(live, repository, embeddings=Embeddings()).retrieve("query", 8, "home")
    assert client.is_closed and seen[0]["follow_redirects"] is False
    assert seen[0]["verify"].check_hostname


def test_explicit_fixture_is_repeatable_eligible_and_network_free(settings, repository):
    fixture = settings.model_copy(update={"retrieval_mode": "fixture"})
    retriever = retrieval.CatalogRetriever(fixture)
    first = retriever.retrieve("start homework", 8, "home")
    assert first and first == retriever.retrieve("start homework", 8, "home")
    assert all(repository.eligible(g["goal_id"], 8, "home") for g in first)
    assert len({g["source_ref"]["concept_id"] for g in first}) == len(first) <= 6
    assert retriever.retrieve("zzqqyyx", 8, "home") == []
    excluded = [g["goal_id"] for g in first]
    assert not set(excluded) & {
        g["goal_id"] for g in retriever.retrieve("start homework", 8, "home", excluded_goal_ids=excluded)
    }


def test_disabled_mode_and_missing_key_fail_closed(settings, repository):
    retriever = retrieval.CatalogRetriever(settings, repository)
    with pytest.raises(retrieval.RetrievalError, match="disabled"):
        retriever.retrieve("query", 8, "home")
    with pytest.raises(retrieval.RetrievalError, match="not_configured"):
        _ = retriever.headers
    with pytest.raises(retrieval.RetrievalError, match="disabled"):
        retriever.verify_target()


def index_info(live):
    return {
        "host": live.pinecone_host,
        "status": {"ready": True},
        "schema": {"fields": {"embedding": {"type": "dense_vector", "dimension": 512, "metric": "cosine"}}},
        "tags": {"application": "habitquest", "embedding-model": "text-embedding-3-small"},
    }


@pytest.mark.parametrize("failure", [None, "index", "namespace", "http", "json"])
def test_optional_preflight_verifies_target_without_embedding(live, repository, failure):
    calls = []

    def handle(request):
        calls.append(request)
        value = index_info(live) if len(calls) == 1 else {"record_count": 381}
        if failure == "index" and len(calls) == 1:
            value["status"] = {"ready": False}
        if failure == "namespace" and len(calls) == 2:
            value["record_count"] = 0
        if failure == "json":
            return httpx.Response(200, content=b"{")
        return httpx.Response(503 if failure == "http" else 200, json=value)

    retriever = retrieval.CatalogRetriever(
        live, repository, client=httpx.Client(transport=httpx.MockTransport(handle))
    )
    if failure:
        with pytest.raises(retrieval.RetrievalError):
            retriever.verify_target()
    else:
        retriever.verify_target()
        assert len(calls) == 2 and all(r.method == "GET" for r in calls)


def test_concept_deduplication_remains_bounded(settings, repository, monkeypatch):
    goal = eligible(repository)[0]
    fixture = settings.model_copy(update={"retrieval_mode": "fixture"})
    retriever = retrieval.CatalogRetriever(fixture, repository)
    monkeypatch.setattr(retriever, "_fixture", lambda *args: [goal.source_id, goal.source_id])
    assert len(retriever.retrieve("query", 8, "home")) == 1


@pytest.mark.parametrize(
    "count,valid",
    [
        (381, True),
        ("381", True),
        ("00381", True),
        (True, False),
        (381.0, False),
        ("381.0", False),
        ("-381", False),
        ("NaN", False),
        ("382", False),
        (None, False),
    ],
)
def test_namespace_preflight_accepts_documents_api_decimal_count(live, repository, count, valid):
    def handle(request):
        body = (
            index_info(live)
            if request.url.host == "api.pinecone.io"
            else {
                "name": "habits-0-1-0",
                "record_count": count,
                "size_bytes": "6487328",
            }
        )
        return httpx.Response(200, json=body)

    retriever = retrieval.CatalogRetriever(
        live, repository, client=httpx.Client(transport=httpx.MockTransport(handle))
    )
    if valid:
        retriever.verify_target()
    else:
        with pytest.raises(retrieval.RetrievalError, match="target_mismatch"):
            retriever.verify_target()


def test_request_stage_timings_and_reset_preserve_observer_reference(live, repository, monkeypatch):
    clock = [1.0]
    monkeypatch.setattr(retrieval, "monotonic", lambda: clock[0])
    embeddings = Embeddings(callback=lambda: clock.__setitem__(0, 4.0))

    def handle(request):
        clock[0] = 6.0
        return httpx.Response(200, json={"matches": []})

    retriever = retrieval.CatalogRetriever(
        live, repository, embeddings=embeddings, client=httpx.Client(transport=httpx.MockTransport(handle))
    )
    observed = retriever.timings
    retriever.retrieve("query", 8, "home")
    assert observed is retriever.timings
    assert observed == {"embedding_ms": 3000.0, "pinecone_ms": 2000.0, "hydration_ms": 0.0}
    with pytest.raises(retrieval.RetrievalError, match="invalid_context"):
        retriever.retrieve("", 8, "home")
    assert observed == {"embedding_ms": 0.0, "pinecone_ms": 0.0, "hydration_ms": 0.0}


def test_actual_documents_wire_numbers_hydrate_without_coercing_identity(live, repository):
    payload = actual_documents_payload()
    client, calls = client_for(payload)
    embeddings = Embeddings()
    retriever = retrieval.CatalogRetriever(live, repository, embeddings=embeddings, client=client)
    result = retriever.retrieve("Child A needs help starting homework", 8, "home")
    assert [item["source_ref"]["source_id"] for item in result] == [
        item["_id"] for item in payload["matches"]
    ]
    assert result[0]["goal_id"] == repository.from_source(payload["matches"][0]["_id"]).goal_id
    assert len(calls) == len(embeddings.calls) == 1
    assert retriever.timings["hydration_ms"] >= 0


@pytest.mark.parametrize(
    "field,value",
    [
        ("age_min", True),
        ("age_min", "6"),
        ("age_min", 6.5),
        ("age_min", 7.0),
        ("age_max", float("nan")),
        ("age_max", float("inf")),
        ("age_max", -float("inf")),
        ("embedding_dimensions", True),
        ("embedding_dimensions", "512"),
        ("embedding_dimensions", 512.5),
        ("embedding_dimensions", 513.0),
        ("embedding_dimensions", float("nan")),
        ("embedding_dimensions", float("inf")),
        ("available_by_default", 1),
        ("available_by_default", 1.0),
        ("catalog_version", 0.1),
        ("canonical_record_sha256", "wrong"),
    ],
)
def test_actual_documents_invalid_numeric_or_identity_fields_still_fail_closed(
    live, repository, field, value
):
    payload = actual_documents_payload()
    payload["matches"][0][field] = value
    # Simulate non-standard JSON NaN/Infinity responses without serializing through httpx's strict encoder.
    response = httpx.Response(200, content=json.dumps(payload).encode())
    with pytest.raises(retrieval.RetrievalError, match="match_mismatch"):
        retrieval.CatalogRetriever(live, repository)._hydrate(response)
