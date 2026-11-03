"""The coach crew: each agent, the review loop, and how failures degrade."""

import json
import threading

import httpx
import pytest
from pydantic import ValidationError

from habitquest_backend import crew, llm
from habitquest_backend.ai import Candidate
from habitquest_backend.coach import run_turn
from habitquest_backend.coach_tools import Snapshot
from habitquest_backend.config import Settings
from habitquest_backend.guidance import CHUNKS
from habitquest_backend.onboarding import MAX_ACTIVE_HABITS

BEDTIME = [
    {"id": "bedtime", "title": "Get to bed early", "tier": 1},
    {"id": "story-time", "title": "Share a book", "tier": 1},
]
MEALS = [{"id": "wash-hands", "title": "Wash hands", "tier": 1}]
GOALS = [
    Candidate("bedtime", "Calmer bedtimes", "Bed on time.", ["bedtime"], BEDTIME),
    Candidate("meals", "Happier mealtimes", "Calm meals.", ["meals"], MEALS),
]
PLAN = {"homework": {"title": "Homework", "cue_time": "16:00", "status": "active"}}
TEXT = "Alex keeps stalling at bedtime"
TRIAGE = {
    "intent": "new_problem",
    "problem": "Child A stalls at bedtime",
    "queries": ["bedtime stalling"],
    "question": "",
}
FOUND = crew.passages(["bedtime stalling", "Child A stalls at bedtime"], 8)
REF = FOUND[0].ref
BRIEF = {"points": [{"ref": REF, "point": "A steady routine helps."}]}
SAFE = {"safe": True, "problems": []}
FITS = {"poor_fit": []}


def snapshot(**overrides):
    values = {"age": 8, "goals": GOALS, "plan": dict(PLAN), "approved_days": {"homework": 3}}
    return Snapshot(**(values | overrides))


def plan(
    reply=f"A routine helps [{REF}]. The cards can help.",
    cards=(("bedtime", "Child A needs a clear end."),),
    changes=(),
):
    return {
        "reply": reply,
        "cards": [{"habit_id": h, "reason": r} for h, r in cards],
        "changes": [{"habit_id": h, "action": a, "cue_time": t, "reason": r} for h, a, t, r in changes],
    }


@pytest.fixture
def crew_settings(remote):
    return remote.model_copy(update={"coach_engine": "crew", "openai_safety_model": "vendor/safety"})


@pytest.fixture
def agents(monkeypatch):
    """Answers each structured call by its schema's name, since parallel agents call in any order. Each name takes
    a list of replies, used in turn, the last repeated; `.seen` holds each name's request bodies.
    """
    replies: dict[str, list] = {}
    seen: dict[str, list[dict]] = {}
    lock = threading.Lock()

    def respond(request):
        body = json.loads(request.content)
        name = body["response_format"]["json_schema"]["name"]
        with lock:
            seen.setdefault(name, []).append(body)
            queue = replies.get(name, [{"risk": False, "reason": ""}] if name == "ParentRisk" else None)
            assert queue is not None, f"no reply for {name}"
            reply = queue.pop(0) if len(queue) > 1 else queue[0]
        if isinstance(reply, httpx.Response):
            return reply
        message = {"role": "assistant", "content": json.dumps(reply)}
        return httpx.Response(
            200,
            json={
                "id": "x",
                "object": "chat.completion",
                "created": 0,
                "model": "m",
                "choices": [{"index": 0, "finish_reason": "stop", "message": message}],
            },
        )

    monkeypatch.setattr(
        llm, "http_client", lambda settings: httpx.Client(transport=httpx.MockTransport(respond))
    )

    def route(**named):
        replies.update(
            {name: list(value) if isinstance(value, list) else [value] for name, value in named.items()}
        )

    route.seen = seen
    return route


def everything(agents, **overrides):
    agents(
        **{
            "Triage": TRIAGE,
            "Brief": BRIEF,
            "Patterns": {"patterns": ["Homework is rarely done."]},
            "Plan": plan(),
            "Fit": FITS,
            "SafetyVerdict": SAFE,
        }
        | overrides
    )


FAIL = httpx.Response(400, json={"error": "no"})


# ── Pieces ────────────────────────────────────────────────────────────────────


