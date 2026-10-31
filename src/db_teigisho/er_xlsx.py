"""Editable SpreadsheetDrawing groups and attached orthogonal connectors.

Cells are written by openpyxl first. DrawingML is added to the package last,
because an openpyxl load/save cycle cannot preserve arbitrary worksheet shapes.
No images, Office automation, macros, or external executables are involved.
"""

from __future__ import annotations

import os
import posixpath
from collections import defaultdict
from dataclasses import dataclass, replace
from io import BytesIO
from pathlib import Path
from tempfile import NamedTemporaryFile
from xml.etree.ElementTree import Element, SubElement, fromstring, tostring
from zipfile import ZIP_DEFLATED, ZipFile

from openpyxl import Workbook

from db_teigisho.er_graph import ErGraph
from db_teigisho.er_scene import (
    MAX_SCENE_EXTENT,
    Edge,
    Node,
    Point,
    Text,
    build_nodes,
    build_scene,
    initial_positions,
    text_width,
)
from db_teigisho.errors import DefinitionRenderError

_A = "http://schemas.openxmlformats.org/drawingml/2006/main"
_XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
_S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
_P = "http://schemas.openxmlformats.org/package/2006/relationships"
_CT = "http://schemas.openxmlformats.org/package/2006/content-types"
_DRAWING_TYPE = "application/vnd.openxmlformats-officedocument.drawing+xml"
_EMU = 9525  # Drawing coordinates are CSS pixels at 96 dpi.
_MARGIN = 86.0  # Group-owned endpoint labels live outside the table rectangle.
_CARDINALITY = {"exactly_one": "1", "zero_or_one": "0..1", "zero_or_many": "0..N"}


@dataclass(frozen=True)
class ExcelErDrawing:
    """Native drawing bytes, sheet-space bounds in pixels, and FK legend rows."""

    xml: bytes
    width: float
    height: float
    legend: tuple[tuple[str, str, str, str, str], ...]


def _a(parent: Element, tag: str, **attributes: str) -> Element:
    return SubElement(parent, f"{{{_A}}}{tag}", attributes)


def _x(parent: Element, tag: str, **attributes: str) -> Element:
    return SubElement(parent, f"{{{_XDR}}}{tag}", attributes)


def _emu(value: float) -> str:
    return str(round(value * _EMU))


def _transform(parent: Element, x: float, y: float, w: float, h: float) -> Element:
    transform = _a(parent, "xfrm")
    _a(transform, "off", x=_emu(x), y=_emu(y))
    _a(transform, "ext", cx=_emu(w), cy=_emu(h))
    return transform


class _Drawing:
    def __init__(self) -> None:
        self.next_id = 0

    def identity(self, parent: Element, name: str) -> int:
        self.next_id += 1
        _x(parent, "cNvPr", id=str(self.next_id), name=name)
        return self.next_id

    def shape(
        self,
        parent: Element,
        name: str,
        x: float,
        y: float,
        w: float,
        h: float,
        *,
        fill: str | None = None,
        stroke: str | None = None,
        geometry: str = "rect",
    ) -> tuple[Element, int]:
        shape = _x(parent, "sp")
        visual = _x(shape, "nvSpPr")
        id_ = self.identity(visual, name)
        _x(visual, "cNvSpPr")
        properties = _x(shape, "spPr")
        _transform(properties, x, y, w, h)
        _a(_a(properties, "prstGeom", prst=geometry), "avLst")
        if fill:
            _a(_a(properties, "solidFill"), "srgbClr", val=fill.lstrip("#"))
        else:
            _a(properties, "noFill")
        line = _a(properties, "ln", w="9525")
        if stroke:
            _a(_a(line, "solidFill"), "srgbClr", val=stroke.lstrip("#"))
        else:
            _a(line, "noFill")
        return shape, id_

    def text(self, parent: Element, name: str, text: Text) -> None:
        shape, _ = self.shape(
            parent,
            name,
            text.x,
            text.y - text.size * 1.15,
            max(12, text_width(text.value, text.size) + 10),
            text.size * 1.9,
        )
        visual = shape.find(f"{{{_XDR}}}nvSpPr/{{{_XDR}}}cNvSpPr")
        assert visual is not None
        visual.set("txBox", "1")
        body = _x(shape, "txBody")
        properties = _a(
            body,
            "bodyPr",
            wrap="none",
            lIns="0",
            tIns="0",
            rIns="0",
            bIns="0",
            anchor="t",
            vertOverflow="overflow",
        )
        _a(properties, "noAutofit")
        _a(body, "lstStyle")
        paragraph = _a(body, "p")
        run = _a(paragraph, "r")
        properties = _a(run, "rPr", lang="ja-JP", sz=str(round(text.size * 75)))
        _a(_a(properties, "solidFill"), "srgbClr", val=text.color.lstrip("#"))
        _a(properties, "latin", typeface="Noto Sans JP")
        _a(properties, "ea", typeface="Noto Sans JP")
        _a(run, "t").text = text.value


