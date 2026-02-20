from __future__ import annotations

import html
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote
from urllib.request import Request, urlopen


USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36"
CHARACTER_INDEX_KEY = "__GAME8_CHARACTER_INDEX__"
CHARACTER_INDEX_URL = "https://game8.jp/heavenburnsred/425628"


@dataclass
class StyleWebInfo:
    style_name: str
    character: str
    page_url: str
    image_url: str
    page_title: str
    squad: str
    source: str
    fetched_at: float
    tier_overall: str = ""
    tier_roles: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "style_name": self.style_name,
            "character": self.character,
            "page_url": self.page_url,
            "image_url": self.image_url,
            "page_title": self.page_title,
            "squad": self.squad,
            "tier_overall": self.tier_overall,
            "tier_roles": self.tier_roles,
            "source": self.source,
            "fetched_at": self.fetched_at,
        }


class StyleWebInfoResolver:
    def __init__(self, cache_path: str | Path):
        self.cache_path = Path(cache_path)
        self.cache: dict[str, dict[str, Any]] = {}
        self._load_cache()

    def _load_cache(self) -> None:
        if self.cache_path.exists():
            try:
                self.cache = json.loads(self.cache_path.read_text(encoding="utf-8"))
            except Exception:
                self.cache = {}

    def _save_cache(self) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        self.cache_path.write_text(
            json.dumps(self.cache, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    def lookup(self, style_name: str, character: str) -> Optional[StyleWebInfo]:
        key = f"{character}|{style_name}"
        cached = self.cache.get(key)
        if cached and cached.get("image_url"):
            cached_info = self._from_cache_dict(cached, style_name, character)
            cached_conf = self._match_confidence(
                cached_info.page_title, style_name, character
            )
            if cached_conf >= 0.45 and not self._is_generic_image(cached_info.image_url):
                return cached_info

        queries = self._build_queries(style_name, character)
        best_info: Optional[StyleWebInfo] = None
        best_conf = 0.0

        for query in queries:
            items = self._game8_site_search(query, style_name, character)
            for url, label in items[:6]:
                parsed = self._fetch_game8_info(url, style_name, character)
                if parsed is None:
                    continue
                confidence = max(
                    self._match_confidence(label, style_name, character),
                    self._match_confidence(parsed.page_title, style_name, character),
                )
                if self._is_generic_image(parsed.image_url):
                    confidence -= 0.3
                if confidence > best_conf:
                    best_info = parsed
                    best_conf = confidence
                if confidence >= 0.85:
                    break
            if best_conf >= 0.85:
                break

        # Fallback: if style page cannot be resolved, fetch character page for image/squad.
        if (best_info is None or best_conf < 0.35) and character:
            fallback = self._lookup_character_page(style_name, character)
            if fallback is not None:
                best_info = fallback
                best_conf = max(best_conf, 0.35)
        elif best_info is not None and not best_info.squad and character:
            fallback = self._lookup_character_page(style_name, character)
            if fallback is not None and fallback.squad:
                best_info.squad = fallback.squad
                if self._is_generic_image(best_info.image_url):
                    best_info.image_url = fallback.image_url
                    best_info.page_url = fallback.page_url
                    best_info.page_title = fallback.page_title

        if best_info is not None and best_conf >= 0.35:
            self.cache[key] = best_info.to_dict()
            self._save_cache()
            return best_info
        return None

    def lookup_character(self, character: str) -> Optional[StyleWebInfo]:
        key = f"CHARACTER|{character}"
        cached = self.cache.get(key)
        if isinstance(cached, dict) and cached.get("image_url"):
            return self._from_cache_dict(cached, style_name=character, character=character)

        index = self.load_character_index()
        entry = index.get("characters", {}).get(character)
        if isinstance(entry, dict):
            info = self._from_character_index_entry(character, entry)
            if info is not None:
                self.cache[key] = info.to_dict()
                self._save_cache()
                return info

        info = self._lookup_character_page(style_name=character, character=character)
        if info is None:
            return None

        self.cache[key] = info.to_dict()
        self._save_cache()
        return info

    def get_cached_style_info(self, style_name: str, character: str) -> Optional[StyleWebInfo]:
        key = f"{character}|{style_name}"
        cached = self.cache.get(key)
        if isinstance(cached, dict) and cached.get("image_url"):
            return self._from_cache_dict(cached, style_name=style_name, character=character)
        return None

    def get_cached_character_info(self, character: str) -> Optional[StyleWebInfo]:
        key = f"CHARACTER|{character}"
        cached = self.cache.get(key)
        if isinstance(cached, dict) and cached.get("image_url"):
            return self._from_cache_dict(cached, style_name=character, character=character)
        return None

    def load_character_index(self, refresh: bool = False) -> dict[str, Any]:
        cached = self.cache.get(CHARACTER_INDEX_KEY)
        if (
            not refresh
            and isinstance(cached, dict)
            and isinstance(cached.get("characters"), dict)
            and cached["characters"]
        ):
            return cached

        try:
            html_text = self._fetch_html(CHARACTER_INDEX_URL)
        except Exception:
            return cached if isinstance(cached, dict) else {}

        parsed = self._parse_character_index(html_text)
        if not parsed.get("characters"):
            return cached if isinstance(cached, dict) else {}

        payload = {
            "page_url": CHARACTER_INDEX_URL,
            "source": "Game8",
            "fetched_at": time.time(),
            "characters": parsed["characters"],
        }
        self.cache[CHARACTER_INDEX_KEY] = payload
        self._save_cache()
        return payload

    def _from_cache_dict(
        self, cached: dict[str, Any], style_name: str, character: str
    ) -> StyleWebInfo:
        def to_text(value: Any, default: str = "") -> str:
            if value is None:
                return default
            return str(value)

        fetched_raw = cached.get("fetched_at", 0.0)
        try:
            fetched_at = float(fetched_raw) if fetched_raw is not None else 0.0
        except (TypeError, ValueError):
            fetched_at = 0.0

        return StyleWebInfo(
            style_name=to_text(cached.get("style_name"), style_name),
            character=to_text(cached.get("character"), character),
            page_url=to_text(cached.get("page_url"), ""),
            image_url=to_text(cached.get("image_url"), ""),
            page_title=to_text(cached.get("page_title"), ""),
            squad=to_text(cached.get("squad"), ""),
            tier_overall=to_text(cached.get("tier_overall"), ""),
            tier_roles=to_text(cached.get("tier_roles"), ""),
            source=to_text(cached.get("source"), "Game8"),
            fetched_at=fetched_at,
        )

    def _from_character_index_entry(
        self, character: str, entry: dict[str, Any]
    ) -> Optional[StyleWebInfo]:
        image_url = str(entry.get("image_url") or "")
        if not image_url:
            return None

        page_url = str(entry.get("page_url") or "")
        if page_url.startswith("/"):
            page_url = "https://game8.jp" + page_url
        if image_url.startswith("//"):
            image_url = "https:" + image_url

        fetched_raw = entry.get("fetched_at", 0.0)
        try:
            fetched_at = float(fetched_raw) if fetched_raw is not None else 0.0
        except (TypeError, ValueError):
            fetched_at = 0.0

        return StyleWebInfo(
            style_name=character,
            character=character,
            page_url=page_url,
            image_url=image_url,
            page_title=f"{character}の評価とスタイル一覧",
            squad=str(entry.get("squad") or ""),
            source=str(entry.get("source") or "Game8"),
            fetched_at=fetched_at,
        )

    def _build_queries(self, style_name: str, character: str) -> list[str]:
        alias = style_name
        subtitle = ""
        m = re.match(r"^(.*?)\((.*)\)$", style_name)
        if m:
            alias = m.group(1).strip()
            subtitle = m.group(2).strip()

        q = [f"{character} {alias}", style_name]
        if subtitle:
            q.insert(0, f"{character} {subtitle}")
        return q

    def _game8_site_search(
        self, query: str, style_name: str, character: str
    ) -> list[tuple[str, str]]:
        search_url = "https://game8.jp/heavenburnsred/search?q=" + quote(query)
        try:
            html_text = self._fetch_html(search_url)
        except Exception:
            return []

        items: list[tuple[str, str]] = []
        for m in re.finditer(
            r'<a[^>]+href="([^"]*?/heavenburnsred/\d+)"[^>]*>(.*?)</a>',
            html_text,
            re.S,
        ):
            href = html.unescape(m.group(1))
            if href.startswith("/"):
                href = "https://game8.jp" + href

            label = re.sub(r"<[^>]+>", "", m.group(2))
            label = " ".join(label.split())
            if not label:
                continue
            items.append((href, label))

        dedup: list[tuple[str, str]] = []
        seen_urls: set[str] = set()
        for href, label in items:
            if href in seen_urls:
                continue
            seen_urls.add(href)
            dedup.append((href, label))

        alias = style_name
        subtitle = ""
        m = re.match(r"^(.*?)\((.*)\)$", style_name)
        if m:
            alias = m.group(1).strip()
            subtitle = m.group(2).strip()

        def score_item(item: tuple[str, str]) -> tuple[float, int]:
            _, label = item
            score = 0.0
            if character and character in label:
                score += 3.0
            if alias and alias in label:
                score += 2.0
            if subtitle and subtitle in label:
                score += 2.0
            if "評価とスキル" in label:
                score += 1.2
            if "SS" in label:
                score += 0.5
            return score, -len(label)

        dedup.sort(key=score_item, reverse=True)
        return dedup[:10]

    def _fetch_html(self, url: str) -> str:
        req = Request(url, headers={"User-Agent": USER_AGENT})
        with urlopen(req, timeout=10) as resp:
            body = resp.read()
        return body.decode("utf-8", errors="ignore")

    def _fetch_game8_info(
        self, page_url: str, style_name: str, character: str
    ) -> Optional[StyleWebInfo]:
        try:
            html_text = self._fetch_html(page_url)
        except Exception:
            return None

        title = self._extract_meta(html_text, "og:title") or ""
        image_url = self._extract_meta(html_text, "og:image") or ""
        if image_url.startswith("//"):
            image_url = "https:" + image_url

        squad = ""
        m = re.search(r"所属部隊</th>\s*<td[^>]*>\s*([^<]+)\s*</td>", html_text)
        if m:
            squad = m.group(1).strip()

        tier_map = self._extract_tiers(html_text)
        tier_overall = tier_map.get("総合", "")
        tier_roles = " / ".join(
            f"{k}:Tier{v}" for k, v in tier_map.items() if k != "総合" and v
        )

        if not image_url:
            return None

        time.sleep(0.4)
        return StyleWebInfo(
            style_name=style_name,
            character=character,
            page_url=page_url,
            image_url=image_url,
            page_title=title,
            squad=squad,
            tier_overall=tier_overall,
            tier_roles=tier_roles,
            source="Game8",
            fetched_at=time.time(),
        )

    def _extract_meta(self, html_text: str, prop: str) -> str:
        patterns = [
            rf'<meta\s+property="{re.escape(prop)}"\s+content="([^"]+)"',
            rf'<meta\s+content="([^"]+)"\s+property="{re.escape(prop)}"',
            rf"<meta\s+property='{re.escape(prop)}'\s+content='([^']+)'",
            rf"<meta\s+content='([^']+)'\s+property='{re.escape(prop)}'",
        ]
        for pat in patterns:
            m = re.search(pat, html_text)
            if m:
                return html.unescape(m.group(1))
        return ""

    def _match_confidence(self, title: str, style_name: str, character: str) -> float:
        if not title:
            return 0.0

        score = 0.0
        if character and character in title:
            score += 0.4

        alias = style_name
        subtitle = ""
        m = re.match(r"^(.*?)\((.*)\)$", style_name)
        if m:
            alias = m.group(1).strip()
            subtitle = m.group(2).strip()

        if alias and alias in title:
            score += 0.25

        if subtitle:
            # subtitle may be long; check partial token overlap
            subtitle_tokens = [t for t in re.split(r"[・\s/\-_]+", subtitle) if t]
            if subtitle_tokens:
                hit = sum(1 for t in subtitle_tokens if t in title)
                score += min(0.35, 0.1 * hit)

        return min(1.0, score)

    def _is_generic_image(self, image_url: str) -> bool:
        return "assets.game8.jp/assets/game8_ogp" in (image_url or "")

    def _extract_tiers(self, html_text: str) -> dict[str, str]:
        out: dict[str, str] = {}
        for label in ("総合", "アタッカー", "ブレイカー", "デバフ", "サポート", "ヒーラー"):
            pattern = (
                rf"{re.escape(label)}[:：]\s*(?:<[^>]+>|\s)*"
                r"Tier\s*([0-9A-Za-z+\-]+)"
            )
            m = re.search(pattern, html_text)
            if m:
                out[label] = m.group(1)
        return out

    def _lookup_character_page(
        self, style_name: str, character: str
    ) -> Optional[StyleWebInfo]:
        search_url = "https://game8.jp/heavenburnsred/search?q=" + quote(character)
        try:
            html_text = self._fetch_html(search_url)
        except Exception:
            return None

        links: list[str] = []
        for m in re.finditer(r'href="([^"]*?/heavenburnsred/\d+)"', html_text):
            href = html.unescape(m.group(1))
            if href.startswith("/"):
                href = "https://game8.jp" + href
            if href not in links:
                links.append(href)
            if len(links) >= 6:
                break

        best: Optional[StyleWebInfo] = None
        best_score = 0.0
        for url in links:
            info = self._fetch_game8_info(url, style_name, character)
            if info is None or self._is_generic_image(info.image_url):
                continue
            score = self._match_confidence(info.page_title, style_name, character)
            if character and character in info.page_title:
                score += 0.25
            if "プロフィール" in info.page_title:
                score += 0.15
            if score > best_score:
                best = info
                best_score = score
            if score >= 0.8:
                break
        return best

    def _parse_character_index(self, html_text: str) -> dict[str, Any]:
        start = html_text.find('id="hl_1">キャラ一覧')
        if start < 0:
            start = html_text.find("id='hl_1'>キャラ一覧")
        if start < 0:
            return {"characters": {}}

        end = html_text.find('id="hl_2"', start)
        if end < 0:
            end = len(html_text)
        section = html_text[start:end]

        squad_markers = list(
            re.finditer(r">(31[A-FX]|30G|司令部|AB!)</a>", section, re.S)
        )
        if not squad_markers:
            return {"characters": {}}

        char_pattern = re.compile(
            r"<a[^>]+href=(?:\"([^\"]*?/heavenburnsred/\d+)\"|'([^']*?/heavenburnsred/\d+)')[^>]*>\s*"
            r"(<img[^>]*>)\s*([^<]+)\s*</a>",
            re.S,
        )
        style_pattern = re.compile(
            r"<a[^>]+href=(?:\"([^\"]*?/heavenburnsred/\d+)\"|'([^']*?/heavenburnsred/\d+)')[^>]*>\s*"
            r"(<img[^>]*>)\s*</a>",
            re.S,
        )

        characters: dict[str, Any] = {}

        for idx, squad_m in enumerate(squad_markers):
            squad = squad_m.group(1)
            seg_start = squad_m.end()
            seg_end = (
                squad_markers[idx + 1].start()
                if idx + 1 < len(squad_markers)
                else len(section)
            )
            seg = section[seg_start:seg_end]
            char_matches = list(char_pattern.finditer(seg))

            for c_idx, cm in enumerate(char_matches):
                href = cm.group(1) or cm.group(2) or ""
                img_tag = cm.group(3)
                visible_name = html.unescape(cm.group(4)).strip()

                width = self._extract_attr(img_tag, "width")
                height = self._extract_attr(img_tag, "height")
                if width != "50" or height != "50":
                    continue

                alt_name = html.unescape(self._extract_attr(img_tag, "alt")).strip()
                name = visible_name or alt_name
                if not name:
                    continue

                image_url = (
                    self._extract_attr(img_tag, "data-src")
                    or self._extract_attr(img_tag, "src")
                )
                image_url = self._normalize_url(image_url)
                if not image_url or image_url.startswith("data:image"):
                    continue

                page_url = self._normalize_url(href)
                if not page_url:
                    continue

                chunk_start = cm.end()
                chunk_end = (
                    char_matches[c_idx + 1].start()
                    if c_idx + 1 < len(char_matches)
                    else len(seg)
                )
                chunk = seg[chunk_start:chunk_end]

                tooltip = ""
                tm = re.search(
                    r"<template[^>]*js-tooltip-content[^>]*>(.*?)</template>",
                    chunk,
                    re.S,
                )
                if tm:
                    tooltip = tm.group(1)

                style_rows: list[dict[str, str]] = []
                seen_titles: set[str] = set()
                for sm in style_pattern.finditer(tooltip):
                    style_href = sm.group(1) or sm.group(2) or ""
                    style_img_tag = sm.group(3)

                    style_alt = html.unescape(self._extract_attr(style_img_tag, "alt"))
                    if not style_alt.endswith("の画像"):
                        continue

                    style_title = style_alt[: -len("の画像")].strip()
                    if not style_title or style_title in seen_titles:
                        continue

                    style_image = (
                        self._extract_attr(style_img_tag, "data-src")
                        or self._extract_attr(style_img_tag, "src")
                    )
                    style_image = self._normalize_url(style_image)
                    if not style_image or style_image.startswith("data:image"):
                        continue

                    style_page = self._normalize_url(style_href)
                    if not style_page:
                        continue

                    seen_titles.add(style_title)
                    style_rows.append(
                        {
                            "title": style_title,
                            "page_url": style_page,
                            "image_url": style_image,
                        }
                    )

                characters[name] = {
                    "character": name,
                    "squad": squad,
                    "page_url": page_url,
                    "image_url": image_url,
                    "source": "Game8",
                    "fetched_at": time.time(),
                    "styles": style_rows,
                }

        return {"characters": characters}

    def _extract_attr(self, tag: str, attr: str) -> str:
        m = re.search(
            rf"{re.escape(attr)}\s*=\s*(?:\"([^\"]*)\"|'([^']*)')",
            tag,
            re.S,
        )
        if not m:
            return ""
        value = m.group(1) if m.group(1) is not None else m.group(2)
        return html.unescape(value or "")

    def _normalize_url(self, url: str) -> str:
        text = (url or "").strip()
        if not text:
            return ""
        if text.startswith("//"):
            return "https:" + text
        if text.startswith("/"):
            return "https://game8.jp" + text
        return text
