# Deployment Guide

## おすすめ

最初の公開先は Railway を推奨します。

理由:

- 今の構成は `Node.js + SQLite + 静的ファイル配信` の 1 サービス構成
- SQLite を残したまま出しやすい
- `Dockerfile` をそのまま使える
- 永続ボリュームを付けやすい

## このリポジトリで追加したもの

- `Dockerfile`
  デプロイ先でそのままビルドして起動できる
- `.dockerignore`
  不要なローカル生成物をイメージに入れない
- `PLATFORM_DATA_DIR`
  SQLite 保存先をデプロイ先の永続ボリュームに向けられる
- `HOST`
  クラウドで必要な `0.0.0.0` 待受に対応

## Railway での出し方

1. GitHub リポジトリを Railway に接続する
2. ルートの `Dockerfile` を使ってデプロイする
3. Volume（永続保存領域）を追加する
4. Volume のマウント先を `/app/data` にする
5. 必要ならカスタムドメインを付ける

推奨環境変数:

- `HOST=0.0.0.0`
- `PLATFORM_DATA_DIR=/app/data`

`PORT` は Railway 側が自動で渡す想定です。

ヘルスチェック:

- `/api/health`

## Render での出し方

Railway の次点は Render です。

向いているケース:

- 管理画面がわかりやすい方がよい
- Docker ベースで素直に運用したい

手順:

1. GitHub リポジトリから Web Service を作る
2. Runtime は Docker を選ぶ
3. Persistent Disk（永続ディスク）を追加する
4. マウント先を `/app/data` にする
5. 環境変数 `HOST=0.0.0.0` と `PLATFORM_DATA_DIR=/app/data` を設定する

ヘルスチェック:

- `/api/health`

## 今はおすすめしない候補

### Vercel

今の構成では不向きです。

- ローカル SQLite をそのまま永続化しにくい
- 常時動く単一 Node サーバー構成と相性がよくない

## Cloudflare Workers + D1 + Durable Objects

Cloudflare で進める場合は、この構成に寄せます。

- `Workers`
  API と静的配信の入口
- `Assets`
  ロビーと各ゲームの静的ファイル
- `D1`
  ランキング保存
- `Durable Objects`
  レート制限

追加した主なファイル:

- `wrangler.toml`
- `cloudflare/worker.mjs`
- `cloudflare/rate-limiter-do.mjs`
- `cloudflare/migrations/0001_init.sql`
- `scripts/build-cloudflare-assets.mjs`

最初のセットアップ:

1. `wrangler login`
2. `wrangler d1 create codex-web-platform`
3. 返ってきた `database_id` を `wrangler.toml` に入れる
4. `npm run cf:d1:migrate:local`
5. `npm run cf:dev`

本番反映:

1. `npm run cf:build-assets`
2. `wrangler d1 migrations apply codex-web-platform --remote`
3. `npm run cf:deploy`
4. `npm run cf:smoke -- https://<your-domain-or-workers-dev>`

現在の安定公開先:

- `https://codex-web-platform.yqs01140.workers.dev`

注意:

- Cloudflare 版は既存の Node サーバーとは別入口です
- まずは Workers 側で公開できる状態まで寄せ、必要ならあとで全面移行します

### 独自ドメイン反映後の手順

ネームサーバー反映が終わって、Cloudflare に `satoshi-0302.com` の zone が見えるようになったら次を行います。

1. `wrangler.toml` に以下を追加する

```toml
[[routes]]
pattern = "games.satoshi-0302.com"
zone_name = "satoshi-0302.com"
custom_domain = true
```

2. `npm run cf:deploy`
3. `npm run cf:smoke -- https://games.satoshi-0302.com`

もし deploy 時に zone が見つからない場合は、まだネームサーバー反映待ちです。

## 無料枠で壊れにくくする方針

- `GET /api/games` だけ短いキャッシュを使う
- ランキングと投稿結果はキャッシュしない
- 投稿は Durable Objects でレート制限する
- D1 には Top10 だけを残す

この方針にしておくと、無料枠でも無駄な読み取りを増やしにくく、投稿直後の見え方も崩しにくいです。

## 公開前に見る点

1. ロビーが `/` で開くか
2. 4ゲームへ遷移できるか
3. `/api/health` が `ok` を返すか
4. スコア投稿後、再起動してもランキングが残るか
5. 永続ボリュームが `/app/data` に付いているか