def test_roles_take_overrides_and_settings_refuse_bad_ones():
    settings = Settings(_env_file=None, crew_roles="planner:large:low, fit:small:high")
    found = crew.roles(settings)
    assert found["planner"] == crew.Role("large", "low") and found["fit"] == crew.Role("small", "high")
    assert found["triage"] == crew.ROLES["triage"]
    with pytest.raises(ValidationError, match="role:size:effort"):
        Settings(_env_file=None, crew_roles="planner:huge:low")


def test_only_citations_of_the_brief_are_kept():
    text = "Try this [G1, G9]. Also this [G7]. A [note] stays [G3,G3]."
    assert crew.keep_cited(text, {"G1", "G3"}) == "Try this [G1]. Also this. A [note] stays [G3]."


def test_passages_take_each_query_in_turn_without_repeats():
    found = crew.passages(["bedtime stalling", "bedtime stalling", "screen time tantrum"], 8)
    refs = [c.ref for c in found]
    assert len(refs) == len(set(refs)) <= crew.MAX_PASSAGES
    assert refs[0] == FOUND[0].ref and crew.passages([], 8) == []


def test_progress_facts_count_exactly_and_use_titles():
    checkins = [
        {"mood": "hard", "hardest": "homework", "favorite": None},
        {"mood": "hard", "hardest": "homework", "favorite": "bedtime"},
    ]
    facts = crew.progress_facts(snapshot(checkins=checkins))
    assert facts["plan"] == [{"habit": "Homework", "time": "16:00", "status": "active", "approved_days": 3}]
    assert facts["moods"] == {"hard": 2} and facts["trickiest"] == {"Homework": 2}
    assert facts["favourite"] == {"Get to bed early": 1} and facts["checkins"] == 2


def test_the_conversation_names_who_said_what():
    from langchain_core.messages import AIMessage, HumanMessage

    text = crew.conversation(
        [HumanMessage(content="Hi"), AIMessage(content="Hello"), HumanMessage(content="[App] Accepted")]
    )
    assert text == "Parent: Hi\nCoach: Hello\nApp: Accepted"


# ── A whole turn ──────────────────────────────────────────────────────────────


def test_a_full_turn_runs_every_agent_and_restores_names(crew_settings, agents):
    changes = (
        ("homework", "retime", "5pm", "Bad time."),
        ("homework", "retime", "17:30", "Child A is tired at 4."),
    )
    everything(agents, Plan=plan(changes=changes))
    reply = run_turn(crew_settings, snapshot(), [{"role": "coach", "content": "Hi Alex"}], TEXT, ["Alex"])
    assert reply.mapped_by == "ai" and reply.text == f"A routine helps [{REF}]. The cards can help."
    assert reply.turn.recommendations == {"bedtime": "Alex needs a clear end."}
    assert [(c.kind, c.cue_time, c.reason) for c in reply.turn.changes] == [
        ("retime", "17:30", "Alex is tired at 4.")
    ]
    assert list(reply.turn.sources) == [REF] and not reply.no_habit_match
    sent = json.dumps(agents.seen)
    assert "Alex" not in sent and "Child A keeps stalling" in sent
    assert agents.seen["Plan"][0]["model"] == "vendor/model"
    assert agents.seen["Triage"][0]["model"] == "vendor/small"
    assert agents.seen["SafetyVerdict"][0]["model"] == "vendor/safety"
    assert agents.seen["Plan"][0]["reasoning_effort"] == "medium"
    schema = json.dumps(agents.seen["Plan"][0]["response_format"])
    assert (
        '"bedtime"' in schema
        and '"homework"' in schema
        and agents.seen["Plan"][0]["response_format"]["json_schema"]["strict"]
    )
    planner_input = json.dumps(agents.seen["Plan"][0]["messages"])
    assert "Homework is rarely done." in planner_input and "story-time: Share a book, tier 1" in planner_input


def test_the_fit_check_sees_titles_but_not_the_planners_reasons(crew_settings, agents):
    everything(agents, Plan=plan(cards=[("bedtime", "A persuasive reason.")]))
    run_turn(crew_settings, snapshot(), [], TEXT, ["Alex"])
    fit = json.dumps(agents.seen["Fit"][0]["messages"])
    assert "Get to bed early (Calmer bedtimes)" in fit and "persuasive" not in fit


