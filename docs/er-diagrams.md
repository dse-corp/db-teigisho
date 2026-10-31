# ER図の操作と仕様

ER図は、YAMLのテーブルと外部キー（FK）から生成します。HTMLでは表示や配置を変更でき、XLSXでは図形を編集できます。SVG・PNG・PDFでは生成時の図を確認できます。ビューとストアドプロシージャはER図に含めません。この文書の前半は閲覧者向け、後半のAPIと描画仕様は開発者向けです。

## Excelで図形を編集する

XLSXの「ER図」シートには、全カラムを表示するテーブル図形と、FKごとのカギ線コネクタを出力します。テーブルは外枠・ヘッダー・区切り線・テキストをグループ化しています。線の端点には、テーブルのグループに含まれる透明な接続口を割り当てています。

| やりたいこと | 操作 |
| --- | --- |
| テーブルを移動する | テーブルのグループを選択してドラッグ |
| テーブル名やカラム名を変える | グループを選択した後、内部のテキストボックスを選択して編集 |
| 色や線を変える | 図形やコネクタを選択し、「図形の書式設定」で変更 |
| カギ線の折れ位置を調整する | コネクタを選択し、調整ハンドルをドラッグ |
| FK名と複合列の対応を確認する | 接続口付近の番号と、図の下にある外部キーの凡例を照合 |

多重度と関連番号もテーブルのグループに含めます。接続口の図形を個別に削除したり、グループを解除したりすると接続関係が変わるため、配置変更はグループ単位で行ってください。接続先を手で変更した場合、ラベルと凡例の修正も必要です。

通常の経路はExcelの標準カギ線形状を使います。自己参照や折れ点の多い経路は、調整ハンドルを持つ1本のカスタムコネクタで表します。初期配置ではテーブル内部を通らない経路を使いますが、利用者が移動した後の交差や障害物回避はExcelの動作に依存します。印刷は横1ページ・縦複数ページに設定しています。印刷範囲は生成時の図と凡例を収めるように設定し、手動で範囲外へ移動した場合はExcel側で印刷範囲も変更してください。

Excel内の編集はYAMLへ反映しません。再生成時はYAMLから図を作り直すので、配置を調整した配布用ファイルは別名で保存してください。生成後にopenpyxlで読み込んで保存すると図形が失われる場合があります。図形の文字にはNoto Sans JPを指定し、未インストールの端末ではアプリケーションが代替フォントを使います。

Windows版・Mac版Excelでの移動時の追従、折れ位置の編集、保存・再読込、印刷は実機確認待ちです。自動検証の結果と残る確認項目は[計画との照合結果](excel-er-verification.md)を参照してください。

## HTMLを開いて表示を切り替える

生成HTMLは、JavaScriptと図のデータを同梱しています。`file:` URLで開いてオフラインで利用できます。JavaScriptが無効な場合は静的SVGを表示し、印刷時は全カラム表示の静的SVGを使います。

| やりたいこと | 操作 |
| --- | --- |
| 情報量を変える | 「全カラム」「PK・FKのみ」「テーブルのみ」を選択 |
| 拡大・縮小する | ホイールまたは「＋」「−」を操作。倍率は5〜300% |
| 図の見える範囲を動かす | 背景をドラッグ |
| 図全体を表示する | 「全体表示」を選択 |
| ページ内で画面いっぱいに広げる | 「最大化」を選択。「元に戻す」またはEscapeで解除 |
| テーブルの位置を変える | テーブルをドラッグ |
| 配置を整える | 「自動配置」を選択。方向は「左→右」「上→下」から指定 |
| 線の形を変える | 「曲線」「直線」「鍵線」を選択。初期値は直線 |
| 鍵線の位置を調整する | 中央の水平・垂直セグメントをドラッグ、またはフォーカスして対応する向きの矢印キーで10単位ずつ移動 |
| 線の交差を見分ける | 「Line jump」で交差ジャンプを切り替え。初期値はOn |
| 初期配置へ戻す | 「配置をリセット」を選択。保存済み配置と鍵線位置も削除 |

保存領域を利用でき、保存済み配置がない場合は、HTMLを開いたときに左から右への自動配置を実行し、その結果を保存します。「配置をリセット」は生成時の座標へ戻す操作です。選択中の線種とLine jumpの設定はリセットしません。

テーブルやカラムを選択すると、制約、デフォルト値、インデックス、外部キーなどを詳細パネルに表示します。選択したテーブルと直接関連するテーブル・接続線を強調し、関連しない要素は薄く表示します。

キーボードでは、矢印キーで選択候補を移動し、EnterまたはSpaceで選択します。Escapeまたは「閉じる」で詳細パネルを閉じます。最大化中は背景のスクロールを止め、解除時には操作前のフォーカスへ戻します。

## 配置は同じブラウザーの保存領域へ記録する

テーブルの配置、選択した線種、鍵線位置、Line jumpの設定は、ブラウザーの`localStorage`へ保存して再読み込み時に復元します。HTMLファイルやYAML自体は書き換えません。HTML上の調整は、別途生成するSVG・PNG・PDF・XLSXには反映されません。

保存する範囲は設定によって異なります。

