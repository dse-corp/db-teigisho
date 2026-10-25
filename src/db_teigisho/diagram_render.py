"""Offline SVG and PNG rendering from the same Python ER scene."""

from __future__ import annotations

import math
from dataclasses import dataclass
from io import BytesIO
from typing import Literal
from xml.etree.ElementTree import Element, SubElement, tostring

from PIL import Image, ImageDraw

from db_teigisho.er import ColumnDisplayMode
from db_teigisho.er_graph import build_er_graph
from db_teigisho.er_scene import Scene, Text, build_nodes, build_scene, font, text_width
from db_teigisho.errors import DefinitionRenderError
from db_teigisho.models import DatabaseDefinition

ErDiagramMode = Literal["all", "keys", "tables"]
DEFAULT_ER_DIAGRAM_MODES: tuple[ErDiagramMode, ...] = ("all", "keys", "tables")
# Bound allocations before Image.new, independent of Pillow's decoder limits.
MAX_PNG_PIXELS = 16_000_000
MAX_PNG_SIDE = 8_000
MIN_PNG_SCALE = 0.5


@dataclass(frozen=True, slots=True)
class RenderedErDiagram:
    """Rendered image bytes for one ER column display mode."""

    svg: bytes
    png: bytes


def _svg(scene: Scene) -> bytes:
    x, y, width, height = scene.bounds
    root = Element(
        "svg",
        {
            "xmlns": "http://www.w3.org/2000/svg",
            "viewBox": f"{x} {y} {width} {height}",
            "width": str(width),
            "height": str(height),
            "role": "img",
            "aria-label": "ER diagram",
            "font-family": "Noto Sans JP, sans-serif",
        },
    )
    SubElement(
        root,
        "rect",
        {"x": str(x), "y": str(y), "width": str(width), "height": str(height), "fill": "#ffffff"},
    )
    for edge in scene.edges:
        attributes = {
            "points": " ".join(f"{px},{py}" for px, py in edge.points),
            "fill": "none",
            "stroke": "#536b7a",
            "stroke-width": "1.5",
            "data-relationship-id": edge.id,
        }
        if edge.dashed:
            attributes["stroke-dasharray"] = "6 4"
        SubElement(root, "polyline", attributes)
    for node in scene.nodes:
        group = SubElement(
            root, "g", {"data-table-id": node.id, "transform": f"translate({node.x} {node.y})"}
        )
        SubElement(
            group,
            "rect",
            {
                "width": str(node.width),
                "height": str(node.height),
                "fill": "#ffffff",
                "stroke": "#7890a0",
            },
        )
        SubElement(
            group,
            "rect",
            {"width": str(node.width), "height": str(node.header_height), "fill": "#124e78"},
        )
        for divider in node.dividers:
            SubElement(
                group,
                "line",
                {
                    "x1": "0",
                    "x2": str(node.width),
                    "y1": str(divider),
                    "y2": str(divider),
                    "stroke": "#d5dce3",
                },
            )
        for text in node.texts:
            _svg_text(group, text)
    for text in scene.texts:
        _svg_text(root, text, halo=True)
    return bytes(tostring(root, encoding="utf-8"))


def _svg_text(parent: Element, text: Text, *, halo: bool = False) -> None:
    attributes = {
        "x": str(text.x),
        "y": str(text.y),
        "font-size": str(text.size),
        "fill": text.color,
        "xml:space": "preserve",
    }
    if text.value:
        # The SVG reader may use another font. Keep measured text within bounds.
        attributes.update(
            textLength=str(text_width(text.value, text.size)), lengthAdjust="spacingAndGlyphs"
        )
    if halo:
        attributes.update({"paint-order": "stroke", "stroke": "#ffffff", "stroke-width": "4"})
    SubElement(parent, "text", attributes).text = text.value


