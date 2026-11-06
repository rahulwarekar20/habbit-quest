"""Failure diagnostics are useful without retaining model text or private input."""

import pytest
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from habitquest_backend.action_quality import ChildCopyError
from habitquest_backend.generated_habits import DraftOutput, fake_output
from habitquest_backend.generation_validation import (
    FEEDBACK,
    DraftValidationError,
    correction_feedback,
    validation_issue,
)


def test_codes_are_allowlisted_and_unknown_exception_text_is_never_returned():
    secret = "private-child-name secret-provider-response"
    for exc in (ValueError(secret), ChildCopyError(secret), DraftValidationError(secret)):
        assert validation_issue(exc) == {"code": "validation_failed"}
        assert secret not in correction_feedback(validation_issue(exc))
    for code in FEEDBACK:
        issue = validation_issue(DraftValidationError(code))
        assert issue["code"] == code and correction_feedback(issue)
    assert validation_issue(ChildCopyError("step_has_clipped_ending"))["code"] == "step_has_clipped_ending"


def test_schema_diagnostics_include_known_field_paths_but_no_values_or_extra_names():
    raw = fake_output(1).model_dump()
    raw["items"][0]["title"] = "PRIVATE" * 30
    raw["items"][0]["recurrence"] = "SECRET-UNSUPPORTED"
    raw["items"][0]["emoji_key"] = "SECRET-UNSUPPORTED"
    raw["items"][0]["secret-extra-name"] = "secret-value"
    with pytest.raises(ValidationError) as failure:
        DraftOutput.model_validate(raw)
    issue = validation_issue(failure.value)
    assert issue["code"] == "schema_invalid"
    assert issue["fields"] == ["items.0.emoji_key", "items.0.recurrence", "items.0.title"]
    assert issue["error_types"] == ["extra_forbidden", "literal_error", "string_too_long"]
    feedback = correction_feedback(issue)
    assert "items.0.title" in feedback and "SECRET" not in feedback and "PRIVATE" not in str(issue)
    assert "secret-extra-name" not in str(issue)


def test_unrecognized_pydantic_error_types_are_generic():
    class Model(BaseModel):
        model_config = ConfigDict(extra="forbid")
        title: str = Field(pattern="^safe$")

    with pytest.raises(ValidationError) as failure:
        Model(title="do-not-log-this")
    assert validation_issue(failure.value) == {
        "code": "schema_invalid",
        "fields": ["title"],
        "error_types": ["validation_error"],
    }
