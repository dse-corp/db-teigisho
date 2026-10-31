from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest
import yaml

from db_teigisho.errors import DefinitionError
from db_teigisho.loader import load_definition, validate_paths
from db_teigisho.render import build_artifacts
from db_teigisho.schema import generate_schema


def test_loads_relative_references_independent_of_cwd(
    split_definition_file: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(split_definition_file.parent.parent / "tables")
    definition = load_definition(split_definition_file)
    assert [table.physical_name for table in definition.tables] == ["customers", "orders"]
    assert definition.tables[1].foreign_keys[0].referenced_table == "customers"


def test_allows_inline_tables_with_references(split_definition_file: Path) -> None:
    raw = yaml.safe_load(split_definition_file.read_text())
    child = split_definition_file.parent / raw["tables"][0]["$ref"]
    raw["tables"][0] = yaml.safe_load(child.read_text())
    split_definition_file.write_text(yaml.safe_dump(raw))
    assert len(load_definition(split_definition_file).tables) == 2


@pytest.mark.parametrize(
    ("content", "message"),
    [
        (None, "Cannot read"),
        ("[", "Invalid YAML"),
        ("[]", "mapping"),
        (
            "physical_name: wrong\nlogical_name: Wrong\ncolumns: [{physical_name: id, "
            "logical_name: ID, data_type: int}]",
            "table_reference_name_mismatch",
        ),
        ("physical_name: customers\n$ref: ../catalog/database.yaml", "columns"),
        ("physical_name: customers\nlogical_name: Customer\ncolumns: []\ntypo: true", "typo"),
    ],
)
def test_reports_referenced_file_errors(
    split_definition_file: Path, content: str | None, message: str
) -> None:
    child = (split_definition_file.parent / "../tables/customer/master.yaml").resolve()
    if content is None:
        child.unlink()
    else:
        child.write_text(content)
    with pytest.raises(DefinitionError) as caught:
        load_definition(split_definition_file)
    assert message in str(caught.value)
    assert str(child) in str(caught.value)


@pytest.mark.parametrize(
    "reference",
    [
        "",
        "https://example.com/table.yaml",
        "/tmp/table.yaml",
        "C:\\tables\\table.yaml",
        "table.json",
        "bad\x00.yaml",
    ],
)
def test_rejects_unsupported_reference_paths(split_definition_file: Path, reference: str) -> None:
    raw = yaml.safe_load(split_definition_file.read_text())
    raw["tables"][0]["$ref"] = reference
    split_definition_file.write_text(yaml.safe_dump(raw))
    with pytest.raises(DefinitionError):
        load_definition(split_definition_file)


@pytest.mark.parametrize("problem", ["duplicate", "foreign_key", "extra_reference_field"])
def test_validates_the_resolved_database(split_definition_file: Path, problem: str) -> None:
    raw = yaml.safe_load(split_definition_file.read_text())
    if problem == "duplicate":
        raw["tables"].append(raw["tables"][0])
        expected = "duplicate_table"
    elif problem == "foreign_key":
        raw["tables"].pop(0)
        expected = "foreign_table_missing"
    else:
        raw["tables"][0]["logical_name"] = "Override"
        expected = "extra_forbidden"
    split_definition_file.write_text(yaml.safe_dump(raw))
    with pytest.raises(DefinitionError, match=expected):
        load_definition(split_definition_file)


def test_directory_validation_checks_parents_and_unreferenced_files(
    split_definition_file: Path,
) -> None:
    directory = split_definition_file.parent.parent
    orphan = directory / "orphan.yaml"
    orphan.write_text("physical_name: orphan\n")
    results = validate_paths([directory])
    assert [(r.path, r.valid) for r in results] == [(split_definition_file, True), (orphan, False)]


def test_directory_validation_reports_invalid_referenced_table_once(
    split_definition_file: Path,
) -> None:
    child = split_definition_file.parent / "sales/nested/orders.yml"
    child.write_text("physical_name: orders\n")
    results = validate_paths([split_definition_file.parent.parent])
    assert len(results) == 1
    assert not results[0].valid
    assert str(child) in results[0].errors[0]


def test_directory_validation_deduplicates_symlinked_table_files(
    split_definition_file: Path,
) -> None:
    child = split_definition_file.parent / "sales/nested/orders.yml"
    (child.parent / "orders-link.yaml").symlink_to(child)
    results = validate_paths([split_definition_file.parent.parent])
    assert len(results) == 1
    assert results[0].valid


def test_schema_describes_inline_and_referenced_tables() -> None:
    schema = generate_schema()
    alternatives = schema["properties"]["tables"]["items"]["anyOf"]
    assert {item["$ref"] for item in alternatives} == {
        "#/$defs/TableDefinition",
        "#/$defs/TableReference",
    }
    assert schema["$defs"]["TableReference"]["required"] == ["physical_name", "$ref"]


def test_directory_validation_does_not_hide_invalid_parents(split_definition_file: Path) -> None:
    raw = yaml.safe_load(split_definition_file.read_text())
    del raw["document"]
    raw["tables"].append({"physical_name": "self", "$ref": "database.yaml"})
    split_definition_file.write_text(yaml.safe_dump(raw))
    results = validate_paths([split_definition_file.parent.parent])
    assert len(results) == 1
    assert results[0].path == split_definition_file
    assert not results[0].valid


def test_referenced_yaml_uses_safe_loader(split_definition_file: Path) -> None:
    child = split_definition_file.parent / "sales/nested/orders.yml"
    child.write_text("!!python/object/apply:builtins.print ['must not execute']")
    with pytest.raises(DefinitionError, match="Invalid YAML"):
        load_definition(split_definition_file)


def test_build_resolves_tables_and_records_all_input_checksums(
    split_definition_file: Path, tmp_path: Path
) -> None:
    manifest_path = build_artifacts(split_definition_file, tmp_path / "output")
    manifest = json.loads(manifest_path.read_text())
    assert len(manifest["sources"]) == 3
    for source in manifest["sources"]:
        path = split_definition_file.parent / source["file"]
        assert source["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
    html = (manifest_path.parent / "database.html").read_text()
    assert "customers" in html and "orders" in html
