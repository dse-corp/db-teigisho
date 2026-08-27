from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

import pytest

from db_teigisho.diagram_render import render_er_diagrams
from db_teigisho.errors import DefinitionRenderError
from db_teigisho.models import DatabaseDefinition

_PNG_HEADER = b"\x89PNG\r\n\x1a\n"


def _definition(valid_definition: dict[str, Any]) -> DatabaseDefinition:
    return DatabaseDefinition.model_validate(valid_definition)


def _write_diagram_output(command: list[str]) -> None:
    output = Path(command[command.index("-o") + 1])
    if output.suffix == ".svg":
        output.write_bytes(b'<svg xmlns="http://www.w3.org/2000/svg"></svg>')
    else:
        output.write_bytes(_PNG_HEADER + b"rendered")


def test_renders_svg_and_png_for_each_requested_mode(
    monkeypatch: pytest.MonkeyPatch, valid_definition: dict[str, Any]
) -> None:
    commands: list[list[str]] = []
    puppeteer_configs: list[dict[str, list[str]]] = []

    def fake_run(command: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
        commands.append(command)
        assert kwargs["shell"] is False
        config = Path(command[command.index("-p") + 1])
        puppeteer_configs.append(json.loads(config.read_text(encoding="utf-8")))
        _write_diagram_output(command)
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr("db_teigisho.diagram_render.shutil.which", lambda _: "/usr/bin/npx")
    monkeypatch.setattr("db_teigisho.diagram_render.subprocess.run", fake_run)

    diagrams = render_er_diagrams(_definition(valid_definition), modes=("all", "keys"))

    assert set(diagrams) == {"all", "keys"}
    assert all(diagram.svg.startswith(b"<svg") for diagram in diagrams.values())
    assert all(diagram.png.startswith(_PNG_HEADER) for diagram in diagrams.values())
    assert len(commands) == 4
    expected_prefix = ["--no-install", "@mermaid-js/mermaid-cli", "-i"]
    assert all(command[1:4] == expected_prefix for command in commands)
    assert puppeteer_configs == [
        {"args": ["--no-sandbox", "--disable-setuid-sandbox"]}
    ] * 4


def test_reports_a_renderer_failure_with_command_output(
    monkeypatch: pytest.MonkeyPatch, valid_definition: dict[str, Any]
) -> None:
    monkeypatch.setattr("db_teigisho.diagram_render.shutil.which", lambda _: "/usr/bin/npx")
    monkeypatch.setattr(
        "db_teigisho.diagram_render.subprocess.run",
        lambda command, **kwargs: subprocess.CompletedProcess(
            command, 1, "", "Chromium unavailable"
        ),
    )

    with pytest.raises(DefinitionRenderError, match="Chromium unavailable"):
        render_er_diagrams(_definition(valid_definition), modes=("all",))


def test_reports_missing_mermaid_cli(
    valid_definition: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("db_teigisho.diagram_render.shutil.which", lambda _: None)

    with pytest.raises(DefinitionRenderError, match="npm ci"):
        render_er_diagrams(_definition(valid_definition), modes=("all",))
