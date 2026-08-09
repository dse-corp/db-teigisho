"""Safe loading and validation of YAML definition files."""

from __future__ import annotations

from dataclasses import dataclass
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
from db_teigisho.models import DatabaseDefinition
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


def load_definition(path: Path) -> DatabaseDefinition:
    """Load one YAML file and enforce structural and semantic validation."""

    source = path.resolve()
    try:
        text = source.read_text(encoding="utf-8")
    except (FileNotFoundError, IsADirectoryError, PermissionError, UnicodeError) as error:
        raise DefinitionLoadError(f"Cannot read definition file {source}: {error}") from error

    try:
        raw = yaml.safe_load(text)
    except yaml.YAMLError as error:
        raise DefinitionLoadError(f"Invalid YAML in {source}: {error}") from error
    if not isinstance(raw, dict):
        raise DefinitionLoadError(f"YAML root must be a mapping in {source}")

    try:
        definition = DatabaseDefinition.model_validate(raw)
    except ValidationError as error:
        raise DefinitionValidationError(source, _structural_issues(error)) from error

    issues = semantic_issues(definition)
    if issues:
        raise DefinitionValidationError(source, issues)
    return definition


def _definition_files(paths: list[Path]) -> list[Path]:
    found: set[Path] = set()
    for path in paths:
        target = path.resolve()
        if target.is_dir():
            found.update(target.rglob("*.yaml"))
            found.update(target.rglob("*.yml"))
        elif target.suffix.casefold() in {".yaml", ".yml"}:
            found.add(target)
        else:
            raise DefinitionLoadError(f"Not a YAML definition file or directory: {path}")
    files = sorted(found, key=lambda item: str(item))
    if not files:
        raise DefinitionLoadError("No YAML definition files found in the requested targets.")
    return files


def validate_paths(paths: list[Path]) -> list[ValidationResult]:
    """Validate one or more files/directories and return every result."""

    results: list[ValidationResult] = []
    for path in _definition_files(paths):
        try:
            load_definition(path)
        except DefinitionError as error:
            results.append(ValidationResult(path=path, valid=False, errors=(str(error),)))
        else:
            results.append(ValidationResult(path=path, valid=True))
    return results
