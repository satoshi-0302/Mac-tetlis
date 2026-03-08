# Asteroids 60

60 秒固定、60tick 固定のブラウザゲームです。  
replay 検証つき leaderboard と、AI demo / WATCH replay が入っています。

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

1. `npm install`
2. `npm run server`
3. 別ターミナルで `npm run dev`
4. ブラウザで開く

通常は `http://localhost:5173` です。  
API は `http://localhost:8787` を使います。

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