def _anchor(root: Element, x: float, y: float, w: float, h: float) -> Element:
    anchor = _x(root, "absoluteAnchor")
    _x(anchor, "pos", x=_emu(x), y=_emu(y))
    _x(anchor, "ext", cx=_emu(w), cy=_emu(h))
    return anchor


def _connection_port(
    drawing: _Drawing, group: Element, node: Node, point: Point, name: str
) -> tuple[int, int]:
    """A native rectangle site on an unpainted member of the table group.

    Separate ports keep parallel FKs distinct without relying on custom
    connection-site formulas. The selected site is on the table perimeter.
    """
    x, y = point[0] - node.x, point[1] - node.y
    if x == 0:
        px, py, site = x, y - 1, 1
    elif x == node.width:
        px, py, site = x - 2, y - 1, 3
    elif y == 0:
        px, py, site = x - 1, y, 0
    else:
        px, py, site = x - 1, y - 2, 2
    _, id_ = drawing.shape(group, name, px, py, 2, 2)
    return id_, site


def _simplify(points: tuple[Point, ...]) -> tuple[Point, ...]:
    result: list[Point] = []
    for point in points:
        if result and point == result[-1]:
            continue
        if len(result) >= 2 and (
            result[-2][0] == result[-1][0] == point[0] or result[-2][1] == result[-1][1] == point[1]
        ):
            result[-1] = point
        else:
            result.append(point)
    return tuple(result)


def _preset_connector(properties: Element, points: tuple[Point, ...]) -> bool:
    """Map up to five orthogonal segments to an adjustable Office preset."""
    if not 2 <= len(points) <= 6:
        return False
    vertical = points[0][0] == points[1][0]
    canonical = tuple((y, -x) if vertical else (x, y) for x, y in points)
    (sx, sy), (ex, ey) = canonical[0], canonical[-1]
    w, h = abs(ex - sx), abs(ey - sy)
    if w == 0 or (h == 0 and len(points) > 2):
        return False
    # A rotation changes the bounding box around its centre, not its origin.
    cx, cy = (sx + ex) / 2, (sy + ey) / 2
    x, y = (-cy - w / 2, cx - h / 2) if vertical else (min(sx, ex), min(sy, ey))
    transform = _transform(properties, x, y, w, h)
    if vertical:
        transform.set("rot", "5400000")
    if ex < sx:
        transform.set("flipH", "1")
    if ey < sy:
        transform.set("flipV", "1")
    preset = _a(properties, "prstGeom", prst=f"bentConnector{max(3, len(points) - 1)}")
    adjustments = _a(preset, "avLst")
    if len(points) == 2:
        values = [50000]
    else:
        values = [round((canonical[1][0] - sx) / (ex - sx) * 100000)]
        if len(points) >= 5:
            values.append(round((canonical[2][1] - sy) / (ey - sy) * 100000))
        if len(points) == 6:
            values.append(round((canonical[3][0] - sx) / (ex - sx) * 100000))
    for i, value in enumerate(values, 1):
        _a(adjustments, "gd", name=f"adj{i}", fmla=f"val {value}")
    return True


