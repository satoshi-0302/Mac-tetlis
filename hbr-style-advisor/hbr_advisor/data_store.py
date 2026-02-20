from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .models import Enemy, Skill, Style


@dataclass
class AdvisorData:
    styles: list[Style]
    skills: list[Skill]
    enemies: list[Enemy]
    knowledge: dict[str, Any]



def _style_from_dict(obj: dict[str, Any]) -> Style:
    return Style(**obj)



def _skill_from_dict(obj: dict[str, Any]) -> Skill:
    return Skill(**obj)



def _enemy_from_dict(obj: dict[str, Any]) -> Enemy:
    return Enemy(**obj)



def load_data_json(path: str | Path) -> AdvisorData:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    styles = [_style_from_dict(x) for x in payload.get("styles", [])]
    skills = [_skill_from_dict(x) for x in payload.get("skills", [])]
    enemies = [_enemy_from_dict(x) for x in payload.get("enemies", [])]
    knowledge = payload.get("knowledge", {}) if isinstance(payload, dict) else {}
    if not isinstance(knowledge, dict):
        knowledge = {}
    return AdvisorData(styles=styles, skills=skills, enemies=enemies, knowledge=knowledge)
