"""Observable, readable child instructions preserve the prototype's practical guards."""

from copy import deepcopy

import pytest

from habitquest_backend.action_quality import (
    ChildCopyError,
    child_copy_limits,
    child_word_count,
    text_values,
    validate_child_copy,
)


def draft(**changes):
    return {
        "title": "Pass a ball",
        "kid_title": "Pass a ball",
        "kid_hint": "Try a gentle pass.",
        "description": "Your child can practice with support.",
        "instruction": "Pass a soft ball to your grown-up.",
        "why": "Your child can enjoy taking turns.",
        "parent_setup": "Choose a soft ball.",
        "strategy": "Turn taking",
        "estimated_seconds": 60,
        "steps": ["Choose a soft ball together.", "Pass the ball to your grown-up."],
        "materials": ["A soft ball"],
        "help_text": "You can ask for help or a break anytime.",
        "cue": "When you choose to play together.",
        "completion": "You passed the ball to your grown-up.",
        "parent_guidance": {
            "prepare": "Choose an open space.",
            "coach": "Stay close and demonstrate.",
            "if_hard": "Pause and offer help.",
            "observe": "Notice the attempt.",
        },
        "recurrence": "daily",
        **changes,
    }


def source(**changes):
    return {
        "age": {"min": 3, "max": 13},
        "research": {"product_efficacy": "not_established"},
        "safety": {"care_and_help_unconditional": True},
        "support_targets": [],
        **changes,
    }


@pytest.mark.parametrize(
    "age,step_limit", [(3, 10), (5, 10), (6, 14), (8, 14), (9, 16), (10, 16), (11, 20), (13, 20)]
)
def test_supported_ages_limits_and_parent_fields(age, step_limit):
    item = draft()
    before = deepcopy(item)
    validate_child_copy(item, age, source())
    assert item == before
    assert child_copy_limits(age)["step_words"] == step_limit
    # At the exact age-sized boundary succeeds; one word more fails.
    item["steps"] = [" ".join(["word"] * step_limit), "Try it together."]
    validate_child_copy(item, age)
    item["steps"][0] += " more"
    with pytest.raises(ChildCopyError, match="age_sized_instructions"):
        validate_child_copy(item, age)


def test_word_count_and_raw_text_walk():
    assert child_word_count("Let's try a grown-up's soft-ball game.") == 6
    assert list(text_values({"x": ["hello", {"y": "world"}, 3], "duration": 60})) == ["hello", "world"]


@pytest.mark.parametrize(
    "change,code",
    [
        ({"recurrence": "monthly"}, "recurrence"),
        ({"steps": ["  ", "Try together."]}, "empty"),
        ({"help_text": "Ask for\x01help."}, "control"),
        ({"kid_title": "Help your child"}, "address_parent"),
        ({"instruction": "Offer to pass the ball."}, "parent_coaching"),
        ({"instruction": "Manage your emotions."}, "named_activity"),
        ({"instruction": "Try this. Then try that."}, "short_sentence"),
        ({"instruction": "Try this\nwith help."}, "short_sentence"),
        ({"instruction": " ".join(["word"] * 21)}, "short_sentence"),
        ({"steps": ["Try it."]}, "start_and_action"),
        ({"steps": ["Try it."] * 9}, "start_and_action"),
        ({"steps": ["x" * 181, "Try together."]}, "age_sized"),
        ({"steps": ["Try this\nwith help.", "Try together."]}, "age_sized"),
        ({"steps": ["Use your mindfulness skills.", "Try together."]}, "abstract_jargon"),
        ({"kid_hint": "Try,then ask."}, "spaces"),
        ({"steps": ["Put the ball beside the.", "Try together."]}, "clipped"),
        ({"completion": "You feel calm."}, "internal_state"),
        (
            {
                "parent_guidance": {
                    "prepare": "Scaffold the task.",
                    "coach": "Help.",
                    "if_hard": "Pause.",
                    "observe": "Look.",
                }
            },
            "everyday_words",
        ),
        ({"completion": "You declined the activity."}, "nonparticipation"),
        ({"completion": "You said not now."}, "nonparticipation"),
        ({"completion": "You paused the activity."}, "nonparticipation"),
        ({"completion": "You watched the model."}, "observation"),
        ({"completion": "You observed or tried the step."}, "observation"),
        ({"completion": "You passed."}, "nonparticipation"),
        ({"completion": "You asked for help."}, "physical_action"),
    ],
)
def test_known_copy_failures_are_explicit_and_never_rewritten(change, code):
    item = draft(**change)
    before = deepcopy(item)
    with pytest.raises(ChildCopyError, match=code):
        validate_child_copy(item, 8)
    assert item == before


