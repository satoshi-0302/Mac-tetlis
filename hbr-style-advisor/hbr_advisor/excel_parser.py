from __future__ import annotations

import json
import re
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

from .models import Enemy, Skill, Style
from .utils import clean_style_raw, parse_float, parse_optional_float


MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NS = {"main": MAIN_NS, "rel": REL_NS, "pkgrel": PKG_REL_NS}


def _split_top_level_args(text: str) -> list[str]:
    args: list[str] = []
    cur: list[str] = []
    depth = 0
    in_quote = False
    i = 0

    while i < len(text):
        ch = text[i]
        if ch == '"':
            cur.append(ch)
            if in_quote and i + 1 < len(text) and text[i + 1] == '"':
                cur.append('"')
                i += 2
                continue
            in_quote = not in_quote
            i += 1
            continue

        if not in_quote:
            if ch == '(':
                depth += 1
            elif ch == ')':
                depth = max(0, depth - 1)
            elif ch == ',' and depth == 0:
                args.append("".join(cur).strip())
                cur = []
                i += 1
                continue

        cur.append(ch)
        i += 1

    if cur:
        args.append("".join(cur).strip())

    return args


def _excel_unquote(text: str) -> str:
    text = text.strip()
    if len(text) >= 2 and text[0] == '"' and text[-1] == '"':
        return text[1:-1].replace('""', '"')
    return text


def _extract_fallback_from_formula(formula: str) -> str | None:
    txt = formula.strip()
    if not txt.upper().startswith("IFERROR(") or not txt.endswith(")"):
        return None

    body = txt[len("IFERROR(") : -1]
    args = _split_top_level_args(body)
    if len(args) < 2:
        return None

    fallback = args[1].strip()
    # If fallback itself is wrapped in DUMMYFUNCTION("...")
    if fallback.upper().startswith("__XLUDF.DUMMYFUNCTION(") and fallback.endswith(")"):
        inner = fallback[len("__xludf.DUMMYFUNCTION(") : -1]
        inner_args = _split_top_level_args(inner)
        if inner_args:
            return _excel_unquote(inner_args[0])

    return _excel_unquote(fallback)


def _col_index_from_ref(cell_ref: str) -> int:
    col = ""
    for ch in cell_ref:
        if ch.isalpha():
            col += ch
        else:
            break
    idx = 0
    for ch in col:
        idx = idx * 26 + (ord(ch.upper()) - 64)
    return idx


@dataclass
class WorkbookData:
    styles: list[Style]
    skills: list[Skill]
    enemies: list[Enemy]
    knowledge: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {
            "styles": [s.to_dict() for s in self.styles],
            "skills": [s.to_dict() for s in self.skills],
            "enemies": [e.to_dict() for e in self.enemies],
            "knowledge": self.knowledge,
        }


