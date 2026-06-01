# Funnel proof + the webhook-delivery gap — 2026-06-01

**Run by:** Claude (operator) for Jameson. Real $49 test purchase of Personal (order #3403942), refunded same session.

## What was proven (green)

End-to-end with a **real** LemonSqueezy license key (`BB18…A00A`), exercising the exact path the desktop app uses:

| Step | Result |
|---|---|
| Buy Personal $49 (real card) | order #3403942 created, license key issued |
| Activate (`POST /activate` → LS activate → mint JWT) | token minted, **tier correctly = `personal`**, 30-day TTL |
| Unlock (`POST /validate` token) | `valid: true, tier: personal` |
| Survive restart (re-validate same token) | still `valid: true` |
| Refund (LS API `POST /v1/orders/8576445/refund`) | order `refunded: true`; LS set the license to **`status: expired`** immediately |
| New activation after refund | **blocked** by LS: `/activate` → "license key is expired" (403) |
| Revocation **logic** (manual signed `license_key_updated(status=expired)`) | token → `valid: false, reason: revoked` |

Also verified: validator healthy, tries both API keys, 31 tier/revocation unit tests green, HMAC signature verification works, and **cross-product isolation** holds (a Guesslet refund on the shared store is ignored and does not touch Keepance licenses, and vice versa).

## ✅ RESOLVED (2026-06-01, same day): the webhook gap is fixed + verified live

Root cause: webhook `89126` had **`test_mode: true`**, so it only fired for test-mode events and never for the real (live) order. It was also under-subscribed (missing `subscription_expired/paused` and the reactivate events). Fix: created a new **live** webhook (`106297`, `test_mode: false`) via the LS API pointing at `https://licenses.projelli.com/webhook` with the validator's signing secret and the full 9-event set the validator handles. **Verified with a real live delivery:** patched the test license's `activation_limit` via the LS API (a real `license_key_updated` event) and the validator logged `[webhook] revoked license BB18... (license_key_updated)` within 5s. Push-based revocation now works end-to-end for refunds and subscription cancellations. The old test-mode webhook `89126` was left in place (it still serves test-mode testing; it does not double-fire live events). Defense-in-depth (shorter token TTL) was deliberately NOT applied: the 30-day TTL exists for offline tolerance in a local-first app, and shortening it risks locking out offline paid users; revisit only if push revocation proves unreliable.

## The gap (original finding, now resolved) — LS webhooks were not being delivered to the validator

On refund, LS expired the license (so *new* activations are blocked), **but the validator never received any webhook** for the order. The already-minted token stayed valid until I manually fired the event LS should have sent.

Evidence:
- Validator log (`journalctl -u license-validator`) shows **zero `[webhook]` deliveries** for order #3403942 — no `order_created` (18:47), no `order_refunded` (18:52), no `license_key_updated`. Last real-looking delivery predates the test.
- The public endpoint is **fully reachable and working**: a `POST https://licenses.projelli.com/webhook` from the host reaches Caddy → bun and processes correctly (verified live). So Caddy → bun is fine.
- The webhook is **registered** (id `89126`, created 2026-04-09, events: `order_created, order_refunded, license_key_updated, subscription_cancelled`, URL `https://licenses.projelli.com/webhook`).

**Conclusion: the broken link is LemonSqueezy not delivering** (our endpoint, Caddy, and the validator logic all work). Most likely webhook `89126` is paused/failing on the LS side, or its signing secret drifted from `LEMONSQUEEZY_WEBHOOK_SECRET` so LS retried-then-gave-up. The public API doesn't expose per-delivery logs; the LS dashboard webhook view does.

### Why this matters more now
The pull path (app → validator → LS, used for activate/validate) works, which is why existing customers validate fine. But **revocation is push-only** (LS → validator webhook). With Practice now a **subscription** (shipped today), `subscription_cancelled` revocation rides the same broken path, so a cancelled or refunded customer would keep access until their 30-day token expires.

### Mitigations / fix options (in order)
1. **Fix delivery (the real fix):** in the LS dashboard, open webhook `89126`, check its recent delivery attempts/failures, re-save it (regenerate/confirm the signing secret matches `/etc/license-validator.env`), and send a test delivery. Confirm it lands in the validator log.
2. **Defense in depth (recommended regardless):** have `/validate` periodically re-check license status with LS (or shorten the token TTL from 30 days), so a missed webhook can't grant up to a month of post-refund access.

## Cleanup done
- Order #3403942 refunded (full).
- The test license token was revoked at the validator (manual `license_key_updated(expired)`), so it grants nothing.
- Synthetic test keys used in webhook checks (`KEEPANCE-FUNNELTEST-*`, `PUBLIC-PATH-*`) left net-clean in the revocation log.
