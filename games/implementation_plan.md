# Asteroids 短期予測コントローラ 実装計画

最終更新: 2026-04-02 (rev.19)

## 目的

- 反射的で初級者的な挙動（その場回転・無駄撃ち・端ハマり）を減らし、**生存優先**の制御へ置き換える
- エンドツーエンドRLから始めず、まずは**ルールベースの短期予測制御**を実装する
- 各フレームで候補行動を評価し、**120tick先の安全性予測**を主軸に行動選択する

## 成果目標

### Primary

- 現行再生の worst-10% survival time を最優先で改善
- median survival time を改善

### Secondary

- worst-10% score
- edge-stay ratio
- continuous spin ratio
- continuous spin+shoot ratio
- useless shot count
- death cause estimate

## 変更対象ファイル

1. `games/asteroid/src/rl/predictive-controller.js`（既存）
- 特徴量抽出（ship / asteroid / global）
- 脅威スコア算出（closing speed, TCPA, DCPA, threat）
- 候補行動定義を**移動操作列のみ**へ整理し、射撃は常時ONに固定
- **120tick先の高忠実度評価**（`sim-core` ベース）へ集約
- 安全性スコア（衝突余裕 / edge risk / free-space / center return）で行動選択
- 連続回転・連続回転+射撃・無駄撃ちの追跡
- 死亡直前180フレームのリングバッファ収集
- デバッグ可視化用データ生成（safe sectors / high threat / future positions / top scores）

2. `games/asteroid/src/rl/demo-agent.js`
- 既存の学習済み policy ローダーに加えて、predictive controller を demo agent として選択可能にする
- デバッグメトリクス/オーバーレイ情報を外部から参照できるインターフェースを追加する

3. `games/asteroid/src/main.js`
- demo 実行時に predictive controller の診断情報を収集
- run中のメトリクス集計（edge滞在、連続spin、無駄撃ちなど）
- run終了時にログ（特にワーストエピソードの死亡前180フレーム）を保持・出力
- renderer へデバッグオーバーレイ情報を渡す

4. `games/asteroid/src/render/renderer.js`
- オーバーレイ描画を追加
  - safe sectors
  - high-threat asteroids
  - predicted future positions
  - chosen action
  - top candidate scores
- 通常描画を壊さないよう、overlay有効時のみ追加描画

## 実装ステップ

1. **120tick高忠実度予測へ置換**
- `predictive-controller.js` の近似 ship/asteroid 予測を、`sim-core` の `cloneSimulationState` / `stepSimulation` を使った実シミュレーション予測へ置換
- 予測内に未来spawn、弾、クールダウン、wrap をそのまま反映する
- デバッグ表示の予測座標を、実際に予測で使った座標と一致させる

2. **移動操作列に絞る**
- 候補行動を「射撃有無」ではなく移動操作列だけへ整理する
- 射撃は常時ON固定とし、`shootGain` / `usefulShot` / 射撃安全評価を削除する
- 120tick を通した移動結果だけで比較する

3. **Safety評価の再調整**
- 120tick 時点までの `minMargin` / `minPredictedTtc` / `edgeTrapRisk` / `free-space` / `center return` を主評価にする
- 30/60tick の重み付き合算はやめ、120tick の予測精度を優先する
- 射撃関連の報酬・罰則は除外し、移動精度だけに集中する

4. **Demo統合**
- `demo-agent.js` / `main.js` 接続
- `nextMask(state)` とデバッグ情報取得APIを統一

5. **メトリクスと死亡前ログ**
- run中カウンタ集計
- 終了時サマリと worst episode の180フレーム履歴を保存・表示
- 120tick 予測の主要値が追えるように debug 情報を整理する

6. **可視化オーバーレイ**
- `renderer.js` へ候補スコア・safe sector等を描画
- 可読性優先で色分け

7. **検証**
- `games/asteroid` のビルド/起動確認
- demo再生で、edge-trap 直前の進路選択が早めに変わるか確認

