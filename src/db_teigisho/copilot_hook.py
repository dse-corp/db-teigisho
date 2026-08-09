"""GitHub Copilot hook logic for automatic definition validation."""

from __future__ import annotations

import json
import os
import re
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any, TextIO

from db_teigisho.errors import DefinitionError
from db_teigisho.loader import validate_paths

_DEFINITION_PATH = re.compile(
    r"(?:^|[\\/])(?:definitions|examples)[\\/][^\s'\"]+\.ya?ml\b",
    re.IGNORECASE,
)
_EDIT_TOOLS = {"create", "edit", "apply_patch", "Write", "Edit"}


def _strings(value: object) -> Iterator[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)


def should_validate_after_tool(payload: dict[str, Any]) -> bool:
    """Return whether a Copilot tool call may have edited a definition YAML."""

    tool_name = payload.get("toolName", payload.get("tool_name"))
    if tool_name not in _EDIT_TOOLS:
        return False
    tool_args = payload.get("toolArgs", payload.get("tool_input"))
    return any(_DEFINITION_PATH.search(value) for value in _strings(tool_args))


def _validate_repository(repository: Path) -> tuple[bool, str]:
    targets = [
        repository / name for name in ("definitions", "examples") if (repository / name).is_dir()
    ]
    try:
        results = validate_paths(targets)
    except DefinitionError as error:
        return False, f"Database definition validation could not run: {error}"

    invalid = [result for result in results if not result.valid]
    if invalid:
        details = "\n\n".join(error for result in invalid for error in result.errors)
        return False, f"Database definition validation failed after the edit:\n{details}"[:12_000]
    return True, f"Database definition validation passed ({len(results)} file(s))."


def run_hook(
    payload: dict[str, Any],
    repository: Path,
    *,
    event: str | None = None,
) -> dict[str, Any] | None:
    """Run a native GitHub Copilot hook event and return its JSON response."""

    event_name = event or os.environ.get("DBDEF_HOOK_EVENT")
    if event_name in {"postToolUse", "PostToolUse"}:
        if not should_validate_after_tool(payload):
            return None
        _, message = _validate_repository(repository)
        return {"additionalContext": message}

    if event_name in {"agentStop", "Stop"}:
        valid, message = _validate_repository(repository)
        if valid:
            return {"decision": "allow"}
        if payload.get("stop_hook_active") is True:
            return {"decision": "allow"}
        return {
            "decision": "block",
            "reason": f"Fix the database definition before completing the task.\n\n{message}",
        }
    return None


def main(
    stdin: TextIO = sys.stdin,
    stdout: TextIO = sys.stdout,
    repository: Path | None = None,
    *,
    event: str | None = None,
) -> int:
    """Read one Copilot hook event from stdin and emit one JSON response."""

    try:
        payload = json.load(stdin)
    except (json.JSONDecodeError, UnicodeError) as error:
        print(json.dumps({"additionalContext": f"Invalid hook input: {error}"}), file=stdout)
        return 1
    if not isinstance(payload, dict):
        print(json.dumps({"additionalContext": "Hook input must be a JSON object."}), file=stdout)
        return 1
    response = run_hook(payload, repository or Path.cwd(), event=event)
    if response is not None:
        print(json.dumps(response, ensure_ascii=False), file=stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
