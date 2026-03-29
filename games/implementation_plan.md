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

## asteroid 再現性監査 + 状態ハッシュ + ヘッドレス replay runner 設計（2026-03-29 追加）

### 目的

- `games/asteroid` の実装を読み、replay の再現性を崩す要因がないか監査する
- 現在の「入力列 replay 検証」に加えて、途中状態まで検証できる `状態ハッシュ` の導入方針を固める
- ブラウザ依存なしに replay を検証できる `ヘッドレス replay runner` の設計を固める
- 必要なら、そのまま最小実装まで進められるように変更範囲を先に固定する

### 現時点の監査観点

- `games/asteroid/src/game/sim-core.js`
  - tick ごとの更新順が固定されているか
  - 乱数や時刻参照が混入していないか
  - object / array の走査順に依存した不安定さがないか
  - wrap, collision, spawn child の処理が browser / Node 間で同一になる前提か
- `games/asteroid/src/game/spawn-schedule.js`
  - seed 固定で同一 schedule が生成されるか
  - 小数丸めや sort 条件が再現性を壊さないか
- `games/asteroid/src/replay/replay.js`
  - replay digest が「入力列そのもの」しか見ておらず、中間状態の破損検知ができない点をどう補うか
- `games/asteroid/src/replay/verify-worker.js`
  - browser worker 依存のため、CI やサーバー検証で再利用しづらい点をどう共通化するか
- `platform/adapters/asteroid.mjs`
  - サーバー側検証が score 一致のみで十分か
  - `seed` を payload から受ける現状を固定 seed 運用に寄せるべきか

### 設計方針

#### 1. 状態ハッシュ

- `sim-core` に「描画非依存・順序固定」の state snapshot 関数を追加する
- snapshot には少なくとも以下を含める
  - `tick`
  - `score`, `kills`, `hits`, `shotsFired`, `crashes`, `combo`, `comboTimer`, `maxCombo`
  - ship の `x`, `y`, `vx`, `vy`, `angle`, `cooldownTicks`, `invulnTicks`, `destroyed`
  - bullets の位置・速度・寿命
  - asteroids の `id`, `type`, `x`, `y`, `vx`, `vy`, `hitPoints`
- 浮動小数はそのまま stringify せず、桁を固定して canonical 文字列化する
- hash は replay digest とは別に「state hash chain」または「final state hash」として扱う
- 最小実装は `finalStateHash`
- 拡張案として `N tick ごとの checkpoint hash` を持てる形にする

#### 2. ヘッドレス replay runner

- browser worker のロジックを UI から切り離し、Node / browser の両方から呼べる共通モジュールへ寄せる
- 入力は `replayData`, `seed`, 必要なら `expectedScore`, `expectedFinalStateHash`
- 出力は `summary`, `replayDigest`, `finalStateHash`, 必要なら checkpoint 群
- worker はその共通 runner を呼ぶ薄いラッパーに縮小する
- サーバー adapter も同じ runner を呼ぶ形にそろえ、検証ロジックを 1 箇所へ集約する

### 変更対象ファイル（予定）

- `games/asteroid/src/game/sim-core.js`
  - 状態 snapshot / hash 用の基礎関数を追加する
  - `runReplay` から最終 state hash を返せるようにする
- `games/asteroid/src/replay/replay.js`
  - digest の責務を整理し、入力 digest と状態 hash を併記できる形にする
- `games/asteroid/src/replay/verify-runner.js`（新規想定）
  - browser / Node 共通の headless replay verifier を実装する
- `games/asteroid/src/replay/verify-worker.js`
  - 共通 runner 呼び出しへ薄く寄せる
- `platform/adapters/asteroid.mjs`
  - score 一致に加えて final state hash の扱いを追加する
- `platform/src/adapters/asteroid.ts`
  - TypeScript 側 adapter も同じ検証フローへ合わせる
- `games/asteroid/README.md`
  - replay 検証仕様が変わる場合だけ追記する

### 実装手順

