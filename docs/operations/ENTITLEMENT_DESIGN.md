# Entitlement Design: tiers + profession packs (the data contract)

**Status:** Design spec, 2026-05-29. NOT yet implemented. This is the single contract that the app, the license server, and LemonSqueezy must all be built to, in one coordinated pass (see the dependency note at the bottom). Pricing facts come from `docs/reference/PRICING_AND_POSITIONING.md`.

## Why this doc exists
The app's licensing code (`src/hooks/useLicense.ts`), the license validator (`licenses.keepance.com`), and the LemonSqueezy store were all built for the **retired** pricing (`free` / `pro` / `lifetime`, with `Pro $49 / Lifetime $99 / Founder's $29` products). The new model is `personal` / `professional` / `practice` plus per-profession packs. All three systems disagree with each other and with the new pricing. They must be re-aligned together; changing one alone produces a broken activation flow.

## The new entitlement model

A license grants:
1. **A tier:** `trial` | `personal` | `professional` | `practice`
2. **A set of unlocked profession packs:** subset of `legal` | `tax` | `consulting` (possibly empty)
3. **A seat count:** 1 (personal/professional) or up to 5 (practice)

Mapping:
| Tier | Packs unlocked | Seats |
|---|---|---|
| `trial` | all (during 30 days), then none | 1 |
| `personal` | none | 1 |
| `professional` | exactly one (the one they bought: legal OR tax OR consulting) | 1 |
| `practice` | all three | up to 5 |

**Critical rule (from positioning):** tier gates ONLY the profession packs. Every tier (including `personal`) gets the full app: all four AI providers, whiteboard, audio, research/citations, multi-model comparison, unlimited workspaces. The current `tierHasFeature()` gating of those core features is WRONG and must be removed.

## The JWT contract (what the license server mints, what the app reads)

The activation token (JWT from `licenses.keepance.com`) payload should carry:
```jsonc
{
  "sub": "<license_key_id>",
  "tier": "professional",          // trial | personal | professional | practice
  "packs": ["legal"],              // array of unlocked pack slugs; [] for personal
  "seats": 1,                       // 1..5
  "exp": 1234567890                 // unix expiry
}
```
- `personal` → `packs: []`
- `professional` → `packs: ["<the one they bought>"]`
- `practice` → `packs: ["legal","tax","consulting"]`

The app's entitlement check becomes: `packs.includes(packSlug)` to unlock a profession pack; core features never check tier.

## Where LemonSqueezy fits
Each LemonSqueezy product/variant must carry metadata the webhook → license server can read to set `tier` and `packs`. Concretely, the variant needs to encode:
- which tier it is, and
- for Professional, which pack the buyer selected (legal/tax/consulting). This likely means **either** separate Professional variants per pack (Professional-Legal, Professional-Tax, Professional-Consulting) **or** a single Professional variant plus a pack-choice captured at checkout (custom field) and passed in the webhook. Separate-variant-per-pack is simpler and recommended.

Known existing variant IDs (currently the OLD products, must be reconciled):
- Professional ($129): `33cd497b-bffd-404c-910e-f8dd1f4453bd`
- Practice ($399): `9a5a7f48-0ffe-448a-a1af-889af99a0f47`
- Personal ($49): not yet found, confirm/create.
- BOARD_ACTION_ITEMS.md still references old `Pro $49 / Lifetime $99 / Founder's $29` variants, those must be retired/renamed.

## Implementation order (MUST be done in this sequence, together)
1. **LemonSqueezy** (Jameson + Claude): retire old products; create Personal / Professional-per-pack / Practice; add the $89 charter; record variant IDs + the metadata each carries.
2. **License server** (`/etc/license-validator.env` + validator code): map each variant → `{tier, packs, seats}`; mint the JWT shape above. Test `/activate` returns the new payload.
3. **App** (`useLicense.ts` + consumers): change `LicenseTier` to the new values; add `packs`/`seats` to `LicenseState`; replace `tierHasFeature()` (remove core-feature gates) with a `hasPack(slug)` check used only at the profession-pack surfaces; update `LicenseSettings`, `TrialStatusChip`, `AIAssistantPane`, `RunOnAllButton`, `defaultModel`, and i18n strings (`settings.license.tier.*`) to the new tiers. Then verify against the running desktop app with real test-mode keys.

**Why not do step 3 first/alone:** the app must read `packs` from a JWT the server only produces after steps 1-2. Building the app gate against a guessed contract guarantees rework and risks locking out paying users. App code stays untouched until 1-2 are real.

## Test matrix (for when we implement)
- Trial active → full app, all packs usable. Trial expired + no license → viewer mode.
- Personal key → full app (all providers/whiteboard/audio/multi-model), NO profession pack; user can still create/import their own templates.
- Professional-Legal key → full app + Legal pack only; Tax/Consulting packs locked.
- Practice key → full app + all three packs; up to 5 seats.
- Revoked key (refund) → reverts to viewer/free on next `/validate`.
