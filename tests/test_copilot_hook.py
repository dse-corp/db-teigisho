from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from db_teigisho.copilot_hook import run_hook, should_validate_after_tool


def _write(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")


def _post_tool_payload(path: str) -> dict[str, Any]:
    return {
        "toolName": "edit",
        "toolArgs": {"path": path, "oldText": "before", "newText": "after"},
    }


def test_copilot_hook_ignores_edits_outside_definition_directories(tmp_path: Path) -> None:
    payload = _post_tool_payload("README.md")

    assert should_validate_after_tool(payload) is False
    assert run_hook(payload, tmp_path, event="postToolUse") is None


def test_copilot_post_tool_hook_reports_valid_definition(
    tmp_path: Path, valid_definition: dict[str, Any]
) -> None:
    _write(tmp_path / "definitions" / "database.yaml", valid_definition)

    result = run_hook(
        _post_tool_payload("/workspace/definitions/database.yaml"),
        tmp_path,
        event="postToolUse",
    )

    assert result is not None
    assert result == {"additionalContext": "Database definition validation passed (1 file(s))."}


def test_copilot_post_tool_hook_reports_invalid_definition(
    tmp_path: Path, valid_definition: dict[str, Any]
) -> None:
    valid_definition["tables"][0]["columns"][0]["not_null"] = False
    _write(tmp_path / "examples" / "database.yaml", valid_definition)

    result = run_hook(
        _post_tool_payload("examples/database.yaml"),
        tmp_path,
        event="postToolUse",
    )

    assert result is not None
    assert "validation failed after the edit" in result["additionalContext"]
    assert "primary_key_not_null" in result["additionalContext"]


def test_copilot_agent_stop_blocks_completion_for_invalid_definition(
    tmp_path: Path, valid_definition: dict[str, Any]
) -> None:
    valid_definition["tables"][0]["columns"][0]["not_null"] = False
    _write(tmp_path / "definitions" / "database.yaml", valid_definition)

    result = run_hook(
        {"stopReason": "end_turn", "stop_hook_active": False},
        tmp_path,
        event="agentStop",
    )

    assert result is not None
    assert result["decision"] == "block"
    assert "primary_key_not_null" in result["reason"]


def test_copilot_agent_stop_allows_one_failed_retry_to_avoid_a_loop(
    tmp_path: Path, valid_definition: dict[str, Any]
) -> None:
    valid_definition["tables"][0]["columns"][0]["not_null"] = False
    _write(tmp_path / "definitions" / "database.yaml", valid_definition)

    result = run_hook(
        {"stopReason": "end_turn", "stop_hook_active": True},
        tmp_path,
        event="agentStop",
    )

    assert result == {"decision": "allow"}


def test_copilot_agent_stop_allows_completion_for_valid_definition(
    tmp_path: Path, valid_definition: dict[str, Any]
) -> None:
    _write(tmp_path / "examples" / "database.yaml", valid_definition)

    result = run_hook(
        {"stopReason": "end_turn", "stop_hook_active": False},
        tmp_path,
        event="agentStop",
    )

    assert result == {"decision": "allow"}
