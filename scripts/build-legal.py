#!/usr/bin/env python3
"""Erzeugt aus legal/AGB_2026-10.txt die Texte für Landingpage und Edge Function.

Ausgabe:
  landing/src/content/legal.ts                      – Blöcke für /agb und /widerruf
  supabase/functions/booking-checkout/legal.ts      – Klartext für die Bestätigungsmail

Aufruf aus dem Repo-Root: python3 scripts/build-legal.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "legal" / "AGB_2026-10.txt"
WIDERRUF_START = "Widerrufsbelehrung für Verbraucher"

lines = [l.strip() for l in SRC.read_text(encoding="utf-8").splitlines() if l.strip()]
title_idx = lines.index("Allgemeine Geschäftsbedingungen AGB")
w_idx = lines.index(WIDERRUF_START)


def blocks(part):
    out = []
    for line in part:
        if re.match(r"^\d{1,2} \S", line) and len(line) < 100 and not re.match(r"^\d+\.\d", line):
            out.append(("h2", line))
        elif (
            not re.search(r"[.:;!?)]$", line)
            and len(line) < 90
            and "_" not in line
            and not line[0].isdigit()
            and not line.startswith("An:")
        ):
            out.append(("h3", line))
        else:
            out.append(("p", line))
    return out


agb = blocks(lines[title_idx + 1 : w_idx])
widerruf = blocks(lines[w_idx + 1 :])


def ts_blocks(items):
    body = ",\n".join(f"  {{ kind: {json.dumps(k)}, text: {json.dumps(t, ensure_ascii=False)} }}" for k, t in items)
    return f"[\n{body},\n]"


landing = f"""// GENERIERT von scripts/build-legal.py aus legal/AGB_2026-10.txt – nicht von Hand ändern.
export interface LegalBlock {{
  kind: 'h2' | 'h3' | 'p'
  text: string
}}

export const AGB_VERSION = '2026-10'

export const AGB_BLOCKS: LegalBlock[] = {ts_blocks(agb)}

export const WIDERRUF_BLOCKS: LegalBlock[] = {ts_blocks(widerruf)}
"""

def plain(items):
    out = []
    for k, t in items:
        if k == "h2":
            out.append("")
            out.append(t.upper())
        elif k == "h3":
            out.append("")
            out.append(t)
        else:
            out.append(t)
    return "\n".join(out).strip()


edge = f"""// GENERIERT von scripts/build-legal.py aus legal/AGB_2026-10.txt – nicht von Hand ändern.
export const AGB_VERSION = '2026-10'

export const AGB_PLAIN = {json.dumps(plain(agb), ensure_ascii=False)}

export const WIDERRUF_PLAIN = {json.dumps(plain(widerruf), ensure_ascii=False)}
"""

(ROOT / "landing" / "src" / "content").mkdir(parents=True, exist_ok=True)
(ROOT / "landing" / "src" / "content" / "legal.ts").write_text(landing, encoding="utf-8")
(ROOT / "supabase" / "functions" / "booking-checkout" / "legal.ts").write_text(edge, encoding="utf-8")
print(f"AGB-Blöcke: {len(agb)}, Widerruf-Blöcke: {len(widerruf)}")
