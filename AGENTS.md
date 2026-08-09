# Database definition workflow

- Treat YAML files under `definitions/` as the SSOT. Never hand-edit generated HTML, XLSX, PDF, manifest, or JSON Schema files.
- Use the repository Skill at `.agents/skills/manage-db-definitions/SKILL.md` when creating or changing database definitions.
- After editing a definition YAML, run `.venv/bin/dbdef validate <path>` (or `dbdef validate <path>` in an activated environment).
- When changing Python models, regenerate `schemas/db-definition.schema.json` and run the complete test suite.
- Keep physical names stable unless the requested database migration explicitly renames an object.

