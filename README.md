# Place Chronicle

訪れた場所と再訪の記録を、地図・時系列・写真から見返す個人向けWebアプリです。現在はM0のプロトタイプ段階です。架空データの閲覧画面と入力プレビューがあり、保存機能はM1で実装します。

## 資料

- [基本設計書 v0.1](docs/place-chronicle-design-v0.1.md)：元の構想とMVPの範囲
- [作業計画](docs/implementation-plan.md)：M0からMVPまでの順序、完了条件、未決事項
- [API契約](docs/api-contract.md)：M1/M2実装時の入出力・制限・エラー形式
- [作業ルール](AGENTS.md)：このリポジトリでの実装と検証の約束

## 開発環境

- Git
- Node.js 24 LTS（`.nvmrc`）。この環境では v24.21.0 を確認済みです。
- npm 11.19.0（この環境で確認済み）
- Docker Desktop / Docker Compose（PostgreSQL用）

Node.jsのパッケージはnpm workspacesで `apps/api` と `apps/web` に分かれています。

## ローカルDBの準備

PowerShellで以下を実行します。`.env` はローカル専用で、Gitには追加しません。

```powershell
Copy-Item .env.example .env
# .env の POSTGRES_PASSWORD を自分用の値に変更
docker compose up -d db
docker compose ps
```

DBは `127.0.0.1:5432` で待ち受けます。ポートが使用中の場合は `.env` の `POSTGRES_PORT` を変更してください。停止は `docker compose stop db` です。名前付きボリューム `postgres_data` を使うため、コンテナ停止後もDBデータは残ります。DB全体の削除につながる `docker compose down -v` は、不要になったデータであることを確認してから実行してください。

`POSTGRES_*` の初期化設定は空のデータボリュームにだけ適用されます。既存ボリュームのパスワードは `.env` の書き換えだけでは変わりません。

## アプリの起動と検証

初回はルートで `npm ci` を実行します。DB起動後に `npm run db:migrate` で3テーブルを作成します。再実行しても既存データは残ります。

```powershell
npm ci
docker compose up -d db
npm run db:migrate
npm run dev:api
```

別のターミナルでWebを起動します。

```powershell
npm run dev:web
```

Webは `http://127.0.0.1:5173`、APIは `http://127.0.0.1:3000` です。Webから `/api/health` はAPIへ転送されます。開発中のAPIとDBはローカルホストにだけ公開します。

```powershell
npm run typecheck
npm test
npm run build
npm run format:check
```

APIテストはローカルDB内に一時スキーマを作成して削除します。実行前に `docker compose ps` でDBが `healthy` であることを確認してください。

## 次に進める作業

1. [API契約](docs/api-contract.md)に沿って、M1の場所と訪問の作成APIをテストから実装する。
2. 架空データ画面を実際の場所・訪問APIへ段階的に接続する。

実際の訪問履歴と写真は個人情報を含み得るため、サンプルデータとしてコミットしないでください。
