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

## 公開前に見る点

1. ロビーが `/` で開くか
2. 4ゲームへ遷移できるか
3. `/api/health` が `ok` を返すか
4. スコア投稿後、再起動してもランキングが残るか
5. 永続ボリュームが `/app/data` に付いているか
