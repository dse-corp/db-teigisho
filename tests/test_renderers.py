from __future__ import annotations

import hashlib
import json
from pathlib import Path

from openpyxl import load_workbook

from db_teigisho.loader import load_definition
from db_teigisho.render import build_artifacts, render_html, render_pdf, render_xlsx


def test_renders_self_contained_html(definition_file: Path, tmp_path: Path) -> None:
    document = load_definition(definition_file)
    output = tmp_path / "definition.html"

    render_html(document, output)

    html = output.read_text(encoding="utf-8")
    assert "<!doctype html>" in html.lower()
    assert "受注管理システム" in html
    assert "orders" in html
    assert "customer_order_totals" in html
    assert "<style>" in html


def test_renders_formatted_xlsx(definition_file: Path, tmp_path: Path) -> None:
    document = load_definition(definition_file)
    output = tmp_path / "definition.xlsx"

    render_xlsx(document, output)

    workbook = load_workbook(output, read_only=False, data_only=True)
    assert workbook.sheetnames == [
        "文書情報",
        "customers",
        "orders",
        "ビュー",
        "ストアドプロシージャ",
    ]
    assert workbook["文書情報"]["B2"].value == "PJ-001"
    assert workbook["orders"].freeze_panes == "A5"
    assert workbook["orders"]["B5"].value == "order_id"
    assert workbook["orders"].sheet_view.showGridLines is False
    assert workbook["orders"].page_setup.orientation == "landscape"
    assert workbook["orders"].page_setup.fitToWidth == 1


def test_xlsx_keeps_formula_like_user_input_as_text(
    definition_file: Path, tmp_path: Path
) -> None:
    document = load_definition(definition_file)
    document.views[0].sql = '=HYPERLINK("https://example.test", "click")'
    output = tmp_path / "definition.xlsx"

    render_xlsx(document, output)

    workbook = load_workbook(output, read_only=False, data_only=False)
    cell = workbook["ビュー"]["D4"]
    assert cell.data_type == "s"
    assert cell.value == "'=HYPERLINK(\"https://example.test\", \"click\")"


def test_renders_a_valid_pdf(definition_file: Path, tmp_path: Path) -> None:
    document = load_definition(definition_file)
    document.views[0].sql = "SELECT * FROM orders WHERE total_amount < 100 AND note <> '<tag>';"
    output = tmp_path / "definition.pdf"

    render_pdf(document, output)

    content = output.read_bytes()
    assert content.startswith(b"%PDF-")
    assert len(content) > 3_000
    assert b"/FontFile2" in content
    assert b"Adobe-Japan1" not in content


def test_builds_all_ci_artifacts_with_sha256_manifest(
    definition_file: Path, tmp_path: Path
) -> None:
    output_dir = tmp_path / "artifacts"

    manifest_path = build_artifacts(definition_file, output_dir)

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["source"]["file"] == definition_file.name
    assert {item["format"] for item in manifest["artifacts"]} == {"html", "xlsx", "pdf"}
    for item in manifest["artifacts"]:
        artifact = output_dir / item["file"]
        assert artifact.is_file()
        assert item["sha256"] == hashlib.sha256(artifact.read_bytes()).hexdigest()