class XlsxExtractor:
    def __init__(self, xlsx_path: str | Path):
        self.path = Path(xlsx_path)
        self._zip = zipfile.ZipFile(self.path)
        self._shared_strings = self._load_shared_strings()
        self._sheet_targets = self._load_sheet_targets()

    def close(self) -> None:
        self._zip.close()

    def _load_shared_strings(self) -> list[str]:
        names = set(self._zip.namelist())
        if "xl/sharedStrings.xml" not in names:
            return []

        root = ET.fromstring(self._zip.read("xl/sharedStrings.xml"))
        out: list[str] = []
        for si in root.findall("main:si", NS):
            text_parts = [t.text or "" for t in si.findall(".//main:t", NS)]
            out.append("".join(text_parts))
        return out

    def _load_sheet_targets(self) -> dict[str, str]:
        wb = ET.fromstring(self._zip.read("xl/workbook.xml"))
        rels = ET.fromstring(self._zip.read("xl/_rels/workbook.xml.rels"))
        rel_map = {
            rel.get("Id"): rel.get("Target")
            for rel in rels.findall("pkgrel:Relationship", NS)
        }

        out: dict[str, str] = {}
        for sheet in wb.findall("main:sheets/main:sheet", NS):
            name = sheet.get("name")
            rid = sheet.get(f"{{{REL_NS}}}id")
            target = rel_map.get(rid)
            if not name or not target:
                continue
            if not target.startswith("/"):
                target = "xl/" + target
            out[name] = target
        return out

    def _cell_value(self, cell: ET.Element) -> str | None:
        ctype = cell.get("t", "n")
        formula = cell.find("main:f", NS)
        v = cell.find("main:v", NS)
        inline = cell.find("main:is", NS)

        if formula is not None and formula.text:
            fallback = _extract_fallback_from_formula(formula.text)
            if fallback is not None:
                return fallback
            return "=" + formula.text

        if ctype == "s" and v is not None and (v.text or "").isdigit():
            idx = int(v.text)
            if 0 <= idx < len(self._shared_strings):
                return self._shared_strings[idx]
            return v.text

        if ctype == "inlineStr" and inline is not None:
            tvals = [t.text or "" for t in inline.findall(".//main:t", NS)]
            return "".join(tvals)

        if v is not None:
            return v.text

        return None

    def iter_sheet_rows(self, sheet_name: str) -> Iterator[tuple[int, dict[int, str]]]:
        target = self._sheet_targets.get(sheet_name)
        if not target:
            return

        root = ET.fromstring(self._zip.read(target))
        data = root.find("main:sheetData", NS)
        if data is None:
            return

        for row in data.findall("main:row", NS):
            rnum = int(row.get("r") or 0)
            values: dict[int, str] = {}
            for cell in row.findall("main:c", NS):
                cref = cell.get("r")
                if not cref:
                    continue
                cidx = _col_index_from_ref(cref)
                value = self._cell_value(cell)
                if value is not None:
                    values[cidx] = value
            if values:
                yield rnum, values

    def parse_styles(self) -> list[Style]:
        styles: list[Style] = []
        seen: set[str] = set()

        for rnum, row in self.iter_sheet_rows("パッシブ"):
            if rnum < 2:
                continue

            alias = str(row.get(2, "")).strip()
            character = str(row.get(3, "")).strip()
            style_raw = str(row.get(4, "")).strip()
            rarity = str(row.get(5, "")).strip().upper()
            style_name_cell = str(row.get(1, "")).strip()

            if not character or not style_raw:
                continue

            if style_name_cell and not style_name_cell.startswith("="):
                style_name = style_name_cell
            elif alias:
                style_name = f"{alias}({clean_style_raw(style_raw)})"
            else:
                style_name = style_raw

            style_name = style_name.strip()
            if not style_name or style_name in seen:
                continue

            seen.add(style_name)

            style = Style(
                style_name=style_name,
                alias=alias,
                character=character,
                style_raw=style_raw,
                rarity=rarity,
                attack_bonus_no_lb=parse_float(row.get(6)),
                def_bonus_no_lb=parse_float(row.get(8)),
                attack_bonus_lb3=parse_float(row.get(16)),
                def_bonus_lb3=parse_float(row.get(18)),
                crit_damage_no_lb=parse_float(row.get(10)),
                crit_damage_lb3=parse_float(row.get(20)),
                crit_rate_no_lb=parse_float(row.get(12)),
                crit_rate_lb3=parse_float(row.get(22)),
                destruction_no_lb=parse_float(row.get(14)),
                destruction_lb3=parse_float(row.get(24)),
                attack_scope_no_lb=str(row.get(7, "")).strip(),
                def_scope_no_lb=str(row.get(9, "")).strip(),
                crit_damage_scope_no_lb=str(row.get(11, "")).strip(),
                crit_rate_scope_no_lb=str(row.get(13, "")).strip(),
                destruction_scope_no_lb=str(row.get(15, "")).strip(),
                attack_scope_lb3=str(row.get(17, "")).strip(),
                def_scope_lb3=str(row.get(19, "")).strip(),
                crit_damage_scope_lb3=str(row.get(21, "")).strip(),
                crit_rate_scope_lb3=str(row.get(23, "")).strip(),
                destruction_scope_lb3=str(row.get(25, "")).strip(),
                passive_no_lb=str(row.get(26, "")).strip(),
                passive_lb3=str(row.get(27, "")).strip(),
                element_tag=str(row.get(28, "")).strip(),
                jewel_type=parse_float(row.get(29)),
            )
            styles.append(style)

        return styles

    def parse_skills(self) -> list[Skill]:
        skills: list[Skill] = []

        for rnum, row in self.iter_sheet_rows("スキルサブ情報"):
            if rnum < 2:
                continue

            skill_name = str(row.get(1, "")).strip()
            if not skill_name:
                continue

            owner_character = str(row.get(7, "")).strip()
            if not owner_character:
                continue

            skill = Skill(
                skill_name=skill_name,
                weapon=str(row.get(2, "")).strip(),
                element=str(row.get(3, "")).strip(),
                target=str(row.get(4, "")).strip(),
                hit=parse_float(row.get(5), 1.0),
                owner_style_hint=str(row.get(6, "")).strip(),
                owner_character=owner_character,
                sp=parse_float(row.get(8)),
                multiplier=parse_float(row.get(9)),
                notes=str(row.get(10, "")).strip(),
                basic_flag=parse_float(row.get(11)),
                per_hit_multipliers=[
                    x
                    for x in (
                        parse_optional_float(row.get(col))
                        for col in range(12, 32)
                    )
                    if x is not None
                ],
            )
            skills.append(skill)

        return skills

    def parse_enemies(self) -> list[Enemy]:
        enemies: list[Enemy] = []

        for rnum, row in self.iter_sheet_rows("仮想敵"):
            if rnum < 2:
                continue

            name = str(row.get(1, "")).strip()
            if not name:
                continue

            weapon_mult = {
                "斬": parse_float(row.get(9), 1.0),
                "突": parse_float(row.get(10), 1.0),
                "打": parse_float(row.get(11), 1.0),
            }
            element_mult = {
                "火": parse_float(row.get(12), 1.0),
                "氷": parse_float(row.get(13), 1.0),
                "雷": parse_float(row.get(14), 1.0),
                "光": parse_float(row.get(15), 1.0),
                "闇": parse_float(row.get(16), 1.0),
                "無": parse_float(row.get(17), 1.0),
            }

            enemy = Enemy(
                name=name,
                dp=parse_float(row.get(2)),
                hp=parse_float(row.get(3)),
                dr=parse_float(row.get(4)),
                stat=parse_float(row.get(6)),
                category=str(row.get(7, "")).strip(),
                detail_url=str(row.get(8, "")).strip(),
                weapon_mult=weapon_mult,
                element_mult=element_mult,
            )
            enemies.append(enemy)

        return enemies

    def _row_text(self, row: dict[int, str], col: int) -> str:
        return str(row.get(col, "")).strip()

    def _has_real_value(self, text: str) -> bool:
        if not text:
            return False
        return not text.startswith("=")

    def parse_knowledge_tables(self) -> dict[str, Any]:
        return {
            "version": self.parse_version_info(),
            "manual_notes": self.parse_manual_notes(),
            "skill_attack_buffs": self.parse_skill_attack_buffs(),
            "element_attack_buffs": self.parse_element_attack_buffs(),
            "charge_buffs": self.parse_charge_buffs(),
            "crit_damage_buffs": self.parse_crit_damage_buffs(),
            "crit_rate_buffs": self.parse_crit_rate_buffs(),
            "debuff_traits": self.parse_debuff_traits(),
            "field_buffs": self.parse_field_buffs(),
            "mind_eye_buffs": self.parse_mind_eye_buffs(),
            "penetration_skills": self.parse_penetration_skills(),
        }

    def parse_version_info(self) -> dict[str, str]:
        out: dict[str, str] = {}
        for rnum, row in self.iter_sheet_rows("更新履歴"):
            if rnum == 1:
                out["tool_version"] = self._row_text(row, 4)
            elif rnum == 3:
                out["tool_name"] = self._row_text(row, 2)
            elif rnum == 4:
                out["source_sheet"] = self._row_text(row, 1)
            if rnum > 4:
                break
        return out

    def parse_manual_notes(self) -> list[str]:
        notes: list[str] = []
        for rnum, row in self.iter_sheet_rows("マニュアル"):
            if rnum > 120:
                break
            text = self._row_text(row, 1)
            if not text or text.startswith("="):
                continue
            notes.append(text)
        return notes

    def parse_skill_attack_buffs(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for rnum, row in self.iter_sheet_rows("スキル攻撃バフ"):
            if rnum < 3:
                continue
            skill_name = self._row_text(row, 1)
            if not self._has_real_value(skill_name):
                continue
            out.append(
                {
                    "skill_name": skill_name,
                    "threshold": parse_float(row.get(2)),
                    "min_value": parse_float(row.get(3)),
                    "max_value": parse_float(row.get(4)),
                    "jewel_cap": parse_float(row.get(5)),
                    "lv_cap": parse_float(row.get(6)),
                    "precast": parse_float(row.get(7)),
                    "user": self._row_text(row, 8),
                    "style_hint": self._row_text(row, 9),
                }
            )
        return out

    def parse_element_attack_buffs(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for rnum, row in self.iter_sheet_rows("属性攻撃バフ"):
            if rnum < 3:
                continue
            skill_name = self._row_text(row, 1)
            if not self._has_real_value(skill_name):
                continue
            out.append(
                {
                    "skill_name": skill_name,
                    "threshold": parse_float(row.get(2)),
                    "min_value": parse_float(row.get(3)),
                    "max_value": parse_float(row.get(4)),
                    "jewel_cap": parse_float(row.get(5)),
                    "lv_cap": parse_float(row.get(6)),
                    "element": self._row_text(row, 7),
                    "precast": parse_float(row.get(8)),
                    "user": self._row_text(row, 9),
                    "style_hint": self._row_text(row, 10),
                }
            )
        return out

    def parse_charge_buffs(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for rnum, row in self.iter_sheet_rows("チャージバフ"):
            if rnum < 3:
                continue
            skill_name = self._row_text(row, 1)
            if not self._has_real_value(skill_name):
                continue
            out.append(
                {
                    "skill_name": skill_name,
                    "threshold": parse_float(row.get(2)),
                    "min_value": parse_float(row.get(3)),
                    "max_value": parse_float(row.get(4)),
                    "jewel_cap": parse_float(row.get(5)),
                    "lv_cap": parse_float(row.get(6)),
                    "user": self._row_text(row, 7),
                    "style_hint": self._row_text(row, 8),
                }
            )
        return out

    def parse_crit_damage_buffs(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for rnum, row in self.iter_sheet_rows("クリ威力"):
            if rnum < 3:
                continue
            skill_name = self._row_text(row, 1)
            if not self._has_real_value(skill_name):
                continue
            out.append(
                {
                    "skill_name": skill_name,
                    "value": parse_float(row.get(2)),
                    "element": self._row_text(row, 3),
                    "precast": parse_float(row.get(4)),
                    "user": self._row_text(row, 5),
                }
            )
        return out

    def parse_crit_rate_buffs(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for rnum, row in self.iter_sheet_rows("クリバフ"):
            if rnum < 3:
                continue
            skill_name = self._row_text(row, 1)
            if not self._has_real_value(skill_name):
                continue
            out.append(
                {
                    "skill_name": skill_name,
                    "threshold": parse_float(row.get(2)),
                    "min_value": parse_float(row.get(3)),
                    "max_value": parse_float(row.get(4)),
                    "jewel_cap": parse_float(row.get(5)),
                    "lv_cap": parse_float(row.get(6)),
                    "user": self._row_text(row, 7),
                }
            )
        return out

    def parse_debuff_traits(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for rnum, row in self.iter_sheet_rows("デバフ特性"):
            if rnum < 3:
                continue
            skill_name = self._row_text(row, 1)
            if not self._has_real_value(skill_name):
                continue
            out.append(
                {
                    "skill_name": skill_name,
                    "jewel_cap": parse_float(row.get(2)),
                    "attribute": self._row_text(row, 3),
                    "lv": parse_float(row.get(4)),
                    "resistance": self._row_text(row, 5),
                    "effect_type": self._row_text(row, 6),
                    "user": self._row_text(row, 7),
                    "style_hint": self._row_text(row, 8),
                }
            )
        return out

    def parse_field_buffs(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for rnum, row in self.iter_sheet_rows("属性フィールド"):
            if rnum < 3:
                continue
            skill_name = self._row_text(row, 1)
            if not self._has_real_value(skill_name):
                continue
            out.append(
                {
                    "skill_name": skill_name,
                    "element": self._row_text(row, 2),
                    "value": parse_float(row.get(3)),
                    "user": self._row_text(row, 4),
                    "style_hint": self._row_text(row, 5),
                }
            )
        return out

    def parse_mind_eye_buffs(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for rnum, row in self.iter_sheet_rows("心眼"):
            if rnum < 3:
                continue
            skill_name = self._row_text(row, 1)
            if not self._has_real_value(skill_name):
                continue
            out.append(
                {
                    "skill_name": skill_name,
                    "threshold": parse_float(row.get(2)),
                    "min_value": parse_float(row.get(3)),
                    "max_value": parse_float(row.get(4)),
                    "jewel_cap": parse_float(row.get(5)),
                    "lv_cap": parse_float(row.get(6)),
                    "user": self._row_text(row, 7),
                    "default_select": parse_float(row.get(8)),
                    "style_hint": self._row_text(row, 9),
                }
            )
        return out

    def parse_penetration_skills(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for rnum, row in self.iter_sheet_rows("貫通"):
            if rnum < 2:
                continue
            skill_name = self._row_text(row, 1)
            if not self._has_real_value(skill_name):
                continue
            out.append(
                {
                    "skill_name": skill_name,
                    "value": parse_float(row.get(2)),
                }
            )
        return out


def build_workbook_data(xlsx_path: str | Path) -> WorkbookData:
    extractor = XlsxExtractor(xlsx_path)
    try:
        return WorkbookData(
            styles=extractor.parse_styles(),
            skills=extractor.parse_skills(),
            enemies=extractor.parse_enemies(),
            knowledge=extractor.parse_knowledge_tables(),
        )
    finally:
        extractor.close()


def build_json_dataset(xlsx_path: str | Path, out_path: str | Path) -> dict[str, Any]:
    data = build_workbook_data(xlsx_path)
    payload = data.to_dict()

    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return payload
