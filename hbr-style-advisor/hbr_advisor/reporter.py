from __future__ import annotations

import html
from pathlib import Path
from typing import Optional

from .models import TeamPlan
from .web_lookup import StyleWebInfo


def render_console_report(plan: TeamPlan, web_info: dict[str, StyleWebInfo]) -> str:
    lines: list[str] = []

    if plan.enemy is not None:
        lines.append(f"Enemy: {plan.enemy.name} ({plan.enemy.category})")
    else:
        lines.append("Enemy: (not selected)")

    lines.append(f"Estimated Damage: {plan.estimated_damage:,.0f}")
    lines.append(f"Relative Score: x{plan.relative_score:.2f}")
    lines.append("")
    lines.append("Recommended Team")
    lines.append("-" * 72)

    for idx, sc in enumerate(plan.team, start=1):
        finisher = sc.finisher_skill.skill_name if sc.finisher_skill else "-"
        breaker = sc.breaker_skill.skill_name if sc.breaker_skill else "-"
        info = web_info.get(sc.style.style_name)
        squad = info.squad if info else ""
        squad_text = f" / {squad}" if squad else ""
        tier_text = ""
        if info and (info.tier_overall or info.tier_roles):
            overall = f"総合Tier{info.tier_overall}" if info.tier_overall else ""
            detail = info.tier_roles
            tier_parts = [x for x in [overall, detail] if x]
            if tier_parts:
                tier_text = "  strategy=" + " | ".join(tier_parts)
        phase_text = ""
        if breaker != "-" and breaker != finisher:
            phase_text = f"  break={breaker}"
        lines.append(
            f"{idx:>2}. {sc.style.style_name}{squad_text} [{sc.role}]  "
            f"score={sc.total_score:.2f}  finisher={finisher}{phase_text}{tier_text}"
        )

    lines.append("")
    lines.append("Turn Plan")
    lines.append("-" * 72)
    for row in plan.turn_plan:
        lines.append(f"- {row}")

    if plan.unmatched_owned:
        lines.append("")
        lines.append("Unmatched owned styles: " + ", ".join(plan.unmatched_owned))

    if plan.unmatched_wanted:
        lines.append("Unmatched wanted styles: " + ", ".join(plan.unmatched_wanted))

    return "\n".join(lines)


def build_html_report(
    plan: TeamPlan,
    web_info: dict[str, StyleWebInfo],
    out_path: str | Path,
) -> None:
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    cards: list[str] = []
    for sc in plan.team:
        info: Optional[StyleWebInfo] = web_info.get(sc.style.style_name)
        image_html = ""
        source_html = ""

        if info and info.image_url:
            image_html = (
                f'<img src="{html.escape(info.image_url)}" alt="{html.escape(sc.style.style_name)}" '
                'style="width:100%;max-height:260px;object-fit:cover;border-radius:10px;" />'
            )
            if info.page_url:
                source_html = (
                    f'<a href="{html.escape(info.page_url)}" target="_blank" rel="noopener">source</a>'
                )

        finisher = sc.finisher_skill.skill_name if sc.finisher_skill else "-"
        breaker = sc.breaker_skill.skill_name if sc.breaker_skill else "-"
        squad = info.squad if info and info.squad else "-"
        tier_overall = f"Tier{info.tier_overall}" if info and info.tier_overall else "-"
        tier_roles = info.tier_roles if info and info.tier_roles else "-"

        cards.append(
            f"""
            <article class=\"card\">\n
              {image_html}\n
              <h3>{html.escape(sc.style.style_name)}</h3>\n
              <p><b>キャラ:</b> {html.escape(sc.style.character)}</p>\n
              <p><b>所属組:</b> {html.escape(squad)}</p>\n
              <p><b>Game8総合Tier:</b> {html.escape(tier_overall)}</p>\n
              <p><b>Game8役割Tier:</b> {html.escape(tier_roles)}</p>\n
              <p><b>役割:</b> {html.escape(sc.role)}</p>\n
              <p><b>DPブレイク候補:</b> {html.escape(breaker)}</p>\n
              <p><b>推奨フィニッシャー:</b> {html.escape(finisher)}</p>\n
              <p><b>推奨スコア:</b> {sc.total_score:.2f}</p>\n
              <p class=\"source\">{source_html}</p>\n
            </article>
            """.strip()
        )

    enemy_text = html.escape(plan.enemy.name) if plan.enemy else "未指定"

    turn_items = "\n".join(f"<li>{html.escape(t)}</li>" for t in plan.turn_plan)
    cards_html = "\n".join(cards)

    page = f"""
<!doctype html>
<html lang=\"ja\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
  <title>HBR Team Recommendation</title>
  <style>
    :root {{
      --bg: #f8f7f3;
      --card: #ffffff;
      --ink: #222;
      --muted: #666;
      --accent: #2a7f62;
      --line: #ddd;
    }}
    body {{
      margin: 0;
      font-family: "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif;
      background: radial-gradient(circle at 20% 0%, #fff, var(--bg));
      color: var(--ink);
    }}
    main {{
      max-width: 1200px;
      margin: 0 auto;
      padding: 24px;
    }}
    h1 {{ margin: 0 0 8px; }}
    .meta {{ color: var(--muted); margin-bottom: 18px; }}
    .summary {{
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 14px 16px;
      margin-bottom: 20px;
    }}
    .cards {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 14px;
    }}
    .card {{
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px;
    }}
    .card h3 {{
      margin: 10px 0 8px;
      font-size: 18px;
      line-height: 1.35;
    }}
    .card p {{
      margin: 6px 0;
      font-size: 14px;
    }}
    .source a {{ color: var(--accent); text-decoration: none; }}
    .turn-plan {{
      margin-top: 24px;
      background: var(--card);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px 18px;
    }}
    .turn-plan li {{ margin: 8px 0; }}
  </style>
</head>
<body>
  <main>
    <h1>HBR 最大ダメージ向け編成提案</h1>
    <div class=\"meta\">敵: {enemy_text}</div>

    <section class=\"summary\">
      <div><b>推定ダメージ:</b> {plan.estimated_damage:,.0f}</div>
      <div><b>相対スコア:</b> x{plan.relative_score:.2f}</div>
      <div><b>編成人数:</b> {len(plan.team)}</div>
    </section>

    <section class=\"cards\">
      {cards_html}
    </section>

    <section class=\"turn-plan\">
      <h2>推奨行動</h2>
      <ol>
        {turn_items}
      </ol>
    </section>
  </main>
</body>
</html>
""".strip()

    out.write_text(page, encoding="utf-8")
