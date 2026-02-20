from __future__ import annotations

import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Optional
import unicodedata

from .data_store import AdvisorData
from .models import Skill, Style
from .utils import clean_style_raw
from .web_lookup import StyleWebInfoResolver


def _squad_sort_key(squad: str) -> tuple[int, int, str]:
    text = (squad or "").strip()
    if not text:
        return (9, 999, "")
    m = re.fullmatch(r"(\d+)([A-Z])", text)
    if m:
        return (0, int(m.group(1)), m.group(2))
    if text == "司令部":
        return (1, 0, text)
    if text == "AB!":
        return (2, 0, text)
    return (3, 0, text)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _character_id(character: str) -> str:
    return f"character::{character}"


def _squad_id(squad: str) -> str:
    return f"squad::{squad}"


def _style_title(style_name: str) -> str:
    m = re.search(r"\(([^()]*)\)$", style_name or "")
    if m:
        return m.group(1).strip()
    return (style_name or "").strip()


def _normalize_text(text: str) -> str:
    s = unicodedata.normalize("NFKC", text or "")
    s = s.replace(" ", "").replace("　", "")
    return s.lower().strip()


def _pick_index_style_card(
    style_name: str, style_cards: list[dict[str, str]]
) -> Optional[dict[str, str]]:
    if not style_cards:
        return None

    wanted = _normalize_text(_style_title(style_name))
    if not wanted:
        return None

    exact: dict[str, dict[str, str]] = {}
    for card in style_cards:
        title = _normalize_text(str(card.get("title") or ""))
        if title and title not in exact:
            exact[title] = card

    if wanted in exact:
        return exact[wanted]

    scored: list[tuple[float, dict[str, str]]] = []
    for card in style_cards:
        title = _normalize_text(str(card.get("title") or ""))
        if not title:
            continue
        score = SequenceMatcher(None, wanted, title).ratio()
        scored.append((score, card))

    if not scored:
        return None

    scored.sort(key=lambda x: x[0], reverse=True)
    best_score, best_card = scored[0]
    second_score = scored[1][0] if len(scored) > 1 else 0.0

    # Allow small naming variations/typos while avoiding ambiguous picks.
    if best_score >= 0.78 and (best_score - second_score) >= 0.08:
        return best_card

    return None


def _skill_payload(skill: Skill) -> dict[str, Any]:
    per_hit = list(skill.per_hit_multipliers or [])
    return {
        "skill_name": skill.skill_name,
        "weapon": skill.weapon,
        "element": skill.element,
        "target": skill.target,
        "hit": skill.hit,
        "sp": skill.sp,
        "multiplier": skill.multiplier,
        "per_hit_multipliers": per_hit,
        "notes": skill.notes,
        "basic_flag": skill.basic_flag,
        "owner_style_hint": skill.owner_style_hint,
    }


def _style_status_payload(style: Style) -> dict[str, Any]:
    return {
        "no_lb": {
            "atk": style.attack_bonus_no_lb,
            "def": style.def_bonus_no_lb,
            "crit_damage": style.crit_damage_no_lb,
            "crit_rate": style.crit_rate_no_lb,
            "destruction": style.destruction_no_lb,
            "atk_scope": style.attack_scope_no_lb,
            "def_scope": style.def_scope_no_lb,
            "crit_damage_scope": style.crit_damage_scope_no_lb,
            "crit_rate_scope": style.crit_rate_scope_no_lb,
            "destruction_scope": style.destruction_scope_no_lb,
        },
        "lb3": {
            "atk": style.attack_bonus_lb3,
            "def": style.def_bonus_lb3,
            "crit_damage": style.crit_damage_lb3,
            "crit_rate": style.crit_rate_lb3,
            "destruction": style.destruction_lb3,
            "atk_scope": style.attack_scope_lb3,
            "def_scope": style.def_scope_lb3,
            "crit_damage_scope": style.crit_damage_scope_lb3,
            "crit_rate_scope": style.crit_rate_scope_lb3,
            "destruction_scope": style.destruction_scope_lb3,
        },
        "effective": {
            "atk": style.attack_bonus,
            "def": style.def_bonus,
            "crit_damage": style.crit_damage_bonus,
            "crit_rate": style.crit_rate_bonus,
            "destruction": style.destruction_bonus,
        },
        "element_tag": style.element_tag,
        "jewel_type": style.jewel_type,
        "passive_no_lb": style.passive_no_lb,
        "passive_lb3": style.passive_lb3,
    }


