from __future__ import annotations

import re
from typing import Optional


PERCENT_RE = re.compile(r"^\s*([-+]?\d+(?:\.\d+)?)\s*%\s*$")
NUMBER_RE = re.compile(r"^\s*[-+]?\d+(?:\.\d+)?(?:[Ee][-+]?\d+)?\s*$")


def parse_float(value: object, default: float = 0.0) -> float:
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return float(value)

    text = str(value).strip()
    if not text:
        return default

    match = PERCENT_RE.match(text)
    if match:
        return float(match.group(1)) / 100.0

    if NUMBER_RE.match(text):
        try:
            return float(text)
        except ValueError:
            return default

    # Strings like "1.5x" or "+30%" in notes
    text = text.replace(",", "")
    try:
        return float(text)
    except ValueError:
        return default


def parse_optional_float(value: object) -> Optional[float]:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return parse_float(value, default=0.0)


def normalize_spaces(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def clean_style_raw(style_raw: str) -> str:
    # "SS xxxxx" -> "xxxxx"
    return re.sub(r"^(?:A|S|SS)\s+", "", style_raw).strip()


def rarity_score(rarity: str) -> float:
    r = (rarity or "").upper()
    if r == "SS":
        return 1.2
    if r == "S":
        return 1.0
    if r == "A":
        return 0.85
    return 1.0


def extract_percent_values(text: str) -> list[float]:
    if not text:
        return []
    vals: list[float] = []
    for m in re.finditer(r"([-+]?\d+(?:\.\d+)?)\s*%", text):
        vals.append(float(m.group(1)) / 100.0)
    return vals
