"""Deterministic child-copy rules adapted from hq_planner/generation/action_quality.py.

These checks catch specific observed writing failures, not all semantic or safety
issues. The writer receives the canonical source and the parent must approve each
locally validated habit. There is no remote habit review or silent copy rewriting.
"""

import re


class ChildCopyError(ValueError):
    """A local rule failure with optional trusted field paths, never rejected text."""

    def __init__(self, code: str, *, fields: tuple[str, ...] = ()):
        super().__init__(code)
        self.fields = fields


def child_word_count(text: str) -> int:
    """Count lexical words, preserving contractions and ordinary hyphenated words."""
    return len(re.findall(r"[^\W_]+(?:['’\-‑][^\W_]+)*", text))


def child_copy_limits(age: int) -> dict[str, int]:
    """Prompt-ready limits shared with local validation; age itself is server-owned."""
    return {
        "instruction_words": 12 if age <= 5 else 20,
        "step_words": 10 if age <= 5 else 14 if age <= 8 else 16 if age <= 10 else 20,
        "min_steps": 2,
        "max_steps": 3 if age <= 5 else 8,
        "step_characters": 180,
    }


def text_values(value):
    """Inspect actual strings, so JSON escaping cannot hide control characters."""
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from text_values(item)
    elif isinstance(value, list):
        for item in value:
            yield from text_values(item)


