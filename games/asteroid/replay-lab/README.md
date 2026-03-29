# Asteroid Replay Lab

このフォルダは `asteroid` の AI replay データ作成専用です。

## ルール

- この replay-lab の外側にあるファイルは変更しない
- ゲーム本体、配信設定、公開 replay は変更しない
- 最終採用はユーザー指示があるまで行わない
- 候補 replay、評価ログ、最良候補はこのフォルダ内だけで管理する

## ディレクトリ

- `candidates/`
  - 候補 replay の JSON を置く
- `best/`
  - 現時点の最良候補だけを置く
- `logs/`
  - 実行ログやランキング CSV を置く
- `tools/`
  - 生成・評価用スクリプトを置く

## 候補 JSON 形式

```json
{
  "label": "candidate-0001",
  "seed": 0,
  "score": 12345,
  "replayDigest": "sha256-hex",
  "finalStateHash": "sha256-hex",
  "replayData": "base64..."
}
```

## 使い方

評価:

```bash
node ./games/asteroid/replay-lab/tools/evaluate-replay.mjs ./games/asteroid/replay-lab/candidates/example.json
```

ランダム探索:

```bash
node ./games/asteroid/replay-lab/tools/random-search.mjs --count 50 --seed 0
```

局所変異:

```bash
node ./games/asteroid/replay-lab/tools/mutate-replay.mjs \
  --input ./games/asteroid/replay-lab/best/smoke-best.json
```

自律探索ループ:

```bash
node ./games/asteroid/replay-lab/tools/autoresearch-loop.mjs \
  --iterations 50 \
  --prefix loop
```

## 注意

- `random-search.mjs` は最小の探索器です
- `autoresearch-loop.mjs` は replay-lab 専用の軽量な反復改善ループです
- まずは「候補を量産して headless verifier で確実に通す」ことを優先します
- より強い探索器が必要になっても、追加は `tools/` 配下だけで行います
