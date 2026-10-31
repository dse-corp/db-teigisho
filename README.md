# db-teigisho

YAMLでデータベース定義を管理し、検証と定義書の生成を行うPythonツールです。テーブル、カラム、インデックス、外部キー、ビュー、ストアドプロシージャを記述すると、HTML・Excel・PDFの定義書とER図を生成します。

定義内容の正本（Single Source of Truth、SSOT）はYAMLです。変更はYAMLに反映し、配布用のファイルはコマンドで再生成します。実データベースへの接続、DDLの生成、マイグレーションの実行は行いません。

初めて使う場合は「インストールして定義書を生成する」まで進めてください。項目の詳細や開発手順は、次の文書から参照できます。

| 目的 | 参照先 |
| --- | --- |
| YAMLを作成・編集する | [YAML項目ガイド](.agents/skills/manage-db-definitions/references/field-guide.md) |
| 記述例を確認する | [基本サンプル](examples/database-definition.yaml)、[ECサイトの定義例](definitions/ecommerce.yaml) |
| ER図を操作する・表記ルールを確認する | [ER図の操作と仕様](docs/er-diagrams.md) |
| ツールを開発・検証・公開する | [開発と自動検証](docs/development.md) |
| AIエージェントで定義を編集する | [manage-db-definitions Skill](.agents/skills/manage-db-definitions/SKILL.md) |

## インストールして定義書を生成する

Python 3.11以上が必要です。CLIとして利用する場合は、`pipx`でインストールします。

```bash
pipx install db-teigisho
dbdef --version
```

更新には`pipx upgrade db-teigisho`、削除には`pipx uninstall db-teigisho`を使います。

以下は、このリポジトリのルートで実行する例です。インストールしたCLIを別の場所で使う場合は、入力パスを手元のYAMLに置き換えてください。

```bash
# 基本サンプルを検証する
dbdef validate examples/database-definition.yaml

# 定義書とER図を一括生成する
dbdef build examples/database-definition.yaml --output dist/database-definition
```

生成された`dist/database-definition/database-definition.html`をブラウザーで開くと、定義書と操作可能なER図を確認できます。ECサイトの定義例を使う場合は、次のように実行します。

```bash
dbdef build definitions/ecommerce.yaml --output dist/ecommerce
```

パッケージのインストール後は、すべての形式をオフラインで生成できます。生成にNode.js、Mermaid実行環境、ブラウザーは不要です。HTMLのER図操作には、閲覧ブラウザー上で同梱のJavaScriptを使います。

## YAMLを編集し、検証してから再生成する

[基本サンプル](examples/database-definition.yaml)をコピーし、[YAML項目ガイド](.agents/skills/manage-db-definitions/references/field-guide.md)に沿って編集します。`format_version`は`"1.0"`を使います。定義を変更したら`document.updated_at`も更新し、既存の物理名は改名が必要な場合にだけ変更してください。

```bash
# 複数のファイルやディレクトリをまとめて検証する
dbdef validate definitions examples

# プログラムから読み取るため、JSONで結果を出す
dbdef validate definitions --json
```

ディレクトリを指定すると、配下の`*.yaml`と`*.yml`を再帰的に検証します。JSON出力は、ファイルごとの`path`、`valid`、`errors`を持つ配列です。検証エラーがあれば終了コードは`1`になります。

対象の探索に失敗した場合や、指定したディレクトリにYAMLがない場合は、`--json`を付けても配列を返さず標準エラー出力に理由を表示します。プログラムから呼び出す場合は、終了コードと標準エラー出力も確認してください。

検証では、必須項目や未対応のフィールドに加え、名前の重複、PK列のNOT NULL、インデックスやFKの参照先などを確認します。SQL構文、データ型の妥当性、FK参照先の一意性など、DBMSに依存する内容は別途レビューしてください。

YAMLの検証が通ったら`build`を実行します。生成済みファイルを直接編集しても、次の生成で上書きされます。

## 必要な形式だけを出力する

`render`は1形式、`build`は全6形式とmanifestを生成します。どちらも入力YAMLを読み込む際に検証します。用途に応じて形式を選んでください。

| 用途 | 形式 |
| --- | --- |
| 定義書を読み、ER図の表示や配置を変える | HTML |
| 定義書のセルやER図の図形をExcelで編集する | XLSX |
| 印刷・配布用の定義書を作る | PDF |
| ER図を画像として使う | SVG・PNG |
| MermaidにER図のコードを渡す | Mermaid（`.mmd`） |