def _custom_connector(properties: Element, points: tuple[Point, ...]) -> None:
    """Retain complex/self routes as one connector with shared bend handles.

    Presets cannot express an arbitrary number of bends or a loop whose ends
    share a coordinate. Shared X/Y guides keep segments orthogonal when edited.
    """
    xs, ys = zip(*points, strict=True)
    x0, y0 = min(xs), min(ys)
    w, h = max(max(xs) - x0, 1), max(max(ys) - y0, 1)
    _transform(properties, x0, y0, w, h)
    geometry = _a(properties, "custGeom")
    adjustments = _a(geometry, "avLst")
    guides = _a(geometry, "gdLst")
    handles = _a(geometry, "ahLst")
    _a(geometry, "cxnLst")
    names: dict[tuple[str, float], str] = {}
    for axis, coordinates, origin, extent in (("x", xs, x0, w), ("y", ys, y0, h)):
        for value in dict.fromkeys(coordinates):
            name = f"{axis}{len(names)}"
            names[axis, value] = name
            percent = round((value - origin) / extent * 1000000)
            _a(adjustments, "gd", name=f"adj{name}", fmla=f"val {percent}")
            dimension = "w" if axis == "x" else "h"
            _a(guides, "gd", name=name, fmla=f"*/ {dimension} adj{name} 1000000")
            # Endpoint coordinates are fixed; only internal lanes get handles.
            if value not in (coordinates[0], coordinates[-1]):
                attribute = "gdRefX" if axis == "x" else "gdRefY"
                handle = _a(handles, "ahXY", **{attribute: f"adj{name}"})
                other = "vc" if axis == "x" else "hc"
                _a(
                    handle,
                    "pos",
                    x=name if axis == "x" else other,
                    y=name if axis == "y" else other,
                )
    path = _a(_a(geometry, "pathLst"), "path", fill="none")
    for i, (x, y) in enumerate(points):
        command = _a(path, "moveTo" if i == 0 else "lnTo")
        _a(command, "pt", x=names["x", x], y=names["y", y])


def _connector(
    drawing: _Drawing,
    root: Element,
    edge: Edge,
    name: str,
    start: tuple[int, int],
    end: tuple[int, int],
    dx: float,
    dy: float,
) -> None:
    points = _simplify(tuple((x + dx, y + dy) for x, y in edge.points))
    connector = Element(f"{{{_XDR}}}cxnSp")
    visual = _x(connector, "nvCxnSpPr")
    drawing.identity(visual, name)
    connections = _x(visual, "cNvCxnSpPr")
    for tag, (id_, index) in (("stCxn", start), ("endCxn", end)):
        _a(connections, tag, id=str(id_), idx=str(index))
    properties = _x(connector, "spPr")
    if not _preset_connector(properties, points):
        _custom_connector(properties, points)
    _a(properties, "noFill")
    line = _a(properties, "ln", w="14288")
    _a(_a(line, "solidFill"), "srgbClr", val="536B7A")
    _a(line, "prstDash", val="dash" if edge.dashed else "solid")
    _a(line, "round")
    transform = properties.find(f"{{{_A}}}xfrm")
    assert transform is not None
    off, ext = list(transform)[:2]
    anchor = _anchor(
        root,
        int(off.attrib["x"]) / _EMU,
        int(off.attrib["y"]) / _EMU,
        int(ext.attrib["cx"]) / _EMU,
        int(ext.attrib["cy"]) / _EMU,
    )
    anchor.append(connector)
    _x(anchor, "clientData")


