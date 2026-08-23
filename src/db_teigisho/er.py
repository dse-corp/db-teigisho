"""Mermaid ER diagram generation from validated database definitions."""

from __future__ import annotations

from typing import Literal, TypeGuard

from db_teigisho.models import (
    ColumnDefinition,
    DatabaseDefinition,
    ForeignKeyDefinition,
    TableDefinition,
)

ColumnDisplayMode = Literal["all", "keys", "tables"]
_COLUMN_DISPLAY_MODES: frozenset[str] = frozenset({"all", "keys", "tables"})


def _is_column_display_mode(value: str) -> TypeGuard[ColumnDisplayMode]:
    return value in _COLUMN_DISPLAY_MODES


def _key(value: str) -> str:
    return value.casefold()


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


def _foreign_key_columns(table: TableDefinition) -> set[str]:
    return {
        _key(column_name)
        for foreign_key in table.foreign_keys
        for column_name in foreign_key.columns
    }


def _column_keys(
    table: TableDefinition, column_name: str, foreign_key_columns: set[str]
) -> list[str]:
    column = next(column for column in table.columns if column.physical_name == column_name)
    keys: list[str] = []
    if column.primary_key:
        keys.append("PK")
    if _key(column_name) in foreign_key_columns:
        keys.append("FK")
    if column.unique:
        keys.append("UK")
    return keys


def _entity_lines(table: TableDefinition, number: int, column_mode: ColumnDisplayMode) -> list[str]:
    entity_id = f"table_{number}"
    label = _mermaid_text(f"{table.physical_name} / {table.logical_name}")
    if column_mode == "tables":
        return [f'    {entity_id}["{label}"]']

    foreign_key_columns = _foreign_key_columns(table)
    columns = table.columns
    if column_mode == "keys":
        columns = [
            column
            for column in columns
            if column.primary_key or _key(column.physical_name) in foreign_key_columns
        ]

    lines = [f'    {entity_id}["{label}"] {{']
    for column_number, column in enumerate(columns, start=1):
        data_type = _attribute_token(column.data_type, "type")
        name = _attribute_token(column.physical_name, f"column_{column_number}")
        keys = _column_keys(table, column.physical_name, foreign_key_columns)
        key_suffix = f" {', '.join(keys)}" if keys else ""
        comment = _mermaid_text(f"{column.physical_name} / {column.logical_name}")
        lines.append(f'        {data_type} {name}{key_suffix} "{comment}"')
    lines.append("    }")
    return lines


def _local_columns(
    table: TableDefinition, foreign_key: ForeignKeyDefinition
) -> list[ColumnDefinition]:
    by_name = {_key(column.physical_name): column for column in table.columns}
    return [by_name[_key(column_name)] for column_name in foreign_key.columns]


def _is_unique_foreign_key(table: TableDefinition, foreign_key: ForeignKeyDefinition) -> bool:
    foreign_columns = [_key(column_name) for column_name in foreign_key.columns]
    primary_key_columns = [
        _key(column.physical_name) for column in table.columns if column.primary_key
    ]
    if foreign_columns == primary_key_columns:
        return True
    if len(foreign_columns) == 1:
        return _local_columns(table, foreign_key)[0].unique
    return any(
        index.unique
        and index.where is None
        and [_key(column.name) for column in index.columns] == foreign_columns
        for index in table.indexes
    )


def _is_identifying_foreign_key(table: TableDefinition, foreign_key: ForeignKeyDefinition) -> bool:
    primary_key_columns = {
        _key(column.physical_name) for column in table.columns if column.primary_key
    }
    foreign_columns = {_key(column_name) for column_name in foreign_key.columns}
    return foreign_key.on_delete == "CASCADE" or foreign_columns <= primary_key_columns


def _relationship_line(
    table: TableDefinition,
    foreign_key: ForeignKeyDefinition,
    table_ids: dict[str, str],
) -> str:
    local_columns = _local_columns(table, foreign_key)
    parent_cardinality = "||" if all(column.not_null for column in local_columns) else "|o"
    child_cardinality = "||" if _is_unique_foreign_key(table, foreign_key) else "o{"
    connector = "--" if _is_identifying_foreign_key(table, foreign_key) else ".."
    parent_id = table_ids[_key(foreign_key.referenced_table)]
    child_id = table_ids[_key(table.physical_name)]
    label = _mermaid_text(foreign_key.name)
    relationship = f"{parent_cardinality}{connector}{child_cardinality}"
    return f'    {parent_id} {relationship} {child_id} : "{label}"'


def render_mermaid(definition: DatabaseDefinition, column_mode: str = "all") -> str:
    """Return a deterministic Mermaid ER diagram for a validated definition."""

    if not _is_column_display_mode(column_mode):
        raise ValueError(f"Unsupported column_mode: {column_mode}")
    table_ids = {
        _key(table.physical_name): f"table_{number}"
        for number, table in enumerate(definition.tables, 1)
    }
    lines = ["erDiagram", "direction LR"]
    for table in definition.tables:
        for foreign_key in table.foreign_keys:
            lines.append(_relationship_line(table, foreign_key, table_ids))
    for number, table in enumerate(definition.tables, start=1):
        lines.extend(_entity_lines(table, number, column_mode))
    return "\n".join(lines) + "\n"