```bash
dbdef render examples/database-definition.yaml --format html --output dist/definition.html
dbdef render examples/database-definition.yaml --format xlsx --output dist/definition.xlsx
dbdef render examples/database-definition.yaml --format pdf --output dist/definition.pdf

# PK・FK列だけを含むMermaidコード
dbdef render examples/database-definition.yaml --format mermaid --er-columns keys --output dist/definition.mmd

# テーブル名だけのSVGと、全カラムを含むPNG
dbdef render examples/database-definition.yaml --format svg --er-columns tables --output dist/definition.svg
dbdef render examples/database-definition.yaml --format png --output dist/definition.png
```

`--er-columns`は`mermaid`、`svg`、`png`に適用されます。値は`all`（既定、全カラム）、`keys`（PK・FK列）、`tables`（テーブル名のみ）です。HTMLは閲覧時に表示を切り替え、XLSXとPDFには全カラムのER図を掲載します。

XLSXのER図は、テーブルごとにグループ化した図形と、接続先を持つカギ線コネクタで生成します。Excelで文字・色・配置を編集できます。編集結果はExcelファイル内に保存され、YAMLからの再生成時には置き換わります。操作方法と検証状況は[ER図の操作と仕様](docs/er-diagrams.md#excelで図形を編集する)を参照してください。

HTMLで変更した配置や線種は、閲覧したブラウザーの保存領域に記録します。HTMLファイルや他形式の成果物には書き込まれません。保存範囲とリセットの対象は[配置と設定の保存仕様](docs/er-diagrams.md#配置は同じブラウザーの保存領域へ記録する)を参照してください。

`validate`が成功しても、ER図の生成時にサイズ上限を超えると出力に失敗します。HTML・SVG・PDFの生成でも内部でPNGを描画するため、PNGの上限が適用されます。XLSX単独の生成はPNGを経由しません。上限の詳細は[ER図の描画仕様](docs/er-diagrams.md#静的画像の描画と上限)を参照してください。

## 一括生成で出力されるファイル

`dbdef build <入力YAML> --output <出力ディレクトリ>`は、入力ファイルの拡張子を除いた名前を使って、次のファイルを生成します。

| ファイル | 内容 |
| --- | --- |
| `<入力名>.html` | 目次、文書・DBMS情報、ER図、テーブル一覧、各定義、SQL本文を収録した自己完結HTML |
| `<入力名>.xlsx` | 文書情報、テーブル一覧、ER図、各テーブル、ビュー、ストアドプロシージャの各シート |
| `<入力名>.pdf` | 表紙、ER図、テーブル一覧、各定義、SQL本文を収録したPDF |
| `<入力名>.mmd` | FKから生成したMermaid ER図コード |
| `<入力名>.svg` / `<入力名>.png` | 全カラムを表示するER図の画像 |
| `manifest.json` | 入力と各成果物のSHA-256、成果物のバイト数、生成日時、ツールバージョン |

PDFにはNoto Sans JPを埋め込み、PNGの描画にも同じフォントを使います。SVGは閲覧端末の日本語フォントを使用します。同梱フォントのライセンスは[OFL.txt](src/db_teigisho/assets/OFL.txt)を参照してください。

同じ出力ディレクトリで再生成すると、同名の成果物と`manifest.json`を上書きします。複数の定義書を管理する場合は、上の例のように出力先を分けてください。

`build`は全形式の生成後にmanifestを書き込みます。途中で失敗すると、出力先に一部の新しいファイルと以前のファイルが混在する場合があります。配布前にコマンドの成功を確認してください。`render`はmanifestを生成・更新しません。

## ソースコードから利用する

リポジトリのルートで仮想環境を作り、開発用の依存関係をインストールします。

```bash
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
.venv/bin/dbdef validate definitions examples
.venv/bin/dbdef build examples/database-definition.yaml --output dist/database-definition
```

テストやCI、PyPI公開の手順は[開発と自動検証](docs/development.md)にまとめています。

文書内の略語は次の意味で使っています。

| 略語 | 意味 |
| --- | --- |
| PK | 主キー |
| FK | 外部キー |
| UK | 一意キー |
| DBMS | データベース管理システム |

手順で解決しない問題は、実行コマンドとエラー内容を添えて[Issues](https://github.com/dse-corp/db-teigisho/issues)へ報告してください。
