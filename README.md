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

- `<入力名>.html`: ズーム・パン・表示モード切り替えと詳細パネルを備えたER図、テーブル一覧、各定義を検索・印刷できる自己完結HTML
- `<入力名>.xlsx`: 文書情報、テーブル一覧、レンダリング済みER図、各テーブル、ビュー、ストアドプロシージャの各シート
- `<入力名>.pdf`: 表紙、レンダリング済みER図、テーブル一覧、各定義を収録した配布・レビュー用PDF
- `<入力名>.mmd`: FK制約から推論したMermaid ER Diagramコード
- `<入力名>.svg` / `<入力名>.png`: 全カラム表示のレンダリング済みER図
- `manifest.json`: 入力と各成果物のSHA-256、生成日時、ツールバージョン

PDFにはNoto Sans JPを埋め込むため、CIや閲覧端末に日本語フォントがない場合も文字を表示できます。
同梱フォントのライセンスは `src/db_teigisho/assets/OFL.txt` です。

ER図はYAMLに定義されたFKから生成します。`npm ci`で固定されたMermaid CLIとPuppeteerを
導入すると、外部CDNなしでSVG/PNGを生成します。HTMLでは埋め込みグラフデータからER図を
描画し、「全カラム」「PK・FKのみ」「テーブルのみ」の切り替え、リレーションの「直線」「鍵線」
の切り替え、ホイールまたはボタンでのズーム、背景ドラッグでのパン、テーブルのドラッグによる
配置変更、「全体表示」を利用できます。線種は再生成せず即時反映され、自己参照、同一テーブル間の
複数FK、双方向参照は経路をずらしてFK名を判別できます。
FKの親子関係を層化した決定的な自動配置は「左→右」と「上→下」を切り替えられ、循環参照や
自己参照、孤立テーブル、複数の連結成分も重ならないよう配置してからER図全体を表示します。
テーブルまたはカラムを選択すると、インデックス、外部キー、制約、defaultを含む読み取り専用の
詳細パネルを表示します。矢印キーで選択候補を移動し、EnterまたはSpaceで選択、Escapeまたは
閉じるボタンで閉じられます。倍率は5%から300%の範囲です。変更した配置と選択した線種は同じ
ブラウザの`localStorage`へ保存され、再読み込み時に復元されます。「配置をリセット」で保存済み
配置を破棄して初期配置へ戻せます。
HTMLはランタイムをすべて同梱するため、`file:` URLかつオフラインで動作します。
JavaScriptが無効な場合と印刷時には、埋め込み済みの静的SVGを表示します。
PDFとXLSXには従来どおり全カラム表示を掲載します。参照元FK列がすべてNOT NULLなら親端を必須
（`||`）、それ以外は任意（`|o`）とし、FKがUNIQUEまたは主キーと一致すれば子端を
1（`||`）、それ以外は0以上の多（`o{`）とします。`ON DELETE CASCADE` またはFKが
主キーの一部なら実線、それ以外は破線です。`--er-columns` は `all`、`keys`、`tables`
を指定できます。`render --format svg|png` でも表示モードを指定できます。

自己完結HTMLには、`<script id="dbdef-er-graph" type="application/json">` として
`format_version: "1.0"` のERグラフデータも埋め込みます。`tables` とその `columns`、
`relationships` はYAMLの定義順を維持し、各カラムの制約と `key_roles`（`PK`、`UK`、`FK`）、
各テーブルの `indexes` と `foreign_keys`、複合FKの `column_pairs`、両端のcardinality、
`identifying` / `non_identifying` を収録します。
ブラウザでは要素の `textContent` を `JSON.parse` して取得できます。Pythonから同じ契約を
利用する場合は `db_teigisho.er_graph.build_er_graph` を呼び出します。

### HTML ERビューアの拡張API

生成HTMLは `window.dbdefErViewer` にバージョン付きAPIを公開します。`getState()` /
`setViewState()` は表示モード、ビューポート、全ノード座標を共有し、`setNodePosition()` /
`setNodePositions()` はドラッグ操作や自動配置から座標を更新します。座標更新後は
`redrawEdges()` が利用する同じ経路でリレーションを再描画します。

