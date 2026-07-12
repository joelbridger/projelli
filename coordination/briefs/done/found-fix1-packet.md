# Foundation lane — fix round 1 (adversarial Codex review; ONE combined round; TDD each item)

The egress badge is THE trust signal — it must never disagree with the real send path in ANY mode. Fix all six, failing test first per item:

1. BLOCKER useActiveEgressProvider.ts:49 — badge can render stale provider + new mode for a frame after Local-only → Direct switch (recreates the old B-PRIV-1 display race the deleted test covered). Tag resolved state with the mode it was resolved under (or a null "checking" state) exactly like useAsk does; render nothing/checking until they match.
2. BLOCKER activeEgressProvider.ts:141 — the canonical resolver ignores firm Assured routes (resolveAssuredRoute.ts; email prefers Assured over personal BYOK in resolveEmailProvider.ts:63). Badge can say "No AI connected"/personal provider while sends use the firm proxy. Extend the resolver to return the real DESTINATION (direct | local | assured | demo-proxy | none/pending), include assuredAvailable, and pass it through EgressIndicator.
3. MAJOR activeEgressProvider.ts:128 — Local-only falls back to 'ollama' without a reachability check while the Ask send path uses the stricter available-engine probe (askHelpers.ts:342). Use the same probe; when nothing is usable show "Local AI setting up", never "Using local AI".
4. MAJOR AskComposer.tsx:281 — the composer's send-time egress indicator duplicates data-testid="egress-indicator"/"egress-indicator-label" with the top bar; tests grip that id on the Ask page (bench-mirror-cross-cutting.spec.ts:92). Keep the composer indicator (it is the action-time signal) but give it distinct testids and migrate any test that intends the composer one.
5. MAJOR — the removed Ask/MatterHub pills were the click path to AI settings. Make the top-bar status pill clickable (opens AI settings) with hover affordance + aria-label, and verify keyboard access.
6. Restore B-PRIV-1 DOM coverage against the NEW top-bar badge: the one-frame mode-switch case (item 1) plus badge-vs-send-path agreement across modes: local-only, direct/BYOK, assured, none, demo. The matrix in single-source-egress.test.ts should gain assured + pending columns.

When done: scoped checks per common rules, push lp/ux-found, append "## Fix round 1" to found.done.md, write marker coordination/briefs/done/found.fix1.md (HEAD sha + check output). Stop after.