1. `asteroid` の sim / replay / adapter を読み、再現性上の安全点と危険点を洗い出す
2. canonical snapshot の対象フィールドと丸め規則を決める
3. 共通 headless replay runner を新設し、worker / server から再利用する
4. final state hash を検証結果へ含める
5. 必要なら leaderboard seed data の検証も同じ runner に寄せる
6. Node 上で replay を検証する最小の確認コマンドまたはテストを追加する
7. セキュリティベースライン確認を実施する

### 検証項目

- 同じ `replayData` + `seed` で browser worker と Node runner の `score` が一致する
- 同じ `replayData` + `seed` で `finalStateHash` が一致する
- seed data (`public/rl/ai-top10.json`) の replay が引き続き検証通過する
- score 改ざん時に reject される
- replayDigest と finalStateHash の不一致をそれぞれ区別して扱える

### セキュリティ確認

- `bash scripts/secret_scan.sh /Users/saitosatoshi/Documents/Codex`
- `bash scripts/risk_scan.sh /Users/saitosatoshi/Documents/Codex`
- `bash scripts/dependency_guard.sh /Users/saitosatoshi/Documents/Codex`
- `bash scripts/leak_scan.sh /Users/saitosatoshi/Documents/Codex`

## asteroid replay-lab 専用プロジェクト（2026-03-29 追加）

### 目的

- `asteroid` で高品質な AI replay データを作成する
- 目的はあくまで replay データ生成であり、ゲーム本体や配信基盤の改善ではない
- 採用判断は replay データ単位でユーザーに委ねる

### 作業境界

- 変更・新規作成を許可する場所は `games/asteroid/replay-lab/` 配下のみとする
- `games/asteroid/src/`, `games/asteroid/public/`, `platform/`, `cloudflare/` など既存のゲーム・配信・サーバー実装は変更しない
- 既存ファイルの削除・移動・上書きは禁止する
- 生成した最終 replay データも、ユーザーの指示があるまで既存の `public/rl/` へ反映しない

### 前提

- 現在の `asteroid` 実装は replay 検証基盤と headless runner が整っているため、以後の作業はその既存機能を利用する
- replay-lab では「候補 replay の生成」「候補 replay の評価」「最良候補の保管」に専念する
- ゲーム挙動を変えてスコアを伸ばすことは禁止する

### 変更対象ファイル（予定）

- `games/asteroid/replay-lab/README.md`
  - 作業ルール、生成手順、採用フローを書く
- `games/asteroid/replay-lab/tools/`
  - replay 生成・評価・集計用の補助スクリプトを置く
- `games/asteroid/replay-lab/candidates/`
  - 候補 replay データを保存する
- `games/asteroid/replay-lab/best/`
  - 現時点の最良候補のみを保存する
- `games/asteroid/replay-lab/logs/`
  - 試行結果やスコア一覧を保存する

### 実施内容

1. `games/asteroid/replay-lab/` を作り、用途別ディレクトリを分ける
2. replay 候補を安全に生成する補助スクリプトを `tools/` に置く
3. headless runner を使って候補 replay を採点する補助スクリプトを `tools/` に置く
4. 候補ごとの `score`, `seed`, `replayDigest`, `finalStateHash` を `logs/` に記録する
5. 最良候補だけを `best/` にコピーし、ユーザーへ提示できる形にまとめる
6. 採用指示があるまで既存の公開 replay 置き場には触れない

### 検証項目

- `replay-lab/` 配下だけで replay 候補の生成から採点まで完結する
- 生成 replay が既存の headless verifier で検証通過する
- 最良候補のメタデータ（score, digest, finalStateHash）が再計算で一致する
- 既存のゲーム本体ファイルと公開 replay ファイルに変更が入っていない

### 禁止事項

- ゲームロジック、物理、spawn、入力仕様の変更
- leaderboard や公開 replay の上書き
- 指定フォルダ外へのログ出力や一時ファイル生成
- replay の採用を独断で確定すること

## asteroid replay-lab 自律探索ループ導入（2026-03-29 追加）

### 目的

- `autoresearch` の「Goal / Metric / Verify / 反復改善」の考え方だけを、`replay-lab` 専用の最小ループとして取り込む
- Claude Code 専用プラグイン自体は導入せず、`games/asteroid/replay-lab/` 配下だけで完結する探索器を作る
- ゲーム本体を一切変更せずに、候補 replay を自動生成・採点・記録・最良候補更新できるようにする

