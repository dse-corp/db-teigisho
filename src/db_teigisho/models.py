"""Pydantic models for the database definition contract."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class DefinitionModel(BaseModel):
    """Base model that rejects misspelled or unsupported fields."""

    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class DocumentManagement(DefinitionModel):
    """Document ownership and revision metadata."""

    project_number: str = Field(min_length=1, description="プロジェクト番号")
    system_name: str = Field(min_length=1, description="システム名")
    subsystem_name: str | None = Field(default=None, description="サブシステム名")
    created_at: datetime = Field(description="作成日時（ISO 8601）")
    updated_at: datetime = Field(description="最終変更日時（ISO 8601）")


class DatabaseSettings(DefinitionModel):
    """Target database and DBMS settings."""

    dbms_name: str = Field(min_length=1, description="DBMS名")
    dbms_version: str = Field(min_length=1, description="DBMSバージョン")
    server_name: str | None = Field(default=None, description="サーバー名")
    port: int | None = Field(default=None, ge=1, le=65535, description="ポート番号")
    database_name: str = Field(min_length=1, description="データベース名")
    schema_name: str = Field(min_length=1, description="スキーマ名")
    collation: str | None = Field(default=None, description="Collation")


ScalarDefault = str | int | float | bool | None


class ColumnDefinition(DefinitionModel):
    """A table column."""

    physical_name: str = Field(min_length=1, description="カラム物理名")
    logical_name: str = Field(min_length=1, description="カラム論理名")
    data_type: str = Field(min_length=1, description="DBMSのデータ型")
    length: int | None = Field(default=None, gt=0, description="長さまたは精度")
    scale: int | None = Field(default=None, ge=0, description="小数点以下桁数")
    default: ScalarDefault = Field(default=None, description="デフォルト値")
    not_null: bool = Field(default=False, description="NOT NULL制約")
    unique: bool = Field(default=False, description="単一カラムUNIQUE制約")
    primary_key: bool = Field(default=False, description="主キーカラム")
    description: str | None = Field(default=None, description="補足説明")


class IndexColumn(DefinitionModel):
    """An ordered column in an index."""

    name: str = Field(min_length=1, description="対象カラム物理名")
    order: Literal["ASC", "DESC"] = Field(default="ASC", description="ソート順")


class IndexDefinition(DefinitionModel):
    """A DBMS-agnostic index definition."""

    name: str = Field(min_length=1, description="インデックス名")
    type: str | None = Field(default=None, description="btree/hash等のインデックス種別")
    unique: bool = Field(default=False, description="UNIQUEインデックス")
    columns: list[IndexColumn] = Field(min_length=1, description="キー列")
    include_columns: list[str] = Field(default_factory=list, description="付加列")
    where: str | None = Field(default=None, description="部分インデックス条件")


ForeignKeyAction = Literal["NO ACTION", "RESTRICT", "CASCADE", "SET NULL", "SET DEFAULT"]


class ForeignKeyDefinition(DefinitionModel):
    """A foreign key between tables in this definition."""

    name: str = Field(min_length=1, description="外部キー制約名")
    columns: list[str] = Field(min_length=1, description="参照元カラム")
    referenced_table: str = Field(min_length=1, description="参照先テーブル物理名")
    referenced_columns: list[str] = Field(min_length=1, description="参照先カラム")
    on_update: ForeignKeyAction = Field(default="NO ACTION", description="更新時アクション")
    on_delete: ForeignKeyAction = Field(default="NO ACTION", description="削除時アクション")
    deferrable: bool = Field(default=False, description="遅延可能制約")


class TableDefinition(DefinitionModel):
    """A physical database table."""

    physical_name: str = Field(min_length=1, description="テーブル物理名")
    logical_name: str = Field(min_length=1, description="テーブル論理名")
    description: str | None = Field(default=None, description="テーブル説明")
    columns: list[ColumnDefinition] = Field(min_length=1, description="カラム")
    indexes: list[IndexDefinition] = Field(default_factory=list, description="インデックス")
    foreign_keys: list[ForeignKeyDefinition] = Field(default_factory=list, description="外部キー")


class SqlObjectDefinition(DefinitionModel):
    """Common definition for views and stored procedures."""

    physical_name: str = Field(min_length=1, description="物理名")
    logical_name: str = Field(min_length=1, description="論理名")
    sql: str = Field(min_length=1, description="SQL本文")
    description: str | None = Field(default=None, description="補足説明")


class DatabaseDefinition(DefinitionModel):
    """Root of a versioned database definition document."""

    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
        title="Database Definition",
        json_schema_extra={
            "description": "YAML-first table, view, and stored procedure definition",
        },
    )

    format_version: Literal["1.0"] = Field(description="定義フォーマットのバージョン")
    document: DocumentManagement
    database: DatabaseSettings
    tables: list[TableDefinition]
    views: list[SqlObjectDefinition]
    stored_procedures: list[SqlObjectDefinition]
