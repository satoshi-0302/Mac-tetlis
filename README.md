# Web Game Platform

5種類のブラウザゲームを、1つのロビーと共通ランキング基盤でまとめて運用するためのリポジトリです。

公開URL:

- `https://codex-web-platform.yqs01140.workers.dev`

## できること

- 共通ロビーからゲームを選んで遊ぶ
- ロビーから `自動 / PC版 / スマホ版` を選べる
- ゲームごとにランキングを持つ
- 対応ゲームは replay を使ってスコア検証できる

## 現在のゲーム

| Game | Path | Touch | Replay |
| --- | --- | --- | --- |
| Snake60 | `games/snake60/` | Yes | Yes |
| Missile Command | `games/missile-command/` | Yes | Yes |
| Asteroid | `games/asteroid/` | Yes | Yes |
| Slot60 | `games/slot60/` | Yes | No |
| Stackfall | `games/stackfall/` | Yes | Yes |

## 端末別の入口

- ロビーの `PLAY` は端末に合わせて `PC版 / スマホ版` を自動で選びます
- 各カードの下に `PC版` と `スマホ版` の直リンクもあります
- スマホ版は `iPhone 11 以降` の横画面を基準に詰めています

## ディレクトリ構成

```text
.
├── games/
│   ├── snake60/
│   ├── missile-command/
│   ├── asteroid/
│   ├── slot60/
│   └── stackfall/
├── platform/
├── docs/
├── AGENTS.md
├── package.json
└── README.md
```

## 役割

- `games/`
  各ゲーム本体を置く場所です。ゲームごとの実装や補助スクリプトもここに入れます。
- `platform/`
  共通ロビー、共通API、ゲーム定義、ランキング保存を置く場所です。
- `docs/`
  仕様書や運用メモを置く場所です。

## 主要ファイル

- `platform/server.mjs`
  ロビー配信と API のエントリーポイント
- `platform/games.mjs`
  ロビーに出すゲーム一覧の定義
- `docs/WEB_GAME_PLATFORM_SPEC.md`
  統合サイト全体の仕様書

## 起動

統合サイトの起動:

```bash
npm run platform:start
```

Asteroid / Stackfall のビルド:

```bash
npm run platform:build
```

または個別ビルド:

```bash
npm run platform:build:asteroid
npm run platform:build:stackfall
```

ポートを変えたい場合:

```bash
PORT=9191 npm run platform:start
```

## デプロイ

現在は **Cloudflare Workers + D1 + Durable Objects** をメインの実行環境としています。

```bash
npm run cf:build-assets
npm run cf:dev
npm run cf:deploy
```

Railway 等のコンテナ環境でも動作可能です（`Dockerfile` 完備）。

```bash
npm run cf:build-assets
npm run cf:dev
npm run cf:deploy
```

現在の公開先:

- `https://codex-web-platform.yqs01140.workers.dev`

公開確認:

```bash
npm run cf:smoke -- https://codex-web-platform.yqs01140.workers.dev
```

スマホ表示の自動確認:

```bash
npm run ui:capture:iphone14
```

横画面で1ページだけ撮る例:

```bash
npm run ui:capture:iphone14 -- --landscape '/games/missile-command/?mode=mobile'
```

出力先は `docs/screenshots/generated/` です。

## ゲームを追加するときの流れ

1. `games/<slug>/` を作る（技術スタックは **TypeScript + Phaser** を推奨）
2. ゲーム本体をその中に置く
3. `platform/games.mjs` にゲーム定義を追加する
4. 必要なら `platform/adapters/` に verifier adapter を追加する
5. `platform/server.mjs` に配信ルートを追加する

## このリポジトリの方針

- 統合サイトを親にして、その下にゲームをぶら下げる
- 共通機能は `platform/` に寄せる
- 新しいゲームも同じ配置ルールで追加する
- 生成物やローカルデータは親の `.gitignore` でまとめて管理する

## 公開前の最終チェック

1. ルートURLが開く
2. 5ゲームすべてへ遷移できる
3. `api/health` が返る
4. `slot60` のスコア投稿が通る
5. スマホ表示でレイアウト崩れがない