### 方針

- `Goal`
  - 高スコアの replay データを作る
- `Metric`
  - 第一指標: `score`
  - 補助指標: `survivalTicks`, `kills`, `accuracy`
- `Verify`
  - 既存 headless verifier で `score`, `replayDigest`, `finalStateHash` を再計算して一致確認する
- `Scope`
  - `games/asteroid/replay-lab/` 配下のみ

### 変更対象ファイル（予定）

- `games/asteroid/replay-lab/tools/random-search.mjs`
  - 現在の完全ランダム生成を、探索ログを残す反復ループの土台へ拡張する
- `games/asteroid/replay-lab/tools/autoresearch-loop.mjs`（新規）
  - 候補生成 → 検証 → 指標比較 → 最良候補更新 → ログ保存のループを実装する
- `games/asteroid/replay-lab/tools/mutate-replay.mjs`（新規）
  - 既存 replay を少しずつ変化させる変異器を実装する
- `games/asteroid/replay-lab/logs/`
  - 反復ごとの結果 TSV / JSONL を保存する
- `games/asteroid/replay-lab/best/`
  - 最良候補 replay を更新保存する
- `games/asteroid/replay-lab/README.md`
  - 実行方法と探索フローを追記する

### 実施内容

1. 現在の best replay を起点にできる入力形式を決める
2. replay の局所変異を行う `mutate-replay` を作る
3. 1 iteration につき 1 候補だけ生成・検証する `autoresearch-loop` を作る
4. 良化時のみ `best/` を更新し、悪化時は候補をログだけ残して採用しない
5. 反復ログを `logs/` に TSV / JSONL で残す
6. 数十〜数百 iteration の短い試行でループの健全性を確認する

### 検証項目

- ループが `replay-lab/` 配下だけで完結する
- 生成候補が毎回 headless verifier を通る
- best 更新時に `score`, `replayDigest`, `finalStateHash` が保存される
- 悪化候補が best を壊さない
- 既存のゲーム本体・公開 replay・platform 側ファイルに変更が入らない

## asteroid 採用 replay 反映 + ローカル起動（2026-03-29 追加）

### 目的

- `replay-lab` で得られた採用候補 replay を `games/asteroid/public/rl/ai-top10.json` に反映する
- ローカルの `asteroid` サーバーとフロントを起動し、反映結果をその場で確認できる状態にする

### 反映対象

- 採用候補:
  - `games/asteroid/replay-lab/best/run05-best.json`
- 更新先:
  - `games/asteroid/public/rl/ai-top10.json`

### 変更対象ファイル（今回）

- `games/asteroid/public/rl/ai-top10.json`
  - `ai-01` の score / replayDigest / replayData / summary / message を採用候補へ更新する
  - seed は候補の `3` を維持する
  - 他ランクのエントリは変更しない

### 実施内容

1. `run05-best.json` の値を再評価し、採用用メタデータを確定する
2. `public/rl/ai-top10.json` の `ai-01` をその候補で差し替える
3. headless verifier で更新後の seed data を再検証する
4. `npm run server` でローカル API を起動する
5. `npm run dev` でローカルフロントを起動する

### 検証項目

- `ai-top10.json` の 1 位 replay が headless verifier で `score=257734` を返す
- `replayDigest` と `finalStateHash` が再計算で一致する
- `npm run server` が起動する
- `npm run dev` が起動する

### 注意

- この段階で反映するのは replay データのみ
- ゲームロジック、ランキング仕様、他ランクの seed データは変えない

## asteroid leaderboard 表示不具合修正（2026-03-29 追加）

### 目的

- `games/asteroid/server/server.js` が返している leaderboard データを、フロントが正しく描画できるようにする
- 反映済みの `ai-01` replay が画面上にも表示される状態にする

### 原因

- API レスポンスは `combinedEntries` ではなく `aiEntries` と `humanEntries` を返している
- フロントの `buildUnifiedLeaderboardEntries` は `combinedEntries` だけを見ているため、AI leaderboard が空扱いになる

### 変更対象ファイル（今回）