def build_er_drawing(graph: ErGraph) -> ExcelErDrawing:
    """Build an editable, all-column diagram using the common ER layout."""
    nodes = build_nodes(graph)["all"]
    # Leave room for distinct endpoint labels on all four table sides.
    degrees: dict[str, int] = defaultdict(int)
    horizontal_ports: dict[str, int] = defaultdict(int)
    original = {node.id: node for node in nodes}
    for relation in graph.relationships:
        degrees[relation.parent_table_id] += 1
        degrees[relation.child_table_id] += 1
        parent, child = original[relation.parent_table_id], original[relation.child_table_id]
        if parent.id != child.id and parent.x == child.x:
            horizontal_ports[parent.id] += 1
            horizontal_ports[child.id] += 1
    sized = {}
    for node in nodes:
        width = max(node.width, (horizontal_ports[node.id] + 1) * 84.0)
        texts = tuple(
            replace(text, x=text.x + width - node.width)
            if text.css_class == "er-column-type"
            else text
            for text in node.texts
        )
        sized[node.id] = replace(
            node, width=width, height=max(node.height, (degrees[node.id] + 1) * 18.0), texts=texts
        )
    positions = initial_positions(graph, sized)
    nodes = tuple(
        replace(node, x=positions[node.id][0], y=positions[node.id][1]) for node in sized.values()
    )
    scene = build_scene(graph, nodes)
    left = min((node.x - _MARGIN for node in nodes), default=0) - 16
    top = min((node.y - _MARGIN for node in nodes), default=0) - 16
    right = max((node.x + node.width + _MARGIN for node in nodes), default=300)
    bottom = max((node.y + node.height + _MARGIN for node in nodes), default=40)
    for edge in scene.edges:
        left = min(left, *(x - 16 for x, _ in edge.points))
        top = min(top, *(y - 16 for _, y in edge.points))
        right = max(right, *(x + 16 for x, _ in edge.points))
        bottom = max(bottom, *(y + 16 for _, y in edge.points))
    dx, dy = -left, 64 - top
    width, height = right + dx + 16, bottom + dy + 16
    if max(width, height) > MAX_SCENE_EXTENT:
        raise DefinitionRenderError(f"Excel ER diagram extent exceeds {MAX_SCENE_EXTENT} pixels.")
    root = Element(f"{{{_XDR}}}wsDr")
    drawing = _Drawing()
    groups: list[Element] = []
    targets: dict[tuple[str, str], tuple[int, int]] = {}
    tables = {table.id: table for table in graph.tables}
    by_id = {node.id: node for node in nodes}
    for node in nodes:
        table = tables[node.id]
        anchor = _anchor(
            root,
            node.x + dx - _MARGIN,
            node.y + dy - _MARGIN,
            node.width + _MARGIN * 2,
            node.height + _MARGIN * 2,
        )
        group = _x(anchor, "grpSp")
        visual = _x(group, "nvGrpSpPr")
        drawing.identity(visual, f"Table: {table.physical_name}")
        _x(visual, "cNvGrpSpPr")
        properties = _x(group, "grpSpPr")
        transform = _transform(
            properties,
            node.x + dx - _MARGIN,
            node.y + dy - _MARGIN,
            node.width + _MARGIN * 2,
            node.height + _MARGIN * 2,
        )
        _a(transform, "chOff", x=_emu(-_MARGIN), y=_emu(-_MARGIN))
        _a(
            transform,
            "chExt",
            cx=_emu(node.width + _MARGIN * 2),
            cy=_emu(node.height + _MARGIN * 2),
        )
        drawing.shape(
            group,
            f"Outline: {table.physical_name}",
            0,
            0,
            node.width,
            node.height,
            fill="FFFFFF",
            stroke="7890A0",
        )
        drawing.shape(
            group,
            f"Header: {table.physical_name}",
            0,
            0,
            node.width,
            node.header_height,
            fill="124E78",
        )
        for i, divider in enumerate(node.dividers):
            drawing.shape(
                group,
                f"Divider: {table.physical_name} {i + 1}",
                0,
                divider,
                node.width,
                0,
                stroke="D5DCE3",
                geometry="line",
            )
        for i, text in enumerate(node.texts):
            if text.value:
                drawing.text(
                    group, f"{table.physical_name}: {text.column_id or 'title'} {i + 1}", text
                )
        _x(anchor, "clientData")
        root.remove(anchor)
        groups.append(anchor)
    # Endpoint text belongs to the table group, so it moves with the table.
    groups_by_id = {
        node.id: group.find(f"{{{_XDR}}}grpSp") for node, group in zip(nodes, groups, strict=True)
    }
    legend = []
    columns = {column.id: column for table in graph.tables for column in table.columns}
    for number, (relation, edge) in enumerate(
        zip(graph.relationships, scene.edges, strict=True), 1
    ):
        for endpoint, id_, cardinality, point in (
            ("parent", relation.parent_table_id, relation.parent_cardinality, edge.points[0]),
            ("child", relation.child_table_id, relation.child_cardinality, edge.points[-1]),
        ):
            node = by_id[id_]
            x, y = point[0] - node.x, point[1] - node.y
            label = f"[{number}] {_CARDINALITY[cardinality]}"
            label_width = text_width(label, 10)
            if x == 0:
                x -= label_width + 5
            elif x == node.width:
                x += 5
            else:
                x -= label_width / 2
                y += 17 if y == node.height else -6
            endpoint_group = groups_by_id[id_]
            assert endpoint_group is not None
            targets[relation.id, endpoint] = _connection_port(
                drawing, endpoint_group, node, point, f"Port: {relation.name} {endpoint}"
            )
            drawing.text(
                endpoint_group, f"Endpoint: {relation.name} {endpoint}", Text(x, y, label, 10)
            )
        _connector(
            drawing,
            root,
            edge,
            f"FK [{number}]: {relation.name}",
            targets[relation.id, "parent"],
            targets[relation.id, "child"],
            dx,
            dy,
        )
        pairs = ", ".join(
            f"{columns[pair.child_column_id].physical_name} → "
            f"{columns[pair.parent_column_id].physical_name}"
            for pair in relation.column_pairs
        )
        legend.append(
            (
                str(number),
                relation.name,
                tables[relation.child_table_id].physical_name,
                tables[relation.parent_table_id].physical_name,
                pairs,
            )
        )
    root.extend(groups)
    if not nodes:
        anchor = _anchor(root, dx, dy, 300, 40)
        drawing.text(anchor, "Empty diagram", Text(dx, dy + 20, "テーブル定義なし", 14))
        _x(anchor, "clientData")
    return ExcelErDrawing(
        tostring(root, encoding="utf-8", xml_declaration=True), width, height, tuple(legend)
    )


