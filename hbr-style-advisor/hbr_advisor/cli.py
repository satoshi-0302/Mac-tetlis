from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Optional

from .data_store import AdvisorData, load_data_json
from .excel_parser import build_json_dataset, build_workbook_data
from .models import TeamPlan
from .recommender import BattleAdvisor, split_style_input
from .reporter import build_html_report, render_console_report
from .style_database import (
    build_style_database,
    write_style_database_html,
    write_style_database_json,
)
from .web_app import run_web_app
from .web_lookup import StyleWebInfoResolver


def _load_data(args: argparse.Namespace) -> AdvisorData:
    if args.data:
        loaded = load_data_json(args.data)
        return AdvisorData(loaded.styles, loaded.skills, loaded.enemies, loaded.knowledge)

    if not args.xlsx:
        raise ValueError("--data か --xlsx のどちらかを指定してください")

    wb = build_workbook_data(args.xlsx)
    return AdvisorData(wb.styles, wb.skills, wb.enemies, wb.knowledge)


def _team_payload(plan: TeamPlan, web_infos: Optional[dict] = None) -> dict:
    web_infos = web_infos or {}
    return {
        "enemy": plan.enemy.to_dict() if plan.enemy else None,
        "estimated_damage": plan.estimated_damage,
        "relative_score": plan.relative_score,
        "turn_plan": plan.turn_plan,
        "team": [
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
                "web_info": (
                    web_infos[sc.style.style_name].to_dict()
                    if sc.style.style_name in web_infos
                    else None
                ),
            }
            for sc in plan.team
        ],
        "unmatched_owned": plan.unmatched_owned,
        "unmatched_wanted": plan.unmatched_wanted,
    }


def cmd_build_data(args: argparse.Namespace) -> int:
    payload = build_json_dataset(args.xlsx, args.out)
    knowledge_count = 0
    if isinstance(payload.get("knowledge"), dict):
        for value in payload["knowledge"].values():
            if isinstance(value, list):
                knowledge_count += len(value)
    print(
        f"dataset written: {args.out} (styles={len(payload['styles'])}, skills={len(payload['skills'])}, enemies={len(payload['enemies'])}, knowledge_rows={knowledge_count})"
    )
    return 0


