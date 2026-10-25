"""Deterministic ER geometry shared by SVG, Pillow, and the HTML viewer.

No external layout engine is used. Cycles are collapsed for ranking; routing
uses rectilinear corridors outside node interiors. Text is measured with the
bundled Noto font, wrapped without dropping characters, and bounded explicitly.
"""

from __future__ import annotations

import heapq
from collections import defaultdict
from dataclasses import asdict, dataclass, replace
from functools import lru_cache
from importlib.resources import files
from io import BytesIO

from PIL import ImageFont

from db_teigisho.er import ColumnDisplayMode
from db_teigisho.er_graph import ColumnKeyRole, ErGraph, GraphColumn, GraphTable
from db_teigisho.errors import DefinitionRenderError

Point = tuple[float, float]
INK = "#17202a"
BRAND = "#124e78"
MAX_SCENE_EXTENT = 100_000
MAX_TEXT_CHARACTERS = 1_000_000
MAX_TABLES = 500
MAX_RELATIONSHIPS = 2_000
MAX_ROUTE_STATES = 20_000


@dataclass(frozen=True)
class Text:
    x: float
    y: float  # baseline, for both SVG and Pillow
    value: str
    size: int = 12
    color: str = INK
    css_class: str = ""
    column_id: str | None = None


@dataclass(frozen=True)
class Node:
    id: str
    x: float
    y: float
    width: float
    height: float
    header_height: float
    texts: tuple[Text, ...]
    dividers: tuple[float, ...]


@dataclass(frozen=True)
class Edge:
    id: str
    points: tuple[Point, ...]
    dashed: bool


@dataclass(frozen=True)
class Scene:
    nodes: tuple[Node, ...]
    edges: tuple[Edge, ...]
    texts: tuple[Text, ...]
    bounds: tuple[float, float, float, float]


@lru_cache(maxsize=8)
def font(size: float) -> ImageFont.FreeTypeFont:
    # BytesIO also works when package resources are not ordinary filesystem paths.
    resource = files("db_teigisho").joinpath("assets/NotoSansJP[wght].ttf")
    result = ImageFont.truetype(
        BytesIO(resource.read_bytes()), size=size, layout_engine=ImageFont.Layout.BASIC
    )
    result.set_variation_by_axes([400])
    return result


@lru_cache(maxsize=4096)
def text_width(value: str, size: int = 12) -> float:
    return float(font(size).getlength(value))


def wrap_text(value: str, width: float, size: int = 12) -> tuple[str, ...]:
    """Wrap measured Unicode text, including unbroken identifiers and newlines."""
    if any(
        not (
            character in "\t\n\r"
            or " " <= character <= "\ud7ff"
            or "\ue000" <= character <= "\ufffd"
            or "\U00010000" <= character <= "\U0010ffff"
        )
        for character in value
    ):
        raise DefinitionRenderError("ER label contains a character unsupported by XML 1.0.")
    lines = []
    for paragraph in value.splitlines() or [""]:
        line = ""
        length = 0.0
        for character in paragraph:
            advance = text_width(character, size)
            if line and length + advance > width:
                lines.append(line)
                line, length = "", 0.0
            line += character
            length += advance
        lines.append(line)
    return tuple(lines)


def _type(column: GraphColumn) -> str:
    if column.length is None:
        return column.data_type
    dimensions = str(column.length)
    if column.scale is not None:
        dimensions += f",{column.scale}"
    return f"{column.data_type}({dimensions})"


