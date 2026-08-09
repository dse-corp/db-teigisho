from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from typing import Any

import pytest
import yaml

from db_teigisho.errors import DefinitionLoadError, DefinitionValidationError
from db_teigisho.loader import load_definition, validate_paths


def _write_definition(path: Path, data: dict[str, Any]) -> None:
    path.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")


def test_loads_a_structurally_and_semantically_valid_definition(definition_file: Path) -> None:
    document = load_definition(definition_file)

    assert document.document.system_name == "受注管理システム"
    assert document.tables[1].columns[2].default == 0


def test_rejects_unknown_fields(tmp_path: Path, valid_definition: dict[str, Any]) -> None:
    data = deepcopy(valid_definition)
    data["database"]["unknown_setting"] = "mistake"
    path = tmp_path / "invalid.yaml"
    _write_definition(path, data)

    with pytest.raises(DefinitionValidationError) as exc_info:
        load_definition(path)

    assert "database.unknown_setting" in str(exc_info.value)


def test_reports_yaml_syntax_errors(tmp_path: Path) -> None:
    path = tmp_path / "broken.yaml"
    path.write_text("tables:\n  - physical_name: [\n", encoding="utf-8")

    with pytest.raises(DefinitionLoadError, match="YAML"):
        load_definition(path)


def test_reports_cross_reference_and_constraint_errors(
    tmp_path: Path, valid_definition: dict[str, Any]
) -> None:
    data = deepcopy(valid_definition)
    data["tables"][1]["columns"][0]["not_null"] = False
    data["tables"][1]["indexes"][0]["columns"][0]["name"] = "missing_column"
    data["tables"][1]["foreign_keys"][0]["referenced_table"] = "missing_table"
    data["document"]["updated_at"] = "2026-07-01T00:00:00+09:00"
    path = tmp_path / "semantic-errors.yaml"
    _write_definition(path, data)

    with pytest.raises(DefinitionValidationError) as exc_info:
        load_definition(path)

    message = str(exc_info.value)
    assert "primary_key_not_null" in message
    assert "index_column_missing" in message
    assert "foreign_table_missing" in message
    assert "timestamps_out_of_order" in message


def test_validates_all_yaml_files_in_a_directory(
    tmp_path: Path, valid_definition: dict[str, Any]
) -> None:
    definitions = tmp_path / "definitions"
    definitions.mkdir()
    _write_definition(definitions / "valid.yaml", valid_definition)
    invalid = deepcopy(valid_definition)
    invalid["database"]["port"] = 70_000
    _write_definition(definitions / "invalid.yml", invalid)

    results = validate_paths([definitions])

    assert [result.path.name for result in results] == ["invalid.yml", "valid.yaml"]
    assert results[0].valid is False
    assert results[1].valid is True


def test_rejects_an_empty_validation_target(tmp_path: Path) -> None:
    with pytest.raises(DefinitionLoadError, match="No YAML definition files"):
        validate_paths([tmp_path])
