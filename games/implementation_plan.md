# ひよこ版 Flappy Bird 追加 実装計画

最終更新: 2026-03-28 (rev.4)

## 目的

- `Flappy Bird` の操作感を強く意識した新作ゲームを `games/` 配下に追加する
- 主人公は可愛くデフォルメしたひよこに差し替える
- 開発には `Pyxel` を使い、ブラウザで遊べる形にビルドしてロビーから遷移できるようにする
- 既存ロビー配信基盤に新作を組み込む

## 前提と判断

- 新規ゲームの配置先は `games/<slug>/` とする
- プロジェクト標準は原則 `TypeScript + Phaser` だが、今回の依頼では `Pyxel` を優先する
- そのため、ゲーム本体は Python / Pyxel で作り、ブラウザ公開用には `Pyxel` の HTML 出力物を配信する
- `Flappy Bird` の厳密な元ソースはないため、「動画や既知仕様から再現した高忠実度実装」として進める
- 初回は leaderboard / replay verifier までは入れず、まずはロビーから遊べる完成版を優先する
- ひよこ表現は「状態ごとに大量フレーム」から、`24x24` の高品質基本3フレーム（羽上げ/中間/羽下げ）を中心にした運用へ切り替える
- 方向差分（上向き/水平/下向き/急降下）は、同じ3フレームを回転・補正して再利用する

## 調査して反映する内容

- `Flappy Bird` の基本仕様
  - 1入力で上昇、無入力で落下
  - 横スクロール速度は一定
  - 上下パイプの隙間を抜けた回数がスコア
  - パイプ接触または地面接触でゲームオーバー
- 再現対象
  - 上昇の瞬発感
  - 落下の加速感
  - パイプ生成間隔
  - 当たり判定の厳しさ
  - スコア加算タイミング

## 変更対象ファイル

### 1. 新規ゲーム本体

- `games/chick-flap/`
  - 新規ディレクトリとして追加する
- `games/chick-flap/README.md`
  - 起動方法、ビルド方法、操作方法を書く
- `games/chick-flap/requirements.txt`
  - `Pyxel` 依存を固定して明示する
- `games/chick-flap/src/main.py`
  - Pyxel のメインゲームループを実装する
  - タイトル、プレイ中、ゲームオーバーの状態管理を入れる
  - ひよこ、パイプ、背景、地面、スコア、入力処理、当たり判定を実装する
  - ひよこは `24x24` スプライト3フレームをスプライトシートとして保持する
  - 角度別の見た目は、同スプライトを回転・位置補正して描画する
- `games/chick-flap/src/constants.py`
  - 画面サイズ、重力、ジャンプ速度、パイプ速度、隙間幅などの定数を分離する
- `games/chick-flap/src/game_logic.py`
  - パイプ生成、スコア加算、衝突判定などロジックを分離する
- `games/chick-flap/assets/`
  - ひよこ・背景・地面・UI に使う Pyxel 向け素材を置く
- `games/chick-flap/build/`
  - ブラウザ配信用の HTML 出力先として使う

### 2. ロビー・配信側

- `../platform/games.mjs`
  - `chick-flap` のゲーム定義を追加する
  - タイトル、説明文、ルート、タッチ対応有無、並び順、バージョンを設定する
- `../platform/server.mjs`
  - `/games/chick-flap/` の静的配信設定を追加する
  - `Pyxel` のブラウザ出力物を配信対象に含める
- `../platform/public/assets/thumbnails/chick-flap.png`
  - ロビー用のサムネイル画像を追加する

### 3. ルート運用ファイル

- `../README.md`
  - 対応ゲーム一覧と追加手順の記述を 6 ゲーム構成へ更新する
- `../package.json`
  - 必要なら `chick-flap` のビルドを呼ぶスクリプトを追加する
- `../docs/WEB_GAME_PLATFORM_SPEC.md`
  - 新作ゲームの導線や対象ゲーム一覧の記述を更新する

## 実装手順

1. `Pyxel` の導入方法とブラウザ出力手順を固める
2. `chick-flap` のディレクトリを作り、最小構成で起動確認する
3. Flappy Bird ライクな物理挙動を `Pyxel` で実装する
4. ひよこ主人公・背景・UI を追加し、見た目を整える
5. ゲームオーバーとリスタート導線を実装する
6. ブラウザ出力を作り、`platform/server.mjs` から配信できるようにする
7. `platform/games.mjs` とサムネイルを追加してロビーに表示する
8. README / docs を更新する
9. セキュリティ・依存・リーク確認を行う
10. 起動確認と簡単なプレイ確認を行う

## スプライトシート方針（2026-03-27 追加）

### 目的

- ひよこの可愛さを上げつつ、アニメ管理コストを下げる
- 「羽ばたきアニメ」と「姿勢角度」を分離し、今後の調整を容易にする