8. **セキュリティベースライン確認**
- `security-baseline` に沿って secrets/依存/リスクの最終確認を実施

## 追加方針（rev.11）

### 目的

- 120tick 先の危険を認識していても死亡するケースを減らす
- 「危険認識の甘さ」ではなく「回避手の弱さ」が原因の局面を優先的に改善する

### 変更対象ファイル

1. `games/asteroid/src/rl/predictive-controller.js`
- 逃走専用の強い操作列を追加する
  - 長めの左/右 sweep
  - 向きを振ってから加速し続ける離脱列
- 予測中に terminal に達した候補でも、その terminal snapshot を評価に残す
- 危険を十分に認識したフレームで、数 tick だけ回避優先モードを維持する
- 回避優先モード中は「free-space / center-return / earliest-survival」を強く優先する

2. `games/asteroid/src/main.js`
- 死亡前ログに「recognized danger かどうか」を判定しやすい 120tick 指標を残す
- demo 指標を「危険を認識してから死亡した比率」の分析に使いやすい形へ整理する

3. `games/asteroid/src/render/renderer.js`
- 回避優先モードの有無と、120tick terminal 情報をオーバーレイで確認できるようにする

### 実施内容

1. 危険認識後の逃走専用プランを追加する
2. `terminatedEarly` 候補の比較を強化する
3. 数 tick の回避固定モードを導入し、毎フレームの小さなぶれで逃走を中断しないようにする
4. worst seed を再確認し、危険認識済み死亡が減るかを見る

## 追加方針（rev.12）

### 目的

- `danger` 判定の出し過ぎを抑え、本当に危険な局面だけで回避モードへ入る
- 最大の安全扇形があるなら、その中心へ一定 tick コミットして逃げ切る

### 変更対象ファイル

1. `games/asteroid/src/rl/predictive-controller.js`
- danger 判定を「最良候補でも terminal が近い」「上位候補の多くが危険」の条件へ厳格化する
- 最大 safe sector の中心角を計算し、その方向へ向く専用 escape steer を追加する
- escape mode 中は毎フレームの小さな score 変動で左右反転しないよう、heading target へ一定 tick コミットする

2. `games/asteroid/src/main.js`
- 死亡前ログに「best candidate でも危険だったか」「danger 判定が遅かったか」を見分けやすい値を残す

3. `games/asteroid/src/render/renderer.js`
- 最大 safe sector の中心方向と escape target をオーバーレイ表示する

### 実施内容

1. top candidate 群を使って danger 判定を再定義する
2. safe sector 中心へ向く escape target 制御を追加する
3. worst seed を再測定し、`escapeFrames` が過剰に出ないことを確認する
4. 10 seed の `P10 / median` を再確認する

## 追加方針（rev.13）

### 目的

- `predictive-controller` の改善後に replay-lab の学習・評価ループへ戻る
- `VERIFIED-only` と `worst-10% survival` 優先の方針を維持しつつ、新しい挙動を baseline として再測定する
- 失敗タイプと死亡前ログの差分を見ながら、学習候補の更新を再開する

### 変更対象ファイル

1. `games/asteroid/replay-lab/tools/continuous-pdca.mjs`
- baseline 再測定と reflection 出力が新しい controller 前提でも崩れないか確認する
- 必要なら job 設定を今回の seed 群向けに微調整する

2. `games/asteroid/replay-lab/tools/autoresearch-loop.mjs`
- 現行 best を起点に candidate 探索を再開する
- failure summary と diversity を見ながら、worst-10% 改善に寄る候補を優先する

3. `games/asteroid/replay-lab/continuous/*`
- 新しい round の status / history / reflection を蓄積して確認する

### 実施内容

1. 現行 best と baseline を再確認する
2. autonomous job の状態を確認し、必要なら安全に切り替える
3. replay-lab の continuous 学習を再開する
4. `P10 / median / topFailures / nextHypothesis` を見て次の 1 手を決める

