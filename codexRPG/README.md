# codexRPG

TypeScript + Vite + Canvas で実装した、10F到達型のターン制グリッドローグライクMVPです。

## 起動

```bash
cd codexRPG
npm install
npm run dev
```

- `public/spritesheet.png` が無い場合、`predev` で `scripts/generateSpritesheet.mjs` が自動生成します。
- 外部ライブラリ無しでPNGを出力する実装です。

## 操作

- 移動/近接攻撃: `矢印` または `WASD`
- 斜め移動/斜め近接: `Q E Z C`
- 魔法: `1` マジックストライク, `2` バースト, `3` セルフヒール
- `Space`: 隣接敵がいれば自動近接（1体ならその敵、複数ならランダム）/ いなければ待機
- 待機のみ: `.`
- リザルト: `再挑戦` ボタン

## 実装済みMVP要件

- 10Fまで進行（10Fは魔王戦）
- 各階に宝箱1つ、固定宝を即時適用
- 永続PLvをラン開始時へ反映（死亡後もPLv維持）
- ラン終了時に `runXP / 取得PX / PLv / 到達階` を表示し localStorage 更新
- マップ40x24、部屋数4-6・部屋間3マス以上で非重複配置、長い通路や三叉路を含むダンジョン生成
- ターン制（プレイヤー行動後に敵全体行動）
- 敵出現数は既定テーブルの2倍（10F魔王は単体）
- 階段で降りた瞬間HP/MP全回復
- セーブ対象はPX/PLvのみ
- FOV: 通常は周囲8マスのみ可視、部屋に入ると部屋全体＋接している壁/通路を表示
- 視認同期: プレイヤーから敵が見えている時は敵もプレイヤーを知覚
- 敵追跡: いったん追跡状態に入ると、見失ってもしばらく最後に見た方向へ追従
- 既知タイル: 一度見えた場所は以後ずっと明るく表示
- 敵知覚: 周囲8マスまたは同部屋でプレイヤーを知覚
- 戦闘/地形ルール: 部屋内は8方向近接、通路/入口は前後方向のみ近接
- 移動ルール: 基本は8方向移動、入口軸では前後方向のみ移動
- キャラクター/床/通路/壁/敵/宝箱/階段を32pxタイルで描画
- 戦闘演出: 攻撃/被弾/撃破/死亡 + 魔王撃破時のクリア演出 + 与ダメ/被ダメ数値ポップアップ
- 音: WebAudioでBGMと効果音（攻撃/被弾/撃破/死亡/回復/宝箱/階段）+ クリア専用メロディ

## 推奨フォルダ構成

```text
codexRPG/
  public/
    spritesheet.png                 # 必須スプライトシート（無ければ自動生成対象）
  scripts/
    generateSpritesheet.mjs         # 起動前にPNGを自動生成
  src/
    data/
      progression.json              # PX/PLv/成長式データ
      treasures.json                # 固定宝データ
      enemies.json                  # 敵ステータス/スポーン定義
    game/
      types.ts                      # 共通型定義
      data.ts                       # JSONローダーと計算ヘルパー
      map.ts                        # 非重複ルーム+通路のダンジョン生成
      rng.ts                        # 乱数ユーティリティ
      sprites.ts                    # スプライト読み込み/フォールバック生成
      persistence.ts                # localStorage永続処理
      game.ts                       # ゲームループ/戦闘/描画/入力
    main.ts                         # エントリーポイント
    style.css                       # レイアウト/見た目
  index.html
  package.json
  tsconfig.json
  vite.config.ts
```

## 主要ファイルの責務コメント

主要TSファイルは先頭に「何を担当するファイルか」の責務コメントを入れています。
