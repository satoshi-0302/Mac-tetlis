# HBR Style Battle Advisor

`HBR計算機🎭Ver.4.28.01.xlsx` をもとに、手持ち/使いたいスタイルから以下を提案するツールです。

- おすすめ編成（最大 6 人）
- 役割（attacker / buffer / debuffer）
- 3 ターンの行動案
- DP/HPフェーズを分けた簡易ダメージシミュレーション
- Web 画像 + 所属組 + スタイル名の HTML レポート
- 攻略サイト（Game8）参照の Tier 情報表示

## DB構造（基礎データ）

`data/hbr_data.json` には次の正規化データを保持します。

- `styles`: スタイル詳細（無凸/3凸のATK・DEF・クリ威力・クリ率・破壊率、各適用範囲、パッシブ）
- `skills`: スキル詳細（武器/属性、倍率、消費SP、備考、hit内訳倍率）
- `enemies`: 仮想敵（DP/HP/DR、武器・属性倍率）
- `knowledge`: 補助テーブル群
  - `skill_attack_buffs`
  - `element_attack_buffs`
  - `charge_buffs`
  - `crit_damage_buffs`
  - `crit_rate_buffs`
  - `debuff_traits`
  - `field_buffs`
  - `mind_eye_buffs`
  - `penetration_skills`
  - `manual_notes` / `version`

この `knowledge` を推薦ロジックが参照し、役割判定と行動提案を補強します。

## 1. データ生成

```bash
cd /path/to/Codex/hbr-style-advisor
python3 -m hbr_advisor build-data \
  --xlsx "/path/to/HBR計算機🎭Ver.4.28.01.xlsx" \
  --out data/hbr_data.json
```

## 2. 推薦実行

```bash
python3 -m hbr_advisor recommend \
  --data data/hbr_data.json \
  --owned "SSしもべ(魔王に仕えし混沌の謀臣),SSウェイトレス(ホップ・ステップ・スリップ！),SS3周年(夜の香り、薔薇の調べ)" \
  --wanted "SSユニゾン[闇](誇り高き魔王の凱旋)" \
  --enemy "異時層フラットハンド(第二形態)" \
  --fetch-images \
  --html-report reports/sample_team.html \
  --json-out reports/sample_team.json
```

## 3. 手持ちを選択式で使う（Web UI）

```bash
# まだ style DB が無い場合は先に生成
python3 -m hbr_advisor build-style-db \
  --data data/hbr_data.json \
  --fetch-web

python3 -m hbr_advisor serve \
  --data data/hbr_data.json \
  --style-db data/style_database.json \
  --host 127.0.0.1 \
  --port 8787
```

起動後、ブラウザで `http://127.0.0.1:8787` を開くと、まず **6スタイル選択UI** が表示されます。

- 6枠の選択スロット（同一キャラ重複不可）
- 検索（キャラ/スタイル/組）
- 組・キャラ・レアリティで絞り込み
- 絞り込み結果から自動補完
- スタイルをクリックして、Excel由来の詳細ステータス/スキル（固有・共通）を確認
- 仮想敵
- 武器/属性重視
- Game8参照（画像・所属組・Tier）

## 主な入力オプション

- `--owned`: 手持ちスタイル（カンマ or 改行区切り、曖昧一致可）
- `--wanted`: 使いたいスタイル（優先採用）
- `--enemy`: 仮想敵名（`仮想敵` シート）
- `--weapon`: `斬` / `突` / `打`
- `--element`: `火` / `氷` / `雷` / `光` / `闇` / `無`
- `--fetch-images`: 画像・所属組・Tier を取得（Game8）
- `serve`: ローカル選択UIを起動
- `serve --style-db`: 6スタイル選択UIに組・画像つきの一覧を供給

## 画像取得仕様

- Game8 のサイト内検索でスタイルページを解決
- `og:image`、`所属部隊`、Tier 表記（総合/役割）を抽出
- `data/image_cache.json` にキャッシュ

## 注意

- ダメージ値は簡易モデルです（実ゲームと完全一致はしません）
- 計算モデルは「準備（バフ/デバフ）→DPブレイク→HPフィニッシュ」の3段を前提
- Web 画像取得はネットワーク接続が必要です
- 同名/近似名スタイルは別ページを拾う場合があるため、`source` リンク確認を推奨します
