"""Typed graph data for ER diagram renderers and browser viewers."""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict

from db_teigisho.models import (
    DatabaseDefinition,
    ForeignKeyAction,
    ForeignKeyDefinition,
    ScalarDefault,
    TableDefinition,
)


class ColumnKeyRole(StrEnum):
    """A key marker displayed beside an ER diagram column."""

    PRIMARY_KEY = "PK"
    FOREIGN_KEY = "FK"
    UNIQUE_KEY = "UK"


class Cardinality(StrEnum):
    """Cardinality at one end of an ER relationship."""

    ZERO_OR_ONE = "zero_or_one"
    EXACTLY_ONE = "exactly_one"
    ZERO_OR_MANY = "zero_or_many"


class RelationshipType(StrEnum):
    """Whether a foreign key identifies the child row."""

    IDENTIFYING = "identifying"
    NON_IDENTIFYING = "non_identifying"


ParentCardinality = Literal[Cardinality.ZERO_OR_ONE, Cardinality.EXACTLY_ONE]
ChildCardinality = Literal[Cardinality.EXACTLY_ONE, Cardinality.ZERO_OR_MANY]


class GraphModel(BaseModel):
    """Immutable base for the public graph data contract."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class GraphColumn(GraphModel):
    """A column node nested under a table node."""

    id: str
    physical_name: str
    logical_name: str
    data_type: str
    length: int | None
    scale: int | None
    default: ScalarDefault
    not_null: bool
    description: str | None
    key_roles: tuple[ColumnKeyRole, ...]


class GraphTable(GraphModel):
    """A table node in YAML definition order."""

    id: str
    physical_name: str
    logical_name: str
    description: str | None
    columns: tuple[GraphColumn, ...]


class GraphColumnPair(GraphModel):
    """One local-to-referenced column mapping within a foreign key."""

    parent_column_id: str
    child_column_id: str


class GraphRelationship(GraphModel):
    """A directed foreign-key relationship from parent to child."""

    id: str
    name: str
    parent_table_id: str
    child_table_id: str
    column_pairs: tuple[GraphColumnPair, ...]
    parent_cardinality: ParentCardinality
    child_cardinality: ChildCardinality
    relationship_type: RelationshipType
    on_update: ForeignKeyAction
    on_delete: ForeignKeyAction
    deferrable: bool


class ErGraph(GraphModel):
    """Versioned, deterministic graph data derived from one definition."""

    format_version: Literal["1.0"] = "1.0"
    tables: tuple[GraphTable, ...]
    relationships: tuple[GraphRelationship, ...]


def _key(value: str) -> str:
    return value.casefold()


def _foreign_key_columns(table: TableDefinition) -> set[str]:
    return {
        _key(column_name)
        for foreign_key in table.foreign_keys
        for column_name in foreign_key.columns
    }


def _column_key_roles(
    table: TableDefinition, column_name: str, foreign_key_columns: set[str]
) -> tuple[ColumnKeyRole, ...]:
    column = next(column for column in table.columns if column.physical_name == column_name)
    roles: list[ColumnKeyRole] = []
    if column.primary_key:
        roles.append(ColumnKeyRole.PRIMARY_KEY)
    if _key(column_name) in foreign_key_columns:
        roles.append(ColumnKeyRole.FOREIGN_KEY)
    if column.unique:
        roles.append(ColumnKeyRole.UNIQUE_KEY)
    return tuple(roles)


def _local_columns(table: TableDefinition, foreign_key: ForeignKeyDefinition) -> list[str]:
    by_name = {_key(column.physical_name): column.physical_name for column in table.columns}
    return [by_name[_key(column_name)] for column_name in foreign_key.columns]


def _is_unique_foreign_key(table: TableDefinition, foreign_key: ForeignKeyDefinition) -> bool:
    foreign_columns = [_key(column_name) for column_name in foreign_key.columns]
    primary_key_columns = [
        _key(column.physical_name) for column in table.columns if column.primary_key
    ]
    if foreign_columns == primary_key_columns:
        return True
    if len(foreign_columns) == 1:
        column_name = _local_columns(table, foreign_key)[0]
        return next(
            column.unique for column in table.columns if column.physical_name == column_name
        )
    return any(
        index.unique
        and index.where is None
        and [_key(column.name) for column in index.columns] == foreign_columns
        for index in table.indexes
    )


def _is_identifying_foreign_key(
    table: TableDefinition, foreign_key: ForeignKeyDefinition
) -> bool:
    primary_key_columns = {
        _key(column.physical_name) for column in table.columns if column.primary_key
    }
    foreign_columns = {_key(column_name) for column_name in foreign_key.columns}
    return foreign_key.on_delete == "CASCADE" or foreign_columns <= primary_key_columns


def _graph_tables(definition: DatabaseDefinition) -> tuple[GraphTable, ...]:
    tables: list[GraphTable] = []
    for table_number, table in enumerate(definition.tables, start=1):
        table_id = f"table_{table_number}"
        foreign_key_columns = _foreign_key_columns(table)
        columns = tuple(
            GraphColumn(
                id=f"{table_id}_column_{column_number}",
                physical_name=column.physical_name,
                logical_name=column.logical_name,
                data_type=column.data_type,
                length=column.length,
                scale=column.scale,
                default=column.default,
                not_null=column.not_null,
                description=column.description,
                key_roles=_column_key_roles(
                    table, column.physical_name, foreign_key_columns
                ),
            )
            for column_number, column in enumerate(table.columns, start=1)
        )
        tables.append(
            GraphTable(
                id=table_id,
                physical_name=table.physical_name,
                logical_name=table.logical_name,
                description=table.description,
                columns=columns,
            )
        )
    return tuple(tables)


def _graph_relationships(
    definition: DatabaseDefinition, graph_tables: tuple[GraphTable, ...]
) -> tuple[GraphRelationship, ...]:
    table_ids = {
        _key(table.physical_name): graph_table.id
        for table, graph_table in zip(definition.tables, graph_tables, strict=True)
    }
    column_ids = {
        (_key(table.physical_name), _key(column.physical_name)): graph_column.id
        for table, graph_table in zip(definition.tables, graph_tables, strict=True)
        for column, graph_column in zip(table.columns, graph_table.columns, strict=True)
    }
    relationships: list[GraphRelationship] = []
    for table in definition.tables:
        child_table_key = _key(table.physical_name)
        local_columns = {
            _key(column.physical_name): column for column in table.columns
        }
        for foreign_key in table.foreign_keys:
            parent_table_key = _key(foreign_key.referenced_table)
            relationship_number = len(relationships) + 1
            pairs = tuple(
                GraphColumnPair(
                    parent_column_id=column_ids[
                        (parent_table_key, _key(parent_column_name))
                    ],
                    child_column_id=column_ids[
                        (child_table_key, _key(child_column_name))
                    ],
                )
                for child_column_name, parent_column_name in zip(
                    foreign_key.columns,
                    foreign_key.referenced_columns,
                    strict=True,
                )
            )
            parent_cardinality: ParentCardinality = (
                Cardinality.EXACTLY_ONE
                if all(
                    local_columns[_key(column_name)].not_null
                    for column_name in foreign_key.columns
                )
                else Cardinality.ZERO_OR_ONE
            )
            child_cardinality: ChildCardinality = (
                Cardinality.EXACTLY_ONE
                if _is_unique_foreign_key(table, foreign_key)
                else Cardinality.ZERO_OR_MANY
            )
            relationship_type = (
                RelationshipType.IDENTIFYING
                if _is_identifying_foreign_key(table, foreign_key)
                else RelationshipType.NON_IDENTIFYING
            )
            relationships.append(
                GraphRelationship(
                    id=f"relationship_{relationship_number}",
                    name=foreign_key.name,
                    parent_table_id=table_ids[parent_table_key],
                    child_table_id=table_ids[child_table_key],
                    column_pairs=pairs,
                    parent_cardinality=parent_cardinality,
                    child_cardinality=child_cardinality,
                    relationship_type=relationship_type,
                    on_update=foreign_key.on_update,
                    on_delete=foreign_key.on_delete,
                    deferrable=foreign_key.deferrable,
                )
            )
    return tuple(relationships)


def build_er_graph(definition: DatabaseDefinition) -> ErGraph:
    """Build graph data in table, column, and foreign-key definition order."""

    tables = _graph_tables(definition)
    return ErGraph(tables=tables, relationships=_graph_relationships(definition, tables))
