# Next-session handoff — Keepance, Wave 3 (written 2026-06-11)

**Read this first.** Branch `keepance-3.0`, everything committed + pushed (`HEAD == origin/keepance-3.0 == 69703a4`, working tree clean). Plan of record: `docs/strategy/2026-06-10-vision-gap-closure-plan.md` (the 5 waves to 100% of the vision). Follow the **Token-Budget Operating Mode (Keepance only)** in `CLAUDE.md`: drive on Opus 4.8 at `high`; delegate well-specified implementation to Sonnet 4.6 subagents and mechanical work to `model: "haiku"`; **raise to `xhigh` only for the encrypted vault (VG-6d-v2) and the co-editing CRDT (VG-8)**; Fable 5 is break-glass only.

## Status: Waves 1 + 2 COMPLETE

- **Wave 1** (wedge proof + F-501..F-509 fix wave): done, verified. Do NOT redo.
- **Wave 2** (ingest everything): **done, verified, this session.** All 14 tasks. The native leg-3 re-run is banked under `docs/quality/2026-06-11-wedge-proof/wave2-rerun/`; verdicts in RESULTS §F; strategy STATUS ticks on VG-2/2b/3c/3d/4c/6b/6e. The Task-12 letterhead review found and fixed a real fidelity bug (commit 560d82e) — the merge now reconciles generated content's hyperlinks/media/numbering into the template package.
- **Pitch deck + token-budget setup**: done earlier. Do NOT redo.

## The working rhythm that has held (keep it)
Subagent per task → independent spec review → independent quality review → fix round → re-review; tripwire/unit tests as done-signals; the orchestrator applies small review-found fixes directly and commits/pushes. Reviews have caught real bugs at nearly every step (this session: the letterhead relationship-reconciliation bug). Keep that bar.

## NEXT: Wave 3 — the firm-sale wave (per the gap-closure plan §3 VG-6c + VG-6d-v2)

Wave 3 has two committed builds. Each needs its OWN implementation plan written at build time (same as Wave 1/2), under `docs/superpowers/plans/`.

### Wave 3a — SSO (VG-6c). Size: L. Model: Opus 4.8 · high; Sonnet 4.6 subagents.
OIDC authorization-code flow against the firm backend. **Entra ID first** (law firms live on M365), Google Workspace second, generic OIDC third; **SAML explicitly out of v1**. Per-org IdP config in the firm admin console; member sign-in through the system browser, exchanged into the existing **Ed25519 seat-token** session; walls/seat semantics unchanged. Verify against a self-hosted test IdP (**Authentik on this server**) plus a real Entra tenant when available. **The site/pricing re-claim "SSO" ONLY in the release that ships it** (the honesty rule — the false SSO claim is why we're here; it was removed in commit c0454da). Reference the firm backend auth: `backend/src/` (seat tokens, `/.well-known/seat-pubkey`), client `src/modules/firm/contract.ts` `FIRM_ENDPOINTS`.

### Wave 3b — encrypted workspace vault (VG-6d-v2). Size: L, data-loss-sensitive. Model: Opus 4.8 · **xhigh**; Sonnet subagents, Opus reviews every diff.
**The plan REQUIRES a brainstormed design doc + implementation plan + a destructive-failure test suite BEFORE any code ships.** Do not skip this. Use `superpowers:brainstorming` first. Scope (from the plan): optional per-workspace encrypted vault; document files encrypted at rest (AES-256-GCM, the same primitives the mail store + `chunk_text` already use); master key in the OS keychain; an explicit recovery phrase generated at vault creation with a "Keepance cannot recover this for you" ceremony; firm-tier admin escrow reusing the existing ECDH escrow machinery; transparent open/edit through the app; a decrypt-everything escape hatch so "your files are always yours" stays true. Destructive-failure tests: kill the app mid-write, wrong key, lost keychain. (v1 — unmissable disk-encryption guidance — already shipped in Wave 1, VG-6d-v1.)

> Note: VG-6d-v2 + VG-6c are "functional to sell" / demand-gated in the plan, but the board mandate is 100%/zero-exceptions, so they are committed builds.

## Then: Wave 4 (VG-8 live multi-user .docx co-editing — the largest single build; xhigh) and Wave 5 (VG-9 connectors: Clio → Office add-ins → NetDocuments → iManage, as vendor access lands). Wave 5 is externally gated on the vendor-access track.

## Open / needs Jameson (not blocking the build)
- **WAVE2-FU-02** (in `BACKLOG.md`): add an in-app guard to `handleCreateOrg` so the firm backend doesn't rely on the Caddy `/admin/*`→403 edge rule alone (the admin route was internet-reachable + unauthenticated; closed at the edge this prior session, RUNBOOK §K). Keep `/webhooks/lemonsqueezy` (HMAC) + `/org/claim` (key-as-secret) public; the Assured exercise uses the loopback admin route so it must keep working.
- **A valid Anthropic API key** in `~/.local/share/jameworld/keepance-assured-test.env` to finish the ONE remaining Assured sub-step (a clean 200 + completion). Every Anthropic key on the server is revoked/stale (the local-model gateway made them cold) — worth a broader look; may affect other server tools that call Anthropic directly.
- **The proof moat (VG-7, Jameson-only):** formed legal entity → executed DPA → SOC 2 → named-attorney references; the ~5-min Windows spot check; one real-card test purchase; one attorney reviewing a contradiction-finder `.docx`. None block the build.
- **Vendor access (VG-9, for Wave 5):** `docs/operations/2026-06-10-vendor-access-track.md` — Clio / NetDocuments / iManage all filed, awaiting their humans; replies go to `developers@keepance.com` (read via the `outlook` CLI).
- **Wave 2 carried, non-blocking:** native OCR + native letterhead-deliverable exercises (deterministically test-covered; carry to a future attended pass / the Windows spot check); matter-scoped finder native run; RESULTS §F residuals + §E (a)-(e).

## Native harness reminder (for any future leg-3 pass)
`scripts/wedge-proof-native.sh` (preflight/up/launch/seed-localstorage/shot/click/type/assert/down). Check `free -h` FIRST (the box is memory-tight). The seeded workspace indexes **14 files** now. **The in-app editor autosaves every ~2 s** — if you mis-target the chat input and type into an open document, undo + restore the workspace copy from `tests/fixtures/matter-corpus/` immediately (committed fixtures are never at risk, but a contaminated `/tmp/wedge-ws` copy skews a re-index; happened once this session, caught + reverted).