@pytest.mark.parametrize("age", [True, 2, 14])
def test_invalid_age_rejected(age):
    with pytest.raises(ChildCopyError, match="age_invalid"):
        validate_child_copy(draft(), age)


def test_preschool_limits_and_older_vocabulary():
    with pytest.raises(ChildCopyError, match="short_sentence"):
        validate_child_copy(draft(instruction=" ".join(["word"] * 13)), 3)
    with pytest.raises(ChildCopyError, match="start_and_action"):
        validate_child_copy(draft(steps=["Try it together."] * 4), 5)
    validate_child_copy(draft(kid_hint="Try a mindfulness practice."), 11)


def test_pause_real_device_physical_pass_and_help_request_are_distinct():
    validate_child_copy(draft(title="Pause a video", completion="You paused the video."), 8)
    validate_child_copy(draft(completion="You passed a beanbag to your grown-up."), 8)
    validate_child_copy(draft(title="Ask for help", completion="You asked for help."), 8)
    # Observation can be the concrete activity (e.g. look at an object), not a pass route.
    validate_child_copy(draft(title="Look at one leaf", completion="You observed one leaf."), 8)
    validate_child_copy(
        draft(title="Practice a help request", completion="You asked for support."),
        8,
        source(support_targets=["support_request"]),
    )


@pytest.mark.parametrize(
    "completion",
    [
        "You paused the video and parked your device.",
        "You paused your game for the agreed meal.",
        "You paused entertainment while keeping needed communication available.",
    ],
)
def test_device_parking_completion_does_not_depend_on_title_prefix(completion):
    validate_child_copy(draft(title="Park my device", completion=completion), 12, source())


@pytest.mark.parametrize(
    "completion", ["You paused the activity.", "You declined the practice.", "You skipped the practice."]
)
def test_device_title_does_not_turn_nonparticipation_into_completion(completion):
    with pytest.raises(ChildCopyError, match="completion_includes_nonparticipation"):
        validate_child_copy(draft(title="Pause a video", completion=completion), 12, source())


@pytest.mark.parametrize(
    "change,card,code",
    [
        ({}, source(age={"min": 9, "max": 13}), "source_age"),
        ({"why": "This is clinically proven."}, source(), "efficacy"),
        ({"parent_setup": "Give help only after completing the task."}, source(), "support"),
        ({"instruction": "Finish this in 30 seconds."}, source(), "deadline"),
    ],
)
def test_precise_canonical_source_limits(change, card, code):
    with pytest.raises(ChildCopyError, match=code):
        validate_child_copy(draft(**change), 8, card)


def test_conditional_source_rules_do_not_invent_universal_claims():
    validate_child_copy(
        draft(why="This is clinically proven."), 8, source(research={"product_efficacy": "established"})
    )
    validate_child_copy(
        draft(parent_setup="Give help only after completing the task."),
        8,
        source(safety={"care_and_help_unconditional": False}),
    )


@pytest.mark.parametrize(
    "step",
    [
        "Point to the part you need help with.",
        "Choose the friend to pass the ball to.",
        "Choose a toy to look at.",
        "Choose a game to get ready for.",
    ],
)
def test_complete_relative_clause_may_end_in_a_preposition(step):
    validate_child_copy(draft(steps=["Choose your grown-up.", step]), 8)
