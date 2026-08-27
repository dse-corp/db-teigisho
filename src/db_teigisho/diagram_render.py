"""Local Mermaid CLI rendering for database ER diagrams."""

from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Literal

from db_teigisho.er import ColumnDisplayMode, render_mermaid
from db_teigisho.errors import DefinitionRenderError
from db_teigisho.models import DatabaseDefinition

ErDiagramMode = Literal["all", "keys", "tables"]
DEFAULT_ER_DIAGRAM_MODES: tuple[ErDiagramMode, ...] = ("all", "keys", "tables")
_PNG_HEADER = b"\x89PNG\r\n\x1a\n"
_MERMAID_CONFIG = {
    "securityLevel": "strict",
    "theme": "neutral",
}
_PUPPETEER_CONFIG = {
    "args": ["--no-sandbox", "--disable-setuid-sandbox"],
}


@dataclass(frozen=True, slots=True)
class RenderedErDiagram:
    """Rendered image bytes for one ER column display mode."""

    svg: bytes
    png: bytes


def _mmdc_command() -> str:
    command = shutil.which("npx")
    if command is None:
        raise DefinitionRenderError(
            "Mermaid CLI is unavailable. Install the pinned Node.js dependencies with `npm ci`."
        )
    return command


def _run_mermaid_cli(
    source: Path, output: Path, config: Path, puppeteer_config: Path
) -> None:
    command = [
        _mmdc_command(),
        "--no-install",
        "@mermaid-js/mermaid-cli",
        "-i",
        str(source),
        "-o",
        str(output),
        "-b",
        "transparent",
        "-w",
        "2400",
        "-s",
        "2",
        "-c",
        str(config),
        "-p",
        str(puppeteer_config),
        "-q",
    ]
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            check=False,
            shell=False,
            text=True,
        )
    except OSError as error:
        raise DefinitionRenderError(f"Could not run Mermaid CLI: {error}") from error
    if result.returncode != 0:
        details = (result.stderr or result.stdout).strip() or f"exit status {result.returncode}"
        raise DefinitionRenderError(f"Mermaid CLI failed to render {source.name}: {details}")


def _read_svg(path: Path) -> bytes:
    content = path.read_bytes()
    if not content.lstrip().startswith(b"<svg"):
        raise DefinitionRenderError(f"Mermaid CLI produced an invalid SVG: {path.name}")
    return content


def _read_png(path: Path) -> bytes:
    content = path.read_bytes()
    if not content.startswith(_PNG_HEADER):
        raise DefinitionRenderError(f"Mermaid CLI produced an invalid PNG: {path.name}")
    return content


def render_er_diagrams(
    definition: DatabaseDefinition,
    modes: tuple[ColumnDisplayMode, ...] = DEFAULT_ER_DIAGRAM_MODES,
) -> dict[ColumnDisplayMode, RenderedErDiagram]:
    """Render the requested ER column modes to validated SVG and PNG bytes."""

    with TemporaryDirectory(prefix="dbdef-er-") as temporary_directory:
        directory = Path(temporary_directory)
        config = directory / "mermaid-config.json"
        puppeteer_config = directory / "puppeteer-config.json"
        config.write_text(json.dumps(_MERMAID_CONFIG), encoding="utf-8")
        puppeteer_config.write_text(json.dumps(_PUPPETEER_CONFIG), encoding="utf-8")
        rendered: dict[ColumnDisplayMode, RenderedErDiagram] = {}
        for mode in modes:
            source = directory / f"diagram-{mode}.mmd"
            svg = directory / f"diagram-{mode}.svg"
            png = directory / f"diagram-{mode}.png"
            source.write_text(render_mermaid(definition, mode), encoding="utf-8")
            _run_mermaid_cli(source, svg, config, puppeteer_config)
            _run_mermaid_cli(source, png, config, puppeteer_config)
            rendered[mode] = RenderedErDiagram(svg=_read_svg(svg), png=_read_png(png))
    return rendered