def test_a_clarifying_question_ends_the_turn_after_triage(crew_settings, agents):
    agents(Triage=TRIAGE | {"intent": "clarify", "queries": [], "question": "When does it happen?"})
    reply = run_turn(crew_settings, snapshot(), [], "Evenings are hard", ["Alex"])
    assert reply.text == "When does it happen?" and list(agents.seen) == ["ParentRisk", "Triage"]
    assert not reply.no_habit_match and reply.turn.recommendations == {}


def test_clarify_without_a_question_carries_on(crew_settings, agents):
    everything(agents, Triage=TRIAGE | {"intent": "clarify"})
    assert run_turn(crew_settings, snapshot(), [], TEXT, ["Alex"]).turn.recommendations


def test_a_failed_triage_treats_the_message_as_a_new_problem(crew_settings, agents):
    everything(agents, Triage=FAIL)
    reply = run_turn(crew_settings, snapshot(), [], TEXT, ["Alex"])
    assert reply.mapped_by == "ai" and reply.turn.recommendations
    assert "Child A keeps stalling" in json.dumps(agents.seen["Plan"][0]["messages"])


def test_research_without_passages_skips_the_brief(crew_settings, agents):
    nothing = TRIAGE | {"problem": "zzqx", "queries": ["qqzz"]}
    everything(agents, Triage=nothing, Plan=plan(reply="General ideas [G1].", cards=()))
    reply = run_turn(crew_settings, snapshot(), [], "zzqx qqzz", ["Alex"])
    assert "Brief" not in agents.seen and reply.text == "General ideas."
    assert reply.no_habit_match and "(none found)" in json.dumps(agents.seen["Plan"][0]["messages"])


def test_a_failed_brief_passes_the_passages_on(crew_settings, agents):
    everything(agents, Brief=FAIL)
    run_turn(crew_settings, snapshot(), [], TEXT, ["Alex"])
    assert FOUND[0].text[:40] in json.dumps(agents.seen["Plan"][0]["messages"])


def test_progress_needs_no_model_without_data_and_survives_a_failure(crew_settings, agents):
    everything(agents)
    run_turn(crew_settings, snapshot(plan={}), [], TEXT, ["Alex"])
    assert "Patterns" not in agents.seen
    everything(agents, Patterns=FAIL)
    assert run_turn(crew_settings, snapshot(), [], TEXT, ["Alex"]).mapped_by == "ai"


def test_the_plan_schema_only_offers_what_the_child_can_take(crew_settings, agents):
    everything(agents, Plan={"reply": "Tips only."})
    taken = {"bedtime", "story-time", "wash-hands"}
    reply = run_turn(crew_settings, snapshot(plan={}, shown=taken), [], TEXT, ["Alex"])
    schema = agents.seen["Plan"][0]["response_format"]["json_schema"]["schema"]
    assert set(schema["properties"]) == {"reply"} and reply.no_habit_match
    assert "choose no cards" in json.dumps(agents.seen["Plan"][0]["messages"])
    full = {
        f"h{i}": {"title": f"H{i}", "cue_time": "08:00", "status": "active"} for i in range(MAX_ACTIVE_HABITS)
    }
    everything(agents, Plan={"reply": "Tips only.", "changes": []})
    run_turn(crew_settings, snapshot(plan=full), [], TEXT, ["Alex"])
    assert "cards" not in agents.seen["Plan"][-1]["response_format"]["json_schema"]["schema"]["properties"]


def test_a_failed_plan_falls_back_to_keywords(crew_settings, agents):
    everything(agents, Plan=FAIL)
    assert run_turn(crew_settings, snapshot(), [], TEXT, ["Alex"]).mapped_by == "keywords"


# ── Review ────────────────────────────────────────────────────────────────────