- `games/asteroid/src/main.js`
  - `buildUnifiedLeaderboardEntries` を修正する
  - `combinedEntries` がない場合は `aiEntries` と `humanEntries` を結合して Top10 を作る
  - 既存の placeholder 補完と rank 振り直しは維持する

### 実施内容

1. `combinedEntries` 優先の現行挙動は維持する
2. `combinedEntries` がない場合は `aiEntries` と `humanEntries` を score 順で統合する
3. 統合結果から Top10 を描画する
4. ローカル API と dev サーバーで表示確認する

### 検証項目

- 画面上の leaderboard に `AI-01 / 257734 / run05-best.json` が表示される
- `WATCH` ボタンが引き続き表示される
- placeholder 補完が壊れない

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

## snake60 見直し修正計画（2026-03-28 rev.5 追加）

最終更新: 2026-03-28 18:01 JST

### 目的

- `snake60` の「動いてはいるが将来崩れやすい」箇所を、最小限の変更で安定化する
- 親リポジトリ配下の `/games/snake60/` 配信前提と、ゲーム内の URL/通信先の前提を一致させる
- 移動タイミングの誤差を減らし、プレイ感と replay 再現性を改善する
- 壊れているテスト/運用導線を整理し、今後の修正時に確認できる状態へ戻す

### 今回の修正対象

1. 配信パスと API パスの不整合
2. `moveAccumulator` の積み残し切り捨てによる速度誤差
3. 実行不能な API テストの整理
4. `src/main.ts` に集中している責務の最小分離

### 前提と判断

- 今回はゲームルール自体は変えず、体験を壊さない範囲の修正に留める
- 新規依存は追加しない
- Phaser は継続利用する
- 大規模な全面リライトは行わず、まずは「配信」「移動」「確認手段」の安定化を優先する
- `security-baseline` に従い、作業完了前に secret/risk/dependency/leak 系の確認可否を記録する
- 現状リポジトリには `scripts/secret_scan.sh` などの標準スクリプトが見当たらないため、存在確認結果も報告に含める

### 変更対象ファイル

#### 1. `snake60/src/main.ts`

- `fetch('/api/...')` を直書きせず、配信ベースパスから API URL を組み立てる関数へ寄せる
- ロビー URL も固定 `/` ではなく、親配信構成で破綻しにくい参照へ変更する
- `moveAccumulator` を `0` に戻す方式から、超過分を保持する方式へ変更する
- 通信、ゲーム進行、描画補助の関数群を小さく整理し、少なくとも
  - URL/環境解決
  - スコア/リプレイ API
  - シミュレーション更新
  の境界が読み取れる形にする
- 挙動変更が出ないよう、既存 UI テキストやゲーム状態遷移は原則維持する

#### 2. `snake60/index.html`

- `LOBBY` リンクを固定ルート依存のままにしない形へ見直す
- サムネイル参照パスが親リポジトリの実配信位置と一致するよう調整する
- 必要なら `data-` 属性などでフロントにベース情報を渡せる形にする

#### 3. `snake60/vite.config.ts`

- 現行の `base: '/games/snake60/'` を維持するか確認しつつ、HTML/JS 側の参照と矛盾しない前提にそろえる
- 必要なら将来の親配信向けにコメントを追加し、設定意図を明文化する

#### 4. `snake60/tests/test_server_api.py`

- 現状 import 不能な `server` / `snake_replay` 前提を解消する方針を取る
- 具体策は次のどちらかに寄せる
  - 実在するサーバー実装位置へ import を合わせる
  - 現状このゲーム単体では成立しないテストとして隔離し、実行条件を明記する
- 少なくとも「今のままだと実行できない」状態は解消する

#### 5. `snake60/PRODUCTION.md`

- 実際の構成に存在しないサーバー前提があれば注記する
- フロント単体配信か、別サーバー/API 前提かを読み違えない記述へ整理する

#### 6. `snake60/package.json`

- 最低限の確認コマンドを追加するか検討する
  - 例: `build`
  - 例: `test` もしくは `test:api`（実行可能になった場合のみ）
- 実行不能なコマンドは追加しない

### 実装手順

