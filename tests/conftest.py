from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import yaml


@pytest.fixture
def valid_definition() -> dict[str, Any]:
    return {
        "format_version": "1.0",
        "document": {
            "project_number": "PJ-001",
            "system_name": "受注管理システム",
            "subsystem_name": "受注API",
            "created_at": "2026-08-01T09:00:00+09:00",
            "updated_at": "2026-08-09T18:30:00+09:00",
        },
        "database": {
            "dbms_name": "PostgreSQL",
            "dbms_version": "17.5",
            "server_name": "db.example.internal",
            "port": 5432,
            "database_name": "orders",
            "schema_name": "public",
            "collation": "ja_JP.UTF-8",
        },
        "tables": [
            {
                "physical_name": "customers",
                "logical_name": "顧客",
                "columns": [
                    {
                        "physical_name": "customer_id",
                        "logical_name": "顧客ID",
                        "data_type": "uuid",
                        "not_null": True,
                        "unique": True,
                        "primary_key": True,
                    },
                    {
                        "physical_name": "email",
                        "logical_name": "メールアドレス",
                        "data_type": "varchar",
                        "length": 320,
                        "not_null": True,
                        "unique": True,
                        "primary_key": False,
                    },
                ],
                "indexes": [
                    {
                        "name": "idx_customers_email",
                        "type": "btree",
                        "unique": True,
                        "columns": [{"name": "email", "order": "ASC"}],
                    }
                ],
                "foreign_keys": [],
            },
            {
                "physical_name": "orders",
                "logical_name": "受注",
                "columns": [
                    {
                        "physical_name": "order_id",
                        "logical_name": "受注ID",
                        "data_type": "bigint",
                        "not_null": True,
                        "unique": False,
                        "primary_key": True,
                    },
                    {
                        "physical_name": "customer_id",
                        "logical_name": "顧客ID",
                        "data_type": "uuid",
                        "not_null": True,
                        "unique": False,
                        "primary_key": False,
                    },
                    {
                        "physical_name": "amount",
                        "logical_name": "合計金額",
                        "data_type": "numeric",
                        "length": 18,
                        "scale": 2,
                        "default": 0,
                        "not_null": True,
                        "unique": False,
                        "primary_key": False,
                    },
                ],
                "indexes": [
                    {
                        "name": "idx_orders_customer",
                        "type": "btree",
                        "unique": False,
                        "columns": [{"name": "customer_id", "order": "ASC"}],
                        "include_columns": ["amount"],
                    }
                ],
                "foreign_keys": [
                    {
                        "name": "fk_orders_customers",
                        "columns": ["customer_id"],
                        "referenced_table": "customers",
                        "referenced_columns": ["customer_id"],
                        "on_update": "NO ACTION",
                        "on_delete": "RESTRICT",
                    }
                ],
            },
        ],
        "views": [
            {
                "physical_name": "customer_order_totals",
                "logical_name": "顧客別受注金額",
                "sql": "SELECT customer_id, SUM(amount) AS total FROM orders GROUP BY customer_id;",
            }
        ],
        "stored_procedures": [
            {
                "physical_name": "close_orders",
                "logical_name": "受注締め処理",
                "sql": "CREATE PROCEDURE close_orders() LANGUAGE SQL AS $$ SELECT 1; $$;",
            }
        ],
    }


@pytest.fixture
def definition_file(tmp_path: Path, valid_definition: dict[str, Any]) -> Path:
    path = tmp_path / "database.yaml"
    path.write_text(
        yaml.safe_dump(valid_definition, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )
    return path
