# db-teigisho

Excelで管理していたテーブル定義書を、AIと人間の双方が扱いやすいYAML-firstの成果物へ
置き換えるPythonツールです。YAMLをSingle Source of Truth（SSOT）とし、JSON Schema、
意味検証、HTML・Excel・PDF、CI向けmanifestを同じ定義から生成します。

## セットアップ

```bash
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
```

## 基本操作

```bash
# YAML定義書を検証
.venv/bin/dbdef validate definitions/example.yaml

# HTML・Excel・PDFとmanifestを一括生成
.venv/bin/dbdef build definitions/example.yaml --output dist

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

- `<入力名>.html`: テーブル一覧と各定義をブラウザで検索・印刷できる自己完結HTML
- `<入力名>.xlsx`: 文書情報、テーブル一覧、各テーブル、ビュー、ストアドプロシージャの各シート
- `<入力名>.pdf`: 表紙、テーブル一覧、各定義を収録した配布・レビュー用PDF
- `manifest.json`: 入力と各成果物のSHA-256、生成日時、ツールバージョン

PDFにはNoto Sans JPを埋め込むため、CIや閲覧端末に日本語フォントがない場合も文字を表示できます。
同梱フォントのライセンスは `src/db_teigisho/assets/OFL.txt` です。

## 自動検証

- `.pre-commit-config.yaml`: `definitions/**/*.yaml` をコミット前に検証
- `.codex/hooks.json`: Codexが定義YAMLを編集した直後に検証
- `.github/hooks/database-definitions.json`: GitHub CopilotがYAMLを編集した直後とタスク完了前に検証
- `.github/workflows/copilot-setup-steps.yml`: Copilot cloud agentへPython依存関係を事前導入
- `.github/workflows/database-definitions.yml`: テスト、Schemaドリフト、YAML検証、成果物アップロード

リポジトリのCodex hookは初回のみ `/hooks` で内容を確認し、信頼してください。
Copilot hookは編集後に検証結果をコンテキストへ返し、定義が不正な場合は完了前に修正を1回要求します。
無限継続を避けるため、再試行後はCIの検証を最終ゲートとします。
