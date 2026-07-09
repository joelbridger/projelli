# Lantern Board — Complete Overhaul Brief (2026-07-09)

**You are a Codex implementation worker.** Jameson (the owner) asked for a *complete overhaul* of his private project board. It is frozen at **June 29** and still branded **"Keepance"** — it misses his entire **July 8** push. Your job is the development labor: rewrite the content to today's reality, rebrand it **"Lantern"**, wire in two new report pages, and prep for deploy. The coordinator (Claude/Fable) wrote this brief, will handle the domain rename + final review + deploy. **Do not deploy or touch cloudflared/DNS — that's the coordinator's.**

## Files you edit (ALL under `~/keepance/docs/board/`)
- `board-data.json` — the CONTENT (70KB, structured). Source of truth for every section. **Must stay valid JSON** (run `node -e "JSON.parse(require('fs').readFileSync('board-data.json','utf8'))"` after every edit; a broken file cannot ship).
- `index.html` — the DESIGN + tab definitions + render logic. Rebrand literals + update the `tabs` array here.
- Two report pages are **already copied in**: `night-review.html`, `compliance-pack.html`. You only need to **link** them from the data — do not modify them.
- Do NOT run `deploy.sh`. Leave everything in the source dir for the coordinator to review + deploy.

## GROUND TRUTH — read these first (this is the real current state; do not invent facts)
1. `~/lantern-plus/coordination/STATUS.md` — **top 4 updates** (2026-07-09). This is the single best current digest. Read it fully.
2. `~/lantern-plus/docs/plans/onboarding-reframe.md` — the new pitch/direction (the compliance wedge).
3. `~/lantern-plus/coordination/reports/sec-ria-compliance-research.md` — the compliance research.
4. `~/lantern-plus/coordination/reports/{jump-parity-plan,schwab-creative-paths,connector-strategy,calendly-build-seams}.md` — the current build thrust.
5. `~/lantern-plus/docs/user-research/2026-07-08-wife-onboarding/ANALYSIS.md` — the research that drives the reframe. (Audio is private — never quote verbatim voice; summarize insights only.)

Everything below tells you the structure, the exact meta/headline text (use verbatim), and per-section what to keep / rewrite / cut / archive.

---

## 1. REBRAND RULES (apply everywhere: board-data.json + index.html)

- The **board itself** is now **"Lantern"** (Jameson's internal name for the whole platform/effort).
- The **product advisors see** is **"Advisor Prep Hero"** (the customer-facing brand).
- Rule of thumb: replace **"Keepance"** → **"Lantern"** when the sentence is about the *project / platform / company / the thing being built*. Use **"Advisor Prep Hero"** only when the sentence is specifically about *what the advisor sees / the product's brand name* (onboarding hero, the app's Notice Card, the marketing site).
- Add ONE clarifying line in the Strategy section's `now`: *"Lantern is the internal name for the platform; advisors see the product as **Advisor Prep Hero** (advisorprephero.com)."*
- In `index.html` there are 4 "Keepance" literals (lines ~7, ~198, ~210, ~211) — rebrand the page `<title>`, footer, and any brand text to "Lantern".
- **Never** rename or touch `matter_id` / internal isolation keys — but that's code, not this board; just don't introduce confusion in copy.

---

## 2. META BLOCK — replace `board-data.json` `.meta` with EXACTLY this (verbatim):

```json
{
  "title": "Lantern — Project Board",
  "subtitle": "The private, local-first client-intelligence app for financial advisors — internal build board",
  "framing": "Jameson = Board of Directors  ·  Claude = CEO reporting in",
  "lastUpdated": "July 9, 2026",
  "headline": "NEW (2026-07-09) — THE WEDGE IS COMPLIANCE. Live advisor research (design-partner onboarding, 2026-07-08) confirmed the real buying gate: an advisor cannot put client data into ChatGPT, and compliance approval comes BEFORE any interest in features. Lantern's local-first architecture IS the answer to that #1 pain — so the pitch now leads with it: 'The AI you're actually allowed to use with client data.' Everything about the client stays on the advisor's own machine; answers come with citations. Current thrust: (1) a polished Compliance & Security pack an advisor can hand straight to their compliance officer (the gate-opener), (2) a reframed onboarding that leads with the compliance answer, (3) closing Jump feature-parity where it matters — calendar/scheduling + account-opening prefill — as a simple, AI-first app, NOT a 'connect 60 things' note-taker. Go-to-market is design-partner-led and XYPN-approved-list first. This refines the 2026-06-29 'compete head-on as the leading, simple, AI-first advisor app' stance (still in force); it does NOT retreat to a niche.",
  "updateRule": "High bar: a Claude session only updates this for a MAJOR decision, a validated insight, a strategy shift, or a real milestone. Routine work never touches it. Jameson maintains it freely."
}
```

