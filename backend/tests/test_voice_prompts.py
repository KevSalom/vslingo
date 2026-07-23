"""Tests for voice system prompts and scenario mappings (T06)."""

import pytest

from app.prompts.voice import get_voice_system_prompt


def test_voice_system_prompts_cover_all_scenarios() -> None:
    for scenario in ["daily_standup", "system_design", "salary_negotiation", "free"]:
        prompt = get_voice_system_prompt(scenario)  # type: ignore[arg-type]
        assert isinstance(prompt, str)
        assert len(prompt) > 50
        assert "B1-B2 English" in prompt
        assert "600 characters" in prompt
        assert "Do NOT mention pronunciation" in prompt
        assert "Do NOT give language corrections" in prompt


def test_free_scenario_does_not_mention_software_development() -> None:
    free_prompt = get_voice_system_prompt("free")
    lower = free_prompt.lower()
    assert "software" not in lower
    assert "agile" not in lower
    assert "code" not in lower
    assert "developer" not in lower


def test_invalid_scenario_raises_value_error() -> None:
    with pytest.raises(ValueError, match="Unknown scenario"):
        get_voice_system_prompt("invalid_scenario")  # type: ignore[arg-type]