## 想定作業時間

- 40〜60分（実装 + 検証 + セキュリティ確認）

## 非対象（今回）

- 本格的な学習パイプライン刷新（RL本訓練）
- 既存ランキング/サーバAPI仕様の変更

## 追加方針（rev.19）

### 目的

- 最新の `predictive-controller` で実走した replay を `VERIFIED` 候補として replay-lab に取り込む
- 旧来の固定 best replay だけでなく、最新の危険認識から得た donor/source を学習ループへ供給する
- `P10 / median / failure type` を見ながら、controller 由来 replay が source として使えるか確認する

### 変更対象ファイル

1. `games/asteroid/replay-lab/tools/capture-predictive-controller-replays.mjs`（新規）
- 最新 `predictive-controller` を headless 実走し、seed ごとの replay buffer を生成する
- 各 replay を `evaluateReplayBytesAcrossSeeds` / `analyzeReplayBytesAcrossSeeds` で robust 評価する
- `VERIFIED` 形式の candidate JSON と集約 best / manifest を `replay-lab/` 配下へ保存する

2. `games/implementation_plan.md`
- bridge 実装の目的、出力物、検証方針を rev.19 として記録する

### 実施内容

1. 最新 controller を seed ごとに headless 実走して replay を保存する
2. 各 replay を 10 seed などで再評価し、`robustSummary` と `failureSummary` を付与する
3. 候補群から best candidate を選び、`best/` に source として使える JSON を保存する
4. manifest を出して、どの controller-seed が donor/source に向くかを追えるようにする
5. スモーク実行で candidate 生成と robust 評価が通ることを確認する

### 想定作業時間

- 50〜80分（実装 + スモーク検証 + セキュリティ確認）

## 追加方針（rev.14）

### 目的

- failure 別パックが「生成されているのに選ばれていない」のかを可視化する
- 同一 `replayDigest` が round best に張り付き続ける状態を和らげる
- `worst-10% survival` を崩さずに、failure 対策候補を shortlist と採用判定へ乗せやすくする

### 変更対象ファイル

1. `games/asteroid/replay-lab/tools/common.mjs`
- `chooseDiverseCandidate` に shortlist 理由と選抜診断を残す
- 同一 digest の候補が勝ち続けるケースで、failure 別パックを比較しやすい bias と penalty を追加する
- `P10` 同点帯の判定幅を少し広げ、failure 対策候補が shortlist に乗る余地を増やす

2. `games/asteroid/replay-lab/tools/autoresearch-loop.mjs`
- iteration ごとに「生成 strategy 一覧」「shortlist 候補」「最終選抜理由」を JSONL へ出力する
- `edge-trap-recovery-*` / `over-acceleration-recovery-*` が生成止まりなのか、shortlist 負けなのか、最終選抜負けなのかを追えるようにする
- 同一 `P10`・別 digest の候補があるときは、failure 対策候補を採用しやすい条件へ調整する

3. 検証
- 短い `autoresearch-loop` スモークで failure 別 strategy が shortlist と最終選抜に出るかを確認する
- `continuous-pdca` を再起動し、少なくとも round 2 までで同一 digest 固定が崩れるかを見る

### 実施内容

1. shortlist / selection 診断の追加
2. 同一 digest 張り付きの抑制
3. failure 別 strategy の可視化ログ追加
4. スモーク実行で shortlist と winner の変化を確認

## 想定作業時間

- 35〜50分（実装 + スモーク検証 + セキュリティ確認）

## 追加方針（rev.15）

### 目的

- `edge-trap-recovery-*` / `over-acceleration-recovery-*` を shortlist 止まりではなく勝負できる強さまで引き上げる
- 失敗直前の小修正ではなく、failure 手前から replay の局所ループを崩して長い離脱列を作る

## 追加方針（rev.20）

### 目的