| 設定 | 保存・復元の範囲 |
| --- | --- |
| テーブルの配置・自動配置の方向 | 定義書とグラフ構造ごと。構造変更後も、同じ定義書の過去の配置から物理名が一致するテーブルを復元 |
| 鍵線位置 | 定義書とグラフ構造ごと。対応する構造の保存値を復元 |
| 線種・Line jump | 同じ`localStorage`を使う定義書で共有 |
| 表示モード・ズーム・パン・最大化 | 保存しない |

定義書の識別には、`project_number`、`system_name`、`subsystem_name`、`database_name`、`schema_name`から求めるSHA-256を使います。このいずれかを変えると、別の定義書として扱います。`updated_at`の更新だけでは識別は変わりません。

配置の保存キーには、定義書の識別値に加えてテーブル・カラム・FK構造のフィンガープリントを使います。構造変更後の復元では、新しいテーブルを初期位置に置き、復元済みテーブルと重なる場合だけ空き位置へ移動します。鍵線位置はテーブル配置とは別の保存キーを使い、構造変更前の値を引き継ぐ処理は行いません。

自動配置は親子関係を層に分け、循環参照、自己参照、孤立テーブル、互いに接続していないテーブル群も配置します。実行後は全体を表示し、配置と方向を保存します。

ブラウザーが保存を拒否した場合や容量を超えた場合は、画面に失敗を表示します。その場合も図の閲覧、テーブルのドラッグ、線種の切り替えは続けられます。`file:` URLで開いたファイルの保存領域はブラウザーの扱いに依存するため、ファイルの移動・コピー先で復元されることは保証しません。別のブラウザーや端末への配置の共有は行いません。

## リレーションの多重度と線種を読み取る

参照先を親、FKを持つ参照元を子として、両端の多重度を次のルールで推定します。これは定義内容からの推定であり、実データを調査した結果ではありません。

| 判定対象 | 条件 | 表記 |
| --- | --- | --- |
| 親端 | 参照元FK列がすべてNOT NULL | 必ず1件（Mermaidでは`\|\|`） |
| 親端 | 参照元FK列にNULLを許す列がある | 0または1件（`\|o`） |
| 子端 | FK列集合が一意キーを含む | 0または1件（`o\|`） |
| 子端 | 上の条件を満たさない | 0件以上（`o{`） |
| 線種 | `on_delete: CASCADE`、またはFK列がすべて子のPKに含まれる | 実線（`identifying`） |
| 線種 | 上の条件を満たさない | 破線（`non_identifying`） |

一意キーには、主キー全体、`unique: true`の単一列、`where`を持たないUNIQUEインデックスのキー列を使います。列順とASC/DESCは判定に影響しません。部分インデックスは対象外で、`include_columns`も一意キーには含めません。複合FKの列対応は、YAMLの記述順を保持します。

子端が一意でも、親に対応する子が存在することまでは保証されないため、子端の最小件数は常に0です。ER図内の`PK`は主キー列、`FK`は外部キー列、`UK`はカラムの`unique: true`を表します。複合UNIQUEインデックスだけを持つ列には、個別の`UK`マークは付きません。

## 埋め込みグラフを別の機能から利用する

HTMLの`<script id="dbdef-er-graph" type="application/json">`に、`format_version: "1.0"`のグラフを埋め込みます。`tables`、各テーブルの`columns`、`relationships`はYAMLの定義順です。

各カラムの制約と`key_roles`、各テーブルの`indexes`と`foreign_keys`、複合FKの`column_pairs`、両端の多重度、`relationship_type`を収録します。ビューとストアドプロシージャはERグラフに含めません。

```javascript
const graph = JSON.parse(document.querySelector("#dbdef-er-graph").textContent);
```

Pythonでは同じデータを次のように取得できます。

```python
from pathlib import Path

from db_teigisho.er_graph import build_er_graph
from db_teigisho.loader import load_definition

definition = load_definition(Path("examples/database-definition.yaml"))
graph = build_er_graph(definition)
graph_json = graph.model_dump(mode="json")
```

ノードの寸法、初期座標、計測済みテキスト位置は、別の`#dbdef-er-geometry`要素に`format_version: "1.0"`として埋め込みます。ビューアはPython側で計測した寸法と生成時の座標を読み込みます。その後、保存済み配置の復元または自動配置を行います。

## ビューアAPIから座標と描画を更新する

`window.dbdefErViewer`（v1.0）は、表示状態とノード座標を操作するAPIです。`getGraph()`と`getState()`はコピーを返します。取得したオブジェクトを変更しただけでは画面は更新されません。