def _node(table: GraphTable, mode: ColumnDisplayMode) -> Node:
    # A common width across modes keeps saved positions and routing stable.
    width = min(
        560.0,
        max(
            300.0,
            *(
                text_width(value, size) + padding
                for value, size, padding in [
                    (table.physical_name, 15, 28),
                    (table.logical_name, 13, 28),
                    *((column.physical_name, 12, 190) for column in table.columns),
                    *((_type(column), 12, 230) for column in table.columns),
                ]
            ),
        ),
    )
    texts: list[Text] = []
    y = 8.0
    for value, size, color in [
        (table.physical_name, 15, "#ffffff"),
        (table.logical_name, 13, "#d9edf7"),
    ]:
        for line in wrap_text(value, width - 28, size):
            y += size + 6
            texts.append(
                Text(
                    14,
                    y,
                    line,
                    size,
                    color,
                    "er-node-physical" if size == 15 else "er-node-logical",
                )
            )
    header = y + 12
    y = header
    dividers = []
    for column in table.columns:
        if mode == "tables" or (
            mode == "keys"
            and not {ColumnKeyRole.PRIMARY_KEY, ColumnKeyRole.FOREIGN_KEY}.intersection(
                column.key_roles
            )
        ):
            continue
        dividers.append(y)
        roles = " ".join(column.key_roles)
        type_lines = wrap_text(_type(column), 120)
        name_lines = wrap_text(column.physical_name, width - 224)
        logical_lines = wrap_text(column.logical_name, width - 76, 11)
        texts.append(Text(12, y + 19, roles, 11, "#0d6b4c", "er-column-roles", column.id))
        for index, line in enumerate(name_lines):
            texts.append(Text(76, y + 19 + index * 18, line, 12, INK, "er-column-name", column.id))
        for index, line in enumerate(type_lines):
            texts.append(
                Text(
                    width - 130,
                    y + 19 + index * 18,
                    line,
                    12,
                    "#5d6d7e",
                    "er-column-type",
                    column.id,
                )
            )
        y += max(len(name_lines), len(type_lines)) * 18 + 6
        for line in logical_lines:
            texts.append(Text(76, y + 13, line, 11, "#5d6d7e", "er-column-logical", column.id))
            y += 17
        y += 6
    return Node(table.id, 0, 0, width, y, header, tuple(texts), tuple(dividers))


def _components(ids: list[str], adjacency: dict[str, set[str]]) -> list[list[str]]:
    remaining = set(ids)
    result = []
    for root in ids:
        if root not in remaining:
            continue
        stack, component = [root], []
        remaining.remove(root)
        while stack:
            current = stack.pop()
            component.append(current)
            for neighbor in sorted(adjacency[current], reverse=True):
                if neighbor in remaining:
                    remaining.remove(neighbor)
                    stack.append(neighbor)
        result.append(component)
    return result


def initial_positions(graph: ErGraph, nodes: dict[str, Node]) -> dict[str, Point]:
    """Rank SCCs and disconnected components like er_auto_layout.js (LR)."""
    by_id = {table.id: table for table in graph.tables}

    def sort_key(id_: str) -> tuple[bytes, str]:
        # Browser compareText uses UTF-16 code-unit order, including non-BMP names.
        return by_id[id_].physical_name.encode("utf-16-be"), id_

    ids = sorted(by_id, key=sort_key)
    outgoing: dict[str, set[str]] = {id_: set() for id_ in ids}
    incoming: dict[str, set[str]] = {id_: set() for id_ in ids}
    for edge in graph.relationships:
        outgoing[edge.parent_table_id].add(edge.child_table_id)
        incoming[edge.child_table_id].add(edge.parent_table_id)
    # Iterative Kosaraju avoids recursion limits for large cycles.
    visited: set[str] = set()
    order = []
    for root in ids:
        stack = [(root, False)]
        while stack:
            current, finished = stack.pop()
            if finished:
                order.append(current)
            elif current not in visited:
                visited.add(current)
                stack.append((current, True))
                stack.extend(
                    (neighbor, False) for neighbor in sorted(outgoing[current], reverse=True)
                )
    sccs = _components(list(reversed(order)), incoming)
    component_by_node = {id_: i for i, component in enumerate(sccs) for id_ in component}
    successors: dict[int, set[int]] = {i: set() for i in range(len(sccs))}
    indegrees = [0] * len(sccs)
    for source in ids:
        for target in outgoing[source]:
            a, b = component_by_node[source], component_by_node[target]
            if a != b and b not in successors[a]:
                successors[a].add(b)
                indegrees[b] += 1
    ranks = [0] * len(sccs)
    ready = [i for i, degree in enumerate(indegrees) if degree == 0]
    while ready:
        current_component = ready.pop()
        for successor in sorted(successors[current_component]):
            ranks[successor] = max(ranks[successor], ranks[current_component] + 1)
            indegrees[successor] -= 1
            if indegrees[successor] == 0:
                ready.append(successor)
    undirected = {id_: outgoing[id_] | incoming[id_] for id_ in ids}
    positions = {}
    component_y = 0.0
    for component in _components(ids, undirected):
        layers: dict[int, list[str]] = defaultdict(list)
        for id_ in component:
            layers[ranks[component_by_node[id_]]].append(id_)
        x, height = 0.0, 0.0
        for rank in sorted(layers):
            layer = sorted(layers[rank], key=sort_key)
            y = 0.0
            for id_ in layer:
                positions[id_] = (x, y + component_y)
                y += nodes[id_].height + 60
            x += max(nodes[id_].width for id_ in layer) + 140
            height = max(height, y - 60)
        component_y += height + 180
    return positions


