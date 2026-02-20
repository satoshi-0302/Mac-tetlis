from __future__ import annotations

import difflib
import re
from collections import defaultdict
from typing import Any, Iterable, Optional

from .models import Enemy, Skill, Style, StyleScore, TeamPlan
from .utils import extract_percent_values, rarity_score


SUPPORT_KEYWORDS = [
    "バフ",
    "フィールド",
    "チャージ",
    "士気",
    "クリティカル",
    "スキル攻撃力",
    "トークン",
    "OD",
    "SP",
]
DEBUFF_KEYWORDS = ["防御ダウン", "脆弱", "耐性", "デバフ", "被ダメ", "弱体", "封印"]
ATTACK_KEYWORDS = ["対HPダメージ", "対DPダメージ", "連撃", "破壊率", "貫通"]


def split_style_input(raw: str) -> list[str]:
    if not raw:
        return []
    parts = re.split(r"[\n,、]+", raw)
    out = [p.strip() for p in parts if p.strip()]
    return out


class BattleAdvisor:
    def __init__(
        self,
        styles: list[Style],
        skills: list[Skill],
        enemies: list[Enemy],
        knowledge: Optional[dict[str, Any]] = None,
    ):
        self.styles = styles
        self.skills = skills
        self.enemies = enemies
        self.knowledge = knowledge if isinstance(knowledge, dict) else {}
        self.style_by_name = {s.style_name: s for s in styles}
        self.skills_by_character: dict[str, list[Skill]] = defaultdict(list)
        self.skills_by_style_hint: dict[str, list[Skill]] = defaultdict(list)

        # Structured knowledge extracted from workbook tables.
        self.skill_attack_buff_map = self._build_skill_value_map(
            "skill_attack_buffs", "max_value"
        )
        self.element_attack_buff_map = self._build_skill_value_map(
            "element_attack_buffs", "max_value"
        )
        self.charge_buff_map = self._build_skill_value_map("charge_buffs", "max_value")
        self.crit_damage_buff_map = self._build_skill_value_map(
            "crit_damage_buffs", "value"
        )
        self.crit_rate_buff_map = self._build_skill_value_map("crit_rate_buffs", "max_value")
        self.field_buff_map = self._build_skill_value_map("field_buffs", "value")
        self.mind_eye_map = self._build_skill_value_map("mind_eye_buffs", "max_value")
        self.penetration_map = self._build_skill_value_map("penetration_skills", "value")
        self.debuff_trait_map = self._build_debuff_trait_map()

        for sk in skills:
            self.skills_by_character[sk.owner_character].append(sk)
            if sk.owner_style_hint:
                self.skills_by_style_hint[sk.owner_style_hint].append(sk)

    def _percentize(self, value: float) -> float:
        # Workbook values are often in percent-like units (e.g. 30 for 30%).
        if value > 2.0:
            return value / 100.0
        return value

    def _build_skill_value_map(self, key: str, value_key: str) -> dict[str, float]:
        out: dict[str, float] = {}
        rows = self.knowledge.get(key, [])
        if not isinstance(rows, list):
            return out

        for row in rows:
            if not isinstance(row, dict):
                continue
            skill_name = str(row.get("skill_name", "")).strip()
            if not skill_name:
                continue
            try:
                raw_val = float(row.get(value_key, 0.0) or 0.0)
            except (TypeError, ValueError):
                raw_val = 0.0
            out[skill_name] = self._percentize(raw_val)
        return out

    def _build_debuff_trait_map(self) -> dict[str, str]:
        out: dict[str, str] = {}
        rows = self.knowledge.get("debuff_traits", [])
        if not isinstance(rows, list):
            return out
        for row in rows:
            if not isinstance(row, dict):
                continue
            skill_name = str(row.get("skill_name", "")).strip()
            if not skill_name:
                continue
            effect = str(row.get("effect_type", "")).strip()
            resistance = str(row.get("resistance", "")).strip()
            out[skill_name] = f"{effect} {resistance}".strip()
        return out

    def find_enemy(self, enemy_name: str | None) -> Optional[Enemy]:
        if not enemy_name:
            return None
        for e in self.enemies:
            if e.name == enemy_name:
                return e
        for e in self.enemies:
            if enemy_name in e.name:
                return e
        return None

    def resolve_style_queries(self, queries: Iterable[str]) -> tuple[list[Style], list[str]]:
        resolved: list[Style] = []
        unresolved: list[str] = []

        all_names = list(self.style_by_name.keys())
        lower_map = {name.lower(): name for name in all_names}

        for query in queries:
            q = query.strip()
            if not q:
                continue

            # Exact
            if q in self.style_by_name:
                resolved.append(self.style_by_name[q])
                continue

            q_lower = q.lower()
            if q_lower in lower_map:
                resolved.append(self.style_by_name[lower_map[q_lower]])
                continue

            # Substring
            candidates = [
                s
                for s in self.styles
                if q in s.style_name or q in s.character or q in s.alias or q in s.style_raw
            ]
            if candidates:
                candidates.sort(
                    key=lambda s: (
                        0 if s.style_name.startswith(q) else 1,
                        -rarity_score(s.rarity),
                        len(s.style_name),
                    )
                )
                resolved.append(candidates[0])
                continue

            # Fuzzy
            fuzzy = difflib.get_close_matches(q, all_names, n=1, cutoff=0.5)
            if fuzzy:
                resolved.append(self.style_by_name[fuzzy[0]])
                continue

            unresolved.append(q)

        # de-dup while preserving order
        uniq: list[Style] = []
        seen: set[str] = set()
        for style in resolved:
            if style.style_name in seen:
                continue
            seen.add(style.style_name)
            uniq.append(style)

        return uniq, unresolved

    def _skills_for_style(self, style: Style) -> list[Skill]:
        style_skills = self.skills_by_style_hint.get(style.style_name, [])
        if style_skills:
            return style_skills

        # Sometimes owner_style_hint keeps rarity+style raw: "SS XXX(...)"
        candidates = [
            sk
            for sk in self.skills_by_character.get(style.character, [])
            if style.alias and style.alias in sk.owner_style_hint
        ]
        if candidates:
            return candidates

        return self.skills_by_character.get(style.character, [])

    def _weakness_factor(
        self,
        skill: Skill,
        enemy: Optional[Enemy],
        preferred_weapon: str | None,
        preferred_element: str | None,
    ) -> float:
        factor = 1.0

        if enemy is not None:
            if skill.weapon in enemy.weapon_mult:
                factor *= max(0.05, enemy.weapon_mult[skill.weapon])
            if skill.element in enemy.element_mult:
                factor *= max(0.05, enemy.element_mult[skill.element])

        if preferred_weapon and skill.weapon == preferred_weapon:
            factor *= 1.15
        if preferred_element and skill.element == preferred_element:
            factor *= 1.2

        return factor

    def _attack_skill_score(
        self,
        skill: Skill,
        enemy: Optional[Enemy],
        preferred_weapon: str | None,
        preferred_element: str | None,
    ) -> tuple[float, float, float, float]:
        weakness = self._weakness_factor(skill, enemy, preferred_weapon, preferred_element)

        notes = skill.notes or ""
        hp_bonus = 0.0
        dp_bonus = 0.0
        pct_values = extract_percent_values(notes)
        if "対HPダメージ" in notes and pct_values:
            hp_bonus = max(pct_values)
        if "対DPダメージ" in notes and pct_values:
            dp_bonus = max(pct_values)

        attack_keyword_bonus = 0.0
        for k in ATTACK_KEYWORDS:
            if k in notes:
                attack_keyword_bonus += 0.07

        base = max(0.1, skill.multiplier)
        penetration_bonus = self.penetration_map.get(skill.skill_name, 0.0) * 0.65
        mind_eye_bonus = self.mind_eye_map.get(skill.skill_name, 0.0) * 0.4
        hp_score = base * (1.0 + hp_bonus + attack_keyword_bonus + penetration_bonus + mind_eye_bonus) * weakness
        dp_score = base * (1.0 + dp_bonus + attack_keyword_bonus + penetration_bonus + mind_eye_bonus) * weakness
        overall = max(hp_score, dp_score)
        return overall, hp_score, dp_score, weakness

    def _support_skill_score(self, skill: Skill) -> float:
        notes = skill.notes or ""
        score = 0.0
        for k in SUPPORT_KEYWORDS:
            if k in notes:
                score += 1.0
        if "回復" in notes:
            score += 0.4
        score += self.skill_attack_buff_map.get(skill.skill_name, 0.0) * 10.0
        score += self.element_attack_buff_map.get(skill.skill_name, 0.0) * 10.0
        score += self.charge_buff_map.get(skill.skill_name, 0.0) * 9.0
        score += self.crit_damage_buff_map.get(skill.skill_name, 0.0) * 7.0
        score += self.crit_rate_buff_map.get(skill.skill_name, 0.0) * 7.0
        score += self.field_buff_map.get(skill.skill_name, 0.0) * 8.0
        return score

    def _debuff_skill_score(self, skill: Skill) -> float:
        notes = skill.notes or ""
        score = 0.0
        for k in DEBUFF_KEYWORDS:
            if k in notes:
                score += 1.0
        debuff_hint = self.debuff_trait_map.get(skill.skill_name, "")
        if debuff_hint:
            score += 2.0
            if "脆弱" in debuff_hint:
                score += 0.7
            if "DP" in debuff_hint or "耐" in debuff_hint:
                score += 0.5
        if "防御ダウン" in notes:
            score += 1.0
        if "脆弱" in notes:
            score += 1.0
        return score

    def score_style(
        self,
        style: Style,
        enemy: Optional[Enemy],
        preferred_weapon: str | None,
        preferred_element: str | None,
    ) -> StyleScore:
        skills = self._skills_for_style(style)

        best_attack_any: Optional[Skill] = None
        best_attack_any_score = 0.0
        best_hp_skill: Optional[Skill] = None
        best_hp_score = 0.0
        best_dp_skill: Optional[Skill] = None
        best_dp_score = 0.0
        best_weakness = 1.0

        best_support: Optional[Skill] = None
        best_support_score = 0.0

        best_debuff: Optional[Skill] = None
        best_debuff_score = 0.0

        for sk in skills:
            atk_any, atk_hp, atk_dp, weakness = self._attack_skill_score(
                sk, enemy, preferred_weapon, preferred_element
            )
            if atk_any > best_attack_any_score:
                best_attack_any = sk
                best_attack_any_score = atk_any
                best_weakness = weakness
            if atk_hp > best_hp_score:
                best_hp_skill = sk
                best_hp_score = atk_hp
            if atk_dp > best_dp_score:
                best_dp_skill = sk
                best_dp_score = atk_dp

            sup_score = self._support_skill_score(sk)
            if sup_score > best_support_score:
                best_support = sk
                best_support_score = sup_score

            deb_score = self._debuff_skill_score(sk)
            if deb_score > best_debuff_score:
                best_debuff = sk
                best_debuff_score = deb_score

        rarity = rarity_score(style.rarity)
        stat_boost = (
            style.attack_bonus
            + style.crit_damage_bonus * 0.35
            + style.crit_rate_bonus * 0.25
            + style.destruction_bonus * 0.2
        )

        # Battle model:
        # - DPがある敵: DPブレイク技能 -> HPフィニッシュ技能を分離して評価
        # - DPがない敵: 単純に最大火力技能を採用
        use_hp_phase = bool(enemy is not None and enemy.dp > 0)
        finisher_skill = best_hp_skill if use_hp_phase else best_attack_any
        breaker_skill = best_dp_skill if use_hp_phase else best_attack_any
        attack_core = best_hp_score if use_hp_phase else best_attack_any_score
        if attack_core <= 0.0:
            attack_core = best_attack_any_score

        attack_score = attack_core * rarity * (1.0 + stat_boost)
        support_score = (best_support_score + style.attack_bonus * 3.0) * rarity
        debuff_score = (best_debuff_score + style.destruction_bonus * 2.0) * rarity

        passive_text = f"{style.passive_no_lb} {style.passive_lb3}"
        if any(k in passive_text for k in SUPPORT_KEYWORDS):
            support_score += 0.8
        if any(k in passive_text for k in DEBUFF_KEYWORDS):
            debuff_score += 0.8

        # Workbook derived tables are trusted first for role classification.
        if best_support and (
            best_support.skill_name in self.skill_attack_buff_map
            or best_support.skill_name in self.element_attack_buff_map
            or best_support.skill_name in self.charge_buff_map
            or best_support.skill_name in self.field_buff_map
            or best_support.skill_name in self.crit_damage_buff_map
            or best_support.skill_name in self.crit_rate_buff_map
        ):
            role = "buffer"
        elif best_debuff and (
            best_debuff.skill_name in self.debuff_trait_map
            or "防御ダウン" in (best_debuff.notes or "")
            or "脆弱" in (best_debuff.notes or "")
        ):
            role = "debuffer"
        else:
            role_cutoff = max(1.6, attack_score * 0.12)
            if debuff_score >= role_cutoff and debuff_score >= support_score:
                role = "debuffer"
            elif support_score >= role_cutoff:
                role = "buffer"
            else:
                role = "attacker"

        total = attack_score * 1.0 + support_score * 0.7 + debuff_score * 0.7

        return StyleScore(
            style=style,
            role=role,
            total_score=total,
            attack_score=attack_score,
            support_score=support_score,
            debuff_score=debuff_score,
            breaker_skill=breaker_skill,
            finisher_skill=finisher_skill,
            support_skill=best_support,
            debuff_skill=best_debuff,
            weakness_factor=best_weakness,
        )

    def recommend(
        self,
        owned_queries: list[str],
        wanted_queries: list[str],
        enemy_name: str | None = None,
        preferred_weapon: str | None = None,
        preferred_element: str | None = None,
        team_size: int = 6,
    ) -> TeamPlan:
        matched_owned, unmatched_owned = self.resolve_style_queries(owned_queries)
        matched_wanted, unmatched_wanted = self.resolve_style_queries(wanted_queries)

        if matched_owned:
            pool_map = {s.style_name: s for s in matched_owned}
        else:
            pool_map = {s.style_name: s for s in self.styles}

        # Wanted styles are always considered (even outside owned list)
        for st in matched_wanted:
            pool_map[st.style_name] = st

        pool = list(pool_map.values())
        enemy = self.find_enemy(enemy_name)

        scores = [
            self.score_style(st, enemy, preferred_weapon, preferred_element) for st in pool
        ]

        wanted_names = {s.style_name for s in matched_wanted}
        for sc in scores:
            if sc.style.style_name in wanted_names:
                sc.total_score += 100.0

        score_map = {sc.style.style_name: sc for sc in scores}
        used_chars: set[str] = set()
        selected: list[StyleScore] = []

        def add_style(sc: StyleScore) -> bool:
            if sc.style.character in used_chars:
                return False
            selected.append(sc)
            used_chars.add(sc.style.character)
            return True

        # 1) force-add wanted styles
        for st in matched_wanted:
            sc = score_map.get(st.style_name)
            if sc is not None:
                add_style(sc)

        # 2) main attacker
        attackers = sorted(scores, key=lambda x: x.attack_score, reverse=True)
        main_attacker: Optional[StyleScore] = None
        for sc in attackers:
            if add_style(sc):
                main_attacker = sc
                break

        # If main attacker was already wanted and inserted, pick it
        if main_attacker is None and selected:
            main_attacker = max(selected, key=lambda x: x.attack_score)

        # 3) add top debuffers (at least one when available)
        for sc in sorted(scores, key=lambda x: x.debuff_score, reverse=True):
            if len(selected) >= team_size:
                break
            if sc.debuff_score <= 0.4:
                break
            if add_style(sc):
                if len([x for x in selected if x.role == "debuffer"]) >= 1:
                    break

        # 4) add top buffers (at least one when available)
        for sc in sorted(scores, key=lambda x: x.support_score, reverse=True):
            if len(selected) >= team_size:
                break
            if sc.support_score <= 0.4:
                break
            if add_style(sc):
                if len([x for x in selected if x.role == "buffer"]) >= 1:
                    break

        # 4.5) optionally add second support layer/debuff layer
        for sc in sorted(scores, key=lambda x: max(x.support_score, x.debuff_score), reverse=True):
            if len(selected) >= team_size:
                break
            if add_style(sc):
                support_like = len([x for x in selected if x.support_score >= 2.0])
                debuff_like = len([x for x in selected if x.debuff_score >= 2.0])
                if support_like >= 2 and debuff_like >= 2:
                    break

        # 5) fill with total score
        for sc in sorted(scores, key=lambda x: x.total_score, reverse=True):
            if len(selected) >= team_size:
                break
            add_style(sc)

        if main_attacker is None and selected:
            main_attacker = max(selected, key=lambda x: x.attack_score)

        # Estimate damage
        estimated_damage = 0.0
        relative_score = 0.0
        if main_attacker is not None:
            phase_has_dp = bool(enemy is not None and enemy.dp > 0)
            breaker = main_attacker.breaker_skill if phase_has_dp else None
            finisher = main_attacker.finisher_skill
            skill_mult = max(0.5, finisher.multiplier if finisher else 1.0)
            weakness = max(0.1, main_attacker.weakness_factor)

            total_atk_bonus = sum(x.style.attack_bonus for x in selected)
            total_support_layers = 0.0
            total_debuff_layers = 0.0
            for member in selected:
                if member.support_skill is not None:
                    s_name = member.support_skill.skill_name
                    total_support_layers += self.skill_attack_buff_map.get(s_name, 0.0) * 0.7
                    total_support_layers += self.element_attack_buff_map.get(s_name, 0.0) * 0.65
                    total_support_layers += self.charge_buff_map.get(s_name, 0.0) * 0.7
                    total_support_layers += self.field_buff_map.get(s_name, 0.0) * 0.55
                    total_support_layers += self.crit_damage_buff_map.get(s_name, 0.0) * 0.45
                    total_support_layers += self.crit_rate_buff_map.get(s_name, 0.0) * 0.45
                if member.role == "buffer" or member.support_score >= 2.0:
                    total_support_layers += 0.05

                if member.debuff_skill is not None:
                    d_name = member.debuff_skill.skill_name
                    if d_name in self.debuff_trait_map:
                        total_debuff_layers += 0.12
                if member.role == "debuffer" or member.debuff_score >= 2.0:
                    total_debuff_layers += 0.08

            total_support_layers = min(2.2, total_support_layers)
            total_debuff_layers = min(1.8, total_debuff_layers)
            crit_factor = 1.5 + min(
                1.2,
                main_attacker.style.crit_damage_bonus
                + sum(x.style.crit_damage_bonus for x in selected) * 0.25,
            )

            base = 1_000_000.0
            break_phase_factor = 1.0
            if phase_has_dp:
                breaker_mult = max(0.5, breaker.multiplier if breaker else skill_mult)
                break_phase_factor += min(0.85, breaker_mult * 0.045 + total_debuff_layers * 0.2)

            estimated_damage = (
                base
                * skill_mult
                * (1.0 + total_atk_bonus + total_support_layers)
                * (1.0 + total_debuff_layers)
                * weakness
                * crit_factor
                * break_phase_factor
            )
            relative_score = estimated_damage / base

        turn_plan = self._build_turn_plan(selected, main_attacker, enemy)

        # Place main attacker first for readability
        if main_attacker is not None:
            selected = [
                main_attacker,
                *[x for x in selected if x.style.style_name != main_attacker.style.style_name],
            ]

        return TeamPlan(
            team=selected[:team_size],
            main_attacker=main_attacker,
            enemy=enemy,
            estimated_damage=estimated_damage,
            relative_score=relative_score,
            turn_plan=turn_plan,
            unmatched_owned=unmatched_owned,
            unmatched_wanted=unmatched_wanted,
        )

    def _build_turn_plan(
        self,
        team: list[StyleScore],
        main_attacker: Optional[StyleScore],
        enemy: Optional[Enemy],
    ) -> list[str]:
        debuffers = [x for x in team if x.debuff_skill is not None and x != main_attacker]
        buffers = [x for x in team if x.support_skill is not None and x != main_attacker]
        phase_has_dp = bool(enemy is not None and enemy.dp > 0)

        t1_actions: list[str] = []
        acted_style_names: set[str] = set()
        for d in debuffers[:2]:
            if d.style.style_name in acted_style_names:
                continue
            t1_actions.append(f"{d.style.style_name} -> {d.debuff_skill.skill_name}")
            acted_style_names.add(d.style.style_name)
        for b in buffers[:2]:
            if b.style.style_name in acted_style_names:
                continue
            t1_actions.append(f"{b.style.style_name} -> {b.support_skill.skill_name}")
            acted_style_names.add(b.style.style_name)

        if not t1_actions:
            t1_actions.append("バフ/デバフ役で準備行動")

        t2_actions: list[str] = []
        if enemy is not None:
            t2_actions.append(f"敵 {enemy.name} の弱点倍率に合わせて属性/武器を調整")
        if phase_has_dp and main_attacker is not None and main_attacker.breaker_skill is not None:
            t2_actions.append(
                f"{main_attacker.style.style_name} -> {main_attacker.breaker_skill.skill_name} でDPブレイクを狙う"
            )
        else:
            t2_actions.append("SP回収とバフ更新を優先")

        t3_actions: list[str] = []
        if main_attacker is not None:
            if main_attacker.finisher_skill is not None:
                if phase_has_dp:
                    t3_actions.append(
                        f"{main_attacker.style.style_name} -> {main_attacker.finisher_skill.skill_name} でHPフェーズをフィニッシュ"
                    )
                else:
                    t3_actions.append(
                        f"{main_attacker.style.style_name} -> {main_attacker.finisher_skill.skill_name} でフィニッシュ"
                    )
            else:
                t3_actions.append(f"{main_attacker.style.style_name} で最大倍率スキルを発動")
        else:
            t3_actions.append("最大火力役でフィニッシュ")

        return [
            "Turn1: " + " / ".join(t1_actions),
            "Turn2: " + " / ".join(t2_actions),
            "Turn3: " + " / ".join(t3_actions),
        ]