- 自機がやられた瞬間を、現在の簡易消滅ではなく「派手に爆発して四散する」見た目へ強化する
- 画面上に `GAME OVER` を明示表示し、死亡が一目で伝わる演出にする
- ゲームオーバー後も裏では既存のデモ/自動実行ループやシミュレーション後処理を壊さず、継続して動いている状態を維持する

### 変更対象ファイル

1. `asteroid/src/render/particles.js`
- 自機専用の大爆発パーティクルを強化する
- 火花だけでなく、機体破片が四散して見える粒子パターンを追加する
- 必要なら中心フラッシュや余韻用の粒子寿命・速度レンジを調整する

2. `asteroid/src/render/renderer.js`
- `ship-destroyed` 発生時に新しい自機爆散エフェクトを呼ぶ
- 破壊後しばらく残る中心フラッシュやリング波など、死亡演出の見栄えを追加する
- 演出中でも既存の post-finish motion や demo 再起動フローを阻害しないようにする

3. `asteroid/src/main.js`
- キャンバス上に重なる `GAME OVER` オーバーレイ要素を追加する
- `ship-destroyed` 終了時のみオーバーレイを表示し、開始/リスタート時には確実に非表示へ戻す
- runtime status の既存文言更新と競合しないよう、表示責務を分離する

4. `asteroid/src/style.css`
- `GAME OVER` オーバーレイの見た目を追加する
- 爆発演出の雰囲気に合わせ、ネオン寄りで視認性の高い表示へ調整する
- モバイル/デスクトップ両方で中央表示が崩れないようにする

### 実施内容

1. 自機破壊エフェクトを「強い閃光 + 高速火花 + 機体破片の四散」の多層構成へ差し替える
2. `ship-destroyed` 時だけキャンバス上に `GAME OVER` 表示を出し、既存の `runtimeStatus` は補助メッセージとして残す
3. run 開始、即時リスタート、demo 自動再開、replay 視聴遷移の各導線でオーバーレイ表示が残留しないよう整理する
4. 既存の finish 後アイドル遷移や demo 連続実行がそのまま動くことを確認する

### 検証

1. `asteroid` を起動し、被弾時に爆発が明確に派手になっていることを確認する
2. 死亡直後に `GAME OVER` が中央表示され、再スタートで消えることを確認する
3. `DEMO` 有効時に死亡しても裏の再開ループが継続し、次の run が始まることを確認する
4. `security-baseline` に沿って secret / risk / dependency / leak を最終確認する

### 想定作業時間

- 30〜45分（実装 + 見た目確認 + セキュリティ確認）

## 追加方針（rev.21）

### 目的

- `GAME OVER` 表示を自機爆散の直後ではなく、500ms 遅れて出すことで爆発演出を先に見せる
- ローカル修正を GitHub と Cloudflare 本番へ反映する

### 変更対象ファイル

1. `asteroid/src/main.js`
- `GAME OVER` オーバーレイの表示タイミングを即時表示から 500ms 遅延表示へ変更する
- 再スタートや replay 遷移時に、遅延タイマーが残って誤表示しないようにする

2. `games/implementation_plan.md`
- 今回の遅延表示と反映手順を rev.21 として記録する

### 実施内容

1. `ship-destroyed` 時に `GAME OVER` を 500ms 遅延表示へ変更する
2. 再スタート、demo 自動再開、replay 視聴時に遅延表示予約を必ず解除する
3. build とセキュリティ確認を再実施する
4. 今回の変更だけを GitHub に反映する
5. Cloudflare へデプロイし、反映結果を共有する

### 検証

1. 被弾後すぐは爆発だけ見え、約 500ms 後に `GAME OVER` が表示されることを確認する
2. 500ms 未満で再開した場合に古い `GAME OVER` が出ないことを確認する
3. `npm run build` が成功することを確認する
4. `security-baseline` に沿って secrets / risk / dependency / leak を確認する

### 想定作業時間

- 25〜40分（実装 + 確認 + GitHub/Cloudflare 反映）

## 追加方針（rev.22）

