# Design brief: LANTERN INTAKE — the flagship Onboarding OS build
**Issued by:** the Lantern coordinator, 2026-07-10, on Jameson's direct greenlight ("I absolutely love the idea of the lantern intake... I want the best mind on that to build that out").
**You (the reader) are:** a dedicated Fable 5 design session. Your ONLY job is to produce the definitive product + technical design and an executable wave plan for Lantern Intake. You do not write product code.

## Read first, in order
1. `~/lantern-plus/docs/2026-07-10-advisor-pain-analysis-and-lantern-answers.md` — the full pain analysis; Intake is section 3. This brief extends it.
2. `~/lantern-plus/docs/General Advisor Pain Feedback 070926.md` — the raw field research.
3. `~/lantern-plus/LANTERN-PLUS.md` + `docs/plans/lantern-plus/` — this fork's mission, branch rules, and the existing wave-plan format (Calendly + Schwab-prefill plans live here; Intake must compose with them, they become their "paperwork stage").
4. Architecture ground truth: `~/lp-ux-integrate` (branch lp/ux-simplify-v1) — especially `backend/` (the E2EE firm relay: ciphertext-only server pattern you MUST reuse for the client-facing intake link), `src/platform/matter/` (client model), `src/features/matters/` (client hub UI, where the onboarding board lives), the approval-gated CRM write engine (`src-tauri/src/commands/crm/`, merged 2026-07-09), and `ARCHITECTURE.md` (5-layer DAG rules).
5. Board constraints: `~/lantern/docs/strategy/2026-06-29-board-decision-leading-advisor-ai.md` — simple AI-first app; NEVER a note-taker; no integration-breadth arms race. And the repo CLAUDE.md hard rules: robust-no-shortcuts on core product; E2EE-only for anything server-side; matter_id never renamed; light theme; no em dashes in user-facing copy.

## Jameson's direct product decisions (locked, design around them)
- Entry point #1: the **"New client" button** starts intake.
- Entry point #2: intake must be **reachable for EXISTING clients still mid-process** (an in-progress onboarding attached to a client, resumable/manageable from their client page).
- Magic form v1 field set (start here, extend sensibly): **date of birth, Social Security number, driver's license scan (front AND back), spending information, income information.**
- Clients MAY type SSN/sensitive data into an end-to-end-encrypted web page (validated with the design-partner firm). Phone/verbal is not required for any field.
- The onboarding tracker's value is rated VERY HIGH — it is a first-class surface, not an afterthought.

## What you must deliver (files in ~/lantern-plus/docs/plans/lantern-plus/intake/)
1. **PRODUCT-DESIGN.md** — flows with the care of a great product designer (Jameson IS one; write so he can see it):
   - Advisor: New client → intake checklist composer (template + per-client tweaks) → send link (email/SMS-copyable) → onboarding board (progress, missing items, days-stalled, nudge queue) → per-client onboarding tab for existing/in-process clients.
   - Client: open link (no account, mobile-first, firm-branded, LIGHT theme) → guided checklist, one item at a time → uploads + typed fields + "I don't know" paths → save/resume → completion + what-happens-next page (expectation-setting, P7).
   - Email-native fallback: client replies to a normal email; Lantern ingests, extracts, checks items off the same checklist. Design the matching rules + advisor confirmation step (never silently file wrong data).
   - Phone-walkthrough mode: advisor fills the same checklist live during a call.
   - AI moments: Document Detective (instant "this is your IRA statement; we still need the brokerage one"), income/spending extraction from uploaded docs, nudge drafting in the advisor's voice with approval.
   - Every AI action follows house rules: propose-then-approve, receipts, audit rows (reuse the intent/outcome pair machinery from 2026-07-09).
2. **ARCHITECTURE.md** — the E2EE design, with a threat model:
   - Reuse the firm-relay pattern (api.keepance.com stores ciphertext only). Define the key model precisely (per-intake keypair; private key held where? advisor machine / OS keychain; multi-advisor firm case), link lifecycle (expiry, revocation, resume tokens), client-browser crypto (WebCrypto; what the client page can and cannot see), upload chunking for large scans, and what metadata the server unavoidably sees (be honest; minimize).
   - SSN/DL handling on the advisor machine after decryption: where it lands (vault? encrypted store?), retention, masking in UI, audit.
   - The "ask once" data layer: intake answers become structured client facts that downstream prefill (Schwab forms, ACATS, RightCapital) can consume — define that schema now even though prefill ships later.
   - Failure modes: link opened twice, client on old browser, partial uploads, advisor offline.
3. **WAVE-PLAN.md** — implementation waves sized for Codex lanes with Claude review (the house pattern), each wave independently shippable, gates defined (tests + bench verification via the Legion bridge). Wave 1 must be the smallest honest slice: send link → client enters the 5 locked fields + uploads → E2EE round trip → items land in the client's folder + checklist state visible on the client page. Later waves: board + nudges, email-native fallback, Document Detective, phone mode, welcome journey, analytics.
4. **QUESTIONS-FOR-JAMESON.md** — only decisions that genuinely need him (product/design/pricing-tier placement), each with your recommended answer. He answers one at a time; keep it short.
5. **RISKS.md** — compliance notes (SSN handling expectations, Reg S-P framing), the hosted-component security bar, DL-scan storage, and what we must NEVER claim (no SOC 2 certification claims).

## Method requirements
- Self-converge before handing off: run `codex-review` on your design docs (yes, docs — adversarial review for security holes and product gaps; prompt Codex to attack the E2EE story and the client UX for drop-off risk) and fold in findings; note rounds in the handoff.
- Verify architecture claims against the REAL code in ~/lp-ux-integrate (e.g., confirm what the relay actually supports today; name files). No hand-waving.
- Keep the Intake identity subordinate to the app's: it is how data enters the private intelligence layer; the Client Map should visibly begin growing from intake facts (that is the demo moment).
- When completely done: commit your docs on a branch `plan/intake-design` in ~/lantern-plus, push, then print exactly: `WORKER-DONE: plan/intake-design` followed by a 10-line evidence summary (files, codex-review rounds, open questions count).
