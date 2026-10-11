# Place Chronicle API契約 v0.1

この文書はM0時点のM1/M2向け契約です。実装済みエンドポイントは `GET /api/health` のみです。ベースURLはローカルの `http://127.0.0.1:3000` とし、外部公開しません。

## 共通ルール

- JSONのキーは `camelCase`、IDはUUID文字列、日時はオフセットを含むISO 8601文字列。DBには `timestamptz` で保存する。
- 作成・更新日時はサーバーが付与する。更新APIは `updatedAt` を変更する。
- `Content-Type: application/json` を使う。画像だけ `multipart/form-data`。
- 未指定の任意項目は `null`。Visitの `text` だけは未指定・`null`・空文字をすべて `""` として保存・返却する。日時の返却はUTCの `Z` 表記に統一する。
- エラーは `{ "error": { "code": "validation_error", "message": "...", "fields": { "name": "..." } } }`。`fields` は入力エラー時のみ。未検出は404、競合は409、入力不正は400、DB障害は503。
- 一覧は `limit`（既定20、最大50）と不透明な `cursor` を使う。返り値は `{ "items": [...], "nextCursor": string | null }`。訪問は `visitedAt DESC, id DESC`、場所は `createdAt DESC, id DESC`。無効なcursorは400。
- PlaceとVisitの削除は関連数を画面に示して確認する。DBの外部キーは `RESTRICT`。MVPでは子レコードが残るPlace/Visitの削除は409で拒否し、先に子レコードを削除する。Photo削除は原本・サムネイルを消す。

## モデル

| モデル | 入力 | 返却時に加える値 |
|---|---|---|
| Place | `name` 必須、`category`/`address`/`note` 任意、`latitude`/`longitude` 必須 | `id`, `createdAt`, `updatedAt` |
| Visit | `placeId`/`visitedAt` 必須、`text` 任意 | `id`, `createdAt`, `updatedAt` |
| Photo | アップロードした画像、`caption` 任意、`sortOrder` | `id`, `visitId`, `originalFilename`, `mimeType`, `byteSize`, `width`, `height`, `createdAt` |

`name` は前後の空白を除いた1〜200文字。`category` は任意の1〜80文字。緯度は -90〜90、経度は -180〜180、いずれも小数6桁まで。`visitedAt` は明示的な `Z` または `±HH:MM` オフセットを必須とする。Visitの `text` は空欄可で最大10,000文字。`text` 以外の任意文字列は空文字を `null` として保存する。

Place返却例：

```json
{"id":"b3c68aae-9718-4d29-a7d9-2ea114f36d2a","name":"架空の公園","category":"公園","latitude":35.5,"longitude":139.5,"address":null,"note":null,"createdAt":"2026-10-11T08:00:00.000Z","updatedAt":"2026-10-11T08:00:00.000Z"}
```

Visit返却例：

```json
{"id":"4c82d727-b72e-4bf1-bc16-f60566cc18df","placeId":"b3c68aae-9718-4d29-a7d9-2ea114f36d2a","visitedAt":"2026-10-01T00:00:00.000Z","text":"","createdAt":"2026-10-11T08:00:00.000Z","updatedAt":"2026-10-11T08:00:00.000Z"}
```

Place詳細はPlace返却値に `visitCount` を加える。Visit詳細はVisit返却値に `photos` 配列を加える。一覧の `items` は各モデルの返却値の配列。

## エンドポイント

| Method | Path | 入力・応答 |
|---|---|---|
| GET | `/api/health` | DBへ `SELECT 1`。正常時 `200 {"status":"ok","database":"ok"}`、DB障害時503 |
| GET | `/api/places` | `q`（名前の部分一致）、`category`、`limit`、`cursor`。Placeのページ一覧 |
| POST | `/api/places` | Place入力。作成したPlaceを201で返す |
| GET | `/api/places/:id` | Placeと訪問件数。訪問一覧は `/api/visits?placeId=` から取得 |
| PATCH | `/api/places/:id` | Place入力の一部。更新後のPlaceを返す |
| DELETE | `/api/places/:id` | 子Visitがなければ204。子があれば409と件数 |
| GET | `/api/visits` | `placeId`、`category`、`yearMonth`（`YYYY-MM`）、`timeZone`（IANA名）、`limit`、`cursor`。Visitのページ一覧 |
| POST | `/api/visits` | Visit入力。作成したVisitを201で返す。存在しないPlaceは404 |
| GET | `/api/visits/:id` | VisitとPhoto一覧を返す |
| PATCH | `/api/visits/:id` | `visitedAt`/`text` の一部。場所移動はMVPでは対象外 |
| DELETE | `/api/visits/:id` | 子Photoがなければ204。子があれば409と件数 |
| POST | `/api/visits/:id/photos` | `multipart/form-data` の `files`。アップロード後のPhoto一覧を返す |
| DELETE | `/api/photos/:id` | メタデータ・原本・サムネイルを削除し204 |

`yearMonth` を指定する場合は `timeZone` も必須とし、そのタイムゾーンの月初から翌月初までを検索する。無効なIANA名は400。M0の架空データ画面はAPIを呼ばず、この契約の実装はM1から始める。

## 写真

- JPEG、PNG、WebPのみ。拡張子ではなく画像の実体を検証する。1枚15 MiB、1訪問20枚、アップロード1回最大10枚。
- 原本を保持し、表示用サムネイルは別ファイル。原本のEXIFはローカル保存時は維持し、公開時は別途漏洩対策を設計する。
- `sortOrder` は0以上の整数。欠番と同値を許し、表示は `sortOrder ASC, id ASC`。
- ファイル保存に失敗した場合はPhoto行を確定しない。DB書き込み失敗時は保存済みファイルを片付ける。

## バックアップ・復元（M2）

- 初期実装はローカル専用コマンドとする。UIからのAPI実行は、容量・タイムアウト・認可を判断してから追加する。設計書のAPI案は確定仕様ではない。
- ZIPに `manifest.json` と原本画像を含める。マニフェストに `formatVersion: 1`、Place/Visit/PhotoのIDとメタデータ、原本の相対パスとSHA-256を記録する。サムネイルは復元時に再生成する。
- インポート前に形式・参照・パス・サイズ・ハッシュを検証する。初期方式は空のDBへの全件復元のみとし、既存データがある場合は明示的なエラーで停止する。再試行で重複しないよう、途中失敗時はDBをロールバックし一時ファイルを削除する。
- 空データ、複数訪問、複数画像でエクスポートと復元の往復をテストする。写真原本のSHA-256一致を検証する。