### 目的

- `asteroid` の 60秒完走 replay が再生時に即死する不具合を修復する
- ローカルの `ai-top10.json` に混入した不正な watch 用 replay を、device-check で検証済みの replay に戻す

### 変更対象ファイル

1. `asteroid/public/rl/ai-top10.json`
- 壊れている `ai-01` の replay 情報を、device-check で pass している検証済み replay に差し替える
- `seed` / `summary` / `finalStateHash` / `replayDigest` を整合する内容へ戻す

2. `asteroid/src/main.js` または replay 関連ファイル（必要な場合のみ）
- `seed` の扱いに UI 側の誤りが残っていないか確認し、必要な最小修正だけ入れる

3. `games/implementation_plan.md`
- 今回の replay 修復方針を rev.22 として記録する

### 実施内容

1. `ai-01` の現行 replay が headless でも再現失敗することを確認する
2. `device-check` で pass 済みの `run05-best` 系 replay を基準に、`ai-top10.json` の `ai-01` を修復する
3. 修復後の replay を headless 再生で再検証する
4. `npm run build` と `security-baseline` の確認を行う

### 検証

1. 修復後の `ai-01` replay が headless 検証で期待スコアと整合することを確認する
2. ローカル UI 再生でも即死しないことを確認する
3. `npm run build` が成功することを確認する
4. `secret_scan` を実行し、追加の secret 混入がないことを確認する

### 想定作業時間

- 25〜35分（データ修復 + 検証 + セキュリティ確認）

## 追加方針（rev.23）

### 目的

- 60秒完走時に、通常の `TIME UP` ではなく「ゲームクリア」演出へ切り替える
- 60秒到達と同時にエネルギー波で画面上のアステロイドを全破壊し、その後は自機を包む球体バリアで飛来物を完全防御する
- キー入力があるまで「防ぎ続けるデモ状態」を維持し、クリア後の気持ちよさと達成感を強める

### 変更対象ファイル

1. `asteroid/src/main.js`
- `time-up` 到達時に単純終了せず、クリア演出用の状態へ入るフローを追加する
- クリア演出のフェーズ管理
  - エネルギー波発生
  - 画面上アステロイド全破壊
  - 自機を中心に戻して上向き固定
  - 球体バリア展開
  - キー入力待ちの防御デモ
- クリア後に新しく来るアステロイドを破壊/無効化し続ける処理を追加する
- 再スタート入力で通常 run へ戻せるようにする

2. `asteroid/src/render/renderer.js`
- クリア用のエネルギー波エフェクトを追加する
- 自機まわりの「立体的な網目上の球体バリア」描画を追加する
- `GAME CLEAR` 表示を追加する
- 既存の `TIME UP` overlay と競合しないよう、クリア時は専用表示へ切り替える

3. `asteroid/src/render/particles.js`
- クリア波や防御ヒットに必要な追加粒子があれば最小限追加する

4. `asteroid/src/audio/audio-engine.js`
- クリア時のファンファーレ音を追加する
- 既存の破壊音やBGMと重なっても破綻しないようにする

5. `asteroid/src/style.css`（必要な場合のみ）
- DOM overlay を使う場合に限って `GAME CLEAR` 表示のスタイルを追加する
- ただし今回は可能なら renderer 側のキャンバス描画で完結させる

6. `games/implementation_plan.md`
- 今回のクリア演出方針を rev.23 として記録する

### 実施内容

1. `time-up` 直後にクリア演出 state へ遷移する
2. 最初のフェーズでエネルギー波を出し、画面上の既存アステロイドを一掃する
3. 自機を画面中央寄り・上向きに整列させ、網目状の球体バリアを展開する
4. 以後はスポーンしてくるアステロイドがぶつかっても全て防ぐ防御デモへ移る
5. ファンファーレと `GAME CLEAR` 表示を重ね、キー入力で次の run へ進めるようにする

### 検証

