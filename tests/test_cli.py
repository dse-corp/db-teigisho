from __future__ import annotations

import json
import subprocess
import sys
from importlib.metadata import version
from pathlib import Path

from db_teigisho import __version__


def _run_cli(*args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "db_teigisho", *args],
        capture_output=True,
        check=False,
        text=True,
    )


def test_version_matches_installed_distribution() -> None:
    result = _run_cli("--version")

    assert result.returncode == 0
    assert result.stderr == ""
    assert result.stdout.strip() == f"dbdef {version('db-teigisho')}"
    assert __version__ == version("db-teigisho")


def test_validate_command_supports_machine_readable_output(definition_file: Path) -> None:
    result = _run_cli("validate", str(definition_file), "--json")

    assert result.returncode == 0
    payload = json.loads(result.stdout)
    assert payload[0]["valid"] is True
    assert payload[0]["errors"] == []


def test_validate_command_returns_nonzero_for_invalid_input(tmp_path: Path) -> None:
    path = tmp_path / "invalid.yaml"
    path.write_text("format_version: '1.0'\n", encoding="utf-8")

    result = _run_cli("validate", str(path))

    assert result.returncode == 1
    assert "INVALID" in result.stdout


def test_schema_check_command_detects_a_stale_schema(tmp_path: Path) -> None:
    schema_path = tmp_path / "schema.json"
    schema_path.write_text("{}\n", encoding="utf-8")

    result = _run_cli("schema", "--check", str(schema_path))

    assert result.returncode == 1
    assert "out of date" in result.stderr


def test_build_command_writes_manifest(definition_file: Path, tmp_path: Path) -> None:
    output = tmp_path / "published"

    result = _run_cli("build", str(definition_file), "--output", str(output))

    assert result.returncode == 0
    assert (output / "manifest.json").is_file()
    assert "manifest.json" in result.stdout


def test_render_command_writes_mermaid_with_requested_column_mode(
    definition_file: Path, tmp_path: Path
) -> None:
    output = tmp_path / "diagram.mmd"

    result = _run_cli(
        "render",
        str(definition_file),
        "--format",
        "mermaid",
        "--er-columns",
        "keys",
        "--output",
        str(output),
    )

    assert result.returncode == 0
    assert output.read_text(encoding="utf-8").startswith("erDiagram\n")
    assert "numeric amount" not in output.read_text(encoding="utf-8")


def test_render_command_writes_an_svg_er_diagram(definition_file: Path, tmp_path: Path) -> None:
    output = tmp_path / "diagram.svg"

    result = _run_cli(
        "render",
        str(definition_file),
        "--format",
        "svg",
        "--er-columns",
        "tables",
        "--output",
        str(output),
    )

    assert result.returncode == 0
    assert output.read_bytes().lstrip().startswith(b"<svg")
