---
name: manage-db-definitions
description: Create, edit, validate, and publish this repository's YAML database definition documents. Use when working on tables, columns, indexes, foreign keys, views, stored procedures, the JSON Schema, or generated HTML/XLSX/PDF definition artifacts. Do not use for applying live database migrations.
---

# Manage Database Definitions

Treat YAML as the only source of truth. Use the Python CLI for all validation and generated artifacts.

## Workflow

1. Read the target YAML and `examples/database-definition.yaml` before changing structure. Read [field-guide.md](references/field-guide.md) when adding an object or choosing a field.
2. Preserve `format_version` and existing physical names unless the request explicitly includes a rename. Keep timestamps as ISO 8601 values with offsets and update `document.updated_at` for content changes.
3. Edit only YAML for definition content. Never hand-edit generated HTML, XLSX, PDF, manifest, or `schemas/db-definition.schema.json`.
4. Run validation immediately after every logical edit:

   ```bash
   .venv/bin/dbdef validate path/to/definition.yaml
   ```

   If `.venv` is unavailable, use `dbdef validate ...` from an environment where the project is installed.
5. Fix every reported structural and semantic issue. Do not suppress unknown fields or broken references.
6. When requested to publish or preview the definition, build every format and report the manifest path:

   ```bash
   .venv/bin/dbdef build path/to/definition.yaml --output dist/database-definition
   ```

7. When changing Python contract models, regenerate and verify the committed JSON Schema, then run the full test suite:

   ```bash
   .venv/bin/dbdef schema --output schemas/db-definition.schema.json
   .venv/bin/dbdef schema --check schemas/db-definition.schema.json
   .venv/bin/pytest
   ```

## Validation rules

- Keep table, column, index, foreign-key, view, and stored-procedure physical names unique in their scopes.
- Set `not_null: true` on every primary-key column.
- Reference only existing local columns from indexes and foreign keys.
- Reference a table and columns present in the same YAML document from each foreign key.
- Match local and referenced foreign-key column counts.
- Use `SET NULL` only when every affected local column permits null.
- Set `scale` only with `length`, and never make it greater than `length`.
- Keep `updated_at` equal to or later than `created_at`.

## Output discipline

- Use `validate --json` when another program needs validation results.
- Use `render --format html|xlsx|pdf --output <file>` only for a single explicitly requested format.
- Use `build` for CI and review handoffs so `manifest.json` records SHA-256 checksums.
- Describe YAML changes and validation evidence in the handoff. Do not claim a generated format is current unless it was rebuilt after the last YAML edit.