def test_a_poor_fit_sends_the_planner_back_once(crew_settings, agents):
    first = plan(reply="Two habits.", cards=[("bedtime", "Fits."), ("wash-hands", "Stretch.")])
    everything(agents, Plan=[first, plan(reply="One habit.")], Fit=[{"poor_fit": ["wash-hands"]}, FITS])
    snap = snapshot()
    reply = run_turn(crew_settings, snap, [], TEXT, ["Alex"])
    assert reply.text == "One habit." and list(reply.turn.recommendations) == ["bedtime"]
    assert "wash-hands" in snap.shown and len(agents.seen["Plan"]) == 2
    second = json.dumps(agents.seen["Plan"][1]["messages"])
    assert "Wash hands (Happier mealtimes)" in second and "Revise your answer" in second
    assert "wash-hands" not in json.dumps(agents.seen["Plan"][1]["response_format"])


def test_picks_failing_the_second_check_are_dropped(crew_settings, agents):
    everything(
        agents,
        Plan=[
            plan(cards=[("bedtime", "R")]),
            plan(reply="Try this. The card helps.", cards=[("story-time", "R")]),
        ],
        Fit=[{"poor_fit": ["bedtime"]}, {"poor_fit": ["story-time"]}],
    )
    reply = run_turn(crew_settings, snapshot(), [], TEXT, ["Alex"])
    assert reply.turn.recommendations == {} and reply.no_habit_match and reply.text == "Try this."
    assert len(agents.seen["Plan"]) == 2


def test_a_failed_fit_check_drops_the_picks(crew_settings, agents):
    everything(agents, Fit=FAIL)
    reply = run_turn(crew_settings, snapshot(), [], TEXT, ["Alex"])
    assert reply.turn.recommendations == {} and len(agents.seen["Plan"]) == 1


def test_no_cards_means_no_fit_check(crew_settings, agents):
    everything(agents, Plan=plan(reply="Tips.", cards=()))
    run_turn(crew_settings, snapshot(), [], TEXT, ["Alex"])
    assert "Fit" not in agents.seen


def test_an_unsafe_reply_is_rewritten(crew_settings, agents):
    everything(
        agents,
        Plan=[plan(reply="Take their points away."), plan(reply="Calm limits help.")],
        SafetyVerdict=[{"safe": False, "problems": ["2 taking rewards"]}, SAFE],
    )
    reply = run_turn(crew_settings, snapshot(), [], TEXT, ["Alex"])
    assert reply.text == "Calm limits help."
    assert "2 taking rewards" in json.dumps(agents.seen["Plan"][1]["messages"])


def test_a_reply_unsafe_twice_is_replaced(crew_settings, agents):
    everything(agents, SafetyVerdict={"safe": False, "problems": []})
    reply = run_turn(crew_settings, snapshot(), [], TEXT, ["Alex"])
    assert reply.text == crew.SAFE_REPLY and reply.turn.recommendations
    everything(agents, Plan=plan(cards=()), SafetyVerdict={"safe": False, "problems": ["1 diagnosis"]})
    reply = run_turn(crew_settings, snapshot(), [], TEXT, ["Alex"])
    assert reply.text.startswith("Could you tell me") and "1 diagnosis" in json.dumps(agents.seen["Plan"][-1])


def test_a_failed_safety_check_holds_the_reply_back(crew_settings, agents):
    everything(agents, SafetyVerdict=FAIL)
    reply = run_turn(crew_settings, snapshot(), [], TEXT, ["Alex"])
    assert reply.text == crew.SAFE_REPLY and reply.turn.recommendations and len(agents.seen["Plan"]) == 1
    everything(agents, SafetyVerdict=FAIL, Plan=plan(cards=()))
    reply = run_turn(crew_settings, snapshot(), [], TEXT, ["Alex"])
    assert reply.text == crew.UNCHECKED_REPLY and not reply.turn.recommendations


def test_chunks_exist_for_the_tests():
    assert FOUND and REF in {c.ref for c in CHUNKS}


def test_the_safety_model_reads_the_message_first_with_labels(crew_settings, agents):
    everything(agents, ParentRisk={"risk": True, "reason": "possible abuse"})
    reply = run_turn(
        crew_settings, snapshot(), [{"role": "parent", "content": "Alex is scared"}], TEXT, ["Alex"]
    )
    assert reply.safety and list(agents.seen) == ["ParentRisk"]
    sent = json.dumps(agents.seen["ParentRisk"][0])
    assert "Child A is scared" in sent and "Alex" not in sent
    assert agents.seen["ParentRisk"][0]["model"] == "vendor/safety"
