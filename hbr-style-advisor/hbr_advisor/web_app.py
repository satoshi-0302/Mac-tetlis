from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .data_store import AdvisorData
from .recommender import BattleAdvisor
from .web_lookup import StyleWebInfo, StyleWebInfoResolver


def _json_plan_payload(plan, web_infos: dict[str, StyleWebInfo]) -> dict[str, Any]:
    team = []
    for sc in plan.team:
        info = web_infos.get(sc.style.style_name)
        team.append(
            {
                "style_name": sc.style.style_name,
                "character": sc.style.character,
                "rarity": sc.style.rarity,
                "role": sc.role,
                "total_score": sc.total_score,
                "attack_score": sc.attack_score,
                "support_score": sc.support_score,
                "debuff_score": sc.debuff_score,
                "breaker_skill": sc.breaker_skill.skill_name if sc.breaker_skill else None,
                "finisher_skill": sc.finisher_skill.skill_name if sc.finisher_skill else None,
                "support_skill": sc.support_skill.skill_name if sc.support_skill else None,
                "debuff_skill": sc.debuff_skill.skill_name if sc.debuff_skill else None,
                "weakness_factor": sc.weakness_factor,
                "web_info": info.to_dict() if info else None,
            }
        )

    return {
        "enemy": plan.enemy.to_dict() if plan.enemy else None,
        "estimated_damage": plan.estimated_damage,
        "relative_score": plan.relative_score,
        "turn_plan": plan.turn_plan,
        "team": team,
        "unmatched_owned": plan.unmatched_owned,
        "unmatched_wanted": plan.unmatched_wanted,
    }


def _squad_sort_key(squad: str) -> tuple[int, int, str]:
    text = (squad or "").strip()
    if not text:
        return (9, 999, "")
    if text == "司令部":
        return (1, 0, text)
    if text == "AB!":
        return (2, 0, text)
    if len(text) == 3 and text[:2].isdigit() and text[2].isalpha():
        return (0, int(text[:2]), text[2])
    return (3, 0, text)


def _load_style_db_meta(style_db_path: str) -> dict[tuple[str, str], dict[str, Any]]:
    path = Path(style_db_path)
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}

    styles = payload.get("styles")
    if not isinstance(styles, list):
        return {}

    out: dict[tuple[str, str], dict[str, Any]] = {}
    for row in styles:
        if not isinstance(row, dict):
            continue
        character = str(row.get("character") or "")
        style_name = str(row.get("style_name") or "")
        if not character or not style_name:
            continue
        out[(character, style_name)] = row
    return out


def _options_payload(data: AdvisorData, style_db_path: str = "data/style_database.json") -> dict[str, Any]:
    style_meta = _load_style_db_meta(style_db_path)

    styles = [
        {
            "style_id": f"{s.character}::{s.style_name}",
            "style_name": s.style_name,
            "character": s.character,
            "rarity": s.rarity,
            "squad": str(style_meta.get((s.character, s.style_name), {}).get("squad") or ""),
            "image_url": str(
                style_meta.get((s.character, s.style_name), {}).get("image_url") or ""
            ),
            "page_url": str(
                style_meta.get((s.character, s.style_name), {}).get("page_url") or ""
            ),
            "status": style_meta.get((s.character, s.style_name), {}).get("status") or {},
            "style_unique_skills": style_meta.get((s.character, s.style_name), {}).get("style_unique_skills") or [],
            "character_shared_skills": style_meta.get((s.character, s.style_name), {}).get("character_shared_skills") or [],
            "style_unique_skill_count": int(
                style_meta.get((s.character, s.style_name), {}).get("style_unique_skill_count") or 0
            ),
            "character_shared_skill_count": int(
                style_meta.get((s.character, s.style_name), {}).get("character_shared_skill_count") or 0
            ),
        }
        for s in sorted(
            data.styles,
            key=lambda x: (
                _squad_sort_key(
                    str(style_meta.get((x.character, x.style_name), {}).get("squad") or "")
                ),
                x.character,
                x.style_name,
            ),
        )
    ]
    enemies = [
        {"name": e.name, "category": e.category}
        for e in sorted(data.enemies, key=lambda x: (x.category, x.name))
    ]
    return {"styles": styles, "enemies": enemies}


