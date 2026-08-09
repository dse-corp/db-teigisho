---
name: publish-db-definitions
description: Validate a YAML database definition and publish review-ready HTML, XLSX, PDF, and checksum manifest artifacts. Use when GitHub Copilot is asked to build, export, preview, attach, or refresh human-readable database definition documents or CI artifacts.
---

# Publish Database Definitions

Treat YAML as the source of truth and generate every requested artifact from the validated source.

## Workflow

1. Identify exactly one source YAML under `definitions/` or `examples/`. Do not infer a source when multiple candidates match.
2. Validate it before producing output:

   ```bash
   .venv/bin/dbdef validate path/to/definition.yaml
   ```

   If `.venv` is unavailable, use `dbdef` from an environment where this project is installed. Stop and report every validation error before publishing.
3. Build all formats for CI or review handoff:

   ```bash
   .venv/bin/dbdef build path/to/definition.yaml --output dist/database-definition
   ```

   Use `dbdef render --format html|xlsx|pdf --output <file>` only when one format was explicitly requested.
4. Read `manifest.json` and verify that every listed file exists. Do not claim outputs are current if YAML changed after the build.
5. Report the source path, output directory, generated formats, and manifest path.

## Constraints

- Never hand-edit generated HTML, XLSX, PDF, or `manifest.json`.
- Never publish an invalid source or omit a failing format from the handoff.
- Keep generated artifacts in an explicit output directory; do not place them beside the YAML SSOT unless requested.
