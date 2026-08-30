# db-teigisho

Excelで管理していたテーブル定義書を、AIと人間の双方が扱いやすいYAML-firstの成果物へ
置き換えるPythonツールです。YAMLをSingle Source of Truth（SSOT）とし、JSON Schema、
意味検証、HTML・Excel・PDF、CI向けmanifestを同じ定義から生成します。

## セットアップ

```bash
# Node.js 22.12+ が必要
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
npm ci
```

## 基本操作

```bash
# YAML定義書を検証
.venv/bin/dbdef validate definitions/example.yaml

# HTML・Excel・PDFとmanifestを一括生成
.venv/bin/dbdef build definitions/example.yaml --output dist

# Mermaid ER図コードを全カラム表示で生成
.venv/bin/dbdef render definitions/example.yaml --format mermaid --output dist/database-definition.mmd

# Mermaid ER図コードをPK/FKだけの表示で生成
.venv/bin/dbdef render definitions/example.yaml --format mermaid --er-columns keys --output dist/database-definition.mmd

# レンダリング済みSVG/PNGを出力
.venv/bin/dbdef render definitions/example.yaml --format svg --er-columns tables --output dist/database-definition.svg
.venv/bin/dbdef render definitions/example.yaml --format png --output dist/database-definition.png

# JSON Schemaの再生成と、コミット済みSchemaのドリフト検査
.venv/bin/dbdef schema --output schemas/db-definition.schema.json
.venv/bin/dbdef schema --check schemas/db-definition.schema.json
```

YAMLの全項目は [examples/database-definition.yaml](examples/database-definition.yaml)、
AIエージェントによる作成・編集手順は
[.agents/skills/manage-db-definitions/SKILL.md](.agents/skills/manage-db-definitions/SKILL.md)
を参照してください。

### GitHub Copilot向けSkill

GitHub Copilotは既存の `.agents/skills/manage-db-definitions` に加え、次の用途別Skillを利用できます。

- `.github/skills/review-db-definitions`: YAML定義書とPull Requestのレビュー
- `.github/skills/publish-db-definitions`: HTML・XLSX・PDF・manifestの生成
- `.github/skills/evolve-dbdef-tooling`: Schema、検証器、CLI、レンダラーの変更

リポジトリ全体のCopilot指示は `.github/copilot-instructions.md` にあります。

## 出力

`dbdef build` は次のファイルを出力します。

- `<入力名>.html`: 表示モードを切り替えられるレンダリング済みER図、テーブル一覧、各定義を検索・印刷できる自己完結HTML
- `<入力名>.xlsx`: 文書情報、テーブル一覧、レンダリング済みER図、各テーブル、ビュー、ストアドプロシージャの各シート
- `<入力名>.pdf`: 表紙、レンダリング済みER図、テーブル一覧、各定義を収録した配布・レビュー用PDF
- `<入力名>.mmd`: FK制約から推論したMermaid ER Diagramコード
- `<入力名>.svg` / `<入力名>.png`: 全カラム表示のレンダリング済みER図
- `manifest.json`: 入力と各成果物のSHA-256、生成日時、ツールバージョン

PDFにはNoto Sans JPを埋め込むため、CIや閲覧端末に日本語フォントがない場合も文字を表示できます。
同梱フォントのライセンスは `src/db_teigisho/assets/OFL.txt` です。

ER図はYAMLに定義されたFKから生成します。`npm ci`で固定されたMermaid CLIとPuppeteerを
導入すると、外部CDNなしでSVG/PNGを生成します。HTMLでは「全カラム」「PK・FKのみ」
「テーブルのみ」を切り替えられ、PDFとXLSXには全カラム表示を掲載します。参照元FK列がすべてNOT NULLなら親端を必須
（`||`）、それ以外は任意（`|o`）とし、FKがUNIQUEまたは主キーと一致すれば子端を
1（`||`）、それ以外は0以上の多（`o{`）とします。`ON DELETE CASCADE` またはFKが
主キーの一部なら実線、それ以外は破線です。`--er-columns` は `all`、`keys`、`tables`
を指定できます。`render --format svg|png` でも表示モードを指定できます。

自己完結HTMLには、`<script id="dbdef-er-graph" type="application/json">` として
`format_version: "1.0"` のERグラフデータも埋め込みます。`tables` とその `columns`、
`relationships` はYAMLの定義順を維持し、各カラムの `key_roles`（`PK`、`UK`、`FK`）、
複合FKの `column_pairs`、両端のcardinality、`identifying` / `non_identifying` を収録します。
ブラウザでは要素の `textContent` を `JSON.parse` して取得できます。Pythonから同じ契約を
利用する場合は `db_teigisho.er_graph.build_er_graph` を呼び出します。

## 自動検証

- `.pre-commit-config.yaml`: `definitions/**/*.yaml` をコミット前に検証
- `.codex/hooks.json`: Codexが定義YAMLを編集した直後に検証
- `.github/hooks/database-definitions.json`: GitHub CopilotがYAMLを編集した直後とタスク完了前に検証
- `.github/workflows/copilot-setup-steps.yml`: Copilot cloud agentへPython依存関係を事前導入
- `.github/workflows/database-definitions.yml`: テスト、Schemaドリフト、YAML検証、成果物アップロード

リポジトリのCodex hookは初回のみ `/hooks` で内容を確認し、信頼してください。
Copilot hookは編集後に検証結果をコンテキストへ返し、定義が不正な場合は完了前に修正を1回要求します。
無限継続を避けるため、再試行後はCIの検証を最終ゲートとします。
