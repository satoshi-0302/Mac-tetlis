# Asteroids 60

60 秒固定、60tick 固定のブラウザゲームです。  
replay 検証つき leaderboard と、AI demo / WATCH replay が入っています。  
replay 検証は入力 digest に加えて final state hash を計算し、browser worker と headless runner の両方で同じ判定系を使います。

## いま残してあるもの

- ゲーム本体
- leaderboard / replay 用サーバー
- 最新 AI モデル
- 最新 AI replay
- このプロジェクトの結果と学び

学習用の大量ログ、実験スクリプト、途中成果物は整理して削除しています。

## 最新結果

詳しくは `LATEST_RESULT.md` を見てください。

- 最新モデル: `public/rl/demo-policy.json`
- WATCH 用 replay: `public/rl/ai-top10.json`
- 学びのまとめ: `LEARNINGS.md`

## 起動方法

前提:

- Node.js `22.13.0` 以上
- `server/server.js` は `node:sqlite` を使うため、古い Node では起動しません

1. `npm install`
2. `npm run server`
3. 別ターミナルで `npm run dev`
4. ブラウザで開く

通常は `http://localhost:5173` です。  
API は `http://localhost:8787` を使います。

## 公開時の安全設定

- CORS はデフォルトでローカル開発用の `localhost` / `127.0.0.1` を許可します
- 本番でフロントと API の origin（配信元）が分かれる場合は、サーバー起動時に `ASTEROIDS60_ALLOWED_ORIGINS` を設定してください
- 投稿 API には簡単な連投制限があります。必要なら `ASTEROIDS60_SUBMIT_LIMIT` と `ASTEROIDS60_SUBMIT_WINDOW_MS` で調整できます
- 逆プロキシ配下で本来のクライアント IP を使いたい場合だけ `ASTEROIDS60_TRUST_PROXY=1` を設定してください

例:

```bash
ASTEROIDS60_ALLOWED_ORIGINS=https://asteroids.example.com \
ASTEROIDS60_SUBMIT_LIMIT=8 \
ASTEROIDS60_SUBMIT_WINDOW_MS=60000 \
npm run server
```

## 操作

- 回転: `A / D` または `← / →`
- 前進: `W` または `↑`
- 開始 / 射撃 / リスタート: `Space`
- Bomb: `Shift`
- AI demo: `P` または `DEMO`

## leaderboard

- leaderboard は 1 本化済みです
- 1 位は AI の現行ベストです
- 2 位から 10 位は空欄の目標スコアです
- 1 位だけ `WATCH` で replay を見られます

## 構成

```text
src/         ゲーム本体
server/      leaderboard / replay 検証サーバー
public/rl/   最新 AI モデルと replay
```

`src/replay/verify-runner.js` は browser / Node 共通のヘッドレス replay runner です。
