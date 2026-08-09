from __future__ import annotations

import json
from pathlib import Path

from db_teigisho.schema import generate_schema, schema_matches


def test_generated_schema_uses_json_schema_2020_12() -> None:
    schema = generate_schema()

    assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    assert schema["title"] == "Database Definition"
    assert set(schema["required"]) == {
        "format_version",
        "document",
        "database",
        "tables",
        "views",
        "stored_procedures",
    }


def test_schema_matches_detects_drift(tmp_path: Path) -> None:
    path = tmp_path / "schema.json"
    path.write_text(
        json.dumps(generate_schema(), ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    assert schema_matches(path) is True

    path.write_text("{}\n", encoding="utf-8")
    assert schema_matches(path) is False