def build_nodes(graph: ErGraph) -> dict[ColumnDisplayMode, tuple[Node, ...]]:
    size = sum(len(table.model_dump_json()) for table in graph.tables)
    if (
        len(graph.tables) > MAX_TABLES
        or len(graph.relationships) > MAX_RELATIONSHIPS
        or size > MAX_TEXT_CHARACTERS
    ):
        raise DefinitionRenderError(
            "ER diagram exceeds table, relationship, or text safety limits."
        )
    all_nodes = {table.id: _node(table, "all") for table in graph.tables}
    positions = initial_positions(graph, all_nodes)
    result: dict[ColumnDisplayMode, tuple[Node, ...]] = {}
    modes: tuple[ColumnDisplayMode, ...] = ("all", "keys", "tables")
    for mode in modes:
        mode_nodes = []
        for table in graph.tables:
            node = all_nodes[table.id] if mode == "all" else _node(table, mode)
            x, y = positions[table.id]
            mode_nodes.append(replace(node, x=x, y=y))
        result[mode] = tuple(mode_nodes)
    return result


def viewer_geometry(nodes: dict[ColumnDisplayMode, tuple[Node, ...]]) -> dict[str, object]:
    modes = {}
    for mode, mode_nodes in nodes.items():
        geometry = {}
        for node in mode_nodes:
            item = asdict(node)
            item["texts"] = [
                {**asdict(text), "width": text_width(text.value, text.size)} for text in node.texts
            ]
            geometry[node.id] = item
        modes[mode] = geometry
    return {"format_version": "1.0", "modes": modes}


def _blocked(a: Point, b: Point, nodes: tuple[Node, ...]) -> bool:
    # A route may touch an outline, but must never cross a node interior.
    for node in nodes:
        if a[0] == b[0]:
            if (
                node.x < a[0] < node.x + node.width
                and max(a[1], b[1]) > node.y
                and min(a[1], b[1]) < node.y + node.height
            ):
                return True
        elif (
            node.y < a[1] < node.y + node.height
            and max(a[0], b[0]) > node.x
            and min(a[0], b[0]) < node.x + node.width
        ):
            return True
    return False


