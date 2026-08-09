---
name: evolve-dbdef-tooling
description: Safely evolve the Python database-definition contract, semantic validation, CLI, renderers, JSON Schema, and automation. Use when GitHub Copilot changes supported YAML fields, validation rules, output formats, hooks, or generator behavior rather than editing a project definition document.
---

# Evolve Database Definition Tooling

Change the tool contract with tests first and keep models, generated schema, validators, documentation, and outputs synchronized.

## Workflow

1. Read `pyproject.toml`, the affected module under `src/db_teigisho/`, and its tests. Read `examples/database-definition.yaml` before changing the YAML contract.
2. Add or update a failing test that describes the requested behavior. Cover success, invalid input, and compatibility boundaries.
3. Implement the smallest typed Python change. Keep YAML loading safe, reject unknown fields, escape user-controlled output, and preserve Excel formula-injection protection.
4. If `src/db_teigisho/models.py` changes, regenerate and check the committed schema:

   ```bash
   .venv/bin/dbdef schema --output schemas/db-definition.schema.json
   .venv/bin/dbdef schema --check schemas/db-definition.schema.json
   ```

5. Update the complete example, relevant Skill instructions, and README when public behavior changes.
6. Run all quality gates:

   ```bash
   .venv/bin/ruff check .
   .venv/bin/mypy
   .venv/bin/pytest
   .venv/bin/dbdef validate examples
   ```

7. Rebuild and inspect representative HTML, XLSX, and PDF artifacts after renderer or contract changes.

## Contract discipline

- Preserve `format_version: "1.0"` compatibility unless a deliberate version change and migration path are part of the request.
- Keep structural rules in Pydantic models and cross-object rules in semantic validation.
- Never hand-edit `schemas/db-definition.schema.json`; generate it from the model.
- Keep hooks deterministic, local, and free of network calls or secrets.
