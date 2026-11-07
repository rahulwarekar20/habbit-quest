"""Allowlisted generation diagnostics and correction instructions, never rejected copy.

Pydantic messages and exception reprs may contain model output or private context.
Only static rule codes, known schema paths and known error types leave this module.
"""

from pydantic import ValidationError

from habitquest_backend.action_quality import ChildCopyError

FEEDBACK = {
    "wrong_count": "Return exactly the requested count of complete habit items.",
    "local_safety_rejected": "Rewrite all displayed fields with safe, kind language and no personal details, links, threats or unsafe instructions.",
    "display_markup_rejected": "Use plain text without URLs, HTML or control characters in every displayed field.",
    "duplicate_action": "Choose a different concrete action from the supplied previous actions; changing only a title does not make a new action.",
    "privacy_name_detected": "Use generic child/adult labels only; remove personal names from every field.",
    "schema_unparseable": "Return one complete JSON object matching the supplied schema, with every required field and no extra fields.",
    "schema_invalid": "Correct the listed schema fields and types. Keep all other required fields; respect every schema length and range limit.",
    "validation_failed": "Return a complete valid draft that follows the supplied schema, child-copy limits and canonical source constraints.",
    "child_age_invalid": "Only the supplied server-owned age from 3 to 13 is supported; do not invent or change it.",
    "unsupported_recurrence": "Use only daily or weekly recurrence; the parent chooses actual times and days later.",
    "copy_is_empty_or_contains_control_characters": "Provide nonempty readable text in every required field; remove invisible control characters.",
    "child_fields_address_parent": "Rewrite EVERY listed field directly to the child using YOU/YOUR or an imperative. Each step is the child's action, not the adult's response. Put adult duties only in parent_setup/strategy/parent_guidance. Completion must be one action YOU practiced; keep source allowed_outcomes such as watching, pausing or declining outside completion.",
    "instruction_is_parent_coaching": "Make instruction one action the child can do; move instructions for an adult into parent guidance.",
    "instruction_needs_a_named_activity": "Name a specific physical or communication activity instead of an abstract emotional goal.",
    "instruction_needs_one_short_sentence": "Make instruction one short sentence with no newline, within child_copy_limits.instruction_words.",
    "steps_need_an_age_sized_start_and_action": "Provide between child_copy_limits.min_steps and max_steps, with a clear start and observable action.",
    "steps_need_age_sized_instructions": "Shorten each step to child_copy_limits.step_words and step_characters. Use one readable line per step.",
    "child_copy_uses_abstract_jargon": "Use everyday concrete words the child understands; replace emotional or therapeutic jargon with a named action.",
    "child_copy_needs_spaces_after_punctuation": "Put ordinary spaces after punctuation between words in child-facing text.",
    "step_has_clipped_ending": "Finish every step as a complete instruction; do not leave a dangling article, conjunction or unfinished phrase.",
    "internal_state_is_not_action_completion": "Describe the observable action that happened, not whether the child feels calm, happy, strong or brave.",
    "parent_guidance_needs_everyday_words": "Use everyday parent language such as stay nearby, demonstrate or offer help, instead of clinical jargon.",
    "completion_includes_nonparticipation": "Completion must describe actual practice. Keep declining the practice or taking a break separate from completion. Pausing entertainment is a concrete action for device-pause/parking goals: name its object, e.g. 'You paused the video.' A supported pause-request goal may complete with 'You showed your pause signal.' Do not describe merely pausing an unrelated activity as completion.",
    "completion_includes_observation_as_action": "State the action practiced; watching an adult instead is support, not completion of a different action.",
    "help_request_does_not_complete_physical_action": "For a physical task, completion describes that task. Asking for help remains available separately, unless the canonical goal itself practices asking for help.",
    "source_age_mismatch": "Keep the supplied child age within the canonical source age range; do not propose a different-age source.",
    "source_does_not_establish_efficacy": "Remove claims of proven efficacy, guaranteed outcomes or cures; preserve the canonical research limitations.",
    "source_support_must_stay_available": "Keep food, sleep, care and adult help unconditional; they cannot depend on finishing an action.",
    "source_estimate_is_not_a_deadline": "Treat duration as an estimate for the parent, never a timed deadline imposed on the child.",
}
FIELDS = frozenset(
    (
        "items",
        "emoji_key",
        "title",
        "kid_title",
        "kid_hint",
        "description",
        "instruction",
        "why",
        "parent_setup",
        "strategy",
        "estimated_seconds",
        "steps",
        "materials",
        "help_text",
        "cue",
        "completion",
        "parent_guidance",
        "recurrence",
        "prepare",
        "coach",
        "if_hard",
        "observe",
    )
)
ERROR_TYPES = frozenset(
    (
        "missing",
        "extra_forbidden",
        "string_type",
        "string_too_long",
        "string_too_short",
        "list_type",
        "too_short",
        "too_long",
        "int_type",
        "int_parsing",
        "int_from_float",
        "greater_than_equal",
        "less_than_equal",
        "literal_error",
        "model_type",
        "model_attributes_type",
        "dict_type",
        "value_error",
    )
)


class DraftValidationError(ValueError):
    """A trusted internal rule code; message text is never a model-authored value."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def validation_issue(exc: ValueError) -> dict:
    """Extract safe metadata without exception messages, rejected inputs or contexts."""
    if isinstance(exc, ValidationError):
        paths, types = set(), set()
        for error in exc.errors(include_input=False, include_context=False, include_url=False):
            path = error["loc"]
            # Unknown field names can themselves contain private/generated text.
            if path and all((isinstance(part, int) and 0 <= part <= 99) or part in FIELDS for part in path):
                paths.add(".".join(str(part) for part in path))
            types.add(error["type"] if error["type"] in ERROR_TYPES else "validation_error")
        return {"code": "schema_invalid", "fields": sorted(paths)[:12], "error_types": sorted(types)}
    code = (
        exc.code
        if isinstance(exc, DraftValidationError)
        else str(exc)
        if isinstance(exc, ChildCopyError)
        else "validation_failed"
    )
    issue = {"code": code if code in FEEDBACK else "validation_failed"}
    if isinstance(exc, ChildCopyError):
        copy_paths = [
            path
            for path in exc.fields
            if path and all(part in FIELDS or (part.isdigit() and len(part) <= 2) for part in path.split("."))
        ]
        if copy_paths:
            return {**issue, "fields": sorted(set(copy_paths))[:12]}
    return issue


def correction_feedback(issue: dict) -> str:
    """Give the next writer an actionable rule, without echoing rejected draft text."""
    message = FEEDBACK[issue["code"]]
    if issue.get("fields"):
        message += " Fields: " + ", ".join(issue["fields"]) + "."
    if issue.get("error_types"):
        message += " Schema rules: " + ", ".join(issue["error_types"]) + "."
    return message
