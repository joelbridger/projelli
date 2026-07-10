TASK: Lantern Intake Wave 6 Lane W6b — relay load/abuse hardening (backend).

You are Codex (gpt-5.6), building in an isolated git worktree on branch `lp/w56-relay-hardening` off `lp/intake-w56` (dispatched AFTER W5c key-sharing merges, since both touch `backend/src/routes/intake.ts`). Backend TS (Bun). TDD with bun tests.

## Read first
- `docs/plans/lantern-plus/intake/ARCHITECTURE.md` §3 (relay endpoints + honest metadata list — you MUST NOT add any new durable metadata beyond this list), §8 T9 (DoS: token-before-body-read, per-intake + per-IP rate limits, chunk/total-size caps, upload quota) and T10 (traffic analysis — telemetry WITHOUT content, 24h access-log retention, in-memory rate buckets).
- `docs/plans/lantern-plus/intake/WAVE-PLAN.md` Wave 6 goal (rate-limit tuning, quota telemetry-without-content, soak/abuse test).
- Existing relay (already has W1 hardening — you TUNE + extend, don't rebuild):
  - `backend/src/routes/intake.ts` — `publicIntakeRateLimit(ip, intakeId)`, byte caps (`MAX_INTAKE_CHUNK_BYTES`, `MAX_INTAKE_FILE_BYTES`, `MAX_INTAKE_TOTAL_BYTES`, `MAX_INTAKE_SUBMISSIONS`), `readJsonWithCap` (token/cap before body read), 413 on oversize.
  - `backend/test/intake-rate-limit.test.ts`, `backend/test/intake-e2e.test.ts`, `backend/test/intake-privacy-proof.test.ts` — extend these.
  - Find where the rate-limit buckets + limits live (constants) and where caps are defined.

## Goal (plain)
Make the relay stand up to load and abuse: tune the rate limits/quotas to sensible production values, add quota/abuse TELEMETRY that records counts and rejections WITHOUT ever recording content or new client-identifying metadata, and prove it with a soak/abuse test (bursts, oversize, quota exhaustion, unauthenticated floods). The relay stays a dumb ciphertext mailbox — hardening must not widen what it can see.

## Deliverables
1. **Rate-limit / quota tuning**: review current `publicIntakeRateLimit` windows/thresholds and per-intake caps; set defensible production values (per-IP and per-intake request rates; per-intake upload quota already exists via total-bytes — confirm + tune). Make limits named constants, documented inline with the rationale. Ensure token (`t_auth`) is checked BEFORE the request body is read on every public endpoint (T9) — audit each handler and fix any that read body first.
2. **Quota / abuse telemetry (content-free)**: in-memory counters (or the existing metrics surface if one exists) for: requests per endpoint, rate-limit rejections, oversize/quota rejections, unauthenticated/invalid-token hits. NO IP/UA/client data in durable storage (in-memory buckets + 24h access-log rule only). Expose via an existing admin/metrics path if present; otherwise keep counters internal and testable. This must not add anything to ARCHITECTURE §3's "can see" list beyond aggregate counts.
3. **Uniform-410 discipline preserved**: expired/revoked/unknown/wrong-token still return the same neutral result after constant-time token check (don't let hardening introduce an oracle — e.g. a rate-limit response that only fires for real intakes leaks existence). Rate-limit responses must be uniform across existing/non-existing intakes.
4. **Soak/abuse test** — `backend/test/intake-abuse.test.ts` (new): burst floods trip the limiter with the right status; oversize chunk/file/total → 413; submission-count cap enforced; unauthenticated flood rejected before body read; rate-limit response identical for real vs unknown intake id (oracle test); telemetry counters increment correctly and hold NO content.

## Non-negotiables
- No new durable metadata; no content ever logged; no oracle introduced by hardening. Constant-time token compare preserved.
- Don't break existing intake e2e / privacy-proof / rate-limit tests.
- The relay never decrypts anything (unchanged).

### 5. Expiry + grace ciphertext cleanup (retention — makes the IT-pack claim TRUE)
The relay TODAY only deletes ciphertext on advisor ack; expired links are DENIED access but their unacknowledged blobs persist forever (no cleanup job). ARCHITECTURE §5 promises "deleted on ack (and at expiry + 30-day grace regardless)" — implement the missing half. Add a cleanup pass (on-startup + periodic sweep, or on-access lazy delete — pick the simplest robust option for the single-instance Bun relay) that deletes intake ciphertext (chunks, manifests, wrapped keys, sealed state) for intakes past `expires_at` + a 30-day grace window. Make the grace window a named constant. Deletion is content-free (it removes ciphertext rows; logs only counts). Add a test: an intake past expiry+grace has its ciphertext removed; one within grace is retained; ack-delete still works. This closes the W6c it-pack finding (the pack can then restore the honest "expiry + 30-day grace" retention claim — coordinate with the it-pack lane / lead).

## Out of scope
- Key sharing (W5c — but note it added `/intake/:id/keys` endpoints; apply the same auth-before-body + uniform-response discipline to them if they lack it), phone mode, KPI strip, client page. No new product features — this is hardening + the retention-cleanup job only.

## Verify
`cd backend && bun test` (all intake tests, esp. your new abuse test + existing rate-limit/privacy-proof). Report exact pass/fail. When done + committed, print `W56-RELAY-HARDENED-DONE` then `DONE-EXIT:0`.
