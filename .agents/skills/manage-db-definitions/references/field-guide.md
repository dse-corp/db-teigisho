# YAML field guide

Use `examples/database-definition.yaml` as the copyable complete example and
`schemas/db-definition.schema.json` as the structural authority.

## Root

- `format_version`: use `"1.0"`.
- `document`: document ownership and timestamps.
- `database`: DBMS and target database settings.
- `tables`, `views`, `stored_procedures`: keep these lists present even when empty.

## Document

- Require `project_number`, `system_name`, `created_at`, and `updated_at`.
- Add `subsystem_name` only when the definition belongs to a subsystem.
- Write timestamps as ISO 8601 with a timezone offset, for example `2026-08-09T18:30:00+09:00`.

## Database

- Require `dbms_name`, `dbms_version`, `database_name`, and `schema_name`.
- Add `server_name`, `port`, and `collation` when known.
- Keep `port` between 1 and 65535.

## Tables and columns

- Require table `physical_name`, `logical_name`, and at least one `column`.
- Require column `physical_name`, `logical_name`, and `data_type`.
- Use `length` for character length or numeric precision and `scale` for decimal places.
- Use scalar YAML values for `default`. Quote SQL expressions when YAML could reinterpret them.
- Use `not_null`, `unique`, and `primary_key` booleans; omitted values mean `false`.
- Add `description` for business rules that names and constraints do not communicate.

## Indexes

- Require `name` and one or more `columns`.
- Give each column a `name` and optional `order` (`ASC` by default or `DESC`).
- Use `type` for DBMS methods such as `btree`, `hash`, or `gin`.
- Use `unique`, `include_columns`, and `where` for unique, covering, and partial indexes.

## Foreign keys

- Require `name`, local `columns`, `referenced_table`, and `referenced_columns`.
- Keep both column lists in matching positional order.
- Choose `on_update` and `on_delete` from `NO ACTION`, `RESTRICT`, `CASCADE`, `SET NULL`, or `SET DEFAULT`.
- Set `deferrable: true` only when supported and intentionally used by the target DBMS.

## Views and stored procedures

- Require `physical_name`, `logical_name`, and `sql`.
- Use a YAML block scalar (`sql: |`) to preserve readable multi-line SQL.
- Keep SQL executable as a complete statement, including delimiters where required by the DBMS.