def _resolve_style_skills(
    style: Style, skills_by_character: dict[str, list[Skill]]
) -> tuple[list[Skill], list[Skill]]:
    char_skills = list(skills_by_character.get(style.character, []))
    if not char_skills:
        return [], []

    raw_name = clean_style_raw(style.style_raw)
    subtitle = _style_title(style.style_name)
    candidates = [raw_name, subtitle, style.style_name]
    candidate_norm = {
        _normalize_text(x)
        for x in candidates
        if x and len(_normalize_text(x)) >= 4
    }

    char_norm = _normalize_text(style.character)
    unique: list[Skill] = []
    shared: list[Skill] = []
    seen_unique: set[str] = set()
    seen_shared: set[str] = set()

    for sk in char_skills:
        hint = (sk.owner_style_hint or "").strip()
        hint_norm = _normalize_text(hint)

        is_specific = bool(
            hint_norm
            and any(token in hint_norm for token in candidate_norm)
        )
        is_shared = bool(hint_norm and hint_norm == char_norm)

        if is_specific:
            if sk.skill_name not in seen_unique:
                unique.append(sk)
                seen_unique.add(sk.skill_name)
            continue
        if is_shared:
            if sk.skill_name not in seen_shared:
                shared.append(sk)
                seen_shared.add(sk.skill_name)

    unique.sort(key=lambda x: (x.sp, x.skill_name))
    shared.sort(key=lambda x: (x.sp, x.skill_name))
    return unique, shared