def _part(base: str, target: str) -> str:
    return (
        target.lstrip("/")
        if target.startswith("/")
        else posixpath.normpath(posixpath.join(posixpath.dirname(base), target))
    )


def _free_name(names: set[str], template: str) -> str:
    i = 1
    while template.format(i) in names:
        i += 1
    return template.format(i)


def _package_xml(root: Element, namespace: str) -> bytes:
    # OPC readers (including System.IO.Packaging) require unprefixed Types and
    # Relationships roots. Avoid ElementTree's global namespace registration,
    # which would change serialization in the other output formats as well.
    for item in root.iter():
        item.tag = item.tag.removeprefix(f"{{{namespace}}}")
    root.set("xmlns", namespace)
    return tostring(root)


def save_with_er_drawing(
    workbook: Workbook, sheet_title: str, drawing: ExcelErDrawing, output: Path
) -> None:
    """Save cells and inject native drawing parts, atomically replacing output."""
    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    with ZipFile(buffer) as source:
        workbook_xml = fromstring(source.read("xl/workbook.xml"))
        sheets = workbook_xml.findall(f"{{{_S}}}sheets/{{{_S}}}sheet")
        sheet = next(sheet for sheet in sheets if sheet.get("name") == sheet_title)
        workbook_rels = fromstring(source.read("xl/_rels/workbook.xml.rels"))
        sheet_rel = next(rel for rel in workbook_rels if rel.get("Id") == sheet.get(f"{{{_R}}}id"))
        sheet_part = _part("xl/workbook.xml", sheet_rel.attrib["Target"])
        sheet_xml = fromstring(source.read(sheet_part))
        if sheet_xml.find(f"{{{_S}}}drawing") is not None:
            raise DefinitionRenderError("ER worksheet already has a drawing.")
        names = set(source.namelist())
        drawing_part = _free_name(names, "xl/drawings/drawing{}.xml")
        rels_part = posixpath.join(
            posixpath.dirname(sheet_part), "_rels", posixpath.basename(sheet_part) + ".rels"
        )
        rels = (
            fromstring(source.read(rels_part))
            if rels_part in names
            else Element(f"{{{_P}}}Relationships")
        )
        rel_id = _free_name({rel.attrib["Id"] for rel in rels}, "rId{}")
        SubElement(
            rels,
            f"{{{_P}}}Relationship",
            {
                "Id": rel_id,
                "Type": f"{_R}/drawing",
                "Target": posixpath.relpath(drawing_part, posixpath.dirname(sheet_part)),
            },
        )
        # drawing follows legacy page/setup/header elements and precedes extLst.
        reference = Element(f"{{{_S}}}drawing", {f"{{{_R}}}id": rel_id})
        following = {
            f"{{{_S}}}{tag}"
            for tag in (
                "legacyDrawing",
                "legacyDrawingHF",
                "picture",
                "oleObjects",
                "controls",
                "webPublishItems",
                "tableParts",
                "extLst",
            )
        }
        insert_at = next(
            (i for i, item in enumerate(sheet_xml) if item.tag in following), len(sheet_xml)
        )
        sheet_xml.insert(insert_at, reference)
        types = fromstring(source.read("[Content_Types].xml"))
        SubElement(
            types,
            f"{{{_CT}}}Override",
            {"PartName": "/" + drawing_part, "ContentType": _DRAWING_TYPE},
        )
        updates = {
            sheet_part: tostring(sheet_xml),
            rels_part: _package_xml(rels, _P),
            "[Content_Types].xml": _package_xml(types, _CT),
            drawing_part: drawing.xml,
        }
        # Catch malformed XML and broken connector references before replacing a file.
        _validate_drawing(drawing.xml)
        temporary: Path | None = None
        try:
            with NamedTemporaryFile(
                dir=output.parent, prefix=f".{output.name}.", suffix=".tmp", delete=False
            ) as file:
                temporary = Path(file.name)
                with ZipFile(file, "w", compression=ZIP_DEFLATED) as result:
                    for info in source.infolist():
                        if info.filename not in updates:
                            result.writestr(info, source.read(info.filename))
                    for name, data in updates.items():
                        result.writestr(name, data)
            with ZipFile(temporary) as result:
                if result.testzip() is not None:
                    raise DefinitionRenderError("Generated XLSX failed its ZIP integrity check.")
            os.replace(temporary, output)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)


