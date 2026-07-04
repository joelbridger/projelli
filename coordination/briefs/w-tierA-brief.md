# Build brief — TRUST TIER A: "stop saying untrue things" (Jameson-approved, all items)

**Lane:** cc-lantern-tierA · dir `~/lp-tierA` (own worktree, branch `lp/trust-tier-a`). **Model:** Sonnet 5 · high.
**Read FIRST:** `docs/design/2026-07-04-skeptical-advisor-trust-review.md` (findings E1, E5-headline, R3, R7, P4, P6 — with file/line evidence pointers) + `docs/design/2026-07-04-trust-review-coordinator-recommendations.md` (Tier A scope). **Rules:** NO-SHORTCUTS on truthfulness — every new sentence must be verifiably true against the shipped behavior (read the code paths before writing copy). Marketing-voice rules apply to user-facing copy (plain, honest, no hedging jargon). i18n en/de/es for every changed string; i18n:check 0; en-json snapshot regen per its procedure. TDD where behavior changes (R7 is behavior). Codex self-review foreground/watched. PULL + reconcile before handoff.

## Scope — six items (two Tier-A items are NOT yours: E2-labels + the consent-script render bug live in the noticecard lane's files and are folded there)
1. **E1 — the Data Map's false Wealthbox claim** (`DataMapDialog.tsx:112`): replace "read-only: never writes anything back" with the truth — reads client data; writes ONLY advisor-approved notes/tasks through the review card, never silently. Check the OTHER connector rows for the same disease while there (verify each claim against its command surface — Redtail/Salesforce are read-or-stubbed today, DocuSign etc.; state what you verified per row).
2. **E5-headline — reconcile the top-line privacy promise** everywhere it overclaims (welcome/onboarding, privacy settings headers): the true version — "nothing leaves this computer unless you choose cloud AI or connect an account — and the Data Map shows exactly what does." Find every instance of the absolute claim (grep the locales for "never leaves|nothing leaves|ever leaves" and equivalents); fix each against its mode-reality.
3. **R7 — one provider truth everywhere:** the Privacy Center "Current mode" pill must show the SAME provider the actual calls use (it showed "OpenAI" while calls went to Anthropic — find the stale source, likely a config-vs-resolved mismatch; use the same resolver the Ask badge uses, the reactive one). Test: mode pill === resolved provider across provider switches.
4. **R3 — the notes-blocked copy** (`meetings.entry.notes-failed-blocked`): lead with "connect a local model"; the turn-off-Local-only option mentioned second and neutrally.
5. **P4 — onboarding trust pills:** "AI provider is SOC 2 certified" → attribute honestly ("Your AI provider (Anthropic/OpenAI) maintains SOC 2 certification" or equivalent per-provider truth); verify the other two pills' claims against reality and adjust if needed.
6. **P6 — the "Recommended" badge on Cloud AI:** replace with honest framing — "Most capable" on cloud, "Most private" on local — no bare recommendation pointing away from the privacy promise.

## Gate + handoff
tsc · typecheck:tests 0 · i18n 0 · full vitest · eslint-gate. Visual spot-check in the browser build (unique port): Data Map row, privacy settings, onboarding pills — screenshots in handoff. Handoff: per-item what-the-code-actually-does verification notes (the copy must match verified behavior), gate counts, self-review rounds. Push (NOT self-merged), then exactly: `WORKER-DONE: lp/trust-tier-a`

## Landmines
Do NOT touch: ConsentDialog/NoticeTrail/noticeLedger (noticecard lane owns), DocxEditor (reserved), capture Rust (qa35fix owns). Never rename matter_id/Matter. No interactive menus.