def build_style_database(
    data: AdvisorData,
    cache_path: str | Path,
    fetch_web: bool = True,
    fetch_style_images: bool = False,
    style_fetch_limit: int = 0,
) -> dict[str, Any]:
    resolver = StyleWebInfoResolver(cache_path)

    styles = sorted(data.styles, key=lambda s: (s.character, s.style_name))
    characters = sorted({s.character for s in styles})
    index_styles_by_character: dict[str, list[dict[str, str]]] = {}
    skills_by_character: dict[str, list[Skill]] = defaultdict(list)
    for sk in data.skills:
        skills_by_character[sk.owner_character].append(sk)

    # 1) Character metadata: squad + representative image.
    char_meta: dict[str, dict[str, str]] = {
        ch: {
            "squad": "",
            "image_url": "",
            "page_url": "",
            "source": "",
        }
        for ch in characters
    }

    # Seed from existing style cache.
    for st in styles:
        cinfo = resolver.get_cached_style_info(st.style_name, st.character)
        if not cinfo:
            continue
        meta = char_meta[st.character]
        if not meta["squad"] and cinfo.squad:
            meta["squad"] = cinfo.squad
        if not meta["image_url"] and cinfo.image_url:
            meta["image_url"] = cinfo.image_url
            meta["page_url"] = cinfo.page_url
            meta["source"] = cinfo.source

    # Resolve from Game8 character index (single fetch for all squads/characters/styles).
    if fetch_web:
        index_payload = resolver.load_character_index()
        index_characters = index_payload.get("characters", {})
        if isinstance(index_characters, dict):
            for ch in characters:
                entry = index_characters.get(ch)
                if not isinstance(entry, dict):
                    continue
                meta = char_meta[ch]
                if entry.get("squad"):
                    meta["squad"] = str(entry["squad"])
                if entry.get("image_url"):
                    meta["image_url"] = str(entry["image_url"])
                    meta["page_url"] = str(entry.get("page_url") or "")
                    meta["source"] = str(entry.get("source") or "Game8")
                styles_in_index = entry.get("styles")
                if isinstance(styles_in_index, list):
                    index_styles_by_character[ch] = [
                        {
                            "title": str(x.get("title") or ""),
                            "page_url": str(x.get("page_url") or ""),
                            "image_url": str(x.get("image_url") or ""),
                            "source": str(x.get("source") or "Game8"),
                        }
                        for x in styles_in_index
                        if isinstance(x, dict)
                    ]

        # Fallback per character if index did not provide enough metadata.
        for ch in characters:
            meta = char_meta[ch]
            if meta.get("squad") and meta.get("image_url"):
                continue
            info = resolver.lookup_character(ch)
            if not info:
                continue
            if info.squad:
                meta["squad"] = info.squad
            if info.image_url:
                meta["image_url"] = info.image_url
                meta["page_url"] = info.page_url
                meta["source"] = info.source

    # Optional: resolve style-specific pages/images for richer style cards.
    if fetch_style_images:
        fetched = 0
        for st in styles:
            if style_fetch_limit > 0 and fetched >= style_fetch_limit:
                break
            _ = resolver.lookup(st.style_name, st.character)
            fetched += 1

    # 2) Build style entries.
    style_rows: list[dict[str, Any]] = []
    char_to_styles: dict[str, list[str]] = defaultdict(list)
    squad_to_characters: dict[str, set[str]] = defaultdict(set)

    for st in styles:
        style_info = resolver.get_cached_style_info(st.style_name, st.character)
        meta = char_meta.get(st.character, {})
        index_card = _pick_index_style_card(
            st.style_name, index_styles_by_character.get(st.character, [])
        )

        squad = ""
        if meta.get("squad"):
            squad = str(meta["squad"])
        elif style_info and style_info.squad:
            squad = style_info.squad

        image_url = ""
        page_url = ""
        source = ""
        tier_overall = ""
        tier_roles = ""

        if style_info:
            image_url = style_info.image_url or ""
            page_url = style_info.page_url or ""
            source = style_info.source or ""
            tier_overall = style_info.tier_overall or ""
            tier_roles = style_info.tier_roles or ""

        if not image_url and index_card:
            image_url = str(index_card.get("image_url") or "")
            page_url = page_url or str(index_card.get("page_url") or "")
            source = source or str(index_card.get("source") or "Game8")

        if not image_url and meta.get("image_url"):
            image_url = str(meta["image_url"])
            page_url = page_url or str(meta.get("page_url") or "")
            source = source or str(meta.get("source") or "")

        style_id = f"{st.character}::{st.style_name}"
        character_id = _character_id(st.character)
        squad_ref = _squad_id(squad) if squad else ""
        style_unique_skills, character_shared_skills = _resolve_style_skills(
            st, skills_by_character
        )
        row = {
            "style_id": style_id,
            "character_id": character_id,
            "squad_id": squad_ref,
            "style_name": st.style_name,
            "character": st.character,
            "squad": squad,
            "rarity": st.rarity,
            "style_raw": st.style_raw,
            "alias": st.alias,
            "element_tag": st.element_tag,
            "passive_no_lb": st.passive_no_lb,
            "passive_lb3": st.passive_lb3,
            "attack_bonus": st.attack_bonus,
            "crit_damage_bonus": st.crit_damage_bonus,
            "crit_rate_bonus": st.crit_rate_bonus,
            "destruction_bonus": st.destruction_bonus,
            "image_url": image_url,
            "page_url": page_url,
            "source": source,
            "tier_overall": tier_overall,
            "tier_roles": tier_roles,
            "status": _style_status_payload(st),
            "style_unique_skill_count": len(style_unique_skills),
            "character_shared_skill_count": len(character_shared_skills),
            "style_unique_skills": [_skill_payload(x) for x in style_unique_skills],
            "character_shared_skills": [_skill_payload(x) for x in character_shared_skills],
        }
        style_rows.append(row)

        char_to_styles[st.character].append(st.style_name)
        if squad:
            squad_to_characters[squad].add(st.character)

    # 3) Character rows.
    char_rows: list[dict[str, Any]] = []
    for ch in characters:
        meta = char_meta.get(ch, {})
        squad = str(meta.get("squad", "") or "")
        if squad:
            squad_to_characters[squad].add(ch)
        char_rows.append(
            {
                "character_id": _character_id(ch),
                "squad_id": _squad_id(squad) if squad else "",
                "character": ch,
                "squad": squad,
                "image_url": meta.get("image_url", ""),
                "page_url": meta.get("page_url", ""),
                "source": meta.get("source", ""),
                "style_count": len(char_to_styles.get(ch, [])),
                "styles": sorted(char_to_styles.get(ch, [])),
            }
        )

    char_rows.sort(key=lambda x: (_squad_sort_key(x.get("squad", "")), x["character"]))

    # 4) Squad rows.
    squad_rows: list[dict[str, Any]] = []
    for squad, chars in squad_to_characters.items():
        squad_rows.append(
            {
                "squad_id": _squad_id(squad),
                "squad": squad,
                "character_count": len(chars),
                "characters": sorted(chars),
            }
        )
    squad_rows.sort(key=lambda x: _squad_sort_key(x["squad"]))

    payload = {
        "meta": {
            "generated_at": _now_iso(),
            "style_count": len(style_rows),
            "character_count": len(char_rows),
            "squad_count": len(squad_rows),
            "source": "HBR計算機 + Game8",
            "tool_version": data.knowledge.get("version", {}).get("tool_version", ""),
        },
        "squads": squad_rows,
        "characters": char_rows,
        "styles": style_rows,
    }
    return payload


