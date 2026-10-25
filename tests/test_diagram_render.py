from __future__ import annotations

import json
import math
import re
import socket
import subprocess
from dataclasses import replace
from io import BytesIO
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET
from zipfile import ZipFile

import pytest
from PIL import Image, ImageChops

from db_teigisho.cli import main
from db_teigisho.diagram_render import _png, render_er_diagrams
from db_teigisho.er_graph import build_er_graph
from db_teigisho.er_scene import Scene, Text, _blocked, build_nodes, build_scene, text_width
from db_teigisho.errors import DefinitionRenderError
from db_teigisho.models import DatabaseDefinition


def test_offline_cli_generates_every_format_without_external_executables(
    monkeypatch: pytest.MonkeyPatch, definition_file: Path, tmp_path: Path
) -> None:
    def forbidden(*args: object, **kwargs: object) -> Any:
        pytest.fail("Generation attempted a subprocess or network connection")

    monkeypatch.setenv("PATH", "")
    monkeypatch.setattr(subprocess, "Popen", forbidden)
    monkeypatch.setattr(socket, "socket", forbidden)
    monkeypatch.setattr(socket, "create_connection", forbidden)
    for format_ in ("html", "svg", "png", "xlsx", "pdf", "mermaid"):
        output = tmp_path / f"definition.{format_}"
        assert (
            main(["render", str(definition_file), "--format", format_, "--output", str(output)])
            == 0
        )
        assert output.stat().st_size > 0
    assert main(["build", str(definition_file), "--output", str(tmp_path / "build")]) == 0
    with Image.open(tmp_path / "definition.png") as image:
        image.load()
        assert image.format == "PNG"
        assert image.width > 300
    with ZipFile(tmp_path / "definition.xlsx") as workbook:
        images = [name for name in workbook.namelist() if name.startswith("xl/media/")]
        assert len(images) == 1
        with Image.open(BytesIO(workbook.read(images[0]))) as image:
            image.verify()
    assert re.search(rb"/Subtype\s*/Image", (tmp_path / "definition.pdf").read_bytes())
    manifest = json.loads((tmp_path / "build/manifest.json").read_text())
    assert len(manifest["artifacts"]) == 6


def test_renders_all_modes_as_real_deterministic_images(valid_definition: dict[str, Any]) -> None:
    definition = DatabaseDefinition.model_validate(valid_definition)
    first = render_er_diagrams(definition)
    second = render_er_diagrams(definition)
    assert first == second
    heights = []
    for diagram in first.values():
        root = ET.fromstring(diagram.svg)
        assert root.tag == "{http://www.w3.org/2000/svg}svg"
        assert not root.findall(".//{http://www.w3.org/2000/svg}script")
        with Image.open(BytesIO(diagram.png)) as image:
            image.load()
            assert image.width * image.height <= 16_000_000
            heights.append(image.height)
    assert heights[0] > heights[1] > heights[2]
    assert "合計金額".encode() in first["all"].svg
    assert "合計金額".encode() not in first["keys"].svg
    assert b"customer_id" not in first["tables"].svg.split(b"</g>")[0]


def test_rejects_unknown_mode(valid_definition: dict[str, Any]) -> None:
    with pytest.raises(ValueError, match="column_mode"):
        render_er_diagrams(DatabaseDefinition.model_validate(valid_definition), ("bad",))  # type: ignore[arg-type]


def test_unicode_special_characters_and_long_names_are_not_clipped(
    valid_definition: dict[str, Any],
) -> None:
    value = '<script>alert("&")</script> 日本語の非常に長い名前' * 8
    valid_definition["tables"][0]["logical_name"] = value
    valid_definition["tables"][0]["columns"][0]["logical_name"] = value
    valid_definition["tables"][1]["columns"][1]["data_type"] = "長い型<&>" * 12
    definition = DatabaseDefinition.model_validate(valid_definition)
    graph = build_er_graph(definition)
    nodes = build_nodes(graph)["all"]
    for node in nodes:
        for text in node.texts:
            assert text.x >= 0
            if text.css_class == "er-column-name":
                assert text.x + text_width(text.value, text.size) <= node.width - 144
            assert text.x + text_width(text.value, text.size) <= node.width
            assert 0 <= text.y - text.size <= text.y < node.height
    restored = "".join(text.value for text in nodes[0].texts if text.css_class == "er-node-logical")
    assert restored == value
    diagram = render_er_diagrams(definition, ("all",))["all"]
    root = ET.fromstring(diagram.svg)
    assert not root.findall(".//{http://www.w3.org/2000/svg}script")
    assert b"&lt;script&gt;" in diagram.svg
    with Image.open(BytesIO(diagram.png)) as image:
        image.verify()