後続機能向けの主な境界は次のとおりです。

| 境界 | 用途 |
| --- | --- |
| `getGraph()` / `getState()` | 埋め込みグラフと現在のビュー状態をコピーとして取得 |
| `setMode(mode)` / `setViewport(viewport)` / `fitToView()` | 表示モードとズーム・パン状態を更新 |
| `getNodePosition(tableId)` / `setNodePosition(tableId, position)` | 単一ノードの座標を取得・更新 |
| `getNodeSize(tableId, mode)` | 指定表示モード（既定は全カラム）のノード寸法を取得 |
| `setNodePositions(positions)` | 配置アルゴリズムや保存済み配置から複数座標を一括更新 |
| `redrawEdges()` | 現在のノード座標とサイズから全エッジを再描画 |
| `setEdgePathRenderer(renderer)` | エッジ経路戦略を差し替え（`null` で既定へ復帰） |
| `screenToGraphPoint(clientX, clientY)` | ポインター座標をグラフ座標へ変換 |

ビューア要素 `#dbdef-er-viewer` は
`dbdef:er-view-change`、`dbdef:er-node-position-change`、
`dbdef:er-edges-redrawn`、`dbdef:er-selection-change` の各`CustomEvent`を発火します。
ノードDOMには `data-table-id`、カラム行には `data-column-id`、エッジDOMには
`data-relationship-id`があります。選択対象は `aria-selected` と
`aria-controls="dbdef-er-details"` で単一の詳細パネルへ関連付けられます。

線種切り替えは`window.dbdefErEdgeRouting` v1.0として分離され、
`getRoutingMode()` / `setRoutingMode(mode)`で`straight`または`orthogonal`を取得・設定できます。
各戦略は`setEdgePathRenderer()`へ登録され、ノード座標計算には関与しません。座標の単一・一括更新
およびドラッグ時は`redrawEdges()`を通して選択中の経路、FK名、両端のカーディナリティを更新します。
保存領域が利用不可または容量超過の場合は図の閲覧と線種切り替えを継続しながら画面上に失敗を表示し、
`dbdef:er-edge-routing-storage-error`イベントを発火します。

配置操作は`window.dbdefErLayout` v1.0として分離され、`save()`、`restore()`、`reset()`、
`getStorageKey()`、`getGraphFingerprint()`を公開します。`window.dbdefErAutoLayout` v1.0は
`run()`、`setDirection()`、`calculate()`を公開し、計算と座標適用を分けて拡張できます。
保存キーは文書・データベース識別情報
のSHA-256と、テーブル・カラム・リレーション構造のフィンガープリントを含みます。構造変更時は
同じ定義書の過去配置から物理名が一致するテーブルだけを復元します。新規テーブルは初期位置を
基点に、復元済みテーブルと重なる場合だけ空き位置へ移してから全体表示します。保存領域が利用不可
または容量超過の場合は、図の閲覧とドラッグを継続しながら画面上に保存失敗を表示し、
`dbdef:er-layout-storage-error`イベントも発火します。

## 自動検証

- `.pre-commit-config.yaml`: `definitions/**/*.yaml` をコミット前に検証
- `.codex/hooks.json`: Codexが定義YAMLを編集した直後に検証
- `.github/hooks/database-definitions.json`: GitHub CopilotがYAMLを編集した直後とタスク完了前に検証
- `.github/workflows/copilot-setup-steps.yml`: Copilot cloud agentへPython依存関係を事前導入
- `.github/workflows/database-definitions.yml`: テスト、Schemaドリフト、YAML検証、成果物アップロード

リポジトリのCodex hookは初回のみ `/hooks` で内容を確認し、信頼してください。
Copilot hookは編集後に検証結果をコンテキストへ返し、定義が不正な場合は完了前に修正を1回要求します。
無限継続を避けるため、再試行後はCIの検証を最終ゲートとします。