1. 60秒到達時に即座にクリア演出へ切り替わることを確認する
2. エネルギー波で画面上のアステロイドが全て消えることを確認する
3. バリア展開後はアステロイドが当たっても自機が破壊されないことを確認する
4. `GAME CLEAR` 表示とファンファーレが再生されることを確認する
5. キー入力まで防御デモが続き、入力後に通常の再スタートへ戻れることを確認する
6. `npm run build` と `security-baseline` の確認を行う

### 想定作業時間

- 45〜70分（実装 + 見た目/音確認 + セキュリティ確認）

### 変更対象ファイル

1. `games/asteroid/replay-lab/tools/autoresearch-loop.mjs`
- `edge-trap` 向け recovery パックを長い逃走列ベースに作り直す
- `over-acceleration` 向け recovery パックを「減速 -> 向き直し -> 再加速」の長め列に強化する
- failure 手前から広めの window を消して差し替える variant を追加する
- recovery 後に短い微調整 mutation を足す variant を混ぜる

### 実施内容

1. recovery 用の長い plan 定義を追加
2. focus window を広げ、失敗 tick より前から入力を差し替える
3. pure recovery と recovery + micro mutation の両方を生成
4. smoke で `recovery-*` の `P10` 上振れを確認する

## 想定作業時間

- 40〜55分（実装 + スモーク検証 + セキュリティ確認）

## 追加方針（rev.16）

### 目的

- `recovery` 単独では届かない局面に対して、failure 窓の近傍だけ donor の良い断片を借りる
- `targeted-crossover -> recovery -> micro mutation` の 3 段構成で、局所ループを壊しつつ助かる操作列を作る

### 変更対象ファイル

1. `games/asteroid/replay-lab/tools/autoresearch-loop.mjs`
- `edge-trap` / `over-acceleration` 専用の donor-guided recovery を追加する
- failure 窓の start/end 付近だけ donor 断片を移植し、その上から長い recovery 列を重ねる
- donor は全体 best ではなく、該当 failure 窓に対して penalty が小さい候補を優先する
- selection ログに donor label を残せるよう metadata を整える

### 実施内容

1. failure 窓に強い donor 選定ヘルパーの追加
2. donor-guided recovery variant の生成
3. `edge-trap` / `over-acceleration` それぞれに recovery-hybrid を追加
4. smoke で recovery-hybrid の `P10` 上振れを確認する

## 想定作業時間

- 45〜60分（実装 + スモーク検証 + セキュリティ確認）

## 追加方針（rev.17）

### 目的

- guided recovery の donor 組み合わせを追跡できるようにする
- `edge-trap-guided-recovery-5/6` のように上振れしている plan を shortlist に乗せやすくする

### 変更対象ファイル

1. `games/asteroid/replay-lab/tools/autoresearch-loop.mjs`
- `selection.jsonl` の evaluated summary / shortlist / selected に `donorLabels` を残す
- `edge-trap-guided-recovery-5/6` とその hybrid に小さな bias を追加する

### 実施内容

1. donor 情報の可視化
2. guided 上位 plan の軽い優遇
3. smoke で donor と `P10` の対応を見る

## 想定作業時間

- 30〜45分（実装 + スモーク検証 + セキュリティ確認）

## 追加方針（rev.18）

### 目的

- AI が何を危険と認識しているかをプレイ中に人が見えるようにする
- 危険度の総合値と内訳、危険判定理由、危険 asteroid を HUD で確認できるようにする

### 変更対象ファイル

1. `games/asteroid/src/rl/predictive-controller.js`
- 既存の危険メトリクスから総合危険度 `0..1` と内訳を組み立てる
- 「なぜ危険と判断したか」の短い reason 群を `debugOverlay` へ入れる

2. `games/asteroid/src/main.js`
- demo telemetry / 死亡前ログに危険度スナップショットを残す

3. `games/asteroid/src/render/renderer.js`
- 危険度ゲージ、内訳、reason 表示、危険 asteroid の強調表示を追加する

