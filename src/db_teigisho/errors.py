"""Errors and issue types exposed by the package."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    """One actionable structural or semantic problem."""

    path: str
    code: str
    message: str

    def __str__(self) -> str:
        return f"{self.path} [{self.code}]: {self.message}"


class DefinitionError(Exception):
    """Base error for definition processing."""


class DefinitionLoadError(DefinitionError):
    """Raised when an input cannot be read or parsed as YAML."""


class DefinitionValidationError(DefinitionError):
    """Raised when a definition violates the contract."""

    def __init__(self, source: Path, issues: list[ValidationIssue]) -> None:
        self.source = source
        self.issues = issues
        details = "\n".join(f"  - {issue}" for issue in issues)
        super().__init__(f"Definition is invalid: {source}\n{details}")


class DefinitionRenderError(DefinitionError):
    """Raised when a human-readable artifact cannot be rendered."""