### 実装方針

- ひよこスプライトは `24x24` の3フレーム
  - `flap_up`
  - `flap_mid`
  - `flap_down`
- 3フレームは 1 枚のスプライトシートとして生成・保持する
- 描画時は速度から角度カテゴリを決める
  - 上昇: 上向き
  - 通常: ほぼ水平
  - 下降: 斜め下
  - 急降下: ほぼ真下
- 角度カテゴリに応じて、同じ3フレームへ回転・オフセット補正を適用する
- これまでの「状態専用スプライト大量生成」は廃止する

## スプライト高精細化方針（2026-03-27 rev.2 追加）

### 目的

- 現状の `24x24` は動きは良いが、見た目が粗く感じるため、密度を上げる
- 可愛さを維持したまま、輪郭・目・くちばし・羽のディテールを増やす

### 実装方針

- ひよこスプライトを `48x48` の3フレームへ拡張する
  - `flap_up`
  - `flap_mid`
  - `flap_down`
- 角度運用は現行方針を維持する
  - 3フレームを速度に応じて回転して再利用
- 当たり判定と描画基準点を `48x48` に合わせて再調整する
- 既存のゲーム物理（重力・パイプ速度）は原則維持し、見た目だけ精細化する

### この方針で変更するファイル

- `games/chick-flap/src/main.py`
  - スプライトサイズ定数を `48` へ変更
  - スプライト生成関数を `48x48` 用に描き直す
  - 回転描画時の中心点とオフセットを調整する
- `games/chick-flap/src/constants.py`
  - `CHICK_SIZE` と `CHICK_HITBOX_RADIUS` を `48x48` 基準に更新する

## TypeScript + Phaser 移行方針（2026-03-27 rev.3 追加）

### 目的

- `chick-flap` をリポジトリ標準に合わせて `TypeScript + Phaser` 実装へ移行する
- 既存のゲーム体験（操作感・速度感・難易度・見た目方向性）を維持したまま、保守性を上げる

### 移行の前提

- 既存 `Pyxel` 実装は即時削除せず、比較用に一時保持する
- ロビー導線は最終的に Phaser版へ切り替える
- 先に「挙動の忠実移植」を優先し、その後に演出改善を行う

### 変更対象ファイル

- `games/chick-flap/package.json`（新規）
  - Phaser + TypeScript + Vite の実行/ビルドスクリプトを定義
- `games/chick-flap/tsconfig.json`（新規）
  - TypeScript コンパイル設定
- `games/chick-flap/vite.config.ts`（新規）
  - ビルド設定
- `games/chick-flap/index.html`（新規）
  - Phaser エントリ
- `games/chick-flap/src/` 配下（再編）
  - `main.ts`
  - `game/constants.ts`
  - `game/scenes/BootScene.ts`
  - `game/scenes/GameScene.ts`
  - `game/objects/Chick.ts`
  - `game/objects/PipePair.ts`
  - `game/ui/Hud.ts`
- `games/chick-flap/public/assets/`（新規）
  - 48x48 ひよこスプライト（3フレーム）
  - 必要な背景/地面画像
- `games/chick-flap/README.md`
  - 起動/ビルド手順を TypeScript + Phaser 前提へ更新
- `package.json`（ルート）
  - `platform:build:chick-flap` を Phaser版ビルド呼び出しへ変更
- `platform/server.mjs`
  - `/games/chick-flap/` の配信先を `build` から `dist` へ変更

### 実装手順

1. `games/chick-flap` に Phaser の最小構成を作る
2. 既存 Pyxel と同じ画面サイズ・重力・ジャンプ・パイプ速度を定数化する
3. ひよこ（48x48 / 3フレーム）+ 回転描画を Phaser で再現する
4. パイプ生成、衝突判定、スコア加算、ゲームオーバー、リスタートを実装する
5. HUD（スコア、ゲームオーバー表示）を実装する
6. `npm run build --prefix games/chick-flap` で `dist` 出力を生成する
7. ルートビルドスクリプトと `platform/server.mjs` を Phaser版に切り替える
8. ロビーから遷移して動作確認する
9. セキュリティスキャンを実施し、結果を記録する

### 検証項目

- `npm run dev --prefix games/chick-flap` で起動できる
- `npm run build --prefix games/chick-flap` が成功する
- `/games/chick-flap/` で正常表示される
- 1ボタン操作で上昇し、無入力で落下する
- パイプ通過でスコアが上がる
- 接触でゲームオーバーになる
- リトライが機能する

### セキュリティ確認

- `bash scripts/secret_scan.sh /Users/saitosatoshi/Documents/Codex`
- `bash scripts/risk_scan.sh /Users/saitosatoshi/Documents/Codex`（存在しない場合は記録）
- `bash scripts/dependency_guard.sh /Users/saitosatoshi/Documents/Codex`（存在しない場合は記録）
- `bash scripts/leak_scan.sh /Users/saitosatoshi/Documents/Codex`（存在しない場合は記録）