---

## 3. TAB STRUCTURE — update the `tabs` array in `index.html` to this order:

```
overview   (special tiles — keep as is)
strategy   → sections: ["strategy","competitive"]
compliance → sections: ["compliance"]          ← NEW TAB, place 2nd/3rd (it's the wedge)
roadmap    → sections: ["roadmap"]
product    → sections: ["engineering","design"]  ← merge old ux+ui into ONE "design" section
gtm        → sections: ["marketing","sales","growth"]
testing    → sections: ["testing"]
demo       → sections: ["demo"]
finance    → sections: ["finance"]
questions  → sections: ["questions"]
persondev  → sections: ["persondev"]
archive    → sections: ["archive"]             ← NEW TAB, LAST
```
- Label the compliance tab **"Compliance"**, the archive tab **"Archive"**, product tab keeps label "Product".
- Delete the old **"Strategic Memo"** tab (its `memo` section moves into Archive — see §5).

---

## 4. SECTIONS — per-section instructions

For every section keep the existing JSON **shape/keys** (id, title, icon, status, now, and its content arrays like decisions/insights/links, or its `type` + specialized keys). Only the *values* change. Keep `type` fields intact so rendering doesn't break (testing/questions/roadmap/demo/persondev have `type`; standard sections don't).

### strategy (Strategy & Vision) — REWRITE
- `status`: "Compliance-led, competing head-on"
- `now`: lead with the compliance wedge (the new headline in one paragraph) + the clarifying Lantern/Advisor Prep Hero line. Keep: head-on vs Jump, simple AI-first not a note-taker, beachhead = solo/small fee-only RIAs, local-first as the credible proof.
- `decisions`: keep the 2026-06-29 head-on decision + the re-aim (law→advisors) + demo-first + do-not-rename-matter_id, and ADD the 2026-07-08 research-driven decisions: compliance is the buying gate (two-pillar: "can we use it?" before "what does it do?"); lead the pitch with "the AI you're allowed to use"; build the CCO compliance pack as the gate-opener; GTM is design-partner-led → XYPN approved-list → firm → peers.
- `insights`: keep the firsthand Jump read; ADD the research insights from ANALYSIS.md (compliance gate first; the design partner quit at gate #1 for lack of a compliance answer; local-first = structural advantage; consumer provider names matter — "ChatGPT" not "OpenAI").
- `links`: keep the strategy report links; ADD `{"label":"🌙 Night Review — full current snapshot (2026-07-09)","doc":"night-review.html"}` as the FIRST link.

### compliance (Compliance & Security) — NEW SECTION (standard type, no `type` field)
- `id`:"compliance", `title`:"Compliance & Security", `icon`:"🛡️", `status`:"The gate-opener — pack drafted"
- `now`: one paragraph — compliance approval is the first buying gate; Lantern's local-first design is the structural answer; we hand the advisor a pack for their compliance officer. Note the SEC reality from the research (Reg S-P 2024 amendments = the concrete bar; no explicit AI-software rule; local-first is a structural advantage). Name the target reviewer pattern (e.g. Synergy Compliance / a CCO).
- `decisions`: build a polished CCO pack (drafted, `docs/partnerships/compliance-pack/`); a compliance video script drafted; defer SOC 2 until a real deal demands it, lead with local-first until then.
- `insights`: pull the 10-item "what a CCO needs" checklist mapped to SEC rules from `sec-ria-compliance-research.md` (summarize as ~5-7 bullets).
- `links`:
  - `{"label":"🛡️ Compliance & Security Pack — hand this to the compliance officer","doc":"compliance-pack.html"}`
  - `{"label":"📋 SEC/RIA compliance research — what Synergy/CCO needs, mapped to SEC rules","doc":"https://jameworld.com/claudereports/night-review.html"}` ← use the night-review link if no standalone research page exists; otherwise omit.
  - Keep it to real, existing pages only. `compliance-pack.html` and `night-review.html` both exist in this dir.

### roadmap (Roadmap) — REWRITE lanes (`type`:"roadmap", keep shape)
Reflect current reality. Suggested lanes/state:
- **Shipped**: two full UI feedback rounds (7,108 tests green), swappable brand system (Advisor Prep Hero restored), clean-slate demo on the Legion, Notice Card product-branding, unified rail widths, R17 deep-test fixes (documents-tab, local-AI download+citations, Outlook reconnect, OneDrive import).
- **In flight**: reframed onboarding (compliance-led, built on `feat/onboarding-reframe`, not yet merged — present first); calendar/scheduling (Calendly clone Phase 1+2 on `feat/calendly-scheduling`, timezone polish in flight); Schwab account-opening prefill (Phase 1 on `feat/schwab-prefill`); compliance pack + video.
- **Next / gated on Jameson**: merge reframed onboarding + calendar to the preview; Plaid go/no-go; approve-all on the v2 UI preview; assured-routing lane (built, gated); final signed installer.
- Cut anything that's stale or was speculative and never started.

### engineering (Engineering) — REWRITE
- `status`: "Feature-parity push + release hardening"
- `now`: the app is functionally solid on Windows (bench-verified); current engineering = closing Jump parity (calendar WRITE + scopes + booking domain; Schwab prefill via 8 account-type field maps) + release pipeline (Tauri version align, signed installer).
- `decisions`/`insights`: reuse the engine, don't rename matter_id; connector strategy = "meet advisors where their data lives" + creative paths for gated connectors (Schwab/Redtail/etc.); booking page Option A (privacy-preserving, stores only busy/free + slug, never client data).
- `links`: keep useful ones; add night-review.html.

### design (Design) — NEW MERGED SECTION (was ux + ui)
- `id`:"design", `title`:"Design & UX", `icon`:"🎨", `status`:"Overhaul shipped; design system refreshed"
- `now`: two rounds of feedback overhaul shipped; the app is simpler and on-brand; the design system docs were refreshed after the overhaul; onboarding reframe is a narrative/copy change on the same liked visuals.
- `decisions`/`insights`: merge the still-true points from the old `ux` and `ui` sections; drop anything already done/superseded. Light theme, kp/* primitives, unified tokens.

### competitive (Competitive & Market) — UPDATE
- Keep the Jump head-on read (firsthand: Jump's AI is scattered, still a note-taker — our opening). Add: the research validates compliance-led differentiation. Keep as market intel.

### marketing / sales / growth (Go-to-Market) — THIN + UPDATE
- Collapse to the current plan: **design-partner-led** (start with the design partner, then her firm, then peers) + **XYPN approved-list** as the scalable channel (the "Jump path") + Microsoft-adjacency + herd-adoption logos + court Synergy Compliance. North Star = weekly active advisors who ran a real client workflow. Cut speculative tactics that were never acted on (move any you want to keep to Archive).

### testing (Testing) — UPDATE (`type`:"testing", keep shape)
- Current: 7,108 tests + guards green; real-Windows bench QA on the Legion (R17 deep test: onboarding, all 3 cloud AI providers, local AI, connectors, real file search + real cited answers — mostly PASS, 4 bugs found+fixed); signed-installer pipeline (Azure Trusted Signing) validated; Tauri version-align fix pending for the final signed cut.

### demo (Demo) — UPDATE (`type`:"demo", keep shape)
- Current: clean-slate demo on the Legion for the design partner; the aha-path (connect AI → import → progress → search → cited answer → start a meeting). Note the 2026-07-08 live walkthrough happened and drove the research/reframe. Notice Card shows "⏺ Recording · Advisor Prep Hero".

### finance (Finance & Metrics) — UPDATE
- Keep it honest: pre-revenue; ~zero traction is the reality the whole strategy responds to. Pricing decision open (test higher advisor tier, advisors spend $6-12K/yr on software). North Star = weekly active advisors. Cut invented numbers.

### questions (Jameson's Questions) — REWRITE to the CURRENT open decisions (`type`:"questions", keep shape)
Replace the question list with the decisions actually awaiting Jameson now (from STATUS.md "AWAITING JAMESON"):
- Ship the reframed onboarding + calendar to the demo laptop to click live? (rec: yes, present first then ship)
- Plaid go/no-go — a fast Schwab-data win? (rec: yes if it unblocks account data cheaply)
- Approve-all on the v2 UI preview (both feedback rounds)? (rec: yes)
- Green-light the assured-routing lane merge (built, gated)? 
- Green-light XYPN-approved-list GTM? 
- Booking-page deploy is commercial → needs explicit go before it goes live.
Keep the two still-valid "answered" ones (Windows-vs-Mac, "what else with AI") at the bottom if still useful; otherwise move to Archive.

### persondev (Personal Development) — KEEP light-touch (`type`:"persondev")
- Leave the structure. Only update if something is clearly stale. Do not invent personal goals.

### archive (Archive) — NEW SECTION (LAST). Two options — pick the simplest that renders:
- Simplest: make it a **standard** section (no `type`) titled "Archive", `icon`:"🗄️", `status`:"Superseded — kept for reference", with a `now` explaining it holds prior direction/docs that were superseded but may still be useful, and a `links` array pointing to the old standalone HTML pages that still exist in this dir (`keepance-ceo-evaluation.html`, `proof-sprint-futurevault.html`, `proof-sprint-session-plan.html`, `proof-sprint-trust-sheet.html`, `cold-call-guide.html`, `q-ai-opportunities.html`, `q-platform-windows-vs-mac.html`) + a bullet list (in `insights`) summarizing the archived **Strategic Advisor Memo** (the 2026-06-28 "retreat to a niche" counsel — kept as market intel, NOT direction).
- The old `memo` section content: fold its key points into the Archive section's `insights` as a short summary + keep its links. You may DELETE the standalone `memo` section object, OR keep it but remove it from all tabs. Cleanest: delete the `memo` section and represent it inside `archive`.

---

## 5. WHAT TO CUT vs ARCHIVE
- **Cut outright** (delete): anything describing work as "planned/next" that is now DONE (re-state as done in roadmap instead), invented finance numbers, speculative GTM tactics never acted on, the June-29 headline (replaced by the new one).
- **Archive** (move to the Archive section): the Strategic Advisor Memo, the proof-sprint docs, the CEO evaluation, old cold-call guide, the two "answered questions" pages if you pull them out of questions.
- When unsure, Archive rather than delete — Jameson said he's fine keeping a reference pile.

---

## 6. WIRING THE TWO REPORTS
- `night-review.html` and `compliance-pack.html` are ALREADY in this dir. The board's link renderer opens a `"doc"` value as a page. So just add `{"label":"…","doc":"night-review.html"}` / `{"label":"…","doc":"compliance-pack.html"}` link entries where the brief says (Strategy + Overview surface the night review; Compliance section surfaces both).
- Verify the link renderer in `index.html` (the `renderStandard` links block) handles a local `.html` `doc` the same way the existing ones do (e.g. `keepance-ceo-evaluation.html` — it does). No renderer change needed.

## 7. DONE = 
1. `board-data.json` is valid JSON, rebranded, every section reflects 2026-07-09 reality per this brief, new `compliance` + `archive` sections present, `memo` folded into archive, `ux`+`ui` merged into `design`.
2. `index.html` tabs array updated to §3, brand literals → "Lantern".
3. Both report links wired.
4. Report back a short summary of what you changed per section + confirm `node -e JSON.parse` passes. **Do NOT deploy.** End your final message with `DONE-EXIT:0`.