1. `snake60` の配信 URL、ロビー遷移 URL、API URL の基準を決める
2. `index.html` と `src/main.ts` の固定パス参照を整理する
3. `advanceRunFrame()` の時間積算を修正し、余剰時間を保持する
4. `src/main.ts` 内の責務を最小限分けて、今後の修正点が追いやすい形に整える
5. API テストの成立条件を確認し、動かない理由をコード上で解消または明文化する
6. `PRODUCTION.md` と `package.json` を実態に合わせて整理する
7. `npm run build` を再実行してビルド確認する
8. 可能ならテストコマンドを実行し、不可なら不可理由を明記する
9. `security-baseline` に沿ってスキャンスクリプトの存在確認と、手動の安全確認結果を報告する

### 検証項目

- `npm run build --prefix snake60` が成功する
- 生成された `dist/index.html` のアセット参照が `/games/snake60/` 配信前提と矛盾しない
- タイトル画面から開始、ゲームオーバー、リトライ、replay 再生の基本導線が維持される
- 移動速度が高くなっても、不自然な引っかかりが増えない
- スコア取得時のテンポが既存より悪化しない
- テストが実行可能なら成功する
- テストが依然として実行不能な場合、なぜ実行できないかがファイル上または README/PRODUCTION に明記される

### セキュリティ確認

- `bash scripts/secret_scan.sh /Users/saitosatoshi/Documents/Codex/games` の存在確認
- `bash scripts/risk_scan.sh /Users/saitosatoshi/Documents/Codex/games` の存在確認
- `bash scripts/dependency_guard.sh /Users/saitosatoshi/Documents/Codex/games` の存在確認
- `bash scripts/leak_scan.sh /Users/saitosatoshi/Documents/Codex/games` の存在確認
- 標準スクリプトが存在しない場合:
  - 新規 secret 混入がないか手動確認する
  - 不要な依存追加がないことを確認する
  - ログやドキュメントにローカルパスや認証情報を書き出していないことを確認する

### 想定変更範囲外

- ゲームルールの刷新
- UI デザインの全面変更
- サーバー実装の新規追加
- leaderboard/replay 仕様そのものの変更

## chick-flap 修復計画（2026-03-29 追加）

### 目的

- `chick-flap` の leaderboard / submit が、Vite 開発環境でも親プラットフォーム環境でも正しく動くようにする
- `src/main.ts` と `src/game/scenes/GameScene.ts` が参照する API ベースの判断をそろえる
- 既存のゲーム挙動や配信パスを壊さず、通信先だけを安定化する

### いまの問題の見立て

- `chick-flap/src/net/api.ts` は、`/games/chick-flap/` 配下で開いたときに API ベースを空文字にしている
- その結果、`npm run dev` で開いたときに leaderboard と submit が Vite サーバー自身へ飛び、`/api/*` が 404 になりやすい
- 一方、親プラットフォームの `9090` サーバーは `/api/leaderboard` と `/api/submit` を持っているため、そちらへ明示的に向ければ両方の環境で揃う

### 変更対象ファイル

#### 1. `chick-flap/src/net/api.ts`

- API ベース判定を見直し、Vite 開発時は `http://localhost:9090` または設定済み `VITE_API_BASE` を使うようにする
- `file:` から開くケースと、親配信下で同一オリジンを使うケースを壊さない
- leaderboard 取得と score submit の両方が同じベース判定を使うように維持する

#### 2. `chick-flap/src/game/net/api.ts`

- 旧シーン側でも同じ判定を使うようにそろえる
- 新旧実装のズレを減らし、将来どちらを参照しても通信先が一致するようにする

#### 3. `chick-flap/README.md`

- 開発時は `npm run dev` だけでなく、`platform/server.mjs` が動いていることが必要な点を明記する
- スマホ/PC の確認 URL を補足して、見失いやすい導線を減らす

### 実装手順

1. API ベース判定を共通化する
2. leaderboard と submit の通信先を Vite 開発時に 9090 へ寄せる
3. 必要なら README に確認手順を追記する
4. `npm run build` で再確認する
5. `9090` の `snake60` と `chick-flap` の両方で動線を再確認する

### 検証項目

