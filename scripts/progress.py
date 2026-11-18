#!/usr/bin/env python3
"""Build a progress bar from the checkboxes in docs/ROADMAP.md and inject it into README.md.

Usage: python3 scripts/progress.py
The README must contain the markers <!-- progress:start --> and <!-- progress:end -->.
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ROADMAP = ROOT / "docs" / "ROADMAP.md"
README = ROOT / "README.md"
WIDTH = 20


def bar(done: int, total: int) -> str:
    filled = round(WIDTH * done / total) if total else 0
    return "█" * filled + "░" * (WIDTH - filled)


def parse():
    phases, current = [], None
    for line in ROADMAP.read_text().splitlines():
        m = re.match(r"^##\s+(.*)", line)
        if m:
            current = {"name": m.group(1).strip(), "done": 0, "total": 0}
            phases.append(current)
            continue
        m = re.match(r"^- \[([ xX])\]", line)
        if m and current is not None:
            current["total"] += 1
            current["done"] += m.group(1).lower() == "x"
    return [p for p in phases if p["total"]]


def render(phases) -> str:
    done = sum(p["done"] for p in phases)
    total = sum(p["total"] for p in phases)
    pct = round(100 * done / total) if total else 0
    # current stage = first phase that is not fully complete
    current = next((p for p in phases if p["done"] < p["total"]), None)

    lines = [
        f"**Overall: {pct}%** ({done}/{total} tasks)",
        "",
        "```",
        f"[{bar(done, total)}] {pct}%",
        "```",
        "",
        "| Stage | Progress | Status |",
        "|-------|----------|--------|",
    ]
    for p in phases:
        p_pct = round(100 * p["done"] / p["total"])
        if p["done"] == p["total"]:
            status = "✅ Complete"
            name = p["name"]
        elif p is current:
            status = "🚧 **In progress (current stage)**"
            name = f"**▶ {p['name']}**"
        else:
            status = "⏳ Not started" if p["done"] == 0 else "🚧 Partial"
            name = p["name"]
        lines.append(f"| {name} | `{bar(p['done'], p['total'])}` {p_pct}% ({p['done']}/{p['total']}) | {status} |")
    return "\n".join(lines)


def main():
    block = f"<!-- progress:start -->\n{render(parse())}\n<!-- progress:end -->"
    text = README.read_text()
    new, n = re.subn(r"<!-- progress:start -->.*?<!-- progress:end -->", block, text, flags=re.S)
    if n != 1:
        raise SystemExit("README.md is missing the progress markers")
    README.write_text(new)
    print("README progress updated")


if __name__ == "__main__":
    main()
