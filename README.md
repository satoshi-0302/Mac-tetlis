# Web Game Platform

4種類のブラウザゲームを、1つのロビーから遊べるようにまとめたプロジェクトです。

## このリポジトリの考え方

- `platform/` に統合ロビーと共通APIを置く
- `games/` に各ゲーム本体を置く
- `docs/` に仕様書などの運用資料を置く

## フォルダ構成

```text
.
├── games/
│   ├── snake60/
│   ├── missile-command/
│   ├── asteroid/
│   └── slot60/
├── platform/
├── docs/
├── package.json
└── README.md
```

## ゲーム一覧

- `games/snake60/`: Snake60
- `games/missile-command/`: Missile Command
- `games/asteroid/`: Asteroid
- `games/slot60/`: Slot60

## 主な役割

- `platform/`
  共通ロビー、ゲーム一覧、ランキングAPI、リプレイ連携の土台
- `games/`
  各ゲームの本体コードとゲームごとの必要ファイル
- `docs/`
  仕様書と整理メモ

## 起動

統合サイトを起動:

```bash
npm run platform:start
```

Asteroid のビルド:

```bash
npm run platform:build:asteroid
```

ゲームごとの詳しい起動方法は、それぞれのフォルダ内の説明ファイルを参照してください。

## 補足

このリポジトリは「統合サイトを親にして、その下に4ゲームをぶら下げる」構成で管理します。
今後ゲームを追加する場合も、同じく `games/` 配下に追加して `platform/` 側へ登録する方針です。
