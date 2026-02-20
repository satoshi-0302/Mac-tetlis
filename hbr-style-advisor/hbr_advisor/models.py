from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Optional


@dataclass
class Style:
    style_name: str
    alias: str
    character: str
    style_raw: str
    rarity: str
    attack_bonus_no_lb: float
    attack_bonus_lb3: float
    crit_damage_no_lb: float
    crit_damage_lb3: float
    crit_rate_no_lb: float
    crit_rate_lb3: float
    destruction_no_lb: float
    destruction_lb3: float
    passive_no_lb: str
    passive_lb3: str
    element_tag: str
    jewel_type: float
    def_bonus_no_lb: float = 0.0
    def_bonus_lb3: float = 0.0
    attack_scope_no_lb: str = ""
    def_scope_no_lb: str = ""
    crit_damage_scope_no_lb: str = ""
    crit_rate_scope_no_lb: str = ""
    destruction_scope_no_lb: str = ""
    attack_scope_lb3: str = ""
    def_scope_lb3: str = ""
    crit_damage_scope_lb3: str = ""
    crit_rate_scope_lb3: str = ""
    destruction_scope_lb3: str = ""

    @property
    def attack_bonus(self) -> float:
        return max(self.attack_bonus_no_lb, self.attack_bonus_lb3)

    @property
    def crit_damage_bonus(self) -> float:
        return max(self.crit_damage_no_lb, self.crit_damage_lb3)

    @property
    def crit_rate_bonus(self) -> float:
        return max(self.crit_rate_no_lb, self.crit_rate_lb3)

    @property
    def destruction_bonus(self) -> float:
        return max(self.destruction_no_lb, self.destruction_lb3)

    @property
    def def_bonus(self) -> float:
        return max(self.def_bonus_no_lb, self.def_bonus_lb3)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Skill:
    skill_name: str
    weapon: str
    element: str
    target: str
    hit: float
    owner_style_hint: str
    owner_character: str
    sp: float
    multiplier: float
    notes: str
    basic_flag: float
    per_hit_multipliers: list[float] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Enemy:
    name: str
    dp: float
    hp: float
    dr: float
    stat: float
    category: str
    detail_url: str
    weapon_mult: dict[str, float]
    element_mult: dict[str, float]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class StyleScore:
    style: Style
    role: str
    total_score: float
    attack_score: float
    support_score: float
    debuff_score: float
    breaker_skill: Optional[Skill]
    finisher_skill: Optional[Skill]
    support_skill: Optional[Skill]
    debuff_skill: Optional[Skill]
    weakness_factor: float


@dataclass
class TeamPlan:
    team: list[StyleScore]
    main_attacker: Optional[StyleScore]
    enemy: Optional[Enemy]
    estimated_damage: float
    relative_score: float
    turn_plan: list[str]
    unmatched_owned: list[str]
    unmatched_wanted: list[str]
