---
name: review-db-definitions
description: Review YAML database definitions for structural validity, relational consistency, naming quality, and DBMS-specific risks. Use when GitHub Copilot reviews a pull request or is asked to audit tables, columns, indexes, foreign keys, views, or stored procedures without applying migrations.
---

# Review Database Definitions

Review the YAML SSOT and report actionable findings. Do not modify files unless the user also asks for fixes.

## Workflow

1. Read the changed YAML, `examples/database-definition.yaml`, and `schemas/db-definition.schema.json`.
2. Run machine validation, using JSON when results will be parsed:

   ```bash
   .venv/bin/dbdef validate --json path/to/definition.yaml
   ```

3. Inspect issues the validator cannot fully decide:

   - physical naming consistency and logical-name clarity;
   - data type, length, precision, scale, default, nullability, and uniqueness intent;
   - PK, index order, covering columns, and partial-index predicates;
   - FK cardinality, referential actions, cycles, and nullable `SET NULL` targets;
   - view and stored-procedure SQL completeness and target-DBMS compatibility;
   - timestamps and document/DBMS metadata completeness.

4. Distinguish correctness defects from optional design suggestions. For each defect, cite the YAML file and field path, explain the impact, and propose the smallest correction.
5. If no actionable defect remains, state that explicitly and include the validation command used.

## Review boundaries

- Treat generated HTML, XLSX, PDF, and manifests as derived output, not review authorities.
- Do not suggest a live migration solely because the definition changes.
- Do not accept broken references, unknown fields, or suppressed validator failures.