### この方針で変更するファイル

- `games/chick-flap/src/main.py`
  - スプライト生成処理を3フレーム前提へ作り替える
  - 描画処理を「フレーム選択 + 回転」へ切り替える
  - 既存の多フレーム定義を削除する
- `games/chick-flap/src/constants.py`
  - 必要なら角度閾値・回転補正用の定数を追加する

## leaderboard 全実装 + スマホ版（2026-03-28 rev.4 追加）

### 目的

- `chick-flap` に `asteroid` と同系統の leaderboard 導線を実装する
- スコア送信・ランキング表示・再読込をゲーム内で完結できるようにする
- スマホ利用時の UI/入力体験を改善し、縦画面でもプレイしやすくする

### 実装方針（asteroid準拠）

- API 層は `resolveApiBase` + `/api/leaderboard` + `/api/submit` の構成を採用する
- ゲーム本体（Phaser canvas）とサイド UI（leaderboard / submit）を分離する
- `mode=mobile|desktop|auto` のクエリを読み取り、スマホ向けレイアウトに切り替える
- スマホ時は「START ボタン」「簡略説明」「大きめフォーム」で操作ミスを減らす
- 送信時は `name/message` をサニタイズし、送信中/成功/失敗の状態を明示する
- replay は現時点で必須要件ではないため、`asteroid` の leaderboard 部分を先行移植し、`WATCH` は入れない

### 変更対象ファイル（今回）

- `games/chick-flap/src/net/api.ts`（新規）
  - `fetchLeaderboard` / `submitScore` 実装
  - `gameId=chick-flap` で API に接続
- `games/chick-flap/src/main.ts`
  - `#app` に DOM レイアウト（ヘッダー、ゲーム領域、leaderboard、結果フォーム）を生成
  - Phaser 初期化時に `parent` を `phaser-root` へ変更
  - `mode` 判定（mobile/desktop/auto）と `data-route-mode` 設定
- `games/chick-flap/src/game/scenes/GameScene.ts`
  - スコアイベント/ゲーム状態イベントを DOM 層へ通知する仕組みを追加
  - スマホ開始導線（START タップ）と既存入力の整合を取る
- `games/chick-flap/src/game/ui/Hud.ts`
  - 画面内テキストをスマホ時に読みやすいサイズへ調整
  - DOM 版 result UI と競合する説明文を整理
- `games/chick-flap/src/style.css`
  - `asteroid` 参考の2カラム + モバイル1カラムレイアウトを追加
  - leaderboard カード、submit フォーム、mobile quick help のスタイルを追加
  - タッチ端末用に余白・フォントサイズ・ボタンサイズを最適化
- `games/chick-flap/src/game/constants.ts`
  - `GAME_VERSION` を leaderboard 実装版に更新

### 実装ステップ

1. API クライアント層を追加して leaderboard 取得/送信を可能にする
2. ルート DOM を `asteroid` 準拠レイアウトに置き換える
3. Phaser シーンと DOM の橋渡し（score更新・gameover通知）を実装する
4. 結果フォームから submit し、成功時に leaderboard を自動再読込する
5. `mode` 判定と CSS を実装し、スマホ UI を最適化する
6. ビルド・起動で desktop/mobile 両方の動作を検証する
7. `security-baseline` のチェック（少なくとも `secret_scan.sh`）を実施して記録する

### 検証項目（今回）

- `npm run build --prefix chick-flap` が成功する
- `http://127.0.0.1:9191/games/chick-flap/` で leaderboard が表示される
- スコア送信後にランキングへ反映される
- `?mode=mobile` で 1カラム化され、開始/再開がタップで可能
- `?mode=desktop` で従来通りプレイできる

## 検証項目

- ローカルで `chick-flap` 単体が起動する
- ブラウザ出力物が生成できる
- ロビーから `/games/chick-flap/` に遷移できる
- スマホ横画面でも最低限プレイ可能
- スコアが正しく増える
- パイプ・地面接触でゲームオーバーになる
- リスタートで再プレイできる

## セキュリティ確認予定

- `security-baseline` に従って以下を実行する
  - `bash scripts/secret_scan.sh ..`
  - `bash scripts/risk_scan.sh ..`
  - `bash scripts/dependency_guard.sh ..`
  - `bash scripts/leak_scan.sh ..`
- 新規依存は `Pyxel` のみを想定し、目的と代替案を最終報告で明記する
- 出力物やログに秘密情報やローカルパスが混ざらないか確認する

## 今回まだやらないこと

- leaderboard 連携
- replay 保存 / verifier adapter
- AI seed データ投入

これらが必要になった場合は、別計画として追加提案する
