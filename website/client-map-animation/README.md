# Client Map onboarding animation — FINAL (financial-advisor version)

**Status:** ✅ Approved by Jameson 2026-06-24 as "the final version for now."
**Not yet integrated** into the homepage — this is a standalone, reference-ready artifact.
**Audience:** financial advisors (Keepance was re-aimed from law firms to advisors on 2026-06-23 — see `~/keepance/docs/strategy/2026-06-23-reaim-to-financial-advisors.md`).

This is the animated hero for the homepage "Client Map" section. It is self-contained
HTML + GSAP (no build step needed to *view* it).

## Files
| File | What it is |
|---|---|
| `index.html` | The final animation. Open it in a browser — that's the whole thing. |
| `gsap.min.js` | Self-hosted GSAP 3.13 (no CDN, for supply-chain safety). `index.html` loads it by relative path. |
| `build.py` | The generator that produced `index.html`. Edit this, not the HTML. |

## Preview it
Serve this folder (or the whole `website/`) over HTTP and open it. Example:
```bash
cd website/client-map-animation && python3 -m http.server 8903
# then open http://<host>:8903/   (on this server: http://100.68.20.52:8903/)
```
(Opening `index.html` via `file://` also works, but a local server is cleaner.)

## Change it
Edit `build.py`, then regenerate in place:
```bash
python3 build.py     # overwrites index.html next to it
```
Everything (the example client's data, the section list, the gap notes, the search
question/answer, all timings) lives as plain Python data/strings near the top of `build.py`.

## What the animation does (4 beats)
1. **Constellation** — nine advisor source materials light up one at a time, scattered and
   connected by a web of lines: Email, Statements, Meeting notes, Financial plan, KYC form,
   Risk profile, Calls, Calendar, Beneficiary forms.
2. **Dossier fades in BEHIND the web** — the light Client Map file glows in behind the
   still-visible source web (the card sits on a lower z-index layer).
3. **Sources line up into a list, then the list dissolves into the dossier** — the source
   icons fly into the file and form a "From your sources" checklist, then that list
   reorganizes into the five structured sections. (This is the "raw materials become the
   organized file" idea Jameson asked for.)
4. **Live dossier** — sections open/close on their own to reveal fields, gap notes
   ("Missing: …"), and per-section field counts; then the search bar types a real
   pre-meeting question and a cited answer slides up.

## Example content (the Smith household)
- **Sections:** Household & key people · Goals & priorities · Accounts & holdings ·
  Risk & suitability · Timeline & next actions.
- **Gaps flagged:** stale risk profile (suitability), a held-away 401(k) not linked, a
  missing trusted-contact form. (Two sections show "complete" for contrast.)
- **Search demo:** *"What's still open before the Smith review?"* → a cited answer drawn
  from those gaps, with Risk / Accounts / Household citation chips.

## Guardrails honored (don't break these when editing copy)
- **No compliance claims** — never say "compliant" or "guaranteed." Suitability/Reg-BI
  language stays factual ("risk profile is over a year old"), never a claim about the law.
- **No dollar figures** — accounts stay high-level (account *types*, not balances), so it
  never reads as financial advice.
- **No em dashes** in any visible copy (public-facing voice rule).
- **Light theme** for the dossier (matches the real app's default).

## Design decisions (so you don't relitigate them)
- Dossier is **light** (white card on the dark space) because the real product runs light by default.
- Section icons are **plain dark-blue glyphs, no gradient circles**; the "AS" avatar is a **solid dark-blue** circle (Jameson's call).
- The transition is **constellation → list → dossier** (Jameson rejected four earlier
  transitions: slide-aside, gather-up, unfold-from-client, soft-dissolve).
- The dossier reveals **behind** the web, not on top (Jameson's last note).

## Next step (when Jameson gives the word)
Integrate into the homepage `website/index.html` `#client-map` section, replacing the older
static radial map there (which still has the pre-pivot legal example). Keep it scroll-triggered
(play when the section enters the viewport) and give the card a fixed height so the page below
it doesn't jump as sections open/close.