def _route(start: Point, end: Point, nodes: tuple[Node, ...]) -> tuple[Point, ...]:
    xs = sorted({start[0], end[0], *(p for n in nodes for p in (n.x - 24, n.x + n.width + 24))})
    ys = sorted({start[1], end[1], *(p for n in nodes for p in (n.y - 24, n.y + n.height + 24))})
    source, target = (xs.index(start[0]), ys.index(start[1])), (xs.index(end[0]), ys.index(end[1]))
    # Direction is part of the search state, allowing a deterministic bend penalty.
    queue = [(0.0, 0.0, source, -1)]
    costs = {(source, -1): 0.0}
    previous: dict[tuple[tuple[int, int], int], tuple[tuple[int, int], int]] = {}
    visited_states = 0
    while queue:
        visited_states += 1
        if visited_states > MAX_ROUTE_STATES:
            raise DefinitionRenderError(
                "ER routing exceeds the safety limit; split the definition."
            )
        _, cost, point, direction = heapq.heappop(queue)
        state = (point, direction)
        if cost != costs[state]:
            continue
        if point == target:
            path = [(xs[point[0]], ys[point[1]])]
            while state in previous:
                state = previous[state]
                path.append((xs[state[0][0]], ys[state[0][1]]))
            return tuple(reversed(path))
        for dx, dy, next_direction in [(1, 0, 0), (0, 1, 1), (-1, 0, 0), (0, -1, 1)]:
            neighbor = (point[0] + dx, point[1] + dy)
            if not (0 <= neighbor[0] < len(xs) and 0 <= neighbor[1] < len(ys)):
                continue
            a, b = (xs[point[0]], ys[point[1]]), (xs[neighbor[0]], ys[neighbor[1]])
            if _blocked(a, b, nodes):
                continue
            distance = abs(a[0] - b[0]) + abs(a[1] - b[1])
            next_cost = cost + distance + (20 if direction not in (-1, next_direction) else 0)
            next_state = (neighbor, next_direction)
            if next_cost < costs.get(next_state, float("inf")):
                costs[next_state] = next_cost
                previous[next_state] = (point, direction)
                heuristic = abs(b[0] - end[0]) + abs(b[1] - end[1])
                heapq.heappush(queue, (next_cost + heuristic, next_cost, neighbor, next_direction))
    raise DefinitionRenderError("Could not route ER relationship outside table nodes.")


