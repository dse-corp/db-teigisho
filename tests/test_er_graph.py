from __future__ import annotations

from copy import deepcopy
from typing import Any

import pytest
from pydantic import ValidationError

from db_teigisho.er_graph import (
    Cardinality,
    ColumnKeyRole,
    RelationshipType,
    build_er_graph,
)
from db_teigisho.models import DatabaseDefinition


def _definition(data: dict[str, Any]) -> DatabaseDefinition:
    return DatabaseDefinition.model_validate(data)


def test_rejects_non_finite_defaults_that_json_cannot_represent(
    valid_definition: dict[str, Any],
) -> None:
    data = deepcopy(valid_definition)
    data["tables"][0]["columns"][0]["default"] = float("nan")

    with pytest.raises(ValidationError, match="finite number"):
        _definition(data)


def test_builds_a_deterministic_ordered_graph_contract(
    valid_definition: dict[str, Any],
) -> None:
    definition = _definition(valid_definition)

    graph = build_er_graph(definition)

    assert graph.format_version == "1.0"
    assert [table.id for table in graph.tables] == ["table_1", "table_2"]
    assert [table.physical_name for table in graph.tables] == ["customers", "orders"]
    assert [column.physical_name for column in graph.tables[1].columns] == [
        "order_id",
        "customer_id",
        "amount",
    ]
    assert graph.tables[0].columns[0].key_roles == (
        ColumnKeyRole.PRIMARY_KEY,
        ColumnKeyRole.UNIQUE_KEY,
    )
    assert graph.tables[1].columns[1].key_roles == (ColumnKeyRole.FOREIGN_KEY,)
    assert graph.tables[0].columns[0].unique is True
    assert graph.tables[0].columns[0].primary_key is True
    assert graph.tables[0].indexes[0].name == "idx_customers_email"
    assert graph.tables[0].indexes[0].columns[0].name == "email"
    assert graph.tables[1].foreign_keys[0].columns == ("customer_id",)
    assert graph.tables[1].foreign_keys[0].referenced_table == "customers"

    relationship = graph.relationships[0]
    assert relationship.id == "relationship_1"
    assert relationship.name == "fk_orders_customers"
    assert relationship.parent_table_id == "table_1"
    assert relationship.child_table_id == "table_2"
    assert relationship.parent_cardinality is Cardinality.EXACTLY_ONE
    assert relationship.child_cardinality is Cardinality.ZERO_OR_MANY
    assert relationship.relationship_type is RelationshipType.NON_IDENTIFYING
    assert [
        (pair.parent_column_id, pair.child_column_id) for pair in relationship.column_pairs
    ] == [("table_1_column_1", "table_2_column_2")]
    assert graph.model_dump(mode="json") == build_er_graph(definition).model_dump(mode="json")


def test_represents_composite_self_and_cyclic_relationship_inference(
    valid_definition: dict[str, Any],
) -> None:
    data = deepcopy(valid_definition)
    customers = data["tables"][0]
    orders = data["tables"][1]
    customers["columns"].extend(
        [
            {
                "physical_name": "parent_customer_id",
                "logical_name": "親顧客ID",
                "data_type": "uuid",
                "not_null": False,
                "unique": False,
                "primary_key": False,
            },
            {
                "physical_name": "latest_order_id",
                "logical_name": "最新受注ID",
                "data_type": "bigint",
                "not_null": True,
                "unique": True,
                "primary_key": False,
            },
        ]
    )
    customers["foreign_keys"].extend(
        [
            {
                "name": "fk_customers_parent",
                "columns": ["parent_customer_id"],
                "referenced_table": "customers",
                "referenced_columns": ["customer_id"],
                "on_delete": "NO ACTION",
            },
            {
                "name": "fk_customers_latest_order",
                "columns": ["latest_order_id"],
                "referenced_table": "orders",
                "referenced_columns": ["order_id"],
                "on_delete": "NO ACTION",
            },
        ]
    )
    orders["columns"].append(
        {
            "physical_name": "customer_email",
            "logical_name": "顧客メールアドレス",
            "data_type": "varchar",
            "not_null": True,
            "unique": False,
            "primary_key": False,
        }
    )
    orders["foreign_keys"][0]["columns"] = ["customer_id", "customer_email"]
    orders["foreign_keys"][0]["referenced_columns"] = ["customer_id", "email"]
    orders["foreign_keys"][0]["on_delete"] = "CASCADE"
    orders["indexes"].append(
        {
            "name": "uq_orders_customer",
            "type": "btree",
            "unique": True,
            "columns": [
                {"name": "customer_id", "order": "ASC"},
                {"name": "customer_email", "order": "ASC"},
            ],
        }
    )

    graph = build_er_graph(_definition(data))

    assert [relationship.name for relationship in graph.relationships] == [
        "fk_customers_parent",
        "fk_customers_latest_order",
        "fk_orders_customers",
    ]
    self_reference, cyclic_reference, composite = graph.relationships
    assert self_reference.parent_table_id == self_reference.child_table_id == "table_1"
    assert self_reference.parent_cardinality is Cardinality.ZERO_OR_ONE
    assert self_reference.child_cardinality is Cardinality.ZERO_OR_MANY
    assert self_reference.relationship_type is RelationshipType.NON_IDENTIFYING
    assert cyclic_reference.parent_table_id == "table_2"
    assert cyclic_reference.child_table_id == "table_1"
    assert cyclic_reference.parent_cardinality is Cardinality.EXACTLY_ONE
    assert cyclic_reference.child_cardinality is Cardinality.ZERO_OR_ONE
    assert cyclic_reference.relationship_type is RelationshipType.NON_IDENTIFYING
    assert len(composite.column_pairs) == 2
    assert graph.tables[1].foreign_keys[0].columns == (
        "customer_id",
        "customer_email",
    )
    assert graph.tables[1].foreign_keys[0].referenced_columns == (
        "customer_id",
        "email",
    )
    assert composite.parent_cardinality is Cardinality.EXACTLY_ONE
    assert composite.child_cardinality is Cardinality.ZERO_OR_ONE
    assert composite.relationship_type is RelationshipType.IDENTIFYING


