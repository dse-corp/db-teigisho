# 開発と自動検証

この文書は、Pythonの検証器・生成処理と、HTMLのER図操作を変更する開発者向けです。まず仮想環境を用意し、変更箇所に応じてPythonの品質検査とブラウザーテストを実行してください。CLIの利用だけなら[README](../README.md)の手順で足ります。

## 仮想環境を作り、基本の品質検査を実行する

Python 3.11以上を使い、リポジトリのルートで実行します。CIのPythonは3.12です。

```bash
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'

.venv/bin/ruff check .
.venv/bin/mypy
.venv/bin/pytest
.venv/bin/dbdef schema --check schemas/db-definition.schema.json
.venv/bin/dbdef validate definitions examples
```

pytestはカバレッジも計測し、80%未満なら失敗します。型検査はmypyのstrict設定です。YAMLだけを変更した場合は、まず対象ファイルを`dbdef validate`で検証してください。

## モジュールの役割から変更箇所を探す

| ファイル | 役割 |
| --- | --- |
| `src/db_teigisho/models.py` | PydanticによるYAMLの項目・型・既定値の定義 |
| `src/db_teigisho/loader.py` | YAMLの安全な読み込み、ファイル探索、検証の呼び出し |
| `src/db_teigisho/validation.py` | 日時、名前、PK、インデックス、FKの意味検証 |
| `src/db_teigisho/schema.py` | モデルからのJSON Schema生成と差分検査 |
| `src/db_teigisho/er_graph.py` | 描画先に依存しないERグラフと多重度の推定 |
| `src/db_teigisho/er.py` | Mermaidコードの生成 |
| `src/db_teigisho/er_scene.py` | フォント計測、初期配置、経路、図の上限検査 |
| `src/db_teigisho/er_xlsx.py` | XLSX用のグループ図形・コネクタ、パッケージへの組み込みと安全な保存 |
| `src/db_teigisho/diagram_render.py` | 共通シーンからのSVG・Pillow PNG生成 |
| `src/db_teigisho/render.py` | HTML・XLSX・PDF生成とmanifest出力 |
| `src/db_teigisho/templates/` | HTMLテンプレートとER図操作のJavaScript・CSS |
| `src/db_teigisho/cli.py` | `validate`、`schema`、`render`、`build`の引数と終了コード |
| `src/db_teigisho/codex_hook.py` / `copilot_hook.py` | エージェント向け自動検証の判定と応答 |

基本的な引数の一覧は`dbdef --help`、各コマンドの詳細は`dbdef render --help`などで確認できます。`dbdef schema`は出力先を省略すると標準出力にJSON Schemaを表示します。

## モデルを変更したらSchemaとテストを更新する

YAMLの構造は`models.py`、項目間やオブジェクト間の整合性は`validation.py`で定義します。Pythonのモデルを変更した場合は、生成済みSchemaを手で直さず、次のコマンドで更新します。

```bash
.venv/bin/dbdef schema --output schemas/db-definition.schema.json
.venv/bin/dbdef schema --check schemas/db-definition.schema.json
.venv/bin/pytest
```

公開する項目や挙動を変えたら、[基本サンプル](../examples/database-definition.yaml)、[YAML項目ガイド](../.agents/skills/manage-db-definitions/references/field-guide.md)、関連SkillとREADMEにも反映します。既存の`format_version: "1.0"`との互換性を確認してください。

レンダラーを変更した場合は、代表例をビルドしてHTML・XLSX・PDFの内容とレイアウトを確認します。

```bash
.venv/bin/dbdef build examples/database-definition.yaml --output dist/database-definition
```

XLSXのER図は、セルをopenpyxlで保存した後、生成したDrawingMLをパッケージへ追加します。追加後のXLSXをopenpyxlで再保存しないでください。`tests/test_er_xlsx.py`は接続先と図形ID、接続点と描画座標、標準形状の回転・反転、カスタム形状の調整ハンドル、既存画像・リンクの保持、保存失敗時の復元、長い凡例、500テーブル・2,000 FKの境界を検査します。

変更時は基本サンプルと`definitions/ecommerce.yaml`をビルドし、Windows版・Mac版Excelで、グループ移動への接続線・ラベルの追従、内部テキストの編集、線の調整、保存・再読込、印刷を確認してください。XMLやZIPの検査はExcelでの操作確認の代わりにはなりません。今回の実施結果と実機確認手順は[照合結果](excel-er-verification.md)に記録しています。

出力先の`manifest.json`には、入力と成果物のSHA-256を記録します。定義YAMLを再編集した後は、成果物も再生成してください。

## HTMLの操作はブラウザーで回帰テストする

開発時のブラウザーテストには、Node.js 22.12以上とPuppeteerが使うChromiumが必要です。これらは成果物の生成・閲覧には不要です。

```bash
npm ci
npm test
```

`npm test`は`tests/test_er_*.mjs`を実行します。表示切り替えや選択、ズーム・パンなどの閲覧操作に加え、配置の変更・保存・復元と線の経路も検証します。

