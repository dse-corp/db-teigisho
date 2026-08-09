"""Codex PostToolUse hook logic for automatic definition validation."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, TextIO

from db_teigisho.errors import DefinitionError
from db_teigisho.loader import validate_paths

_DEFINITION_PATH = re.compile(r"(?:^|[\s'\"/:])(?:definitions|examples)/[^\s'\"]+\.ya?ml\b", re.I)


def should_validate(payload: dict[str, Any]) -> bool:
    """Return whether a completed tool call may have changed a definition YAML."""

    if payload.get("tool_name") not in {"apply_patch", "Bash"}:
        return False
    tool_input = payload.get("tool_input")
    if not isinstance(tool_input, dict):
        return False
    command = tool_input.get("command")
    return isinstance(command, str) and _DEFINITION_PATH.search(command) is not None


def run_hook(payload: dict[str, Any], repository: Path) -> dict[str, Any] | None:
    """Validate definition directories and return Codex hook feedback."""

    if not should_validate(payload):
        return None
    targets = [
        repository / name for name in ("definitions", "examples") if (repository / name).is_dir()
    ]
    try:
        results = validate_paths(targets)
    except DefinitionError as error:
        message = f"Database definition validation could not run: {error}"
        return {
            "decision": "block",
            "reason": message,
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": message,
            },
        }

    invalid = [result for result in results if not result.valid]
    if invalid:
        details = "\n\n".join(error for result in invalid for error in result.errors)
        message = f"Database definition validation failed after the edit:\n{details}"[:12_000]
        return {
            "decision": "block",
            "reason": "Fix the invalid database definition before continuing.",
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": message,
            },
        }
    return {
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": f"Database definition validation passed ({len(results)} file(s)).",
        }
    }


def main(
    stdin: TextIO = sys.stdin,
    stdout: TextIO = sys.stdout,
    repository: Path | None = None,
) -> int:
    """Read a Codex hook event from stdin and emit JSON feedback."""

    try:
        payload = json.load(stdin)
    except (json.JSONDecodeError, UnicodeError) as error:
        print(json.dumps({"systemMessage": f"Invalid hook input: {error}"}), file=stdout)
        return 1
    if not isinstance(payload, dict):
        print(json.dumps({"systemMessage": "Hook input must be a JSON object."}), file=stdout)
        return 1
    root = repository or Path.cwd()
    response = run_hook(payload, root)
    if response is not None:
        print(json.dumps(response, ensure_ascii=False), file=stdout)
    return 0
