"""Explicit provider groups and the fixed existing catalog embedding contract."""

import pytest
from pydantic import ValidationError

from habitquest_backend.config import Settings


def configured(**changes):
    values = dict(
        ai_mode="openai",
        openai_base_url="https://legacy.example/v1",
        openai_model="legacy-model",
        openai_api_key="legacy-test-key",
        planning_openai_api_key="planning-test-key",
        pinecone_api_key="pinecone-test-key",
        pinecone_host="habits.svc.test.pinecone.io",
        catalog_snapshot_pointer="",
    )
    return Settings(_env_file=None, **(values | changes))


def test_disabled_features_do_not_require_other_provider_credentials():
    settings = Settings(_env_file=None, coach_engine="refined")
    assert settings.coach_provider == "legacy"
    assert settings.retrieval_mode == "local"
    assert settings.planning_openai_api_key is None
    assert settings.coach_context_ttl_seconds == 30
    assert settings.coach_context_max_entries == 128
    assert settings.catalog_pointer_path.name == "backend"


def test_settings_diagnostics_do_not_expose_database_or_login_secrets():
    settings = Settings(
        _env_file=None,
        database_url="postgresql://u:private-db-secret@localhost/test",
        dev_login_password="private-login-secret",
    )
    assert "private-db-secret" not in repr(settings)
    assert "private-login-secret" not in repr(settings)
    with pytest.raises(ValidationError) as error:
        Settings(_env_file=None, ai_mode="openai", openai_api_key="private-api-secret")
    assert "private-api-secret" not in str(error.value)


def test_enabled_features_have_separate_validated_groups():
    settings = configured(
        coach_engine="refined",
        coach_provider="planning",
        retrieval_mode="pinecone",
        habit_generation_enabled=True,
    )
    assert settings.coach_model == settings.habit_generation_model == "gpt-6-luna"
    assert settings.openai_embedding_model == "text-embedding-3-small"
    assert settings.openai_embedding_dimensions == 512
    assert settings.catalog_pointer_path.name == "backend"
    assert "planning-test-key" not in repr(settings)
    assert "pinecone-test-key" not in repr(settings)


@pytest.mark.parametrize(
    "url",
    [
        "http://insecure.example/v1",
        "https://",
        "https://u:p@example.com/v1",
        "https://example.com/v1?key=x",
        "https://example.com/v1#fragment",
    ],
)
def test_imported_provider_rejects_insecure_or_credential_bearing_url(url):
    with pytest.raises(ValidationError, match="HTTPS API URL"):
        configured(coach_engine="refined", coach_provider="planning", planning_openai_base_url=url)


@pytest.mark.parametrize("key", [None, "", "   "])
def test_imported_calls_never_fall_back_to_legacy_key(key):
    with pytest.raises(ValidationError, match="PLANNING_OPENAI_API_KEY"):
        configured(habit_generation_enabled=True, planning_openai_api_key=key)


@pytest.mark.parametrize(
    ("switch", "model", "error"),
    [
        ({"coach_engine": "refined", "coach_provider": "planning"}, "coach_model", "COACH_MODEL"),
        ({"habit_generation_enabled": True}, "habit_generation_model", "HABIT_GENERATION_MODEL"),
    ],
)
def test_enabled_generation_needs_a_model(switch, model, error):
    with pytest.raises(ValidationError, match=error):
        configured(**switch, **{model: " "})


@pytest.mark.parametrize(
    ("changes", "error"),
    [
        ({"ai_mode": "fake"}, "requires AI_MODE=openai"),
        ({"pinecone_api_key": None}, "PINECONE_API_KEY"),
        ({"pinecone_api_key": " "}, "PINECONE_API_KEY"),
        ({"pinecone_host": "https://habits.svc.test.pinecone.io"}, "data-plane hostname"),
        ({"catalog_snapshot_pointer": "old/sibling/path.json"}, "CATALOG_SNAPSHOT_POINTER"),
    ],
)
def test_live_retrieval_requires_complete_target_configuration(changes, error):
    with pytest.raises(ValidationError, match=error):
        configured(retrieval_mode="pinecone", **changes)


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("openai_embedding_model", "another-model"),
        ("openai_embedding_dimensions", 1536),
        ("pinecone_index_name", "other"),
        ("pinecone_namespace", "other"),
        ("pinecone_api_version", "2025-10"),
        ("pinecone_metric", "dotproduct"),
        ("pinecone_vector_field", "vector"),
        ("catalog_version", "0.2.0"),
    ],
)
def test_wrong_embedding_space_or_release_is_rejected(name, value):
    with pytest.raises(ValidationError, match="verified embedding/catalog release"):
        configured(retrieval_mode="pinecone", **{name: value})


def test_fake_mode_cannot_reach_live_retrieval_even_with_credentials():
    with pytest.raises(ValidationError, match="fixture use is local"):
        configured(ai_mode="fake", retrieval_mode="pinecone")


def test_imported_coach_cannot_be_silently_ignored_by_legacy_engine():
    with pytest.raises(ValidationError, match="requires COACH_ENGINE=refined"):
        configured(coach_engine="crew", coach_provider="planning")


def test_dotenv_new_names_are_consumed_without_changing_legacy_group(tmp_path):
    path = tmp_path / "settings.env"
    path.write_text(
        "COACH_ENGINE=refined\nCOACH_PROVIDER=planning\nCOACH_MODEL=chosen-model\n"
        "PLANNING_OPENAI_API_KEY=planning-test-key\nOPENAI_API_KEY=legacy-test-key\n"
        "OPENAI_EMBEDDING_DIMENSIONS=512\nPARENT_RISK_MODEL=risk-model\n"
        "OUTPUT_SAFETY_MODEL=review-model\nHABIT_GENERATION_MODEL=writer-model\n"
    )
    settings = Settings(_env_file=path)
    assert settings.coach_model == "chosen-model"
    assert settings.habit_generation_model == "writer-model"
    assert settings.parent_risk_model == "risk-model"
    assert settings.output_safety_model == "review-model"
    assert settings.openai_api_key != settings.planning_openai_api_key


def test_raw_generation_capture_is_explicitly_unsupported():
    with pytest.raises(ValueError, match="not implemented"):
        Settings(_env_file=None, habit_generation_eval_capture=True)