def validate_child_copy(draft: dict, age: int, source: dict | None = None) -> None:
    """Reject concrete copy/source violations without guessing broad semantic fit.

    Receives a schema-validated HabitDraft dictionary. Parent-only fields may address
    the parent; kid-facing fields must address the child. Help is always available,
    but only actual practice counts as completing an unrelated physical action.
    """
    if type(age) is not int or not 3 <= age <= 13:
        raise ChildCopyError("child_age_invalid")
    if draft["recurrence"] not in {"daily", "weekly"}:
        raise ChildCopyError("unsupported_recurrence")
    values = list(text_values(draft))
    if any(not value.strip() or re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", value) for value in values):
        raise ChildCopyError("copy_is_empty_or_contains_control_characters")
    steps = draft["steps"]
    child_fields = (
        [
            (key, draft[key])
            for key in ("kid_title", "kid_hint", "instruction", "help_text", "cue", "completion")
        ]
        + [(f"steps.{i}", value) for i, value in enumerate(steps)]
        + [(f"materials.{i}", value) for i, value in enumerate(draft["materials"])]
    )
    visible = " ".join(value for _, value in child_fields)
    audience_errors = tuple(
        path
        for path, value in child_fields
        if re.search(r"\b(?:your child|the child|your son|your daughter)\b", value, re.I)
        or (
            source is not None
            and "problem_communication" in source.get("support_targets", [])
            and path.startswith("steps.")
            and re.search(r"\b(?:respond to the signal|offer help or a break)\b", value, re.I)
        )
    )
    if audience_errors:
        raise ChildCopyError("child_fields_address_parent", fields=audience_errors)
    instruction = draft["instruction"].strip()
    if re.search(r"\b(?:offer to|let them|record)\b", instruction, re.I):
        raise ChildCopyError("instruction_is_parent_coaching", fields=("instruction",))
    if re.search(
        r"\b(?:express your feelings|manage your emotions|be emotionally strong|use (?:a |your |the )?(?:coping )?strategy|choose an appropriate response)\b",
        instruction,
        re.I,
    ):
        raise ChildCopyError("instruction_needs_a_named_activity", fields=("instruction",))
    limits = child_copy_limits(age)
    if (
        child_word_count(instruction) > limits["instruction_words"]
        or "\n" in instruction
        or re.search(r"[.!?]\s+\S", instruction)
    ):
        raise ChildCopyError("instruction_needs_one_short_sentence", fields=("instruction",))
    if not limits["min_steps"] <= len(steps) <= limits["max_steps"]:
        raise ChildCopyError("steps_need_an_age_sized_start_and_action", fields=("steps",))
    overlong_steps = tuple(
        f"steps.{i}"
        for i, step in enumerate(steps)
        if child_word_count(step) > limits["step_words"]
        or len(step) > limits["step_characters"]
        or "\n" in step
    )
    if overlong_steps:
        raise ChildCopyError("steps_need_age_sized_instructions", fields=overlong_steps)
    if age <= 8 and re.search(
        r"\b(?:regulat\w*|resilien\w*|self.awareness|reframe|coping strategy|emotional well.being|mindfulness)\b",
        visible,
        re.I,
    ):
        raise ChildCopyError("child_copy_uses_abstract_jargon")
    if re.search(r"[A-Za-z][,;:][A-Za-z]", visible):
        raise ChildCopyError("child_copy_needs_spaces_after_punctuation")
    for index, step in enumerate(steps):
        end = step.strip().rstrip(".!?\"'”’) ")
        # English permits a complete relative clause to end in a preposition
        # ("Point to the part you need help with"). Only clearly unfinished
        # articles/conjunctions are reliable local clipping signals.
        if re.search(r"\b(?:a|an|the|your|my|and|or|if|when)$", end, re.I):
            raise ChildCopyError("step_has_clipped_ending", fields=(f"steps.{index}",))
    if re.search(
        r"\b(?:you (?:feel|are|become) (?:calm|happy|strong|brave)|emotionally strong|control your feelings)\b",
        draft["completion"],
        re.I,
    ):
        raise ChildCopyError("internal_state_is_not_action_completion", fields=("completion",))
    guidance = " ".join(draft["parent_guidance"].values())
    if re.search(r"\b(?:scaffold\w*|co.regulat\w*|validate affect|dysregulat\w*)\b", guidance, re.I):
        raise ChildCopyError("parent_guidance_needs_everyday_words")

    finish = draft["completion"].lower()
    title = draft["title"].lower()
    if re.search(r"\b(?:declin(?:e|es|ed|ing)|skip(?:s|ped|ping)?|not now|not today)\b", finish):
        raise ChildCopyError("completion_includes_nonparticipation", fields=("completion",))
    # Pausing entertainment is itself a concrete action for device-parking goals.
    # Inspect the completion's verb and object, not an incidental title prefix:
    # "Park my device" can validly complete with "You paused the video."
    device_pause = re.search(
        r"\bpaus(?:e|es|ed|ing)\s+(?:(?:the|your|a|one|an)\s+)?"
        r"(?:(?:entertainment|streaming)\s+)?(?:video|game|music|show|device|screen|app|entertainment)\b",
        finish,
    )
    if (
        not device_pause
        and re.search(r"\bpaus(?:e|es|ed|ing)\b", finish)
        and not pause_request_practice(draft, source)
    ):
        raise ChildCopyError("completion_includes_nonparticipation", fields=("completion",))
    if re.search(r"\b(?:watch\w*|observ\w*)\b", finish) and (
        re.search(r"\bor\b", finish) or re.search(r"\bmodel\w*\b", finish)
    ):
        raise ChildCopyError("completion_includes_observation_as_action", fields=("completion",))
    if re.search(r"\bpass(?:es|ed|ing)?\b", finish) and not re.search(
        r"\bpass(?:es|ed|ing)?\s+(?:(?:the|a|your|one)\s+)?(?:ball|beanbag|baton|frisbee|toy|book|card|object)\b",
        finish,
    ):
        raise ChildCopyError("completion_includes_nonparticipation", fields=("completion",))
    request_action = bool(
        re.match(r"(?:ask|request|signal|tell|show|point|use)\b", title)
        and re.search(r"\b(?:help|support|grown-up|adult)\b", title)
    )
    request_in_finish = bool(
        re.search(r"\b(?:ask\w*|request\w*)\b", finish) and re.search(r"\b(?:help|support)\b", finish)
    )
    source_requests = source is not None and bool(
        set(source.get("support_targets", []))
        & {
            "support_request",
            "early_support_request",
            "practical_help_seeking",
            "learning_help_seeking",
            "help_routes",
            "trusted_adult_help",
        }
    )
    # A canonical help-request target can establish communication as the task;
    # asking for help remains available with every unrelated physical action.
    if request_in_finish and not (request_action or source_requests):
        raise ChildCopyError("help_request_does_not_complete_physical_action", fields=("completion",))
    if source is not None:
        validate_source_constraints(draft, age, source)


def pause_request_practice(draft: dict, source: dict | None) -> bool:
    """A source-supported communication signal is practice; merely pausing is not."""
    if source is None or not set(source.get("support_targets", [])) & {
        "problem_communication",
        "body_needs_communication",
        "support_request",
        "early_support_request",
    }:
        return False
    source_copy = " ".join(source.get("kid", {}).get("instructions", []))
    if not re.search(r"\b(?:pause|break)\b", source_copy, re.I):
        return False
    finish = draft["completion"].lower()
    return bool(
        re.fullmatch(
            r"you (?:(?:ask|asked|request|requested|signal|signaled|signalled)(?: (?:your|a|an) (?:grown-up|adult|helper|teacher))? (?:for )?(?:help or )?(?:a )?(?:pause|break)"
            r"|(?:show|showed|use|used|practice|practiced|practise|practised|point to|pointed to) (?:your |a |the |one )?(?:help or )?(?:pause|break)(?: or help)? (?:signal|sign|card|picture|gesture))"
            r"(?: to (?:your |a |the )?(?:grown-up|adult|helper))?[.!]?",
            finish,
        )
    )


def validate_source_constraints(draft: dict, age: int, source: dict) -> None:
    """Enforce precise source limits; parents review broader relevance before approval."""
    if not source["age"]["min"] <= age <= source["age"]["max"]:
        raise ChildCopyError("source_age_mismatch")
    visible = " ".join(text_values(draft))
    if source["research"]["product_efficacy"] == "not_established" and re.search(
        r"\b(?:clinically proven|proven (?:to|effective)|guaranteed (?:to|results)|will cure)\b",
        visible,
        re.I,
    ):
        raise ChildCopyError("source_does_not_establish_efficacy")
    if source["safety"]["care_and_help_unconditional"] and re.search(
        r"\b(?:earn (?:your |a )?(?:meal|food|sleep|help|care)|(?:help|food|sleep|care) only (?:if|when|after)|without (?:any )?help (?:to|for it to) count)\b",
        visible,
        re.I,
    ):
        raise ChildCopyError("source_support_must_stay_available")
    # Canonical timing is an editorial estimate, never a deadline imposed on a child.
    if re.search(
        r"\b(?:finish|complete|hurry)\b[^.!?]{0,50}\b(?:within|in|before)\s+(?:\d+\s*(?:seconds?|minutes?)|the (?:timer|bell))\b",
        draft["instruction"],
        re.I,
    ):
        raise ChildCopyError("source_estimate_is_not_a_deadline")