- `chick-flap` の `leaderboard` が開発環境でも 404 にならない
- `Score Submit` が `submit` API に届く
- 親プラットフォーム配下の `/games/chick-flap/` でも表示が壊れない
- `npm run build` が成功する

### セキュリティ確認

- 新規依存は追加しない
- API ベース URL に秘密情報を埋め込まない
- `VITE_API_BASE` を使う場合も、公開して問題ないホスト名だけを許容する

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

## ロビーサムネイル同期（2026-03-29 追加）

### 目的

- ローカルのロビー表示を Cloudflare 配信の `chick-flap` サムネイルと一致させる
- 画像の実体をそろえて、ローカルと Cloudflare で見え方がズレないようにする

### 変更対象ファイル

- `../platform/public/assets/thumbnails/chick-flap.png`
  - Cloudflare 側と同一の画像に差し替える

### 実施内容

1. Cloudflare 側の `chick-flap.png` を基準画像として確認する
2. `platform/public/assets/thumbnails/chick-flap.png` をその画像で上書きする
3. 両ファイルのハッシュ一致を確認する
4. ローカルロビーで表示が更新されたことを確認する

## ロビーサムネイルのキャッシュ回避（2026-03-29 追加）

### 目的

- ローカルのロビーで古い `chick-flap` サムネイルが残り続ける問題を解消する
- service worker の cache-first が古い画像を返していても、新しい画像を確実に取りに行くようにする

### 変更対象ファイル

- `../platform/public/lobby.js`
  - `card-thumb` の `src` にバージョンクエリを付ける
- `../platform/public/sw.js`
  - 必要ならキャッシュバージョンを上げる

### 実施内容

1. `game.currentGameVersion` を使ってサムネイル URL に `?v=` を付ける
2. `sw.js` のキャッシュ対象が古いサムネイルを返し続けないか確認する
3. 必要なら `CACHE_NAME` を更新して、古い service worker キャッシュを破棄する
4. `9090` のロビーで画像が新しく見えることを確認する

## 静的アセットのハッシュ化（2026-03-29 追加）

### 目的

- 画像・JS・CSS などの静的アセットを「内容が変わったときだけ URL が変わる」形にする
- ブラウザキャッシュ、CDN キャッシュ、Service Worker キャッシュのどれが残っていても、新しい配信物を確実に取りに行けるようにする
- 手動でファイル名を書き換える運用や、手動 query parameter 追加運用をやめる

### 方針

- 本番配信では、`platform/public` の固定名アセットをそのまま配らない
- ビルド時に内容ハッシュ付きファイル名を生成し、HTML と JS からはその生成物を参照する
- 開発時はキャッシュを弱め、差し替えた画像が再読み込みだけで反映されやすいようにする
- `Service Worker` はハッシュ付きアセットを前提にし、固定名アセットの cache-first 依存を減らす

### 変更対象ファイル

- `../scripts/build-cloudflare-assets.mjs`
  - 静的アセットを内容ハッシュ付きで出力し、参照表を生成する
- `../platform/public/index.html`
  - 固定名 CSS/JS 参照をやめ、生成された参照に切り替える
- `../platform/public/lobby.js`
  - サムネイル URL を生成された参照表から読む
- `../platform/public/sw.js`
  - 固定名アセットの cache-first 依存を見直す
- `../platform/server.mjs`
  - 開発時に古い静的アセットが残りにくいヘッダ／参照方法を確認する
- `../platform/public/assets/`
  - ハッシュ化対象外がないか確認し、必要なら `src/assets` 管理へ移す

### 実施内容

1. 本番用の静的アセット manifest を生成する仕組みを追加する
2. HTML が manifest 経由で CSS/JS を読み込むようにする
3. ロビーのサムネイル参照も manifest 経由にする
4. Service Worker のキャッシュ戦略を見直す
5. 開発時に古い画像が残りにくいことを確認する
6. 画像差し替え後、通常リロードだけで新画像が見えることを確認する

## asteroid WATCH リプレイ再生修正（2026-03-29 追加）

### 目的

- leaderboard の `WATCH` ボタン押下後に AI replay が正しく再生開始されるようにする
- local server の `/api/replay` が replay 再生に必要な情報を欠かさず返すようにする