| API | 用途 |
| --- | --- |
| `getGraph()` / `getState()` | グラフ、表示モード、ビューポート、全ノード座標を取得 |
| `setViewState(state)` | `mode`、`viewport`、`nodePositions`を指定して更新 |
| `setMode(mode)` | `all`、`keys`、`tables`へ切り替え |
| `setViewport(viewport)` | `scale`、`x`、`y`を更新 |
| `fitToView()` / `zoomIn()` / `zoomOut()` | 全体表示・拡大・縮小 |
| `getNodePosition(tableId)` / `setNodePosition(tableId, position)` | 単一テーブルの座標を取得・更新 |
| `getNodeSize(tableId, mode)` | 指定モードの寸法を取得。モード省略時は全カラム |
| `setNodePositions(positions)` | 複数の座標を一括更新 |
| `redrawEdges()` | 現在の座標と寸法で接続線を再描画 |
| `setEdgePathRenderer(renderer)` | 接続線の経路計算を差し替え。`null`で既定へ戻す |
| `screenToGraphPoint(clientX, clientY)` | 画面座標をグラフ座標へ変換 |

座標の変更は上記APIを通してください。ドラッグ、自動配置、APIからの座標更新は、同じ経路で接続線を再描画します。

周辺機能は次のオブジェクトに分かれています。

| オブジェクト | バージョン | 主なAPI |
| --- | --- | --- |
| `window.dbdefErLayout` | 1.0 | `save()`、`restore()`、`reset()`、`getStorageKey()`、`getGraphFingerprint()`、`getMetadata()`、`wasRestored()` |
| `window.dbdefErAutoLayout` | 1.0 | `getDirection()`、`calculate()`、`run()`、`setDirection()`。方向は`left-to-right`または`top-to-bottom` |
| `window.dbdefErEdgeRouting` | 2.0 | `getRoutingMode()` / `setRoutingMode()`（`curve`、`straight`、`orthogonal`）、`getRouteOffsets()` / `setRouteOffset()` / `resetRouteOffsets()`、`getLineJumpsEnabled()` / `setLineJumpsEnabled()` |
| `window.dbdefErMaximize` | 1.0 | `isMaximized()`、`setMaximized()`、`maximize()`、`restore()`、`toggle()` |

`calculate()`は配置を計算して返し、`run()`は計算結果の適用・保存・全体表示まで行います。`setDirection()`も指定した方向で`run()`を実行します。線の経路戦略は`setEdgePathRenderer()`へ登録され、ノード座標の計算には関与しません。

ビューアAPIから座標を更新するだけでは配置は保存しません。再読み込み後にも残す場合は、更新後に`window.dbdefErLayout.save()`を呼びます。線種・鍵線位置・Line jumpの更新APIは、既定で変更を保存します。

## 操作の変化をイベントで受け取る

`#dbdef-er-viewer`で次の`CustomEvent`を受け取れます。

| イベント | 通知する変化 |
| --- | --- |
| `dbdef:er-view-change` | 表示モード、ズーム、パン |
| `dbdef:er-node-position-change` | ノード座標 |
| `dbdef:er-edges-redrawn` | 接続線の再描画 |
| `dbdef:er-selection-change` | テーブル・カラムの選択 |
| `dbdef:er-auto-layout` | 自動配置の方向と対象テーブル |
| `dbdef:er-layout-reset` | 配置のリセット |
| `dbdef:er-edge-routing-change` | 線種 |
| `dbdef:er-route-offset-change` / `dbdef:er-route-offset-reset` | 鍵線位置の変更・リセット |
| `dbdef:er-line-jumps-change` | 交差ジャンプの設定 |
| `dbdef:er-layout-storage-error` / `dbdef:er-edge-routing-storage-error` | 保存領域での処理失敗 |
| `dbdef:er-maximize-change` | 最大化。`detail.maximized`と`detail.reason`を提供 |

ノードDOMは`data-table-id`、カラム行は`data-column-id`、接続線は`data-relationship-id`を持ちます。選択対象は`aria-selected`と`aria-controls="dbdef-er-details"`で詳細パネルへ関連付けます。

## 静的画像の描画と上限

SVGとPNGは、共通のPython描画シーンから直接生成します。長い名前は文字幅を計測して折り返し、FK名と列対応は番号付きの凡例に表示します。PNGは同梱のNoto Sans JP、SVGは閲覧端末の日本語フォントを使います。

| 対象 | 上限 |
| --- | --- |
| テーブル数 | 500 |
| リレーション数 | 2,000 |
| テーブルのメタデータ | JSON化した文字数の合計が100万文字 |
| 図の最大辺 | 10万単位 |
| PNG | 最大8,000px/辺、1,600万画素 |

PNGが上限を超える場合は縮小します。必要な縮小率が50%未満になる図はエラーにします。この場合は定義を小さい単位に分割してください。分割後も、各FKの参照先テーブルとカラムを同じYAMLに含める必要があります。

上限はYAMLの検証時ではなく、図の生成時に確認します。画像レンダラーはSVGとPNGをまとめて作るため、`render --format svg`でもPNGの上限が適用されます。HTML・PDF・`build`も同じ画像レンダラーを使います。XLSX単独の生成はPNGを作りませんが、テーブル数、リレーション数、メタデータ量、図の最大辺の上限は適用されます。Mermaidコードの生成は、この描画処理を経由しません。

Python、Pillow、フォントが同じ環境では、SVGとPNGの出力は決定的です。manifestの生成日時やPDF・XLSXの内部メタデータまで同一バイトになることは保証しません。

生成コマンドは[README](../README.md)、描画や操作の回帰テストは[開発と自動検証](development.md)を参照してください。
