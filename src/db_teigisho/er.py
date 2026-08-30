"""Mermaid ER diagram generation from typed ER graph data."""

from __future__ import annotations

from typing import Literal, TypeGuard

from db_teigisho.er_graph import (
    Cardinality,
    ColumnKeyRole,
    GraphRelationship,
    GraphTable,
    RelationshipType,
    build_er_graph,
)
from db_teigisho.models import DatabaseDefinition

ColumnDisplayMode = Literal["all", "keys", "tables"]
_COLUMN_DISPLAY_MODES: frozenset[str] = frozenset({"all", "keys", "tables"})


def _is_column_display_mode(value: str) -> TypeGuard[ColumnDisplayMode]:
    return value in _COLUMN_DISPLAY_MODES


def _mermaid_text(value: str) -> str:
    """Normalize text for a Mermaid quoted label or attribute comment."""

    return " ".join(value.replace('"', "'").replace("\\", "/").split())


def _attribute_token(value: str, fallback: str) -> str:
    normalized = "".join(
        character if character.isascii() and (character.isalnum() or character in "-_[]()")
        else "_"
        for character in value
    ).strip("_")
    if not normalized or not normalized[0].isalpha():
        return fallback
    return normalized


def _entity_lines(table: GraphTable, column_mode: ColumnDisplayMode) -> list[str]:
    label = _mermaid_text(f"{table.physical_name} / {table.logical_name}")
    if column_mode == "tables":
        return [f'    {table.id}["{label}"]']

    columns = table.columns
    if column_mode == "keys":
        columns = tuple(
            column
            for column in columns
            if ColumnKeyRole.PRIMARY_KEY in column.key_roles
            or ColumnKeyRole.FOREIGN_KEY in column.key_roles
        )

    lines = [f'    {table.id}["{label}"] {{']
    for column_number, column in enumerate(columns, start=1):
        data_type = _attribute_token(column.data_type, "type")
        name = _attribute_token(column.physical_name, f"column_{column_number}")
        key_suffix = (
            f" {', '.join(role.value for role in column.key_roles)}"
            if column.key_roles
            else ""
        )
        comment = _mermaid_text(f"{column.physical_name} / {column.logical_name}")
        lines.append(f'        {data_type} {name}{key_suffix} "{comment}"')
    lines.append("    }")
    return lines


def _relationship_line(relationship: GraphRelationship) -> str:
    parent_cardinality = {
        Cardinality.ZERO_OR_ONE: "|o",
        Cardinality.EXACTLY_ONE: "||",
    }[relationship.parent_cardinality]
    child_cardinality = {
        Cardinality.EXACTLY_ONE: "||",
        Cardinality.ZERO_OR_MANY: "o{",
    }[relationship.child_cardinality]
    connector = (
        "--"
        if relationship.relationship_type is RelationshipType.IDENTIFYING
        else ".."
    )
    label = _mermaid_text(relationship.name)
    marker = f"{parent_cardinality}{connector}{child_cardinality}"
    return (
        f"    {relationship.parent_table_id} {marker} "
        f'{relationship.child_table_id} : "{label}"'
    )


def render_mermaid(definition: DatabaseDefinition, column_mode: str = "all") -> str:
    """Return a deterministic Mermaid ER diagram for a validated definition."""

    if not _is_column_display_mode(column_mode):
        raise ValueError(f"Unsupported column_mode: {column_mode}")
    graph = build_er_graph(definition)
    lines = ["erDiagram", "direction LR"]
    lines.extend(_relationship_line(relationship) for relationship in graph.relationships)
    for table in graph.tables:
        lines.extend(_entity_lines(table, column_mode))
    return "\n".join(lines) + "\n"
