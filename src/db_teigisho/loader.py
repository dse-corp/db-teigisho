"""Safe loading and validation of YAML definition files."""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Any

import yaml
from pydantic import ValidationError

from db_teigisho.errors import (
    DefinitionError,
    DefinitionLoadError,
    DefinitionValidationError,
    ValidationIssue,
)
from db_teigisho.models import (
    DatabaseDefinition,
    DatabaseDefinitionSource,
    TableDefinition,
    TableReference,
)
from db_teigisho.validation import semantic_issues


@dataclass(frozen=True, slots=True)
class ValidationResult:
    """Machine-readable result for one input file."""

    path: Path
    valid: bool
    errors: tuple[str, ...] = ()

    def as_dict(self) -> dict[str, object]:
        return {
            "path": str(self.path),
            "valid": self.valid,
            "errors": list(self.errors),
        }


def _format_location(location: tuple[Any, ...]) -> str:
    return ".".join(str(part) for part in location) or "$"


def _structural_issues(error: ValidationError) -> list[ValidationIssue]:
    return [
        ValidationIssue(
            path=_format_location(item["loc"]),
            code=str(item["type"]),
            message=str(item["msg"]),
        )
        for item in error.errors(include_url=False, include_context=False, include_input=False)
    ]


@dataclass(frozen=True, slots=True)
class SourceFile:
    """Checksum of the exact bytes read from one definition source."""

    path: Path
    sha256: str


@dataclass(frozen=True, slots=True)
class LoadedDefinition:
    """A resolved document and all files that contributed to it."""

    definition: DatabaseDefinition
    sources: tuple[SourceFile, ...]


def _read_yaml(source: Path) -> tuple[dict[str, Any], SourceFile]:
    try:
        content = source.read_bytes()
        text = content.decode("utf-8")
    except (OSError, UnicodeError) as error:
        raise DefinitionLoadError(f"Cannot read definition file {source}: {error}") from error

    try:
        raw = yaml.safe_load(text)
    except yaml.YAMLError as error:
        raise DefinitionLoadError(f"Invalid YAML in {source}: {error}") from error
    if not isinstance(raw, dict):
        raise DefinitionLoadError(f"YAML root must be a mapping in {source}")
    return raw, SourceFile(source, sha256(content).hexdigest())


def load_definition_sources(path: Path) -> LoadedDefinition:
    """Resolve named table files, then validate the complete database."""

    source = path.resolve()
    raw, parent = _read_yaml(source)
    try:
        document = DatabaseDefinitionSource.model_validate(raw)
    except ValidationError as error:
        raise DefinitionValidationError(source, _structural_issues(error)) from error

    sources = {source: parent}
    tables: list[TableDefinition] = []
    for index, entry in enumerate(document.tables):
        if isinstance(entry, TableDefinition):
            tables.append(entry)
            continue
        child = (source.parent / entry.ref).resolve()
        try:
            table_raw, child_source = _read_yaml(child)
            try:
                table = TableDefinition.model_validate(table_raw)
            except ValidationError as error:
                raise DefinitionValidationError(child, _structural_issues(error)) from error
        except DefinitionError as error:
            raise DefinitionLoadError(
                f"{source}: tables.{index}.$ref -> {child}\n{error}"
            ) from error
        if table.physical_name != entry.physical_name:
            raise DefinitionValidationError(
                source,
                [
                    ValidationIssue(
                        f"tables.{index}.physical_name",
                        "table_reference_name_mismatch",
                        f"Expected {entry.physical_name!r}, got {table.physical_name!r} in {child}",
                    )
                ],
            )
        sources[child] = child_source
        tables.append(table)

    definition = DatabaseDefinition.model_validate(
        {
            **document.model_dump(exclude={"tables"}),
            "tables": tables,
        }
    )
    issues = semantic_issues(definition)
    if issues:
        raise DefinitionValidationError(source, issues)
    return LoadedDefinition(definition, tuple(sources.values()))


def load_definition(path: Path) -> DatabaseDefinition:
    """Load a parent YAML and validate all inline and referenced tables."""

    return load_definition_sources(path).definition


def _definition_files(paths: list[Path]) -> list[Path]:
    found: set[Path] = set()
    for path in paths:
        target = path.resolve()
        if target.is_dir():
            found.update(item.resolve() for item in target.rglob("*.yaml"))
            found.update(item.resolve() for item in target.rglob("*.yml"))
        elif target.suffix.casefold() in {".yaml", ".yml"}:
            found.add(target)
        else:
            raise DefinitionLoadError(f"Not a YAML definition file or directory: {path}")
    files = sorted(found, key=lambda item: str(item))
    if not files:
        raise DefinitionLoadError("No YAML definition files found in the requested targets.")
    return files


def validate_paths(paths: list[Path]) -> list[ValidationResult]:
    """Validate documents; referenced table files are checked through their parents."""

    files = _definition_files(paths)
    referenced: set[Path] = set()
    # Inspect declarations even if another part of a parent is invalid. Never
    # silently skip unreferenced YAML or follow references recursively.
    for path in files:
        try:
            raw, _ = _read_yaml(path)
        except DefinitionError:
            continue
        entries = raw.get("tables")
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict) or "$ref" not in entry:
                continue
            try:
                reference = TableReference.model_validate(entry)
            except ValidationError:
                continue
            referenced.add((path.parent / reference.ref).resolve())

    results: list[ValidationResult] = []
    for path in files:
        if path in referenced:
            # A malformed reference to a parent must still be validated; only
            # leaf files may be omitted from the list of root results.
            try:
                raw, _ = _read_yaml(path)
            except DefinitionError:
                continue
            if not {"format_version", "document", "database", "tables"}.intersection(raw):
                continue
        try:
            load_definition(path)
        except DefinitionError as error:
            results.append(ValidationResult(path=path, valid=False, errors=(str(error),)))
        else:
            results.append(ValidationResult(path=path, valid=True))
    return results
