"""Replay actual synthetic failures against explicit field audiences and completion rules."""

import json
from copy import deepcopy
from pathlib import Path

import pytest

from habitquest_backend.action_quality import ChildCopyError, validate_child_copy
from habitquest_backend.generated_habits import WRITER_PROMPT, DraftOutput, HabitDraft, validate_drafts
from habitquest_backend.generation_validation import correction_feedback, validation_issue
from habitquest_backend.planning_catalog import CatalogRepository

FIXTURE = json.loads((Path(__file__).parent / "fixtures/habit_audience_regression.json").read_text())


def canonical():
    return CatalogRepository().get(FIXTURE["goal_id"]).evidence()


@pytest.mark.parametrize(
    "index,paths",
    [
        (0, ["items.0.completion", "items.0.steps.1", "items.0.steps.2"]),
        (1, ["items.0.completion", "items.0.cue"]),
    ],
)
def test_actual_synthetic_writer_failures_identify_all_offending_audience_fields(index, paths):
    output = DraftOutput.model_validate(FIXTURE["failed_writer_payloads"][index])
    with pytest.raises(ChildCopyError) as failure:
        validate_drafts(output, 8, 1, [], canonical())
    issue = validation_issue(failure.value)
    assert issue == {"code": "child_fields_address_parent", "fields": paths}
    feedback = correction_feedback(issue)
    assert all(path in feedback for path in paths)
    assert "YOU/YOUR" in feedback and "allowed_outcomes" in feedback
    assert output.model_dump(exclude_unset=True) == FIXTURE["failed_writer_payloads"][index]


def test_concrete_corrected_signal_practice_passes_all_current_local_checks():
    output = DraftOutput.model_validate(FIXTURE["corrected_example"])
    assert validate_drafts(output, 8, 1, [], canonical()) == [
        {"emoji_key": "sparkles", **item} for item in FIXTURE["corrected_example"]["items"]
    ]


@pytest.mark.parametrize("age", range(3, 14))
def test_corrected_child_copy_obeys_all_supported_age_word_and_step_limits(age):
    draft = deepcopy(FIXTURE["corrected_example"]["items"][0])
    draft["completion"] = "You showed your help signal."
    validate_child_copy(draft, age)


@pytest.mark.parametrize(
    "completion",
    [
        "You asked for a pause.",
        "You signaled for help or a pause.",
        "You showed your help or pause signal.",
        "You used a pause card.",
        "You show your pause signal.",
        "You asked your grown-up for a pause.",
    ],
)
def test_source_supported_pause_request_is_an_observable_practice(completion):
    draft = deepcopy(FIXTURE["corrected_example"]["items"][0])
    draft["completion"] = completion
    validate_child_copy(draft, 8, canonical())


@pytest.mark.parametrize(
    "completion",
    [
        "You paused the task.",
        "You took a pause.",
        "You showed your pause signal or paused.",
        "You showed your pause signal or declined.",
        "You watched the model or showed your pause signal.",
        "You observed a help signal or practiced it.",
        "You practiced or skipped the signal.",
    ],
)
def test_decline_observation_and_plain_pause_still_do_not_count(completion):
    draft = deepcopy(FIXTURE["corrected_example"]["items"][0])
    draft["completion"] = completion
    with pytest.raises(ChildCopyError) as failure:
        validate_child_copy(draft, 8, canonical())
    assert str(failure.value) in {
        "completion_includes_nonparticipation",
        "completion_includes_observation_as_action",
    }
    assert validation_issue(failure.value)["fields"] == ["completion"]


@pytest.mark.parametrize("change", ["unrelated_target", "no_source_pause"])
def test_pause_request_exception_requires_precise_source_support(change):
    source = canonical()
    if change == "unrelated_target":
        source["support_targets"] = ["skill_practice"]
    else:
        source["kid"]["instructions"] = ["Put a shirt in your basket."]
    with pytest.raises(ChildCopyError, match="nonparticipation"):
        validate_child_copy(FIXTURE["corrected_example"]["items"][0], 8, source)


def test_schema_and_prompt_define_the_audience_before_generation():
    schema = HabitDraft.model_json_schema()
    child_fields = (
        "kid_title",
        "kid_hint",
        "instruction",
        "steps",
        "materials",
        "help_text",
        "cue",
        "completion",
    )
    parent_fields = (
        "title",
        "description",
        "why",
        "parent_setup",
        "strategy",
        "estimated_seconds",
        "parent_guidance",
    )
    assert all("CHILD-facing" in schema["properties"][name]["description"] for name in child_fields)
    assert all("PARENT-facing" in schema["properties"][name]["description"] for name in parent_fields)
    assert schema["properties"]["steps"]["minItems"] == 2
    assert "ONE observable" in schema["properties"]["completion"]["description"]
    assert "practice.allowed_outcomes" in WRITER_PROMPT and "NOT a list" in WRITER_PROMPT
    assert "child_copy_limits for ALL ages" in WRITER_PROMPT


def test_unknown_child_copy_field_paths_cannot_leak_generated_text():
    issue = validation_issue(
        ChildCopyError(
            "child_fields_address_parent", fields=("items.0.cue", "PRIVATE.child.name", "", "items.100.steps")
        )
    )
    assert issue == {"code": "child_fields_address_parent", "fields": ["items.0.cue"]}


def test_parent_brevity_is_soft_and_does_not_remove_required_habit_fields():
    assert "why at most 20 words" in WRITER_PROMPT
    assert "parent_setup at most 30" in WRITER_PROMPT and "strategy at most 25" in WRITER_PROMPT
    assert "roughly 15-20 words" in WRITER_PROMPT and "soft brevity targets" in WRITER_PROMPT
    assert "support, opt-out, accessibility" in WRITER_PROMPT
    assert "all child instructions complete" in WRITER_PROMPT
    # Complete locally checked content remains valid; no new truncation/word-limit repair is introduced.
    output = DraftOutput.model_validate(FIXTURE["corrected_example"])
    assert validate_drafts(output, 8, 1, [], canonical()) == [
        {"emoji_key": "sparkles", **item} for item in FIXTURE["corrected_example"]["items"]
    ]


def test_icon_schema_is_bounded_strict_and_keeps_legacy_drafts_readable():
    from openai.lib._pydantic import to_strict_json_schema

    schema = to_strict_json_schema(DraftOutput)["$defs"]["HabitDraft"]
    assert "emoji_key" in schema["required"]
    assert "default" not in schema["properties"]["emoji_key"]
    assert "pencil" in schema["properties"]["emoji_key"]["enum"]
    assert HabitDraft.model_validate(FIXTURE["corrected_example"]["items"][0]).emoji_key == "sparkles"