def write_style_database_json(payload: dict[str, Any], out_path: str | Path) -> None:
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_style_database_html(payload: dict[str, Any], out_path: str | Path) -> None:
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    # Inline payload for single-file portability.
    payload_js = json.dumps(payload, ensure_ascii=False)

    html = f"""
<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>HBR 全スタイルDB</title>
  <style>
    :root {{
      --bg: #f1efe8;
      --ink: #1f2023;
      --muted: #5d6068;
      --line: #d2ccbd;
      --panel: #fffef9;
      --accent: #0d6e66;
      --accent-2: #9f3414;
      --chip: #eef7f5;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      color: var(--ink);
      font-family: "Hiragino Sans", "Yu Gothic", sans-serif;
      background:
        radial-gradient(1100px 700px at -10% -20%, #fff8e8 0%, transparent 55%),
        radial-gradient(900px 500px at 120% 0%, #dff2ef 0%, transparent 45%),
        var(--bg);
    }}
    .shell {{
      max-width: 1480px;
      margin: 0 auto;
      padding: 18px;
    }}
    h1 {{ margin: 0; font-size: 30px; letter-spacing: .02em; }}
    .sub {{ color: var(--muted); margin-top: 8px; font-size: 14px; }}
    .meta {{
      margin-top: 12px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }}
    .meta .tag {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 999px;
      font-size: 12px;
      padding: 4px 10px;
    }}
    .layout {{
      margin-top: 14px;
      display: grid;
      grid-template-columns: 340px minmax(0,1fr);
      gap: 12px;
    }}
    .panel {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 12px;
    }}
    .label {{ font-size: 12px; font-weight: 700; color: #30343a; margin-bottom: 4px; }}
    input, select {{
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 8px 10px;
      background: #fff;
      color: var(--ink);
      margin-bottom: 8px;
    }}
    .checkbox-row {{
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      font-size: 13px;
    }}
    .squad-map {{
      margin-top: 8px;
      max-height: 280px;
      overflow: auto;
      border-top: 1px dashed var(--line);
      padding-top: 8px;
    }}
    .squad-item {{ margin-bottom: 10px; }}
    .squad-name {{ font-weight: 700; font-size: 13px; color: #21343a; }}
    .char-chip {{
      display: inline-block;
      margin: 5px 5px 0 0;
      background: var(--chip);
      border: 1px solid #cfe6df;
      padding: 3px 8px;
      border-radius: 999px;
      font-size: 12px;
      cursor: pointer;
    }}
    .result-header {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }}
    .count {{ font-size: 13px; color: var(--muted); }}
    .cards {{
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 10px;
    }}
    .card {{
      border: 1px solid var(--line);
      border-radius: 12px;
      background: #fff;
      overflow: hidden;
      cursor: pointer;
    }}
    .cover {{
      width: 100%;
      height: 170px;
      background: linear-gradient(135deg, #d6dce5, #e7d9cc);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #2f3643;
      font-size: 30px;
      font-weight: 700;
      letter-spacing: 0.05em;
    }}
    .cover img {{ width: 100%; height: 100%; object-fit: cover; display:block; }}
    .body {{ padding: 9px 10px 10px; }}
    .name {{ font-size: 14px; font-weight: 700; line-height: 1.35; }}
    .line {{ font-size: 12px; color: #414752; margin-top: 5px; }}
    .badge {{
      display: inline-block;
      font-size: 11px;
      margin-right: 6px;
      margin-top: 5px;
      border-radius: 999px;
      border: 1px solid #d5dfe6;
      background: #f4f8fb;
      padding: 2px 7px;
    }}
    .tier {{
      margin-top: 6px;
      font-size: 11px;
      color: #2e4a43;
      background: #e8f4f1;
      border: 1px solid #c8e3dc;
      border-radius: 7px;
      padding: 4px 6px;
      line-height: 1.35;
    }}
    .detail {{
      margin-top: 12px;
      border-top: 1px dashed var(--line);
      padding-top: 10px;
    }}
    .detail h3 {{ margin: 0 0 8px; font-size: 15px; }}
    .detail .row {{ font-size: 12px; margin-bottom: 6px; }}
    .detail a {{ color: var(--accent); text-decoration: none; }}
    @media (max-width: 1080px) {{
      .layout {{ grid-template-columns: 1fr; }}
      .squad-map {{ max-height: 190px; }}
    }}
  </style>
</head>
<body>
  <div class="shell">
    <h1>HBR 全スタイル グラフィカルDB</h1>
    <div class="sub">組・キャラ・スタイルを全件で紐付け。検索/フィルタしながら図鑑として確認できます。</div>
    <div class="meta" id="meta"></div>

    <div class="layout">
      <section class="panel">
        <div class="label">検索（スタイル/キャラ）</div>
        <input id="search" type="text" placeholder="例: 佐月 / しもべ" />

        <div class="label">部隊</div>
        <select id="squadFilter"></select>

        <div class="label">キャラクター</div>
        <select id="charFilter"></select>

        <div class="label">レアリティ</div>
        <div class="checkbox-row">
          <label><input type="checkbox" class="rarity" value="SS" checked /> SS</label>
          <label><input type="checkbox" class="rarity" value="S" checked /> S</label>
          <label><input type="checkbox" class="rarity" value="A" checked /> A</label>
        </div>

        <div class="squad-map" id="squadMap"></div>

        <div class="detail" id="detail"></div>
      </section>

      <section class="panel">
        <div class="result-header">
          <div class="count" id="count"></div>
        </div>
        <div class="cards" id="cards"></div>
      </section>
    </div>
  </div>

<script>
const DB = {payload_js};
let current = DB.styles.slice();
let selectedStyleId = '';

function esc(s) {{
  return String(s || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}}

function initMeta() {{
  const meta = document.getElementById('meta');
  const m = DB.meta || {{}};
  meta.innerHTML = `
    <span class="tag">style: ${{m.style_count || 0}}</span>
    <span class="tag">character: ${{m.character_count || 0}}</span>
    <span class="tag">squad: ${{m.squad_count || 0}}</span>
    <span class="tag">tool: ${{esc(m.tool_version || '-')}}</span>
    <span class="tag">generated: ${{esc(m.generated_at || '-')}}</span>
  `;
}}

function initFilters() {{
  const squadSel = document.getElementById('squadFilter');
  const charSel = document.getElementById('charFilter');

  squadSel.innerHTML = '<option value="">すべて</option>';
  for (const s of DB.squads || []) {{
    const opt = document.createElement('option');
    opt.value = s.squad || '';
    opt.textContent = `${{s.squad || '(未設定)'}} (${{s.character_count}})`;
    squadSel.appendChild(opt);
  }}

  charSel.innerHTML = '<option value="">すべて</option>';
  for (const c of DB.characters || []) {{
    const opt = document.createElement('option');
    opt.value = c.character;
    opt.textContent = `${{c.character}} (${{c.squad || '-'}})`;
    charSel.appendChild(opt);
  }}
}}

function renderSquadMap() {{
  const root = document.getElementById('squadMap');
  root.innerHTML = '';
  for (const s of DB.squads || []) {{
    const box = document.createElement('div');
    box.className = 'squad-item';
    const name = document.createElement('div');
    name.className = 'squad-name';
    name.textContent = `${{s.squad || '(未設定)'}}`;
    box.appendChild(name);

    for (const ch of s.characters || []) {{
      const chip = document.createElement('span');
      chip.className = 'char-chip';
      chip.textContent = ch;
      chip.onclick = () => {{
        document.getElementById('charFilter').value = ch;
        applyFilter();
      }};
      box.appendChild(chip);
    }}

    root.appendChild(box);
  }}
}}

function raritySet() {{
  const vals = new Set();
  document.querySelectorAll('.rarity').forEach((x) => {{ if (x.checked) vals.add(x.value); }});
  return vals;
}}

function applyFilter() {{
  const q = document.getElementById('search').value.trim();
  const squad = document.getElementById('squadFilter').value;
  const ch = document.getElementById('charFilter').value;
  const rarity = raritySet();

  current = (DB.styles || []).filter((s) => {{
    if (!rarity.has(s.rarity)) return false;
    if (squad && (s.squad || '') !== squad) return false;
    if (ch && s.character !== ch) return false;
    if (q) {{
      const hay = `${{s.style_name}} ${{s.character}} ${{s.alias || ''}} ${{s.style_raw || ''}}`;
      if (!hay.includes(q)) return false;
    }}
    return true;
  }});

  renderCards();
  renderDetail();
}}

function cardCover(style) {{
  if (style.image_url) {{
    return `<img src="${{esc(style.image_url)}}" alt="${{esc(style.style_name)}}" />`;
  }}
  const txt = (style.character || '?').slice(0, 2);
  return esc(txt);
}}

function renderCards() {{
  const cards = document.getElementById('cards');
  const count = document.getElementById('count');
  count.textContent = `表示: ${{current.length}} / 全体: ${{(DB.styles || []).length}}`;

  cards.innerHTML = '';
  for (const s of current) {{
    const tierParts = [];
    if (s.tier_overall) tierParts.push(`総合 Tier${{s.tier_overall}}`);
    if (s.tier_roles) tierParts.push(s.tier_roles);
    const tierHtml = tierParts.length
      ? `<div class="tier">${{esc(tierParts.join(' / '))}}</div>`
      : '';

    const div = document.createElement('article');
    div.className = 'card';
    div.onclick = () => {{ selectedStyleId = s.style_id; renderDetail(); }};
    div.innerHTML = `
      <div class="cover">${{cardCover(s)}}</div>
      <div class="body">
        <div class="name">${{esc(s.style_name)}}</div>
        <div class="line">${{esc(s.character)}} / ${{esc(s.squad || '-')}}</div>
        <span class="badge">${{esc(s.rarity)}}</span>
        <span class="badge">ATK+${{Number(s.attack_bonus || 0).toFixed(2)}}</span>
        <span class="badge">DEF+${{Number(s.status?.effective?.def || 0).toFixed(2)}}</span>
        <span class="badge">CRD+${{Number(s.crit_damage_bonus || 0).toFixed(2)}}</span>
        <span class="badge">固有${{Number(s.style_unique_skill_count || 0)}}</span>
        ${{tierHtml}}
      </div>
    `;
    cards.appendChild(div);
  }}
}}

function renderDetail() {{
  const root = document.getElementById('detail');
  const style = current.find((x) => x.style_id === selectedStyleId) || current[0];
  if (!style) {{
    root.innerHTML = '<h3>詳細</h3><div class="row">データがありません</div>';
    return;
  }}

  const linked = (DB.styles || []).filter((x) => x.character === style.character).map((x) => x.style_name);
  const source = style.page_url
    ? `<a href="${{esc(style.page_url)}}" target="_blank" rel="noopener">攻略ページ</a>`
    : '-';
  const st = style.status || {{}};
  const noLb = st.no_lb || {{}};
  const lb3 = st.lb3 || {{}};
  const eff = st.effective || {{}};

  const fmtSkill = (x) => {{
    const perHit = (x.per_hit_multipliers && x.per_hit_multipliers.length)
      ? ` / hit内訳:${{x.per_hit_multipliers.map((v) => Number(v).toFixed(2)).join(',')}}`
      : '';
    return `${{esc(x.skill_name)}} [${{esc(x.weapon||'-')}}/${{esc(x.element||'-')}}] SP:${{Number(x.sp||0).toFixed(0)}} 倍率:${{Number(x.multiplier||0).toFixed(2)}}${{perHit}}`;
  }};
  const uniqueSkills = (style.style_unique_skills || []).map((x) => `<div class="row">・${{fmtSkill(x)}}</div>`).join('');
  const sharedSkills = (style.character_shared_skills || []).map((x) => `<div class="row">・${{fmtSkill(x)}}</div>`).join('');

  root.innerHTML = `
    <h3>詳細</h3>
    <div class="row"><b>スタイル:</b> ${{esc(style.style_name)}}</div>
    <div class="row"><b>キャラ:</b> ${{esc(style.character)}}</div>
    <div class="row"><b>部隊:</b> ${{esc(style.squad || '-')}}</div>
    <div class="row"><b>レア:</b> ${{esc(style.rarity)}}</div>
    <div class="row"><b>補正(実効):</b> ATK ${{Number(eff.atk||0).toFixed(2)}} / DEF ${{Number(eff.def||0).toFixed(2)}} / クリ威力 ${{Number(eff.crit_damage||0).toFixed(2)}} / クリ率 ${{Number(eff.crit_rate||0).toFixed(2)}} / 破壊率 ${{Number(eff.destruction||0).toFixed(2)}}</div>
    <div class="row"><b>無凸:</b> ATK ${{Number(noLb.atk||0).toFixed(2)}}(${{esc(noLb.atk_scope||'-')}}) / DEF ${{Number(noLb.def||0).toFixed(2)}}(${{esc(noLb.def_scope||'-')}}) / クリ威力 ${{Number(noLb.crit_damage||0).toFixed(2)}} / クリ率 ${{Number(noLb.crit_rate||0).toFixed(2)}} / 破壊率 ${{Number(noLb.destruction||0).toFixed(2)}}</div>
    <div class="row"><b>3凸:</b> ATK ${{Number(lb3.atk||0).toFixed(2)}}(${{esc(lb3.atk_scope||'-')}}) / DEF ${{Number(lb3.def||0).toFixed(2)}}(${{esc(lb3.def_scope||'-')}}) / クリ威力 ${{Number(lb3.crit_damage||0).toFixed(2)}} / クリ率 ${{Number(lb3.crit_rate||0).toFixed(2)}} / 破壊率 ${{Number(lb3.destruction||0).toFixed(2)}}</div>
    <div class="row"><b>パッシブ:</b> 無凸=${{esc(st.passive_no_lb||'-')}} / 3凸=${{esc(st.passive_lb3||'-')}}</div>
    <div class="row"><b>属性/宝珠:</b> ${{esc(st.element_tag||'-')}} / ${{Number(st.jewel_type||0).toFixed(0)}}</div>
    <div class="row"><b>同キャラのスタイル:</b> ${{esc(linked.join(' / '))}}</div>
    <div class="row"><b>固有スキル(${{Number(style.style_unique_skill_count||0)}}件):</b></div>
    ${{uniqueSkills || '<div class="row">・なし</div>'}}
    <div class="row"><b>共通スキル(${{Number(style.character_shared_skill_count||0)}}件):</b></div>
    ${{sharedSkills || '<div class="row">・なし</div>'}}
    <div class="row"><b>参照:</b> ${{source}}</div>
  `;
}}

function bootstrap() {{
  initMeta();
  initFilters();
  renderSquadMap();

  document.getElementById('search').addEventListener('input', applyFilter);
  document.getElementById('squadFilter').addEventListener('change', applyFilter);
  document.getElementById('charFilter').addEventListener('change', applyFilter);
  document.querySelectorAll('.rarity').forEach((x) => x.addEventListener('change', applyFilter));

  applyFilter();
}}

bootstrap();
</script>
</body>
</html>
""".strip()

    out.write_text(html, encoding="utf-8")