def cmd_recommend(args: argparse.Namespace) -> int:
    data = _load_data(args)
    advisor = BattleAdvisor(data.styles, data.skills, data.enemies, data.knowledge)

    owned = split_style_input(args.owned)
    wanted = split_style_input(args.wanted)

    plan = advisor.recommend(
        owned_queries=owned,
        wanted_queries=wanted,
        enemy_name=args.enemy,
        preferred_weapon=args.weapon,
        preferred_element=args.element,
        team_size=args.team_size,
    )

    web_infos = {}
    if args.fetch_images:
        resolver = StyleWebInfoResolver(args.cache)
        for sc in plan.team:
            info = resolver.lookup(sc.style.style_name, sc.style.character)
            if info:
                web_infos[sc.style.style_name] = info

    print(render_console_report(plan, web_infos))

    if args.json_out:
        out = Path(args.json_out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(
            json.dumps(_team_payload(plan, web_infos), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"\njson report: {out}")

    if args.html_report:
        build_html_report(plan, web_infos, args.html_report)
        print(f"html report: {args.html_report}")

    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    data = _load_data(args)
    run_web_app(
        data=data,
        host=args.host,
        port=args.port,
        cache_path=args.cache,
        style_db_path=args.style_db,
    )
    return 0


def cmd_build_style_db(args: argparse.Namespace) -> int:
    data = _load_data(args)
    payload = build_style_database(
        data=data,
        cache_path=args.cache,
        fetch_web=args.fetch_web,
        fetch_style_images=args.fetch_style_images,
        style_fetch_limit=args.style_fetch_limit,
    )
    write_style_database_json(payload, args.out_json)
    write_style_database_html(payload, args.out_html)
    print(
        f"style db generated: json={args.out_json}, html={args.out_html} "
        f"(styles={payload['meta']['style_count']}, characters={payload['meta']['character_count']}, squads={payload['meta']['squad_count']})"
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="hbr-advisor",
        description="HBR style-based team recommendation and simple damage simulation",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_build = sub.add_parser("build-data", help="Parse xlsx and build JSON dataset")
    p_build.add_argument("--xlsx", required=True, help="Path to source xlsx file")
    p_build.add_argument("--out", required=True, help="Path to output JSON")
    p_build.set_defaults(func=cmd_build_data)

    p_rec = sub.add_parser("recommend", help="Recommend team and battle plan")
    p_rec.add_argument("--data", help="Path to prebuilt JSON dataset")
    p_rec.add_argument("--xlsx", help="Path to xlsx if data JSON is not given")
    p_rec.add_argument(
        "--owned",
        default="",
        help="Owned style names (comma/newline separated; fuzzy match supported)",
    )
    p_rec.add_argument(
        "--wanted",
        default="",
        help="Wanted style names (comma/newline separated; fuzzy match supported)",
    )
    p_rec.add_argument("--enemy", default="", help="Enemy name from 仮想敵")
    p_rec.add_argument("--weapon", default="", choices=["", "斬", "突", "打"]) 
    p_rec.add_argument(
        "--element", default="", choices=["", "火", "氷", "雷", "光", "闇", "無"]
    )
    p_rec.add_argument("--team-size", type=int, default=6)
    p_rec.add_argument("--fetch-images", action="store_true")
    p_rec.add_argument(
        "--cache",
        default="data/image_cache.json",
        help="Image lookup cache JSON path",
    )
    p_rec.add_argument(
        "--json-out",
        default="",
        help="Write recommendation payload JSON",
    )
    p_rec.add_argument(
        "--html-report",
        default="",
        help="Write visual HTML report (images + squad + style)",
    )
    p_rec.set_defaults(func=cmd_recommend)

    p_serve = sub.add_parser(
        "serve", help="Run local selectable web UI (owned styles are selected from list)"
    )
    p_serve.add_argument("--data", help="Path to prebuilt JSON dataset")
    p_serve.add_argument("--xlsx", help="Path to xlsx if data JSON is not given")
    p_serve.add_argument("--host", default="127.0.0.1", help="Bind host")
    p_serve.add_argument("--port", type=int, default=8787, help="Bind port")
    p_serve.add_argument(
        "--cache",
        default="data/image_cache.json",
        help="Image lookup cache JSON path",
    )
    p_serve.add_argument(
        "--style-db",
        default="data/style_database.json",
        help="Style database JSON for fast 6-style selector (squad/image linked)",
    )
    p_serve.set_defaults(func=cmd_serve)

    p_style = sub.add_parser(
        "build-style-db",
        help="Build full graphical style database (squad-character-style linked)",
    )
    p_style.add_argument("--data", help="Path to prebuilt JSON dataset")
    p_style.add_argument("--xlsx", help="Path to xlsx if data JSON is not given")
    p_style.add_argument(
        "--cache",
        default="data/image_cache.json",
        help="Web info cache JSON path",
    )
    p_style.add_argument(
        "--out-json",
        default="data/style_database.json",
        help="Output style database JSON path",
    )
    p_style.add_argument(
        "--out-html",
        default="reports/style_database.html",
        help="Output graphical style database HTML path",
    )
    p_style.add_argument(
        "--fetch-web",
        action="store_true",
        help="Fetch character squad/image from Game8 (recommended)",
    )
    p_style.add_argument(
        "--fetch-style-images",
        action="store_true",
        help="Resolve style-specific pages/images for cards (slow)",
    )
    p_style.add_argument(
        "--style-fetch-limit",
        type=int,
        default=0,
        help="Limit style image fetch count (0 means no limit when enabled)",
    )
    p_style.set_defaults(func=cmd_build_style_db)

    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
