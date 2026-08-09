"""Cross-object semantic validation beyond JSON Schema."""

from __future__ import annotations

from collections.abc import Iterable

from db_teigisho.errors import ValidationIssue
from db_teigisho.models import DatabaseDefinition, TableDefinition


def _key(value: str) -> str:
    return value.casefold()


def _duplicates(values: Iterable[str]) -> set[str]:
    seen: set[str] = set()
    duplicate: set[str] = set()
    for value in values:
        key = _key(value)
        if key in seen:
            duplicate.add(value)
        seen.add(key)
    return duplicate


def _table_issues(table: TableDefinition, table_index: int) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    base = f"tables.{table_index}"
    column_names = {_key(column.physical_name) for column in table.columns}

    for name in sorted(_duplicates(column.physical_name for column in table.columns)):
        issues.append(
            ValidationIssue(
                f"{base}.columns",
                "duplicate_column",
                f"Column physical name is duplicated: {name}",
            )
        )

    for column_index, column in enumerate(table.columns):
        if column.primary_key and not column.not_null:
            issues.append(
                ValidationIssue(
                    f"{base}.columns.{column_index}.not_null",
                    "primary_key_not_null",
                    "A primary key column must be NOT NULL.",
                )
            )
        if column.scale is not None and column.length is None:
            issues.append(
                ValidationIssue(
                    f"{base}.columns.{column_index}.scale",
                    "scale_requires_length",
                    "scale requires length/precision.",
                )
            )
        if column.scale is not None and column.length is not None and column.scale > column.length:
            issues.append(
                ValidationIssue(
                    f"{base}.columns.{column_index}.scale",
                    "scale_exceeds_length",
                    "scale cannot exceed length/precision.",
                )
            )

    for name in sorted(_duplicates(index.name for index in table.indexes)):
        issues.append(
            ValidationIssue(
                f"{base}.indexes", "duplicate_index", f"Index name is duplicated: {name}"
            )
        )

    for index_number, index in enumerate(table.indexes):
        index_base = f"{base}.indexes.{index_number}"
        referenced = [item.name for item in index.columns]
        for name in referenced + index.include_columns:
            if _key(name) not in column_names:
                issues.append(
                    ValidationIssue(
                        index_base,
                        "index_column_missing",
                        f"Index references a missing column: {name}",
                    )
                )
        for name in sorted(_duplicates(referenced + index.include_columns)):
            issues.append(
                ValidationIssue(
                    index_base,
                    "duplicate_index_column",
                    f"Index references the same column more than once: {name}",
                )
            )

    for name in sorted(_duplicates(foreign_key.name for foreign_key in table.foreign_keys)):
        issues.append(
            ValidationIssue(
                f"{base}.foreign_keys",
                "duplicate_foreign_key",
                f"Foreign key name is duplicated: {name}",
            )
        )

    return issues


def semantic_issues(definition: DatabaseDefinition) -> list[ValidationIssue]:
    """Return all cross-field and cross-object issues without failing fast."""

    issues: list[ValidationIssue] = []
    if definition.document.updated_at < definition.document.created_at:
        issues.append(
            ValidationIssue(
                "document.updated_at",
                "timestamps_out_of_order",
                "updated_at must be equal to or later than created_at.",
            )
        )

    for name in sorted(_duplicates(table.physical_name for table in definition.tables)):
        issues.append(
            ValidationIssue(
                "tables", "duplicate_table", f"Table physical name is duplicated: {name}"
            )
        )
    for name in sorted(_duplicates(view.physical_name for view in definition.views)):
        issues.append(
            ValidationIssue("views", "duplicate_view", f"View physical name is duplicated: {name}")
        )
    for name in sorted(_duplicates(proc.physical_name for proc in definition.stored_procedures)):
        issues.append(
            ValidationIssue(
                "stored_procedures",
                "duplicate_stored_procedure",
                f"Stored procedure physical name is duplicated: {name}",
            )
        )

    relation_names = [table.physical_name for table in definition.tables] + [
        view.physical_name for view in definition.views
    ]
    for name in sorted(_duplicates(relation_names)):
        issues.append(
            ValidationIssue(
                "tables/views",
                "duplicate_relation",
                f"Table and view physical names collide: {name}",
            )
        )

    table_by_name = {_key(table.physical_name): table for table in definition.tables}
    for table_index, table in enumerate(definition.tables):
        issues.extend(_table_issues(table, table_index))
        local_columns = {_key(column.physical_name): column for column in table.columns}
        for fk_index, foreign_key in enumerate(table.foreign_keys):
            base = f"tables.{table_index}.foreign_keys.{fk_index}"
            if len(foreign_key.columns) != len(foreign_key.referenced_columns):
                issues.append(
                    ValidationIssue(
                        base,
                        "foreign_key_arity",
                        "Local and referenced foreign key column counts must match.",
                    )
                )
            for name in foreign_key.columns:
                if _key(name) not in local_columns:
                    issues.append(
                        ValidationIssue(
                            f"{base}.columns",
                            "foreign_column_missing",
                            f"Foreign key references a missing local column: {name}",
                        )
                    )
            referenced_table = table_by_name.get(_key(foreign_key.referenced_table))
            if referenced_table is None:
                issues.append(
                    ValidationIssue(
                        f"{base}.referenced_table",
                        "foreign_table_missing",
                        f"Referenced table does not exist: {foreign_key.referenced_table}",
                    )
                )
                continue
            referenced_names = {_key(column.physical_name) for column in referenced_table.columns}
            for name in foreign_key.referenced_columns:
                if _key(name) not in referenced_names:
                    issues.append(
                        ValidationIssue(
                            f"{base}.referenced_columns",
                            "foreign_referenced_column_missing",
                            f"Referenced column does not exist: {name}",
                        )
                    )
            if foreign_key.on_delete == "SET NULL":
                for name in foreign_key.columns:
                    column = local_columns.get(_key(name))
                    if column is not None and column.not_null:
                        issues.append(
                            ValidationIssue(
                                f"{base}.on_delete",
                                "set_null_on_not_null",
                                f"SET NULL cannot target NOT NULL column: {name}",
                            )
                        )

    return issues