### 実施内容

1. controller で danger HUD 用データ生成
2. main で frame ring へ危険度を記録
3. renderer に危険度 HUD を追加
4. build と表示確認

## 想定作業時間

- 45〜70分（実装 + ビルド確認 + セキュリティ確認）

## 追加方針（rev.24）

### 目的

- 60秒クリア演出を、より見やすく・段階的で気持ちよい見せ方に調整する
- クリア後の入力で即リセットせず、上昇ワープ演出を経て初期デモ画面へ戻す

### 変更対象ファイル

1. `games/asteroid/src/main.js`
- `GAME CLEAR` と `Hit Any Key` の表示を 1000ms 遅延にするためのタイミング管理を追加する
- 60秒経過直後は自機をすぐ固定せず、中心へ滑らかに移動させる
- バリアの半径と可視強度を時間経過で徐々に展開する
- キー入力後は上方向へ移動しながらワープ演出 state に入り、完了後に開始前デモへ戻す

2. `games/asteroid/src/render/renderer.js`
- クリア文言を `GAME CLEAR` と `HIT ANY KEY` のみへ整理し、自機と重ならない上寄り位置へ変更する
- バリアを段階展開率に合わせて描画する
- バリア衝突時に asteroid サイズに応じてより派手な爆発と衝撃を出す
- ワープ開始後の上昇・光条演出を追加する

3. `games/asteroid/src/audio/audio-engine.js`
- 既存ファンファーレは維持しつつ、ワープ開始時に短い上昇音を追加する

### 実施内容

1. クリア UI の表示タイミングを 1000ms 遅らせ、表示文言を最小化する
2. 自機を60秒到達後に中心へ移動させ、その間にバリアを徐々に展開する
3. バリア衝突時の爆発をサイズ別に強化する
4. キー入力後に上昇ワープ演出を挟み、完了後に最初の待機デモへ戻す
5. `npm run build` と `security-baseline` を確認する

### 検証

1. 60秒到達後、自機が中心へ移動してからバリアが広がることを確認する
2. `GAME CLEAR` と `HIT ANY KEY` が 1000ms 後に上側へ表示され、自機と重ならないことを確認する
3. バリアに当たった asteroid が派手に爆発し、大きい asteroid ほど強く見えることを確認する
4. キー入力後、上昇ワープ演出を経て開始前デモへ戻ることを確認する
5. `npm run build` と secret scan が通ることを確認する

### 想定作業時間

- 35〜55分（演出調整 + build + セキュリティ確認）

## 追加方針（rev.25）

### 目的

- `GAME OVER` を文字だけのシンプルなオーバーレイに統一する
- `GAME CLEAR` 側も含め、演出中の余計な説明文を消して最小表示に整える
- 調整後の内容を GitHub と Cloudflare 本番へ反映する

### 変更対象ファイル

1. `games/asteroid/src/main.js`
- 必要に応じて runtime status の文言表示を抑え、演出中の補助文が出ないよう整理する

2. `games/asteroid/src/render/renderer.js`
- `GAME CLEAR` 側の補助説明を出さず、必要最小限の文言だけにする

3. `games/asteroid/src/style.css`
- `GAME OVER` オーバーレイを文字だけの見た目に簡素化する

### 実施内容

1. `GAME OVER` オーバーレイを文字だけ表示へ変更する
2. `GAME CLEAR` / `GAME OVER` 中の説明文を削除する
3. `npm run build` と `security-baseline` を確認する
4. 変更を GitHub へ push し、Cloudflare Workers へ deploy する

### 検証

1. 被弾時に `GAME OVER` が文字だけで表示されることを確認する
2. クリア/ゲームオーバー中に余計な説明文が表示されないことを確認する
3. `npm run build` と secret scan が通ることを確認する
4. GitHub push と Cloudflare deploy が成功することを確認する

### 想定作業時間

- 25〜40分（表示整理 + build + セキュリティ確認 + 反映）