実際の生成HTMLを使うテストは、`DBDEF_GENERATED_HTML`を指定した場合に実行されます。未指定では、そのテストだけがスキップされます。Pythonが生成した寸法・初期配置とブラウザー表示の整合性も確認するには、次のように実行してください。

```bash
.venv/bin/dbdef build examples/database-definition.yaml --output dist/browser-test
DBDEF_GENERATED_HTML=dist/browser-test/database-definition.html npm test
```

テストでは`file:` URLからHTMLを開き、外部通信なしでの表示、配置変更、保存、静的SVGへの切り替えを確認します。ブラウザー側のAPIとイベントは[ER図の操作と仕様](er-diagrams.md)を参照してください。

## CIはPythonとブラウザーを別々に検査する

[database-definitions.yml](../.github/workflows/database-definitions.yml)はpushとPull Requestで実行されます。

| ジョブ | 検査・生成内容 |
| --- | --- |
| `validate-and-publish` | Ruff、mypy、pytest、Schema差分、`examples/`の検証、基本サンプルの全形式生成 |
| `browser-tests` | 基本サンプルのHTML生成、`npm ci`、生成HTMLを指定した`npm test` |

生成物は`database-definition`というActions artifactに保存し、保存期間は30日です。このCIでは`definitions/`全体の検証は実行していないため、案件の定義を変更した際はローカルで`dbdef validate definitions`も実行してください。

## エージェントの編集とコミット時にYAMLを検証する

自動検証の設定と対象は次のとおりです。検証内容の実装はPython側に集約しています。

| 設定 | 実行タイミングと対象 |
| --- | --- |
| [.pre-commit-config.yaml](../.pre-commit-config.yaml) | `definitions/`・`examples/`配下のYAMLをコミット前に検証 |
| [.codex/hooks.json](../.codex/hooks.json) | 対象パスを含む`apply_patch`・`Bash`呼び出しの後、`definitions/`と`examples/`を検証 |
| [.github/hooks/database-definitions.json](../.github/hooks/database-definitions.json) | 対象YAMLの`create`・`edit`後と、タスク完了前に検証 |
| [copilot-setup-steps.yml](../.github/workflows/copilot-setup-steps.yml) | Copilot cloud agent向けにPythonと開発用依存関係を導入 |

pre-commitを使う場合は、別途pre-commitをインストールしてから`pre-commit install`でフックを登録します。pre-commitは`.[dev]`のインストール対象に含まれていません。

Codexフックは、`tool_input.command`内の対象パスで実行の要否を判定します。すべての編集方法を検知する仕組みではないため、定義変更後は`dbdef validate <path>`も実行してください。リポジトリのフック起動用スクリプトは`.venv`があればそのPythonを使い、なければ起動元のPythonを使います。

Copilotの編集後フックは検証結果をコンテキストに返します。完了前の検証で不正な定義がある場合は修正を要求し、再試行時に`stop_hook_active: true`なら完了を許可して無限継続を避けます。

定義の作成・編集には[manage-db-definitions](../.agents/skills/manage-db-definitions/SKILL.md)を使います。Copilot向けには、[レビュー](../.github/skills/review-db-definitions/SKILL.md)、[成果物の生成](../.github/skills/publish-db-definitions/SKILL.md)、[ツールの変更](../.github/skills/evolve-dbdef-tooling/SKILL.md)のSkillもあります。共通の指示は[AGENTS.md](../AGENTS.md)と[Copilot指示](../.github/copilot-instructions.md)を参照してください。

## バージョンに対応するタグでPyPIへ公開する

公開手順は[publish-python.yml](../.github/workflows/publish-python.yml)に定義しています。PyPI側のTrusted Publisherには、次の値を登録します。

| 項目 | 値 |
| --- | --- |
| Organization | `dse-corp` |
| Repository | `db-teigisho` |
| Workflow | `publish-python.yml` |
| Environment | `pypi` |

`pyproject.toml`の`project.version`と一致する`v`付きタグをpushすると、ワークフローが実行されます。たとえばバージョンが`0.2.2`なら次のコマンドです。

```bash
git tag v0.2.2
git push origin v0.2.2
```

公開準備では`src/db_teigisho/__init__.py`の`__version__`も確認してください。現在は`pyproject.toml`が`0.2.2`、`__version__`が`0.1.1`です。CLIの`--version`とmanifestは後者を使うため、公開前に両方をそろえる必要があります。

公開前にPythonの品質検査、Schemaとサンプルの検証、成果物の生成を行います。続いて配布パッケージをビルドし、タグとバージョンの一致、wheelのインストールを確認します。ブラウザーテストも別ジョブで実行し、両方が成功した後にPyPIへ公開します。

この説明はリポジトリ内のワークフローを示しています。PyPI側の登録状況や、特定バージョンの公開済み状態はリポジトリからは確認できません。
