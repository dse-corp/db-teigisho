"""Command line interface for validation and publishing."""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path

from db_teigisho import __version__
from db_teigisho.errors import DefinitionError
from db_teigisho.loader import load_definition, validate_paths
from db_teigisho.schema import schema_matches, schema_text, write_schema


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="dbdef",
        description="Validate and publish YAML database definitions.",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    subparsers = parser.add_subparsers(dest="command", required=True)

    validate = subparsers.add_parser("validate", help="Validate files or directories.")
    validate.add_argument("paths", nargs="+", type=Path)
    validate.add_argument("--json", action="store_true", dest="json_output")

    schema = subparsers.add_parser("schema", help="Generate or check the JSON Schema.")
    schema_mode = schema.add_mutually_exclusive_group()
    schema_mode.add_argument("--output", type=Path)
    schema_mode.add_argument("--check", type=Path)

    render = subparsers.add_parser("render", help="Render one human-readable format.")
    render.add_argument("definition", type=Path)
    render.add_argument(
        "--format",
        choices=("html", "xlsx", "pdf", "mermaid", "svg", "png"),
        required=True,
    )
    render.add_argument("--output", type=Path, required=True)
    render.add_argument("--er-columns", choices=("all", "keys", "tables"), default="all")

    build = subparsers.add_parser("build", help="Build all CI artifacts and a manifest.")
    build.add_argument("definition", type=Path)
    build.add_argument("--output", type=Path, required=True)
    return parser


def _validate(args: argparse.Namespace) -> int:
    results = validate_paths(args.paths)
    if args.json_output:
        print(json.dumps([result.as_dict() for result in results], ensure_ascii=False, indent=2))
    else:
        for result in results:
            state = "VALID" if result.valid else "INVALID"
            print(f"{state}: {result.path}")
            for error in result.errors:
                print(error)
    return 0 if all(result.valid for result in results) else 1


def _schema(args: argparse.Namespace) -> int:
    if args.check is not None:
        if schema_matches(args.check):
            print(f"Schema is current: {args.check}")
            return 0
        print(f"Schema is out of date: {args.check}", file=sys.stderr)
        return 1
    if args.output is not None:
        write_schema(args.output)
        print(args.output)
        return 0
    print(schema_text(), end="")
    return 0


def _render(args: argparse.Namespace) -> int:
    from db_teigisho.diagram_render import render_er_diagrams
    from db_teigisho.er import render_mermaid
    from db_teigisho.render import render_html, render_pdf, render_xlsx

    definition = load_definition(args.definition)
    if args.format == "mermaid":
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(render_mermaid(definition, args.er_columns), encoding="utf-8")
        print(args.output)
        return 0
    if args.format in {"svg", "png"}:
        diagram = render_er_diagrams(definition, modes=(args.er_columns,))[args.er_columns]
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_bytes(diagram.svg if args.format == "svg" else diagram.png)
        print(args.output)
        return 0
    renderer = {"html": render_html, "xlsx": render_xlsx, "pdf": render_pdf}[args.format]
    renderer(definition, args.output)
    print(args.output)
    return 0


def _build(args: argparse.Namespace) -> int:
    from db_teigisho.render import build_artifacts

    manifest = build_artifacts(args.definition, args.output)
    print(manifest)
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    """Run the CLI and return a process status."""

    parser = _parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "validate":
            return _validate(args)
        if args.command == "schema":
            return _schema(args)
        if args.command == "render":
            return _render(args)
        if args.command == "build":
            return _build(args)
    except DefinitionError as error:
        print(error, file=sys.stderr)
        return 1
    parser.error(f"Unknown command: {args.command}")
    return 2
