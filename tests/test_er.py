from __future__ import annotations

from copy import deepcopy
from typing import Any

import pytest

from db_teigisho.er import render_mermaid
from db_teigisho.models import DatabaseDefinition


def _definition(data: dict[str, Any]) -> DatabaseDefinition:
    return DatabaseDefinition.model_validate(data)


def test_renders_entities_with_logical_names_and_relationship_inference(
    valid_definition: dict[str, Any],
) -> None:
    diagram = render_mermaid(_definition(valid_definition))

    assert diagram.startswith("erDiagram\ndirection LR\n")
    assert 'table_1["customers / 顧客"] {' in diagram
    assert 'uuid customer_id PK, UK "customer_id / 顧客ID"' in diagram
    assert 'uuid customer_id FK "customer_id / 顧客ID"' in diagram
    assert 'table_1 ||..o{ table_2 : "fk_orders_customers"' in diagram


def test_infers_optional_and_one_to_one_cardinality_and_identifying_style(
    valid_definition: dict[str, Any],
) -> None:
    data = deepcopy(valid_definition)
    foreign_key = data["tables"][1]["foreign_keys"][0]
    data["tables"][1]["columns"][1]["not_null"] = False
    optional = render_mermaid(_definition(data))
    assert 'table_1 |o..o{ table_2 : "fk_orders_customers"' in optional

    data["tables"][1]["columns"][1]["not_null"] = True
    data["tables"][1]["columns"][1]["unique"] = True
    foreign_key["on_delete"] = "CASCADE"
    one_to_one = render_mermaid(_definition(data))
    assert 'table_1 ||--|| table_2 : "fk_orders_customers"' in one_to_one


def test_recognizes_composite_unique_indexes_and_pk_foreign_keys(
    valid_definition: dict[str, Any],
) -> None:
    data = deepcopy(valid_definition)
    child = data["tables"][1]
    child["columns"][1]["primary_key"] = True
    child["columns"].append(
        {
            "physical_name": "customer_email",
            "logical_name": "顧客メールアドレス",
            "data_type": "varchar",
            "not_null": True,
            "unique": False,
            "primary_key": False,
        }
    )
    child["foreign_keys"][0]["columns"] = ["customer_id", "customer_email"]
    child["foreign_keys"][0]["referenced_columns"] = ["customer_id", "email"]
    child["indexes"].append(
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

    diagram = render_mermaid(_definition(data))

    assert 'table_1 ||..|| table_2 : "fk_orders_customers"' in diagram
    assert 'uuid customer_id PK, FK "customer_id / 顧客ID"' in diagram
    assert 'varchar customer_email FK "customer_email / 顧客メールアドレス"' in diagram


def test_does_not_treat_partial_unique_indexes_as_one_to_one(
    valid_definition: dict[str, Any],
) -> None:
    data = deepcopy(valid_definition)
    data["tables"][1]["indexes"].append(
        {
            "name": "uq_orders_customer_active",
            "type": "btree",
            "unique": True,
            "columns": [{"name": "customer_id", "order": "ASC"}],
            "where": "amount > 0",
        }
    )

    diagram = render_mermaid(_definition(data))

    assert 'table_1 ||..o{ table_2 : "fk_orders_customers"' in diagram


@pytest.mark.parametrize(
    ("mode", "present", "absent"),
    [
        ("all", "numeric amount", None),
        ("keys", "uuid customer_id FK", "numeric amount"),
        ("tables", 'table_1["customers / 顧客"]', "uuid customer_id"),
    ],
)
def test_supports_column_display_modes(
    valid_definition: dict[str, Any], mode: str, present: str, absent: str | None
) -> None:
    diagram = render_mermaid(_definition(valid_definition), column_mode=mode)

    assert present in diagram
    if absent is not None:
        assert absent not in diagram


def test_renders_self_references_cycles_and_safe_labels(valid_definition: dict[str, Any]) -> None:
    data = deepcopy(valid_definition)
    data["tables"][0]["physical_name"] = 'customers "archive"'
    data["tables"][0]["logical_name"] = "顧客\n履歴"
    data["tables"][0]["foreign_keys"].append(
        {
            "name": "fk_customers_parent",
            "columns": ["customer_id"],
            "referenced_table": 'customers "archive"',
            "referenced_columns": ["customer_id"],
            "on_delete": "NO ACTION",
        }
    )
    data["tables"][1]["foreign_keys"][0]["referenced_table"] = 'customers "archive"'
    data["tables"][0]["foreign_keys"].append(
        {
            "name": "fk_customers_latest_order",
            "columns": ["customer_id"],
            "referenced_table": "orders",
            "referenced_columns": ["order_id"],
            "on_delete": "CASCADE",
        }
    )

    diagram = render_mermaid(_definition(data))

    assert 'table_1["customers \'archive\' / 顧客 履歴"]' in diagram
    assert 'table_1 ||--|| table_1 : "fk_customers_parent"' in diagram
    assert 'table_1 ||..o{ table_2 : "fk_orders_customers"' in diagram
    assert 'table_2 ||--|| table_1 : "fk_customers_latest_order"' in diagram


def test_rejects_unknown_column_display_mode(valid_definition: dict[str, Any]) -> None:
    with pytest.raises(ValueError, match="column_mode"):
        render_mermaid(_definition(valid_definition), column_mode="compact")