### 変更対象ファイル

- `asteroid/server/server.js`
  - `kind=ai` の replay API 応答に `seed` を含める
  - 必要なら replay 再生に必要な summary 情報の返却形も確認する

### 実施内容

1. `/api/replay?gameId=asteroid&kind=ai&id=...` の応答に `seed` が欠けていることを修正する
2. `WATCH` ボタン押下時に使われる replay payload が `startReplayPlayback` の期待形と一致することを確認する
3. local server を再起動せずに反映できるかを確認し、必要なら再起動する
4. API 応答確認とブラウザ再生確認で `WATCH` が動くことを確認する

## asteroid 初回 WATCH 再生の初期化漏れ修正（2026-03-29 追加）

### 目的

- 一度も遊んでいない初期状態からでも leaderboard の `WATCH` で replay を再生できるようにする
- live run 開始時だけ実行されていた UI 初期化を replay 開始時にもそろえる

### 変更対象ファイル

- `asteroid/src/main.js`
  - replay 開始時に title overlay を閉じる
  - 必要なら live run と replay の開始導線で共通化できる最小処理だけを追加する

### 実施内容

1. 初回 `WATCH` 時だけ残る UI 初期状態の差分を特定する
2. replay 開始でも title overlay が閉じるようにする
3. 既存の live run 開始導線や replay 終了導線を壊していないことを確認する
4. build とローカル再確認で「初回から WATCH が動く」状態を確認する

## asteroid replay / leaderboard 修正の GitHub 反映と Cloudflare デプロイ（2026-03-29 追加）

### 目的

- `asteroid` の replay / leaderboard 修正だけを GitHub に反映する
- 同じ修正を Cloudflare 配信へ反映する
- ワークツリー内の無関係な変更は巻き込まない

### 変更対象ファイル

- `games/asteroid/public/rl/ai-top10.json`
- `games/asteroid/server/server.js`
- `games/asteroid/src/main.js`
- `games/asteroid/src/game/sim-core.js`
- `games/asteroid/src/replay/replay.js`
- `games/asteroid/src/replay/verify-worker.js`
- `games/asteroid/src/replay/verify-runner.js`
- `platform/adapters/asteroid.mjs`
- `platform/src/adapters/asteroid.ts`
- `platform/src/types.ts`
- `cloudflare/lib/asteroid-adapter.mjs`
- `games/asteroid/README.md`
- `games/implementation_plan.md`
- `games/asteroid/replay-lab/`

### 実施内容

1. 今回の `asteroid` 関連変更だけを再確認し、無関係な差分を含めない
2. build と最低限の security check を再実行する
3. 対象ファイルだけを stage して日本語コミットを作る
4. 現在ブランチを GitHub へ push する
5. `npm run cf:deploy` で Cloudflare へ反映する
6. デプロイ結果を確認して共有する

## Cloudflare asteroid seed 更新漏れ修正（2026-03-29 追加）

### 目的

- Cloudflare 本番の `asteroid` leaderboard / replay API が古い AI seed を返し続ける問題を解消する
- human スコアは保持しつつ、AI seed だけは新しい `ai-top10.json` に追随するようにする

### 変更対象ファイル

- `cloudflare/worker.mjs`
  - seed 初期化条件を見直し、AI seed 更新が止まらないようにする
- `cloudflare/lib/asteroid-adapter.mjs`
  - Cloudflare 側でも `ai-top10.json` から seed entry を読み込めるようにする
- 必要なら `games/asteroid/public/rl/ai-top10.json`
  - 反映対象 seed 内容の再確認のみ行う
- `games/implementation_plan.md`
  - 今回の修正計画を追記する

### 実施内容

1. Cloudflare worker の seed 挿入条件を確認する
2. `asteroid` adapter に `loadSeedEntries()` を追加し、`ai-top10.json` を読めるようにする
3. ゲーム全体件数ではなく、AI seed を更新すべき条件で upsert するように修正する
4. human entry を消さないことを確認する
5. build / security check 後に GitHub と Cloudflare へ再反映する
6. 本番 API で `ai-01` が `257734` / `seed=3` を返すことを確認する
