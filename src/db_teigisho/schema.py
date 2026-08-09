"""JSON Schema generation and drift checking."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from db_teigisho.models import DatabaseDefinition


def generate_schema() -> dict[str, Any]:
    """Generate the structural contract from the runtime model."""

    schema = DatabaseDefinition.model_json_schema(mode="validation")
    return {"$schema": "https://json-schema.org/draft/2020-12/schema", **schema}


def schema_text() -> str:
    """Return the canonical committed representation of the schema."""

    return json.dumps(generate_schema(), ensure_ascii=False, indent=2) + "\n"


def write_schema(path: Path) -> None:
    """Write the current schema, creating its parent directory."""

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(schema_text(), encoding="utf-8")


def schema_matches(path: Path) -> bool:
    """Return whether a schema file is present and current."""

    try:
        current: object = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, UnicodeError):
        return False
    return current == generate_schema()
