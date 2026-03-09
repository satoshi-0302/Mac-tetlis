# Web Game Platform

4種類のブラウザゲームを、1つのロビーと共通ランキング基盤でまとめて運用するためのリポジトリです。

## できること

- 共通ロビーからゲームを選んで遊ぶ
- ゲームごとにランキングを持つ
- 対応ゲームは replay を使ってスコア検証できる

## 現在のゲーム

| Game | Path | Touch | Replay |
| --- | --- | --- | --- |
| Snake60 | `games/snake60/` | No | Yes |
| Missile Command | `games/missile-command/` | Yes | Yes |
| Asteroid | `games/asteroid/` | Yes | Yes |
| Slot60 | `games/slot60/` | Yes | No |

## ディレクトリ構成

```text
.
├── games/
│   ├── snake60/
│   ├── missile-command/
│   ├── asteroid/
│   └── slot60/
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

Asteroid のビルド:

```bash
npm run platform:build:asteroid
```

ポートを変えたい場合:

```bash
PORT=9191 npm run platform:start
```

## デプロイ

まずは `Railway` を第一候補にするのが扱いやすいです。

- 単一の Node サービスでそのまま動かせる
- SQLite 用の永続ボリュームを付けやすい
- このリポジトリには `Dockerfile` を追加済みなので、そのまま載せやすい

詳しい手順は `docs/DEPLOYMENT.md` を参照してください。

## ゲームを追加するときの流れ

1. `games/<slug>/` を作る
2. ゲーム本体をその中に置く
3. `platform/games.mjs` にゲーム定義を追加する
4. 必要なら `platform/adapters/` に verifier adapter を追加する
5. `platform/server.mjs` に配信ルートを追加する

## このリポジトリの方針

- 統合サイトを親にして、その下にゲームをぶら下げる
- 共通機能は `platform/` に寄せる
- 新しいゲームも同じ配置ルールで追加する
- 生成物やローカルデータは親の `.gitignore` でまとめて管理する