def build_scene(graph: ErGraph, nodes: tuple[Node, ...]) -> Scene:
    by_id = {node.id: node for node in nodes}
    tables = {table.id: table for table in graph.tables}
    columns = {column.id: column for table in graph.tables for column in table.columns}
    edges, texts = [], []
    # Allocate distinct ports for parallel FKs, cycles, and both ends of self FKs.
    ends: dict[tuple[str, str], list[tuple[int, str]]] = defaultdict(list)
    sides: dict[tuple[int, str], str] = {}
    for i, relation in enumerate(graph.relationships):
        a, b = by_id[relation.parent_table_id], by_id[relation.child_table_id]
        if a.id == b.id:
            pair = ("right", "right")
        elif a.x != b.x:
            pair = ("right", "left") if a.x < b.x else ("left", "right")
        else:
            pair = ("bottom", "top") if a.y < b.y else ("top", "bottom")
        for endpoint, node, side in zip(("parent", "child"), (a, b), pair, strict=True):
            ends[node.id, side].append((i, endpoint))
            sides[i, endpoint] = side

    def port(i: int, end: str, node: Node) -> Point:
        side = sides[i, end]
        group = ends[node.id, side]
        fraction = (group.index((i, end)) + 1) / (len(group) + 1)
        if side in ("left", "right"):
            return node.x + (node.width if side == "right" else 0), node.y + node.height * fraction
        return node.x + node.width * fraction, node.y + (node.height if side == "bottom" else 0)

    def stub(point: Point, side: str) -> Point:
        dx, dy = {"left": (-24, 0), "right": (24, 0), "top": (0, -24), "bottom": (0, 24)}[side]
        return point[0] + dx, point[1] + dy

    for i, relation in enumerate(graph.relationships):
        a, b = by_id[relation.parent_table_id], by_id[relation.child_table_id]
        start, end = port(i, "parent", a), port(i, "child", b)
        first, last = stub(start, sides[i, "parent"]), stub(end, sides[i, "child"])
        path = (start, *_route(first, last, nodes), end)
        edges.append(Edge(relation.id, path, relation.relationship_type == "non_identifying"))
        # Merge collinear runs for label placement (the routed polyline itself
        # retains its ports). Tiny grid segments must not push labels onto nodes.
        runs = [path[0]]
        for point in path[1:]:
            if len(runs) >= 2 and (
                runs[-2][0] == runs[-1][0] == point[0] or runs[-2][1] == runs[-1][1] == point[1]
            ):
                runs[-1] = point
            else:
                runs.append(point)
        longest = max(
            zip(runs, runs[1:], strict=False),
            key=lambda segment: (
                abs(segment[0][0] - segment[1][0]) + abs(segment[0][1] - segment[1][1])
            ),
        )
        label = f"[{i + 1}]"
        middle_x = (longest[0][0] + longest[1][0]) / 2
        middle_y = (longest[0][1] + longest[1][1]) / 2
        horizontal = longest[0][1] == longest[1][1]
        texts.append(
            Text(
                middle_x - text_width(label, 11) / 2
                if horizontal
                else middle_x - text_width(label, 11) - 5,
                middle_y + 18 if horizontal else middle_y + 4,
                label,
                11,
            )
        )
        for point, side, cardinality in [
            (start, sides[i, "parent"], relation.parent_cardinality),
            (end, sides[i, "child"], relation.child_cardinality),
        ]:
            label = {"exactly_one": "1", "zero_or_one": "0..1", "zero_or_many": "0..N"}[cardinality]
            x = (
                point[0] + 3
                if side in ("right", "top", "bottom")
                else point[0] - text_width(label, 10) - 3
            )
            y = point[1] - 5 if side != "bottom" else point[1] + 16
            texts.append(Text(x, y, label, 10))

    # Full names and ordered column mappings live in a wrapped legend so long
    # FK names cannot cover nodes or be clipped along short edge segments.
    max_x = max((node.x + node.width for node in nodes), default=300)
    max_y = max((node.y + node.height for node in nodes), default=40.0)
    for edge in edges:
        max_y = max(max_y, *(point[1] for point in edge.points))
    y = max_y + 40
    if not nodes:
        texts.append(Text(0, 20, "テーブル定義なし", 14))
    if edges:
        texts.append(Text(0, y, "1: exactly one / 0..1: zero or one / 0..N: zero or many", 12))
        y += 22
        texts.append(
            Text(0, y, "Solid: identifying (PK subset or CASCADE); dashed: non-identifying", 12)
        )
        y += 26
    for i, relation in enumerate(graph.relationships):
        parent, child = tables[relation.parent_table_id], tables[relation.child_table_id]
        pairs = ", ".join(
            f"{columns[pair.child_column_id].physical_name} → "
            f"{columns[pair.parent_column_id].physical_name}"
            for pair in relation.column_pairs
        )
        label = (
            f"[{i + 1}] {relation.name}: {child.physical_name} → {parent.physical_name} ({pairs})"
        )
        for line in wrap_text(label, max(500, min(max_x, 1200))):
            texts.append(Text(0, y, line))
            y += 20
        y += 6
    xs, ys = [0.0, max_x], [0.0, max_y]
    for edge in edges:
        xs.extend(point[0] for point in edge.points)
        ys.extend(point[1] for point in edge.points)
    for text in texts:
        xs.extend((text.x, text.x + text_width(text.value, text.size)))
        ys.extend((text.y - text.size * 1.5, text.y + text.size * 0.5))
    x0, y0 = min(xs) - 32, min(ys) - 32
    width, height = max(xs) + 32 - x0, max(ys) + 32 - y0
    if max(width, height) > MAX_SCENE_EXTENT:
        raise DefinitionRenderError(f"ER diagram extent exceeds {MAX_SCENE_EXTENT} units.")
    return Scene(nodes, tuple(edges), tuple(texts), (x0, y0, width, height))