def _validate_drawing(xml: bytes) -> None:
    root = fromstring(xml)
    identities = root.findall(f".//{{{_XDR}}}cNvPr")
    if len({item.attrib["id"] for item in identities}) != len(identities):
        raise DefinitionRenderError("Duplicate Excel drawing shape ID.")
    sites = {}
    for shape in root.findall(f".//{{{_XDR}}}sp"):
        identity = shape.find(f"{{{_XDR}}}nvSpPr/{{{_XDR}}}cNvPr")
        assert identity is not None
        sites[identity.attrib["id"]] = len(
            shape.findall(f"{{{_XDR}}}spPr/{{{_A}}}custGeom/{{{_A}}}cxnLst/{{{_A}}}cxn")
        )
        preset = shape.find(f"{{{_XDR}}}spPr/{{{_A}}}prstGeom")
        if preset is not None and preset.get("prst") == "rect":
            sites[identity.attrib["id"]] = 4
    for connector in root.findall(f".//{{{_XDR}}}cxnSp"):
        for tag in ("stCxn", "endCxn"):
            connection = connector.find(f"{{{_XDR}}}nvCxnSpPr/{{{_XDR}}}cNvCxnSpPr/{{{_A}}}{tag}")
            if connection is None or not 0 <= int(connection.attrib["idx"]) < sites.get(
                connection.attrib["id"], 0
            ):
                raise DefinitionRenderError("Invalid Excel connector attachment.")