def _ui_html() -> str:
    return """
<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HBR 6スタイル選択ツール</title>
  <style>
    :root {
      --bg: #eeece5;
      --panel: #fffefb;
      --ink: #1d2329;
      --muted: #5b6470;
      --line: #d8d2c4;
      --accent: #0f766e;
      --accent-2: #b45309;
      --soft: #f7f4ea;
      --danger: #8f2d1d;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Hiragino Sans", "Yu Gothic", sans-serif;
      color: var(--ink);
      background:
        radial-gradient(1200px 700px at -10% -20%, #fff7df 0%, transparent 55%),
        radial-gradient(1200px 700px at 110% -10%, #dcf2ef 0%, transparent 45%),
        var(--bg);
    }
    .shell {
      max-width: 1460px;
      margin: 0 auto;
      padding: 18px;
    }
    h1 {
      margin: 0;
      font-size: 30px;
      letter-spacing: 0.02em;
    }
    .sub {
      margin-top: 8px;
      font-size: 14px;
      color: var(--muted);
    }
    .layout {
      margin-top: 16px;
      display: grid;
      grid-template-columns: 1.2fr 0.8fr;
      gap: 14px;
    }
    .panel {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px;
      box-shadow: 0 2px 0 rgba(0,0,0,0.02);
    }
    .section-title {
      margin: 0 0 8px;
      font-size: 16px;
      font-weight: 700;
    }
    .picked-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 10px;
    }
    .picked-count {
      font-size: 13px;
      color: #29414a;
      background: #e8f7f5;
      border: 1px solid #ccebe5;
      padding: 4px 8px;
      border-radius: 999px;
      font-weight: 700;
    }
    .small-btn {
      border: 1px solid var(--line);
      background: #fff;
      color: #2d3740;
      border-radius: 8px;
      padding: 5px 9px;
      font-size: 12px;
      cursor: pointer;
    }
    .small-btn:hover {
      border-color: #c5bcaa;
      background: #faf8f1;
    }
    .picked-slots {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin-bottom: 10px;
    }
    .slot {
      border: 1px dashed #cfc7b5;
      background: #fff;
      border-radius: 10px;
      min-height: 112px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .slot.empty {
      align-items: center;
      justify-content: center;
      color: #9b9382;
      font-size: 12px;
      background: #fcfaf3;
    }
    .slot-cover {
      width: 100%;
      height: 64px;
      background: linear-gradient(145deg, #dbe6e4, #e9e0d1);
    }
    .slot-cover img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .slot-body {
      padding: 6px 7px 7px;
      font-size: 11px;
      line-height: 1.35;
      flex: 1;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 4px;
      align-items: start;
    }
    .slot-name {
      font-weight: 700;
      color: #27313a;
      font-size: 12px;
      line-height: 1.3;
    }
    .slot-meta {
      color: #59626e;
    }
    .remove-btn {
      border: 1px solid #d8d2c4;
      background: #fff;
      color: #4b5563;
      border-radius: 6px;
      width: 24px;
      height: 24px;
      line-height: 22px;
      text-align: center;
      cursor: pointer;
      padding: 0;
    }
    .filters {
      margin-top: 2px;
      display: grid;
      grid-template-columns: 1.2fr 0.8fr 0.8fr;
      gap: 8px;
    }
    input[type="text"], select {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fff;
      padding: 8px 10px;
      color: var(--ink);
      font-size: 13px;
    }
    .rarity-row {
      margin-top: 8px;
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
      font-size: 13px;
      color: #3f4854;
    }
    .candidate-meta {
      margin-top: 8px;
      color: #526071;
      font-size: 12px;
    }
    .style-grid {
      margin-top: 8px;
      max-height: 560px;
      overflow: auto;
      border-top: 1px dashed var(--line);
      padding-top: 8px;
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
      gap: 8px;
    }
    .style-detail {
      margin-top: 10px;
      border: 1px solid var(--line);
      background: #fff;
      border-radius: 10px;
      padding: 10px;
      font-size: 12px;
      line-height: 1.45;
    }
    .style-detail h3 {
      margin: 0 0 6px;
      font-size: 14px;
    }
    .style-detail .row {
      margin-bottom: 4px;
      color: #35404d;
    }
    .style-detail .skill-row {
      margin-bottom: 3px;
      color: #2f3c4a;
    }
    .style-card {
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fff;
      overflow: hidden;
      display: grid;
      grid-template-columns: 64px 1fr;
      min-height: 86px;
      cursor: pointer;
    }
    .style-card.selected {
      border-color: #67b7ab;
      box-shadow: inset 0 0 0 1px #67b7ab;
      background: #f5fffd;
    }
    .style-card.focused {
      border-color: #e7a55a;
      box-shadow: inset 0 0 0 1px #e7a55a;
      background: #fffaf1;
    }
    .style-card .cover {
      background: linear-gradient(145deg, #d8dfe8, #e9dbc9);
    }
    .style-card .cover img {
      width: 64px;
      height: 86px;
      object-fit: cover;
      display: block;
    }
    .style-card .body {
      padding: 7px 8px;
      font-size: 11px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .style-name {
      font-size: 12px;
      font-weight: 700;
      line-height: 1.3;
      color: #2a3440;
    }
    .style-line {
      color: #576170;
      line-height: 1.3;
    }
    .style-actions {
      margin-top: auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
    }
    .badge {
      display: inline-block;
      font-size: 10px;
      border-radius: 999px;
      border: 1px solid #ced7e2;
      background: #f3f7fc;
      padding: 1px 7px;
      color: #344255;
    }
    .pick-btn {
      border: 1px solid #b5dbd4;
      background: #eefaf7;
      color: #0f5f58;
      border-radius: 7px;
      padding: 2px 8px;
      font-size: 11px;
      cursor: pointer;
    }
    .pick-btn.remove {
      border-color: #dfc8be;
      background: #fff3ef;
      color: #8f2d1d;
    }
    .pick-btn:disabled {
      opacity: 0.45;
      cursor: default;
    }
    .controls {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 9px;
    }
    .label {
      font-weight: 700;
      margin-bottom: 6px;
      font-size: 13px;
      color: #3d3a33;
    }
    .full {
      grid-column: 1 / -1;
    }
    .btn {
      display: inline-block;
      border: none;
      background: linear-gradient(135deg, var(--accent), #0d9488);
      color: white;
      padding: 10px 14px;
      border-radius: 10px;
      cursor: pointer;
      font-weight: 700;
      letter-spacing: 0.02em;
      width: 100%;
    }
    .btn:disabled {
      opacity: 0.55;
      cursor: default;
    }
    .summary {
      margin-top: 10px;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }
    .metric {
      padding: 10px;
      border-radius: 10px;
      border: 1px solid var(--line);
      background: var(--soft);
      font-size: 13px;
    }
    .metric b { display: block; font-size: 18px; margin-top: 4px; }
    .warn {
      margin-top: 8px;
      color: var(--danger);
      font-size: 13px;
    }
    .result {
      margin-top: 16px;
    }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
      gap: 12px;
      margin-top: 10px;
    }
    .card {
      border: 1px solid var(--line);
      border-radius: 12px;
      background: #fff;
      overflow: hidden;
    }
    .card img {
      width: 100%;
      height: 180px;
      object-fit: cover;
      display: block;
      background: #ece7db;
    }
    .card .body {
      padding: 10px;
      font-size: 13px;
    }
    .card h3 {
      margin: 0 0 6px;
      font-size: 16px;
      line-height: 1.3;
    }
    .chip {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 999px;
      font-size: 12px;
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      margin-right: 6px;
    }
    .strategy {
      margin-top: 6px;
      font-size: 12px;
      color: #3a4b45;
      background: #edf7f5;
      border: 1px solid #cfeae5;
      border-radius: 8px;
      padding: 6px;
    }
    .turn {
      margin-top: 14px;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 10px 14px;
      background: #fff;
    }
    .turn li { margin: 8px 0; }
    @media (max-width: 1150px) {
      .layout { grid-template-columns: 1fr; }
      .summary { grid-template-columns: 1fr; }
      .picked-slots { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .filters { grid-template-columns: 1fr; }
    }
    @media (max-width: 760px) {
      .picked-slots { grid-template-columns: 1fr; }
      .controls { grid-template-columns: 1fr; }
      .style-grid { max-height: 420px; grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <h1>HBR 6スタイル選択シミュレーター</h1>
    <div class="sub">まず6スタイルを快適に選択し、その6枠を前提にダメージ役割と行動順を計算します。</div>

    <div class="layout">
      <section class="panel">
        <h2 class="section-title">1. 6スタイルを選択</h2>
        <div class="picked-head">
          <div id="pickedCount" class="picked-count">0 / 6 選択</div>
          <div>
            <button id="autoFillBtn" class="small-btn">絞込から補完</button>
            <button id="clearPickedBtn" class="small-btn">クリア</button>
          </div>
        </div>
        <div id="pickedSlots" class="picked-slots"></div>

        <div class="filters">
          <input id="styleSearch" type="text" placeholder="検索（キャラ/スタイル/組）" />
          <select id="squadFilter"></select>
          <select id="charFilter"></select>
        </div>
        <div class="rarity-row">
          <label><input type="checkbox" class="rarityFilter" value="SS" checked /> SS</label>
          <label><input type="checkbox" class="rarityFilter" value="S" checked /> S</label>
          <label><input type="checkbox" class="rarityFilter" value="A" checked /> A</label>
          <label><input id="selectedOnly" type="checkbox" /> 選択済みだけ表示</label>
        </div>

        <div class="candidate-meta" id="candidateMeta"></div>
        <div id="styleGrid" class="style-grid"></div>
        <div id="styleDetail" class="style-detail"></div>
      </section>

      <section class="panel">
        <h2 class="section-title">2. 条件を指定して実行</h2>
        <div class="controls">
          <div>
            <div class="label">仮想敵</div>
            <select id="enemySelect"></select>
          </div>
          <div>
            <div class="label">武器重視</div>
            <select id="weaponSelect">
              <option value="">自動</option>
              <option value="斬">斬</option>
              <option value="突">突</option>
              <option value="打">打</option>
            </select>
          </div>
          <div>
            <div class="label">属性重視</div>
            <select id="elementSelect">
              <option value="">自動</option>
              <option value="火">火</option>
              <option value="氷">氷</option>
              <option value="雷">雷</option>
              <option value="光">光</option>
              <option value="闇">闇</option>
              <option value="無">無</option>
            </select>
          </div>
          <div>
            <div class="label">画像/攻略参照</div>
            <label><input id="fetchImages" type="checkbox" checked /> Game8画像・所属組・Tierを参照</label>
          </div>
          <div class="full">
            <button id="runBtn" class="btn" disabled>6スタイル選択後に計算</button>
          </div>
        </div>

        <div class="warn" id="selectWarn"></div>
        <div class="summary" id="summary" style="display:none"></div>
        <div class="warn" id="warn"></div>
      </section>
    </div>

    <section class="result" id="result" style="display:none">
      <div class="cards" id="teamCards"></div>
      <div class="turn">
        <h3>推奨行動</h3>
        <ol id="turnPlan"></ol>
      </div>
    </section>
  </div>

<script>
let allStyles = [];
let allEnemies = [];
const styleById = new Map();
const selectedIds = [];
const selectedSet = new Set();
let focusedStyleId = '';

function escapeHtml(text) {
  return String(text || "")
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function squadSortKey(squad) {
  const text = String(squad || '').trim();
  if (!text) return [9, 999, ''];
  if (text === '司令部') return [1, 0, text];
  if (text === 'AB!') return [2, 0, text];
  const m = text.match(/^(\\d+)([A-Z])$/);
  if (m) return [0, Number(m[1]), m[2]];
  return [3, 0, text];
}

function cmpTuple(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const av = a[i];
    const bv = b[i];
    if (av < bv) return -1;
    if (av > bv) return 1;
  }
  return 0;
}

function raritySet() {
  const set = new Set();
  document.querySelectorAll('.rarityFilter').forEach((el) => {
    if (el.checked) set.add(el.value);
  });
  return set;
}

function selectedItems() {
  return selectedIds.map((id) => styleById.get(id)).filter(Boolean);
}

function isUsedCharacter(character, exceptStyleId = '') {
  return selectedIds.some((id) => id !== exceptStyleId && styleById.get(id)?.character === character);
}

function setSelectWarn(text) {
  document.getElementById('selectWarn').textContent = text || '';
}

function cardImage(url, alt) {
  if (url) {
    return `<img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}" loading="lazy" />`;
  }
  return '';
}

function styleHaystack(s) {
  return `${s.style_name || ''} ${s.character || ''} ${s.squad || ''} ${s.rarity || ''}`.toLowerCase();
}

function filteredStyles() {
  const q = (document.getElementById('styleSearch').value || '').trim().toLowerCase();
  const squad = document.getElementById('squadFilter').value || '';
  const character = document.getElementById('charFilter').value || '';
  const onlySelected = document.getElementById('selectedOnly').checked;
  const rarities = raritySet();

  let rows = allStyles.filter((s) => rarities.has(s.rarity || ''));
  if (squad) rows = rows.filter((s) => (s.squad || '') === squad);
  if (character) rows = rows.filter((s) => s.character === character);
  if (onlySelected) rows = rows.filter((s) => selectedSet.has(s.style_id));
  if (q) rows = rows.filter((s) => styleHaystack(s).includes(q));

  rows.sort((a, b) => {
    const ac = selectedSet.has(a.style_id) ? 0 : 1;
    const bc = selectedSet.has(b.style_id) ? 0 : 1;
    if (ac !== bc) return ac - bc;
    return cmpTuple(
      [...squadSortKey(a.squad || ''), a.character || '', a.style_name || ''],
      [...squadSortKey(b.squad || ''), b.character || '', b.style_name || ''],
    );
  });
  return rows;
}

function removeSelected(styleId) {
  if (!selectedSet.has(styleId)) return;
  selectedSet.delete(styleId);
  const idx = selectedIds.indexOf(styleId);
  if (idx >= 0) selectedIds.splice(idx, 1);
}

function addSelected(styleId) {
  const s = styleById.get(styleId);
  if (!s) return;
  if (selectedSet.has(styleId)) return;
  if (selectedIds.length >= 6) {
    setSelectWarn('6スタイルまで選択できます。入れ替える場合は先に解除してください。');
    return;
  }
  if (isUsedCharacter(s.character)) {
    setSelectWarn(`同一キャラは1枠のみです: ${s.character}`);
    return;
  }
  selectedSet.add(styleId);
  selectedIds.push(styleId);
  setSelectWarn('');
}

function toggleSelected(styleId) {
  if (selectedSet.has(styleId)) {
    removeSelected(styleId);
  } else {
    addSelected(styleId);
  }
  renderPicked();
  renderStyleGrid();
}

function renderPicked() {
  const slots = document.getElementById('pickedSlots');
  const runBtn = document.getElementById('runBtn');
  document.getElementById('pickedCount').textContent = `${selectedIds.length} / 6 選択`;

  slots.innerHTML = '';
  for (let i = 0; i < 6; i += 1) {
    const id = selectedIds[i];
    const item = id ? styleById.get(id) : null;
    if (!item) {
      const empty = document.createElement('div');
      empty.className = 'slot empty';
      empty.textContent = `空きスロット ${i + 1}`;
      slots.appendChild(empty);
      continue;
    }

    const box = document.createElement('div');
    box.className = 'slot';
    box.innerHTML = `
      <div class="slot-cover">${cardImage(item.image_url, item.style_name)}</div>
      <div class="slot-body">
        <div>
          <div class="slot-name">${escapeHtml(item.style_name)}</div>
          <div class="slot-meta">${escapeHtml(item.character)} / ${escapeHtml(item.squad || '-')} / ${escapeHtml(item.rarity || '-')}</div>
        </div>
        <button class="remove-btn" title="解除">×</button>
      </div>
    `;
    box.querySelector('.remove-btn').addEventListener('click', () => {
      removeSelected(item.style_id);
      renderPicked();
      renderStyleGrid();
    });
    slots.appendChild(box);
  }

  runBtn.disabled = selectedIds.length !== 6;
  runBtn.textContent = selectedIds.length === 6 ? 'この6スタイルで計算する' : '6スタイル選択後に計算';
}

function renderStyleGrid() {
  const rows = filteredStyles();
  document.getElementById('candidateMeta').textContent = `候補 ${rows.length}件 / 全${allStyles.length}件`;
  if (!focusedStyleId || !rows.some((x) => x.style_id === focusedStyleId)) {
    focusedStyleId = rows.length ? rows[0].style_id : '';
  }

  const grid = document.getElementById('styleGrid');
  grid.innerHTML = '';
  const fragment = document.createDocumentFragment();

  for (const s of rows) {
    const picked = selectedSet.has(s.style_id);
    const full = selectedIds.length >= 6 && !picked;
    const dupChar = !picked && isUsedCharacter(s.character);
    const disabled = full || dupChar;
    const btnText = picked ? '解除' : (dupChar ? '同キャラ済' : (full ? '満員' : '選択'));

    const card = document.createElement('article');
    const focused = focusedStyleId === s.style_id;
    card.className = `style-card${picked ? ' selected' : ''}${focused ? ' focused' : ''}`;
    card.innerHTML = `
      <div class="cover">${cardImage(s.image_url, s.style_name)}</div>
      <div class="body">
        <div class="style-name">${escapeHtml(s.style_name)}</div>
        <div class="style-line">${escapeHtml(s.character)} / ${escapeHtml(s.squad || '-')}</div>
        <div class="style-actions">
          <span class="badge">${escapeHtml(s.rarity || '-')}</span>
          <button class="pick-btn ${picked ? 'remove' : ''}" ${disabled ? 'disabled' : ''}>${escapeHtml(btnText)}</button>
        </div>
      </div>
    `;
    card.addEventListener('click', () => {
      focusedStyleId = s.style_id;
      renderStyleGrid();
    });
    card.querySelector('.pick-btn').addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleSelected(s.style_id);
    });
    fragment.appendChild(card);
  }
  grid.appendChild(fragment);
  renderStyleDetail();
}

function renderStyleDetail() {
  const root = document.getElementById('styleDetail');
  const style = styleById.get(focusedStyleId);
  if (!style) {
    root.innerHTML = '<h3>スタイル詳細</h3><div class="row">スタイルを選択してください。</div>';
    return;
  }

  const st = style.status || {};
  const noLb = st.no_lb || {};
  const lb3 = st.lb3 || {};
  const eff = st.effective || {};
  const uniq = Array.isArray(style.style_unique_skills) ? style.style_unique_skills : [];
  const shared = Array.isArray(style.character_shared_skills) ? style.character_shared_skills : [];

  const skillLine = (sk) => {
    const w = sk.weapon || '-';
    const e = sk.element || '-';
    const sp = Number(sk.sp || 0).toFixed(0);
    const mul = Number(sk.multiplier || 0).toFixed(2);
    const note = sk.notes ? ` (${sk.notes})` : '';
    return `・${escapeHtml(sk.skill_name)} [${escapeHtml(w)}/${escapeHtml(e)}] SP:${sp} 倍率:${mul}${escapeHtml(note)}`;
  };

  const uniqHtml = uniq.length
    ? uniq.slice(0, 12).map((x) => `<div class="skill-row">${skillLine(x)}</div>`).join('')
    : '<div class="skill-row">・なし</div>';
  const sharedHtml = shared.length
    ? shared.slice(0, 10).map((x) => `<div class="skill-row">${skillLine(x)}</div>`).join('')
    : '<div class="skill-row">・なし</div>';

  root.innerHTML = `
    <h3>スタイル詳細</h3>
    <div class="row"><b>${escapeHtml(style.style_name)}</b> / ${escapeHtml(style.character)} / ${escapeHtml(style.squad || '-')} / ${escapeHtml(style.rarity || '-')}</div>
    <div class="row"><b>実効補正:</b> ATK ${Number(eff.atk||0).toFixed(2)} / DEF ${Number(eff.def||0).toFixed(2)} / クリ威力 ${Number(eff.crit_damage||0).toFixed(2)} / クリ率 ${Number(eff.crit_rate||0).toFixed(2)} / 破壊率 ${Number(eff.destruction||0).toFixed(2)}</div>
    <div class="row"><b>無凸:</b> ATK ${Number(noLb.atk||0).toFixed(2)} (${escapeHtml(noLb.atk_scope||'-')}) / DEF ${Number(noLb.def||0).toFixed(2)} (${escapeHtml(noLb.def_scope||'-')})</div>
    <div class="row"><b>3凸:</b> ATK ${Number(lb3.atk||0).toFixed(2)} (${escapeHtml(lb3.atk_scope||'-')}) / DEF ${Number(lb3.def||0).toFixed(2)} (${escapeHtml(lb3.def_scope||'-')})</div>
    <div class="row"><b>パッシブ:</b> 無凸=${escapeHtml(st.passive_no_lb||'-')} / 3凸=${escapeHtml(st.passive_lb3||'-')}</div>
    <div class="row"><b>固有スキル (${Number(style.style_unique_skill_count||uniq.length)}件):</b></div>
    ${uniqHtml}
    <div class="row"><b>共通スキル (${Number(style.character_shared_skill_count||shared.length)}件):</b></div>
    ${sharedHtml}
  `;
}

function renderEnemySelect() {
  const select = document.getElementById('enemySelect');
  select.innerHTML = '<option value="">未指定</option>';
  for (const enemy of allEnemies) {
    const opt = document.createElement('option');
    opt.value = enemy.name;
    opt.textContent = `${enemy.name} (${enemy.category || '-'})`;
    select.appendChild(opt);
  }
}

function refreshFilters() {
  const squadSelect = document.getElementById('squadFilter');
  const charSelect = document.getElementById('charFilter');
  const prevSquad = squadSelect.value || '';
  const prevChar = charSelect.value || '';

  const squads = Array.from(new Set(allStyles.map((s) => s.squad || '').filter(Boolean)));
  squads.sort((a, b) => cmpTuple(squadSortKey(a), squadSortKey(b)));
  squadSelect.innerHTML = '<option value="">全ての組</option>';
  for (const squad of squads) {
    const opt = document.createElement('option');
    opt.value = squad;
    opt.textContent = squad;
    squadSelect.appendChild(opt);
  }
  if (squads.includes(prevSquad)) squadSelect.value = prevSquad;

  const selectedSquad = squadSelect.value || '';
  let chars = allStyles;
  if (selectedSquad) chars = chars.filter((s) => (s.squad || '') === selectedSquad);
  const uniqueChars = Array.from(new Set(chars.map((s) => s.character || '').filter(Boolean)));
  uniqueChars.sort((a, b) => a.localeCompare(b, 'ja'));

  charSelect.innerHTML = '<option value="">全てのキャラ</option>';
  for (const ch of uniqueChars) {
    const opt = document.createElement('option');
    opt.value = ch;
    opt.textContent = ch;
    charSelect.appendChild(opt);
  }
  if (uniqueChars.includes(prevChar)) charSelect.value = prevChar;
}

function renderSummary(result) {
  const summary = document.getElementById('summary');
  const enemyName = result.enemy ? result.enemy.name : '未指定';
  summary.style.display = 'grid';
  summary.innerHTML = `
    <div class="metric">敵<b>${escapeHtml(enemyName)}</b></div>
    <div class="metric">推定ダメージ<b>${Number(result.estimated_damage || 0).toLocaleString()}</b></div>
    <div class="metric">相対スコア<b>x${Number(result.relative_score || 0).toFixed(2)}</b></div>
  `;
}

function buildStrategyText(webInfo) {
  if (!webInfo) return '';
  const parts = [];
  if (webInfo.tier_overall) parts.push(`総合 Tier${webInfo.tier_overall}`);
  if (webInfo.tier_roles) parts.push(webInfo.tier_roles);
  if (!parts.length) return '';
  return `<div class="strategy">攻略サイト参考: ${escapeHtml(parts.join(' / '))}</div>`;
}

function renderResult(result) {
  renderSummary(result);
  document.getElementById('result').style.display = 'block';

  const cards = document.getElementById('teamCards');
  cards.innerHTML = '';
  for (const m of result.team || []) {
    const info = m.web_info || null;
    const image = info && info.image_url
      ? `<img src="${escapeHtml(info.image_url)}" alt="${escapeHtml(m.style_name)}" loading="lazy" />`
      : `<img alt="no image" />`;
    const squad = info && info.squad ? info.squad : '-';
    const src = info && info.page_url
      ? `<a href="${escapeHtml(info.page_url)}" target="_blank" rel="noopener">Game8記事</a>`
      : '';
    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      ${image}
      <div class="body">
        <h3>${escapeHtml(m.style_name)}</h3>
        <div><span class="chip">${escapeHtml(m.role)}</span><span class="chip">score ${Number(m.total_score || 0).toFixed(2)}</span></div>
        <p><b>キャラ:</b> ${escapeHtml(m.character || '-')}</p>
        <p><b>所属組:</b> ${escapeHtml(squad)}</p>
        <p><b>DPブレイク候補:</b> ${escapeHtml(m.breaker_skill || '-')}</p>
        <p><b>フィニッシャー:</b> ${escapeHtml(m.finisher_skill || '-')}</p>
        ${buildStrategyText(info)}
        <p>${src}</p>
      </div>
    `;
    cards.appendChild(card);
  }

  const turn = document.getElementById('turnPlan');
  turn.innerHTML = '';
  for (const row of (result.turn_plan || [])) {
    const li = document.createElement('li');
    li.textContent = row;
    turn.appendChild(li);
  }

  const warns = [];
  if (result.unmatched_owned && result.unmatched_owned.length) {
    warns.push(`未一致(手持ち): ${result.unmatched_owned.join(', ')}`);
  }
  if (result.unmatched_wanted && result.unmatched_wanted.length) {
    warns.push(`未一致(使いたい): ${result.unmatched_wanted.join(', ')}`);
  }
  document.getElementById('warn').textContent = warns.join(' / ');
}

function clearPicked() {
  selectedSet.clear();
  selectedIds.splice(0, selectedIds.length);
  setSelectWarn('');
  renderPicked();
  renderStyleGrid();
}

function autoFillFromFiltered() {
  const rows = filteredStyles();
  let added = 0;
  for (const s of rows) {
    if (selectedIds.length >= 6) break;
    if (selectedSet.has(s.style_id)) continue;
    if (isUsedCharacter(s.character)) continue;
    selectedSet.add(s.style_id);
    selectedIds.push(s.style_id);
    added += 1;
  }
  if (added === 0) {
    setSelectWarn('絞り込み条件で追加できるスタイルがありません。');
  } else {
    setSelectWarn('');
  }
  renderPicked();
  renderStyleGrid();
}

async function loadOptions() {
  const res = await fetch('/api/options');
  if (!res.ok) throw new Error('option load failed');
  const payload = await res.json();
  allStyles = payload.styles || [];
  allEnemies = payload.enemies || [];

  styleById.clear();
  for (const raw of allStyles) {
    const item = { ...raw };
    if (!item.style_id) item.style_id = `${item.character}::${item.style_name}`;
    styleById.set(item.style_id, item);
  }
  allStyles = Array.from(styleById.values());

  refreshFilters();
  renderEnemySelect();
  renderPicked();
  renderStyleGrid();

  document.getElementById('styleSearch').addEventListener('input', renderStyleGrid);
  document.getElementById('squadFilter').addEventListener('change', () => {
    refreshFilters();
    renderStyleGrid();
  });
  document.getElementById('charFilter').addEventListener('change', renderStyleGrid);
  document.querySelectorAll('.rarityFilter').forEach((el) => el.addEventListener('change', renderStyleGrid));
  document.getElementById('selectedOnly').addEventListener('change', renderStyleGrid);
  document.getElementById('clearPickedBtn').addEventListener('click', clearPicked);
  document.getElementById('autoFillBtn').addEventListener('click', autoFillFromFiltered);
}

async function runRecommend() {
  if (selectedIds.length !== 6) {
    setSelectWarn('先に6スタイルを選択してください。');
    return;
  }

  const btn = document.getElementById('runBtn');
  btn.disabled = true;
  btn.textContent = '計算中...';
  document.getElementById('warn').textContent = '';
  setSelectWarn('');

  try {
    const picked = selectedItems();
    const styleNames = picked.map((s) => s.style_name);
    const req = {
      owned: styleNames,
      wanted: styleNames,
      enemy: document.getElementById('enemySelect').value || '',
      weapon: document.getElementById('weaponSelect').value || '',
      element: document.getElementById('elementSelect').value || '',
      fetch_images: document.getElementById('fetchImages').checked,
      team_size: 6,
    };

    const res = await fetch('/api/recommend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
    const payload = await res.json();
    if (!res.ok || payload.error) {
      throw new Error(payload.error || 'recommend failed');
    }
    renderResult(payload.result);
  } catch (err) {
    document.getElementById('warn').textContent = `エラー: ${err.message}`;
  } finally {
    btn.disabled = false;
    btn.textContent = selectedIds.length === 6 ? 'この6スタイルで計算する' : '6スタイル選択後に計算';
  }
}

document.getElementById('runBtn').addEventListener('click', runRecommend);
loadOptions().catch((err) => {
  document.getElementById('warn').textContent = `初期化失敗: ${err.message}`;
});
</script>
</body>
</html>
""".strip()