def _png(scene: Scene) -> bytes:
    x0, y0, width, height = scene.bounds
    scale = min(
        2.0,
        MAX_PNG_SIDE / width,
        MAX_PNG_SIDE / height,
        math.sqrt(MAX_PNG_PIXELS / (width * height)),
    )
    if scale < MIN_PNG_SCALE:
        raise DefinitionRenderError(
            "ER diagram is too large for a readable PNG (8000 px / 16 million pixel limit). "
            "Split the definition into smaller diagrams."
        )
    size = (max(1, math.floor(width * scale)), max(1, math.floor(height * scale)))
    try:
        canvas = Image.new("RGB", size, "white")
        draw = ImageDraw.Draw(canvas)

        def point(x: float, y: float) -> tuple[float, float]:
            return (x - x0) * scale, (y - y0) * scale

        def draw_text(text: Text, x: float = 0, y: float = 0, *, halo: bool = False) -> None:
            if not text.value:
                return
            scaled_font = font(text.size * scale)
            stroke = max(1, round(scale * 2)) if halo else 0
            left, top, right, bottom = scaled_font.getbbox(text.value, anchor="ls")
            raster = Image.new(
                "RGBA",
                (
                    max(1, math.ceil(right - left + 2 * stroke)),
                    max(1, math.ceil(bottom - top + 2 * stroke)),
                ),
            )
            ImageDraw.Draw(raster).text(
                (stroke - left, stroke - top),
                text.value,
                font=scaled_font,
                fill=text.color,
                anchor="ls",
                stroke_width=stroke,
                stroke_fill="white",
            )
            # FreeType hinting at another size changes advances. Match the scene
            # width explicitly, as SVG textLength does, so long names cannot run
            # into the type column when rendering at 2x or a fractional scale.
            advance = float(scaled_font.getlength(text.value))
            ratio = text_width(text.value, text.size) * scale / advance if advance else 1
            raster = raster.resize(
                (max(1, round(raster.width * ratio)), raster.height), Image.Resampling.LANCZOS
            )
            px, py = point(x + text.x, y + text.y)
            canvas.paste(
                raster, (round(px + (left - stroke) * ratio), round(py + top - stroke)), raster
            )

        for edge in scene.edges:
            for a, b in zip(edge.points, edge.points[1:], strict=False):
                distance = abs(a[0] - b[0]) + abs(a[1] - b[1])
                if not edge.dashed:
                    draw.line(
                        [point(*a), point(*b)], fill="#536b7a", width=max(1, round(1.5 * scale))
                    )
                elif distance:
                    for offset in range(0, math.ceil(distance), 10):
                        low, high = offset / distance, min(offset + 6, distance) / distance
                        draw.line(
                            [
                                point(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
                                for t in (low, high)
                            ],
                            fill="#536b7a",
                            width=max(1, round(1.5 * scale)),
                        )
        for node in scene.nodes:
            draw.rectangle(
                [point(node.x, node.y), point(node.x + node.width, node.y + node.height)],
                fill="white",
                outline="#7890a0",
                width=max(1, round(scale)),
            )
            draw.rectangle(
                [point(node.x, node.y), point(node.x + node.width, node.y + node.header_height)],
                fill="#124e78",
            )
            for divider in node.dividers:
                draw.line(
                    [point(node.x, node.y + divider), point(node.x + node.width, node.y + divider)],
                    fill="#d5dce3",
                    width=max(1, round(scale)),
                )
            for text in node.texts:
                draw_text(text, node.x, node.y)
        for text in scene.texts:
            draw_text(text, halo=True)
        with BytesIO() as output:
            canvas.save(output, format="PNG")
            return output.getvalue()
    except (OSError, ValueError, MemoryError) as error:
        raise DefinitionRenderError(f"Could not render ER PNG: {error}") from error


def render_er_diagrams(
    definition: DatabaseDefinition,
    modes: tuple[ColumnDisplayMode, ...] = DEFAULT_ER_DIAGRAM_MODES,
) -> dict[ColumnDisplayMode, RenderedErDiagram]:
    """Render the requested modes without subprocesses, browsers, or network I/O."""
    for mode in modes:
        if mode not in DEFAULT_ER_DIAGRAM_MODES:
            raise ValueError(f"Unsupported column_mode: {mode}")
    graph = build_er_graph(definition)
    nodes = build_nodes(graph)
    rendered = {}
    for mode in modes:
        scene = build_scene(graph, nodes[mode])
        rendered[mode] = RenderedErDiagram(svg=_svg(scene), png=_png(scene))
    return rendered
