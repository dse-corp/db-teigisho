"""Bootstrap the repository PostToolUse validator without global installation."""

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
        from db_teigisho.codex_hook import main
    except ModuleNotFoundError as error:
        print(
            json.dumps(
                {
                    "systemMessage": (
                        "Database definition hook dependencies are unavailable. "
                        "Run `python3 -m venv .venv` and `.venv/bin/pip install -e .`. "
                        f"Missing module: {error.name}"
                    )
                }
            )
        )
        return 1
    return main(repository=REPOSITORY)


if __name__ == "__main__":
    raise SystemExit(_main())
