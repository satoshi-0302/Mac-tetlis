# Web Game Platform 実装仕様書

- 文書バージョン: 1.0
- 最終更新日: 2026-03-08
- 対象プロジェクト: `Snake60`, `MissileCommand`, `Asteroid`

## 1. 目的

本仕様書は、既存のブラウザゲームを共通のロビー、共通のランキング基盤、共通のリプレイ運用で管理できるようにするための実装方針を定義する。

目的は次の3点とする。

- ゲーム選択ロビーを1つにまとめる
- ハイスコアと Top10 replay 管理を共通化する
- 今後ゲームを追加しやすい構造にする

## 2. 前提条件

- 公開前提で運用する
- PC とスマホの両対応を前提とする
- ロビーと API は同一ドメイン配下に置く
- ランキングはゲームごとに分ける
- AI スコアは人間と同じ表に混在させる
- AI スコアは目標値として扱う
- 同点時は先着を上位とする
- 名前は12文字まで、絵文字なし
- コメントは20文字まで
- サーバ保存する replay は Top10 のみ
- Top10 外の replay はサーバに保存しない
- スコア投稿は replay 必須とし、サーバ側で検証してから採用する

## 3. 全体構成

### 3.1 画面構成

- `/`
  - 共通ロビー
- `/games/snake60`
  - Snake60 本体
- `/games/missile-command`
  - MissileCommand 本体
- `/games/asteroid`
  - Asteroid 本体
- `/api/...`
  - 共通ランキング API

### 3.2 採用方針

- 共通基盤は `Node.js + SQLite` で構成する
- `Asteroid` の構成を土台とする
- 各ゲームの replay 形式は無理に統一しない
- 代わりに、サーバ側で `gameId` ごとの verifier adapter を切り替える

## 4. ロビー仕様

### 4.1 表示内容

ロビーはゲーム一覧のみを表示する。

各ゲームカードの表示項目:

- タイトル
- 一言説明
- サムネイル（ゲーム内容に沿ったレトロゲーム風・シンセウェイヴテイストのハイクオリティなイラストを `assets/thumbnails/<slug>.png` として用意する）
- 対応端末表示
- 現在の 1 位スコア
- `PLAY` ボタン

### 4.2 ロビー用ゲーム定義

各ゲームは少なくとも次の情報を持つ。

- `id`
- `slug`
- `title`
- `description`
- `path`
- `status`
- `supportsTouch`
- `supportsReplay`
- `sortOrder`
- `gameVersion`

## 5. ランキング仕様

### 5.1 ランキング単位

ランキングは `gameId` 単位で管理する。

将来のルール変更に備えて、内部的には `gameVersion` も保持する。

### 5.2 表示ルール

- Top10 のみ表示する
- AI と人間は同じ表に表示する
- 並び順は `score DESC`, `createdAt ASC`
- replay がある entry には `WATCH` を表示する

### 5.3 保存ルール

- サーバ保存するのは Top10 の entry と replay のみ
- 新規投稿が Top10 に入らない場合、entry も replay も保存しない
- 11位以下に落ちた既存 replay は削除してよい

## 6. replay 方針

### 6.1 基本方針

- 投稿時は replay 必須
- サーバは replay を再生し、送信された score と一致するか確認する
- 一致しない投稿は拒否する

### 6.2 Top10 外プレイヤー replay

- Top10 外 replay はサーバ保存しない
- プレイヤー本人が直後に見返す用途は、クライアント内の一時保持のみとする
- ページ再読込後の replay 復元は保証しない

### 6.3 replay 形式

replay 自体の中身はゲームごとに異なってよい。

共通化するのは外側の扱いだけとする。

- `gameId`
- `gameVersion`
- `claimedScore`
- `replayFormat`
- `replayPayload`
- `replayDigest`

## 7. 共通 API 仕様

### 7.1 `GET /api/games`

ロビー表示用のゲーム一覧を返す。

返却項目:

- `id`
- `title`
- `description`
- `path`
- `supportsTouch`
- `supportsReplay`
- `topScore`

### 7.2 `GET /api/leaderboard?gameId=<id>`

指定ゲームの Top10 を返す。

返却項目:

- `gameId`
- `gameVersion`
- `entries`

各 entry の返却項目:

- `id`
- `kind` (`human` or `ai`)
- `name`
- `comment`
- `score`
- `createdAt`
- `replayAvailable`

### 7.3 `GET /api/replay?gameId=<id>&entryId=<id>`