def test_self_cycle_parallel_and_composite_routes_stay_outside_nodes(
    valid_definition: dict[str, Any],
) -> None:
    parent, child = valid_definition["tables"]
    parent["foreign_keys"] = [
        {
            "name": "self",
            "columns": ["customer_id"],
            "referenced_table": "customers",
            "referenced_columns": ["customer_id"],
        },
        {
            "name": "cycle",
            "columns": ["customer_id"],
            "referenced_table": "orders",
            "referenced_columns": ["order_id"],
        },
    ]
    child["foreign_keys"].append({**child["foreign_keys"][0], "name": "parallel"})
    child["foreign_keys"].append(
        {
            "name": "composite",
            "columns": ["customer_id", "order_id"],
            "referenced_table": "customers",
            "referenced_columns": ["customer_id", "email"],
        }
    )
    definition = DatabaseDefinition.model_validate(valid_definition)
    graph = build_er_graph(definition)
    scenes = [build_scene(graph, nodes) for nodes in build_nodes(graph).values()]
    for scene in scenes:
        assert len(scene.edges) == 5
        assert len({edge.points for edge in scene.edges}) == 5
        for edge in scene.edges:
            assert len(edge.points) >= 4
            for a, b in zip(edge.points, edge.points[1:], strict=False):
                assert a[0] == b[0] or a[1] == b[1]
                assert not _blocked(a, b, scene.nodes)
        x, y, width, height = scene.bounds
        for text in scene.texts:
            assert x <= text.x < text.x + text_width(text.value, text.size) <= x + width
            assert y <= text.y - text.size < text.y < y + height
    assert b"composite" in render_er_diagrams(definition, ("tables",))["tables"].svg


def test_large_png_is_bounded_or_rejected_before_allocation(
    valid_definition: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = build_er_graph(DatabaseDefinition.model_validate(valid_definition))
    scene = build_scene(graph, build_nodes(graph)["tables"])
    with Image.open(BytesIO(_png(replace(scene, bounds=(0, 0, 5000, 3000))))) as image:
        assert image.width * image.height <= 16_000_000
        assert max(image.size) <= 8000

    def forbidden(*args: object, **kwargs: object) -> Any:
        pytest.fail("Oversized image allocated before checking bounds")

    monkeypatch.setattr("db_teigisho.diagram_render.Image.new", forbidden)
    with pytest.raises(DefinitionRenderError, match="too large"):
        _png(replace(scene, bounds=(0, 0, 50_000, 50_000)))


def test_empty_graph_and_disconnected_tables(valid_definition: dict[str, Any]) -> None:
    valid_definition["tables"][1]["foreign_keys"] = []
    definition = DatabaseDefinition.model_validate(valid_definition)
    nodes = build_nodes(build_er_graph(definition))["all"]
    assert nodes[1].y >= nodes[0].y + nodes[0].height + 180
    assert render_er_diagrams(definition)
    valid_definition["tables"] = []
    definition = DatabaseDefinition.model_validate(valid_definition)
    assert "テーブル定義なし".encode() in render_er_diagrams(definition)["all"].svg


def test_scene_safety_limits(
    valid_definition: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    definition = DatabaseDefinition.model_validate(valid_definition)
    monkeypatch.setattr("db_teigisho.er_scene.MAX_TABLES", 1)
    with pytest.raises(DefinitionRenderError, match="safety limits"):
        render_er_diagrams(definition)


def test_rejects_xml_control_characters(valid_definition: dict[str, Any]) -> None:
    valid_definition["tables"][0]["logical_name"] = "invalid\x00label"
    with pytest.raises(DefinitionRenderError, match="XML 1.0"):
        render_er_diagrams(DatabaseDefinition.model_validate(valid_definition))


def test_routes_around_intermediate_table_and_bounds_routing_work(
    valid_definition: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from db_teigisho.er_scene import _route

    graph = build_er_graph(DatabaseDefinition.model_validate(valid_definition))
    template = build_nodes(graph)["tables"][0]
    obstacles = (replace(template, id="obstacle", x=100, y=0, width=100, height=100),)
    points = _route((0, 50), (300, 50), obstacles)
    assert any(y <= 0 or y >= 100 for _, y in points)
    assert all(not _blocked(a, b, obstacles) for a, b in zip(points, points[1:], strict=False))
    monkeypatch.setattr("db_teigisho.er_scene.MAX_ROUTE_STATES", 1)
    with pytest.raises(DefinitionRenderError, match="routing exceeds"):
        _route((0, 50), (300, 50), obstacles)


@pytest.mark.parametrize("canvas_width,scale", [(1000, 2.0), (10_000, 0.8)])
def test_png_text_matches_scene_width_at_scaled_font_sizes(canvas_width: int, scale: float) -> None:
    text = Text(10, 30, "customer_email_with_a_long_identifier_" * 3)
    scene = Scene((), (), (text,), (0, 0, canvas_width, 60))
    with Image.open(BytesIO(_png(scene))) as image:
        ink = ImageChops.difference(image, Image.new("RGB", image.size, "white")).getbbox()
        assert ink is not None
        assert ink[0] >= math.floor(text.x * scale) - 2
        assert ink[2] <= math.ceil((text.x + text_width(text.value)) * scale) + 2
        assert ink[2] - ink[0] > text_width(text.value) * scale * 0.95