def run_web_app(
    data: AdvisorData,
    host: str = "127.0.0.1",
    port: int = 8787,
    cache_path: str = "data/image_cache.json",
    style_db_path: str = "data/style_database.json",
) -> None:
    advisor = BattleAdvisor(data.styles, data.skills, data.enemies, data.knowledge)
    resolver = StyleWebInfoResolver(cache_path)
    options = _options_payload(data, style_db_path=style_db_path)

    class Handler(BaseHTTPRequestHandler):
        def _send_json(self, payload: dict[str, Any], code: int = 200) -> None:
            blob = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(blob)))
            self.end_headers()
            self.wfile.write(blob)

        def _send_html(self, text: str, code: int = 200) -> None:
            blob = text.encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(blob)))
            self.end_headers()
            self.wfile.write(blob)

        def do_GET(self) -> None:  # noqa: N802
            path = urlparse(self.path).path
            if path == "/":
                self._send_html(_ui_html())
                return
            if path == "/api/options":
                self._send_json(options)
                return
            self._send_json({"error": "not found"}, code=404)

        def do_POST(self) -> None:  # noqa: N802
            path = urlparse(self.path).path
            if path != "/api/recommend":
                self._send_json({"error": "not found"}, code=404)
                return

            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                length = 0
            raw = self.rfile.read(length) if length > 0 else b"{}"

            try:
                req = json.loads(raw.decode("utf-8"))
            except Exception:
                self._send_json({"error": "invalid json"}, code=400)
                return

            owned = req.get("owned") or []
            wanted = req.get("wanted") or []
            enemy = str(req.get("enemy") or "")
            weapon = str(req.get("weapon") or "")
            element = str(req.get("element") or "")
            fetch_images = bool(req.get("fetch_images", True))

            if isinstance(owned, str):
                owned = [owned]
            if isinstance(wanted, str):
                wanted = [wanted]

            try:
                team_size = int(req.get("team_size", 6))
            except Exception:
                team_size = 6
            team_size = max(1, min(6, team_size))

            try:
                plan = advisor.recommend(
                    owned_queries=[str(x) for x in owned],
                    wanted_queries=[str(x) for x in wanted],
                    enemy_name=enemy,
                    preferred_weapon=weapon,
                    preferred_element=element,
                    team_size=team_size,
                )

                web_infos: dict[str, StyleWebInfo] = {}
                if fetch_images:
                    for sc in plan.team:
                        info = resolver.lookup(sc.style.style_name, sc.style.character)
                        if info:
                            web_infos[sc.style.style_name] = info

                self._send_json({"result": _json_plan_payload(plan, web_infos)})
            except Exception as exc:  # pragma: no cover - runtime guard
                self._send_json({"error": str(exc)}, code=500)

        def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
            # Keep console clean
            return

    server = ThreadingHTTPServer((host, port), Handler)
    print(f"HBR advisor UI: http://{host}:{port}")
    print("Ctrl+C で停止")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