Top10 entry の replay を返す。

### 7.4 `POST /api/submit`

受信項目:

- `gameId`
- `name`
- `comment`
- `claimedScore`
- `replayFormat`
- `replayPayload`
- `replayDigest`

処理手順:

1. 入力値を検証する
2. `gameId` に対応する verifier adapter を選ぶ
3. replay を再生し、score を再計算する
4. score が一致したら Top10 判定する
5. Top10 に入る場合のみ保存する
6. 更新後の leaderboard を返す

## 8. サーバ内部設計

### 8.1 verifier adapter 共通インターフェース

各ゲームはサーバ側で次の関数を提供する。

- `validateSubmission(payload)`
- `verifyReplay(payload)`
- `normalizeReplay(payload)`
- `extractVerifiedScore(result)`

返却すべき情報:

- `score`
- `gameVersion`
- `normalizedReplay`
- `replayDigest`

### 8.2 採用理由

- replay 形式を無理に統一しなくてよい
- 新しいゲーム追加時の変更箇所が明確になる
- 既存ゲームを段階的に載せ替えられる

## 9. データ設計

### 9.1 `games`

- `id`
- `slug`
- `title`
- `description`
- `path`
- `status`
- `supports_touch`
- `supports_replay`
- `sort_order`
- `current_game_version`

### 9.2 `leaderboard_entries`

- `id`
- `game_id`
- `game_version`
- `kind`
- `name`
- `comment`
- `score`
- `created_at`
- `replay_format`
- `replay_digest`
- `replay_data`
- `verified`

### 9.3 AI データ

- AI も `leaderboard_entries` に保存する
- `kind = ai` として区別する
- AI の初期データは seed script で投入する

## 10. ゲーム別移行方針

### 10.1 Asteroid

最優先で共通基盤へ載せ替える。

理由:

- Node.js ベースで共通化しやすい
- replay 検証が最も整理されている
- 公開運用に必要な制御が既に多い

対応内容:

- 共通 API 形式へ合わせる
- ロビーから遷移できるようにする
- DB スキーマを共通化する

### 10.2 MissileCommand

2番目に移行する。

対応内容:

- API パスと返却形式を共通仕様へ合わせる
- replay 検証ロジックを adapter 化する
- 既存 JSON 保存を SQLite へ移行する

### 10.3 Snake60

最後に移行する。

理由:

- サーバが Python で分かれている
- 入力方式がキーボード寄り
- スマホ対応の追加が必要

対応内容:

- verifier を Node.js へ移植する
- スマホ向け操作 UI を追加する
- API を共通仕様へ合わせる

## 11. 入力・デバイス対応方針

### 11.1 共通方針

- PC はキーボードまたはポインタ操作に対応する
- スマホはタッチ操作に対応する
- ゲーム体験は作品ごとに最適化する

### 11.2 Snake60 の追加要件

- 画面内ボタンまたはスワイプで方向転換できるようにする
- 画面サイズに応じてレイアウトを縮小できるようにする
- キーボードがない端末でも開始、再開、replay 視聴ができるようにする

## 12. 段階的実装手順

1. 共通 SQLite スキーマと共通 API サーバを作る
2. ロビー画面を作る
3. Asteroid を共通 API に接続する
4. MissileCommand を共通 API に接続する
5. Snake60 を共通 API に接続し、スマホ操作を追加する
6. AI 初期データ投入スクリプトを作る
7. 本番用の同一ドメイン構成へまとめる

## 13. 受け入れ条件

- ロビーから3ゲームへ遷移できる
- どのゲームでも Top10 を同じ見せ方で取得できる
- どのゲームでも score 投稿時に replay 検証が走る
- Top10 entry のみ replay を視聴できる
- AI と人間が同じ表で正しく混在する
- 同点時に先着が上位になる
- 名前 12 文字制限、コメント 20 文字制限が守られる
- Snake60 がスマホで最低限プレイ可能になる

## 14. 非目標

今回の範囲では次を含めない。

- アカウント機能
- フレンド機能
- 全 replay の永続保存
- 総合ランキング
- 管理画面
- 課金要素

## 15. 補足判断

- 技術選定は `Asteroid` ベースを優先する
- replay の完全共通化は行わず、adapter 方式で拡張性を取る
- 将来ゲーム追加時は「ゲーム定義追加」「verifier adapter 追加」「ロビー登録」の3点で対応可能にする
