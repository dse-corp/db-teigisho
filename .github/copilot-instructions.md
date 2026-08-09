# Database definition repository instructions

- Treat YAML under `definitions/` and `examples/` as the only source of truth for database-definition content.
- Use `manage-db-definitions` when creating or editing YAML definitions.
- Use `review-db-definitions` for audits and pull-request review, `publish-db-definitions` for HTML/XLSX/PDF output, and `evolve-dbdef-tooling` for Python contract or generator changes.
- Read `examples/database-definition.yaml` before introducing new structure and use `schemas/db-definition.schema.json` as the structural authority.
- Never hand-edit generated HTML, XLSX, PDF, manifests, or the generated JSON Schema.
- Run `.venv/bin/dbdef validate <path>` immediately after changing a definition. Fix all structural and semantic errors.
- Update `document.updated_at` for definition-content changes while preserving `created_at`.
- Write Python tooling changes test-first. Run Ruff, mypy, pytest, Schema drift checks, and example validation before completing the task.
- Do not apply live database migrations unless the user explicitly requests a separate migration task.