@pytest.mark.parametrize("source", ["column", "index", "primary_key"])
@pytest.mark.parametrize("nullable", [False, True])
def test_unique_fk_never_requires_a_child_row(
    valid_definition: dict[str, Any],
    source: str,
    nullable: bool,
) -> None:
    child = valid_definition["tables"][1]
    foreign_column = child["columns"][1]
    foreign_column["not_null"] = not nullable
    if source == "column":
        foreign_column["unique"] = True
    elif source == "index":
        child["indexes"][0]["unique"] = True
    else:
        child["columns"][0]["primary_key"] = False
        foreign_column["primary_key"] = True
        foreign_column["not_null"] = True
    relationship = build_er_graph(_definition(valid_definition)).relationships[0]
    assert relationship.child_cardinality is Cardinality.ZERO_OR_ONE
    assert relationship.parent_cardinality is (
        Cardinality.ZERO_OR_ONE if nullable and source != "primary_key" else Cardinality.EXACTLY_ONE
    )


@pytest.mark.parametrize("source", ["index", "primary_key"])
def test_composite_uniqueness_ignores_order_but_column_pairs_preserve_it(
    valid_definition: dict[str, Any],
    source: str,
) -> None:
    child = valid_definition["tables"][1]
    child["foreign_keys"][0]["columns"] = ["customer_id", "order_id"]
    child["foreign_keys"][0]["referenced_columns"] = ["email", "customer_id"]
    if source == "index":
        child["indexes"] = [
            {
                "name": "uq_reversed",
                "unique": True,
                "columns": [{"name": "order_id", "order": "DESC"}, {"name": "CUSTOMER_ID"}],
                "include_columns": ["amount"],
            }
        ]
    else:
        child["columns"][1]["primary_key"] = True
    relationship = build_er_graph(_definition(valid_definition)).relationships[0]
    assert relationship.child_cardinality is Cardinality.ZERO_OR_ONE
    assert [
        (pair.child_column_id, pair.parent_column_id) for pair in relationship.column_pairs
    ] == [
        ("table_2_column_2", "table_1_column_2"),
        ("table_2_column_1", "table_1_column_1"),
    ]


def test_partial_and_wider_unique_indexes_do_not_imply_unique_fk(
    valid_definition: dict[str, Any],
) -> None:
    child = valid_definition["tables"][1]
    child["indexes"] = [
        {
            "name": "partial",
            "unique": True,
            "columns": [{"name": "customer_id"}],
            "where": "amount > 0",
        },
        {"name": "wider", "unique": True, "columns": [{"name": "customer_id"}, {"name": "amount"}]},
    ]
    relation = build_er_graph(_definition(valid_definition)).relationships[0]
    assert relation.child_cardinality is Cardinality.ZERO_OR_MANY


def test_unique_subset_of_composite_fk_limits_matching_children(
    valid_definition: dict[str, Any],
) -> None:
    child = valid_definition["tables"][1]
    child["foreign_keys"][0]["columns"] = ["customer_id", "amount"]
    child["foreign_keys"][0]["referenced_columns"] = ["customer_id", "email"]
    child["columns"][1]["unique"] = True
    relation = build_er_graph(_definition(valid_definition)).relationships[0]
    assert relation.child_cardinality is Cardinality.ZERO_OR_ONE
