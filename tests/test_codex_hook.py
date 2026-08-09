from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from db_teigisho.codex_hook import run_hook, should_validate


def _payload(command: str, tool_name: str = "apply_patch") -> dict[str, Any]:
    return {"tool_name": tool_name, "tool_input": {"command": command}}


def _write(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")


def test_hook_ignores_unrelated_tool_calls(tmp_path: Path) -> None:
    payload = _payload("*** Update File: README.md")

    assert should_validate(payload) is False
    assert run_hook(payload, tmp_path) is None


def test_hook_reports_success_after_definition_edit(
    tmp_path: Path, valid_definition: dict[str, Any]
) -> None:
    _write(tmp_path / "definitions" / "database.yaml", valid_definition)

    result = run_hook(_payload("*** Update File: definitions/database.yaml"), tmp_path)

    assert result is not None
    context = result["hookSpecificOutput"]["additionalContext"]
    assert "passed (1 file(s))" in context


def test_hook_blocks_progress_when_definition_is_invalid(
    tmp_path: Path, valid_definition: dict[str, Any]
) -> None:
    valid_definition["tables"][0]["columns"][0]["not_null"] = False
    _write(tmp_path / "examples" / "database.yaml", valid_definition)

    result = run_hook(_payload("sed -i '' examples/database.yaml", tool_name="Bash"), tmp_path)

    assert result is not None
    assert result["decision"] == "block"
    assert "primary_key_not_null" in result["hookSpecificOutput"]["additionalContext"]
