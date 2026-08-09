"""Bootstrap GitHub Copilot database-definition hooks from a repository checkout."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[2]


def _activate_repository_python() -> None:
    candidates = [
        REPOSITORY / ".venv" / "bin" / "python",
        REPOSITORY / ".venv" / "Scripts" / "python.exe",
    ]
    current = Path(sys.executable).resolve()
    for candidate in candidates:
        if candidate.is_file() and candidate.resolve() != current:
            os.execv(str(candidate), [str(candidate), str(Path(__file__).resolve())])


def _main() -> int:
    _activate_repository_python()
    sys.path.insert(0, str(REPOSITORY / "src"))
    try:
        from db_teigisho.copilot_hook import main
    except ModuleNotFoundError as error:
        message = (
            "Database definition hook dependencies are unavailable. "
            "Install the project with `python -m pip install -e .`. "
            f"Missing module: {error.name}"
        )
        print(
            json.dumps(
                {
                    "additionalContext": message,
                    "decision": "block",
                    "reason": message,
                }
            )
        )
        return 0
    return main(repository=REPOSITORY, event=os.environ.get("DBDEF_HOOK_EVENT"))


if __name__ == "__main__":
    raise SystemExit(_main())
