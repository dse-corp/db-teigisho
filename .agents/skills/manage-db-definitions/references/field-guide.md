# YAML項目ガイド

このガイドは、データベース定義YAMLを作成・編集する人とAIエージェント向けです。[基本サンプル](../../../../examples/database-definition.yaml)をコピーし、対象の項目を確認しながら編集してください。構造と型は[Pythonモデル](../../../../src/db_teigisho/models.py)で定義し、[JSON Schema](../../../../schemas/db-definition.schema.json)はそのモデルから生成します。

編集後は`dbdef validate <path>`で検証します。読み込み時には、構造の検証に続いて名前の重複やFK参照などの意味検証を行います。未対応のフィールドはエラーになります。

## ルートの6項目は省略しない

| 項目 | 内容 |
| --- | --- |
| `format_version` | 文字列の`"1.0"`を指定 |
| `document` | 文書の識別情報と作成・変更日時 |
| `database` | 対象DBMSとデータベースの情報 |
| `tables` | テーブルの配列 |
| `views` | ビューの配列 |
| `stored_procedures` | ストアドプロシージャの配列 |

オブジェクトがない場合も、`tables: []`、`views: []`、`stored_procedures: []`のように空の配列を記述します。

## 文書情報と対象データベースを記述する

`document`には、`project_number`、`system_name`、`created_at`、`updated_at`が必須です。サブシステムに属する場合は`subsystem_name`を追加します。

日時は`"2026-08-09T18:30:00+09:00"`のように、タイムゾーンのオフセットを含むISO 8601形式で記述してください。内容を変えたら`updated_at`を更新し、`created_at`は保持します。検証器は`updated_at`が`created_at`以降であることを確認します。オフセットの有無自体はモデルの検証対象にしていないため、両方の日時を同じ方針で記述してください。

`database`には、`dbms_name`、`dbms_version`、`database_name`、`schema_name`が必須です。`server_name`、`port`、`collation`は任意です。`port`は1〜65535の整数を指定します。これらは定義書の表示用情報であり、ツールからDBへ接続するための設定ではありません。

## テーブルには1列以上のカラムを定義する

テーブルには`physical_name`、`logical_name`、`columns`が必須です。`columns`は1列以上必要です。`description`は任意で、`indexes`と`foreign_keys`は省略すると空の配列になります。

カラムの項目は次のとおりです。

| 項目 | 必須・既定値 | 用途 |
| --- | --- | --- |
| `physical_name` | 必須 | DB上のカラム名 |
| `logical_name` | 必須 | 日本語などの業務上の名前 |
| `data_type` | 必須 | 対象DBMSのデータ型名 |
| `length` | 省略時は`null` | 文字数や数値の精度。正の整数 |
| `scale` | 省略時は`null` | 小数点以下の桁数。0以上の整数 |
| `default` | 省略時は`null` | 文字列、整数、有限の小数、真偽値、`null` |
| `not_null` | `false` | NOT NULL制約 |
| `unique` | `false` | 単一カラムのUNIQUE制約 |
| `primary_key` | `false` | 主キーカラム |
| `description` | 省略時は`null` | 補足説明や業務ルール |

PK列には`primary_key: true`と`not_null: true`を指定します。複合主キーは、構成するすべての列で`primary_key: true`にします。`unique: true`はその列単独の一意性を表すため、複合主キーという理由だけで各列に指定しないでください。

`scale`を指定する場合は`length`も必要で、`scale <= length`にします。データ型ごとに長さや精度が使えるかどうかは、対象DBMSの仕様で確認してください。

`default`には配列やマッピングを指定できません。SQL式は文字列として記述し、YAMLが別の値として解釈する可能性がある場合は引用符で囲みます。たとえばSQLのNULLという文字列を残すなら`default: "NULL"`、値がないことを表すなら`default: null`です。ツールはSQL式を実行しません。

## インデックスのキー列と付加列を分ける

インデックスには`name`と1列以上の`columns`が必須です。各キー列は`name`と`order`を持ち、`order`は省略時に`ASC`、降順なら`DESC`です。

| 任意項目 | 既定値・用途 |
| --- | --- |
| `type` | 省略時は`null`。`btree`、`hash`、`gin`などの種別 |
| `unique` | `false`。複合UNIQUEもここで表現 |
| `include_columns` | 空配列。キーに含めない付加列 |
| `where` | 省略時は`null`。部分インデックスの条件 |

キー列と付加列は、そのテーブルに存在するカラムを参照します。同じカラムを重複して指定した場合も検証エラーになります。種別名と`where`のSQL構文は検証しません。

## FKは同じYAML内のテーブルと列を参照する

FKには`name`、参照元の`columns`、`referenced_table`、参照先の`referenced_columns`が必須です。両方の列配列は1列以上とし、列数と対応順をそろえます。

`on_update`と`on_delete`には、`NO ACTION`、`RESTRICT`、`CASCADE`、`SET NULL`、`SET DEFAULT`のいずれかを指定します。省略時は`NO ACTION`です。`deferrable`は省略時に`false`で、対象DBMSで遅延制約を利用する場合に`true`とします。

参照元カラム、参照先テーブル、参照先カラムはすべて同じYAML内に必要です。`on_delete: SET NULL`の場合、参照元FK列はすべてNULLを許す必要があります。この組み合わせの検証は`on_update: SET NULL`には実装されていないため、更新時の動作もレビューしてください。

参照先が主キーまたは一意キーであること、対応する列のデータ型が適合すること、DBMSが指定アクションをサポートすることは検証しません。ER図の推定ルールは[ER図の操作と仕様](../../../../docs/er-diagrams.md)を参照してください。

## ビューとストアドプロシージャのSQLは複数行で書ける

どちらも`physical_name`、`logical_name`、`sql`が必須で、`description`は任意です。SQL本文には`sql: |`を使うと改行を保って記述できます。

```yaml
views:
  - physical_name: active_customers
    logical_name: 有効顧客
    sql: |
      SELECT customer_id, email
      FROM customers
      WHERE is_active = true;
```

SQL本文の構文解析や参照先の検証は行いません。対象DBMSで実行する際の区切り文字も含め、必要な文を記述してください。

## 名前の重複は大文字・小文字を区別せず検出する

テーブル名、ビュー名、ストアドプロシージャ名は、それぞれの配列内で一意にします。テーブルとビューの間でも同名は使えません。カラム名、インデックス名、FK名は、それぞれ同じテーブル内で重複を検出します。

名前の比較とカラム・テーブルの参照照合には`casefold()`を使います。DBMSの引用識別子による大文字・小文字の区別を再現するものではないため、そのような名前の使い分けは避けてください。

検証を通過しても、DBMS固有の設計やSQLの正しさまでは保証されません。定義を変更したら、検証結果と設計レビューの両方を確認してから成果物を再生成します。生成手順は[README](../../../../README.md)、解決しない問題の報告先は[Issues](https://github.com/dse-corp/db-teigisho/issues)です。
