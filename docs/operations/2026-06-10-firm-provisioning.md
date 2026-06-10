# Keepance Firm: Purchase to Provision Runbook

**Date:** 2026-06-10  
**Task:** Phase 1 firm wiring, Task 5  
**Status:** Webhook LIVE. Claim-org UI shipped (Task 5). **Backend DEPLOYED to api.keepance.com 2026-06-10** (see the "DEPLOYED" section at the end). §3's "do not execute" gate is satisfied; that section is retained for history/rollback reference.

---

## 1. LemonSqueezy product and variant state

### Product

| Field | Value |
|---|---|
| Product name | Keepance Firm |
| LS Product ID | 1131065 |
| Variant name | Default |
| **Variant ID** | **1769899** |
| Price | $1,548.00/year |
| Billing | Subscription, yearly |
| License keys | ON (generate license keys) |
| Activation limit | 5 per key |
| Status | Published |
| Storefront | Visible |

### FIRM_VARIANT_IDS env var

The backend config reads `FIRM_VARIANT_IDS` (comma-separated variant IDs that map to the Firm plan). Set this in `/etc/keepance-firm-backend.env`:

```
FIRM_VARIANT_IDS=1769899
```

### Per-seat quantity (minimum 3): NEED-JAMESON

LemonSqueezy does NOT expose a "minimum quantity" or per-seat quantity setting at the variant level. The product/variant API has no `min_quantity` or `max_quantity` field. Two options to enforce minimum 3:

**Option A (recommended, ~5 min):** Use checkout URL parameter. The Firm checkout link in the website can be constructed as:
```
https://projelli.lemonsqueezy.com/checkout/buy/7a87840c-214f-4b1e-879e-a851db197e7c?checkout[quantity]=3
```
This pre-fills the quantity to 3 at checkout but does not prevent the buyer from reducing it. To enforce a hard minimum, a custom checkout page (Lemon.js) with JS validation is required.

**Option B (manual, dashboard):** LemonSqueezy support can enable quantity-gating per product on request; this is not a self-serve setting in the current dashboard version.

**Current state:** Firm is purchasable as a single seat at $1,548. The backend webhook handler already enforces `seat_limit = max(3, quantity)` (see `backend/src/routes/webhooks.ts` line 143-144), so the minimum-3 logic is enforced server-side on every webhook event. The UI limitation is that the checkout doesn't force the buyer to enter a quantity.

**Action needed from Jameson:** Decide whether to use the checkout URL parameter approach (Option A) or keep "Talk to us" on the Firm card until a real Firm customer initiates, at which point you can issue a custom checkout link with quantity=3 pre-filled.

---

## 2. Webhook configuration

### Existing webhook (license-validator): licenses.projelli.com/webhook

- LS Webhook ID: (existing, 9 events, verified live)
- Events: order_created + subscription lifecycle
- Status: Live, last delivery confirmed 1 Jun 19:49

### New webhook (firm backend): api.keepance.com/webhooks/lemonsqueezy

- **LS Webhook ID: 109091**
- **URL: https://api.keepance.com/webhooks/lemonsqueezy**
- **Events: subscription_created, order_created**
- **Created: 2026-06-10 via API**
- Status: Live in LemonSqueezy store 340394 (projelli)

### Webhook signing secret

**LEMONSQUEEZY_WEBHOOK_SECRET** (for the firm backend, webhook 109091): the value is NOT in this repo. It lives on the server at `~/.local/share/jameworld/keepance-firm-webhook-secret.env` (mode 600) and must be copied into `/etc/keepance-firm-backend.env` at deploy time. It also appears in the LemonSqueezy dashboard on webhook 109091.

The backend will reject all webhook deliveries with `401 X-Signature verification failed` until this is set.

**Note:** This is separate from the license-validator's webhook secret, which lives in `/etc/license-validator.env` on the server (different service, different webhook endpoint). Never write either secret into this repo: it is public.

---

## 3. Backend deploy gate

The live backend at `api.keepance.com` needs to be running the Task 1 code (which added the `/org/claim` route and webhook handler) before webhooks will land and the claim flow will work end-to-end.

Deploy procedure (from `backend/deploy/RUNBOOK.md`):

```bash
# 1. Pull latest code on deploy host
cd /home/jameson/keepance
git pull

# 2. Install deps
cd backend && bun install

# 3. Run tests
bun test

# 4. Set new env vars in /etc/keepance-firm-backend.env:
#    LEMONSQUEEZY_WEBHOOK_SECRET=<from ~/.local/share/jameworld/keepance-firm-webhook-secret.env>
#    FIRM_VARIANT_IDS=1769899

# 5. Restart the service
sudo systemctl restart keepance-backend

# 6. Verify
curl https://api.keepance.com/healthz
```

**DO NOT execute this until the orchestrator gives the release go.** The code is ready; the deploy is gate-blocked on Jameson's sign-off per the Keepance commercial deploy policy.

---

## 4. The /org/claim endpoint

### Purpose

`POST /org/claim` (no authentication required) — allows a buyer to self-activate their firm by presenting the license key from the LemonSqueezy order confirmation email.

### Request

```json
{
  "license_key": "KEEP-XXXX-XXXX-XXXX-XXXX",
  "email": "admin@lawfirm.com",
  "password": "min12charpass",
  "org_name": "Smith & Associates LLC"
}
```

### Response (success 200)

```json
{
  "org": {
    "org_id": "...",
    "name": "Smith & Associates LLC",
    "plan": "practice",
    "packs": ["legal"],
    "seat_limit": 5
  },
  "user": {
    "user_id": "...",
    "email": "admin@lawfirm.com",
    "role": "admin",
    "status": "active",
    "created_at": "..."
  },
  "access_token": "...",
  "refresh_token": "...",
  "access_expires_at": "...",
  "refresh_expires_at": "..."
}
```

### Error cases

| HTTP | error code | Meaning |
|---|---|---|
| 404 | `license_key_not_found` | The key is not in the system. Check the LS order email. |
| 409 | `already_claimed` | The org was already activated. Use normal sign-in. |
| 400 | `missing_fields` | Required field is blank or invalid. |

---

## 5. Ops fallback: manual org creation

If the webhook did not fire or the buyer's license key is missing, an admin can provision an org directly from localhost on the backend server:

```bash
# POST /admin/org (localhost only — not exposed externally)
curl -s http://127.0.0.1:5194/admin/org \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Smith Law Firm",
    "plan": "practice",
    "packs": ["legal"],
    "seat_limit": 5,
    "admin_email": "admin@smithlaw.com",
    "admin_password": "TEMP_SEND_TO_CLIENT"
  }'
# Response includes license_key — send that to the buyer
```

The `/admin/org` route binds to `127.0.0.1` only (Caddy does not proxy it externally). The response includes a `license_key` that can be shared with the buyer so they can use the normal claim flow, or the admin account is already active.

---

## 6. Buyer experience (step by step)

1. **Buyer visits keepance.com** and clicks "Subscribe" (or the Firm "Talk to us" CTA today; once Firm card is wired: the checkout URL).
2. **LemonSqueezy checkout** processes the card. On success, LS sends an order confirmation email containing the license key (e.g. `KEEP-XXXX-XXXX-XXXX-XXXX`).
3. **LS fires webhook** `order_created` (or `subscription_created`) to `https://api.keepance.com/webhooks/lemonsqueezy`. The handler:
   - Verifies the HMAC signature with `LEMONSQUEEZY_WEBHOOK_SECRET`.
   - Checks `isFirmVariant` (variant ID 1769899 matches `FIRM_VARIANT_IDS`).
   - Creates an org with `status='unclaimed'` and `seat_limit = max(3, quantity)`.
   - Stores the license key hash.
4. **Buyer downloads Keepance** (Windows/Mac/Linux from keepance.com or GitHub releases).
5. **Buyer opens Settings > Firm** in the app.
6. **Buyer clicks "I just bought Keepance Firm"** (the new claim-org panel added in this task).
7. **Buyer enters:** license key (from LS email), email, password, firm name (optional).
8. **App calls** `POST /org/claim`, which:
   - Activates the org (status: unclaimed -> active).
   - Creates the admin user account.
   - Returns auth tokens.
9. **App signs in automatically** as admin. The activation form is pre-filled with the license key.
10. **Buyer activates their seat** by clicking "Activate seat" (license key is pre-filled; they add a device label).
11. **Buyer invites colleagues** via Settings > Firm > Console > Invite by email.
12. **Each colleague** downloads Keepance, opens Settings > Firm, signs in with their credentials, and activates a seat.

---

## 7. Screenshots

Taken 2026-06-10 (Task 5 session):

- `docs/quality/2026-06-10-v3-usability-campaign/screenshots/phase1/ls-firm-quantity.png` — Keepance Firm product details (showing Published, license keys ON, description confirming "minimum 3 seats")
- `docs/quality/2026-06-10-v3-usability-campaign/screenshots/phase1/ls-webhook.png` — Webhooks settings page showing all 3 webhooks including the new `api.keepance.com` endpoint

---

## 8. FIRM_VARIANT_IDS summary

| Variant | LS Variant ID | LS Product ID |
|---|---|---|
| Keepance Firm (Default) | **1769899** | 1131065 |

Set in backend env:
```
FIRM_VARIANT_IDS=1769899
```

This is also the fallback: `isFirmVariant()` in `webhooks.ts` also matches any variant whose name contains "Firm" (case-insensitive), so even if this env var is not set, a variant named "Default" on a product named "Keepance Firm" will be caught by the name-based check.

---

## 9. Assured proxy proof scope (accurate record)

The Assured-proxy proof run was:

- **Backend assured-proxy test suite**: `backend/test/assured-proxy.test.ts` (16 tests), run locally against an in-process server. Includes the sentinel never-in-DB-or-logs proof (OpaqueBody stores only `body_hash`, not plaintext) and the static `OpaqueBody` type-level assertion that prevents compilation if plaintext is accidentally exposed.
- **Client-side routing unit tests**: `tests/unit/firm/assuredInference.test.ts` covering `resolveAssuredRoute` and `assuredInference` logic.

No end-to-end browser UI run of the Assured path was performed in this session. That remains an open item for the Diane Marchetti persona scenario.

---

## 10. Staging smoke verification (2026-06-10)

The following were verified against the live `api.keepance.com` endpoint:

- `GET https://api.keepance.com/healthz` — 200 OK
- `GET https://api.keepance.com/.well-known/seat-pubkey` — 200, body is an Ed25519 PEM (`-----BEGIN PUBLIC KEY-----`)

---

## 11. Real-purchase notes and open items

When the first real Firm purchase completes, the following MUST be reconciled before considering provisioning complete:

**License key source reconciliation**: The webhook handler derives a license key by hashing `meta.custom_data.license_key` (if present), then `attrs.identifier`, then a generated fallback. LemonSqueezy's emailed license key for license-enabled products is the LS-generated key stored at `attrs.identifier` on the order. Verify that the key the buyer receives in their LS order email matches exactly what the handler stored (i.e., confirm LS puts the key in `attrs.identifier` on `subscription_created`, not only on `order_created`). Fix the mapping if they differ.

**Member revocation degradation**: The e2e test suite covers share, doc convergence, and ethical wall scenarios. Member seat revocation is covered at the unit level (`backend/test/licensing.test.ts` deprovision suite) and in the `seat_revoked` audit event emission. The full UI walk-through of a revoked member losing access will be exercised in the Diane Marchetti firm persona scenario (Phase 4).

Do not write any secrets or credentials in this file.

---

## DEPLOYED 2026-06-10 (on Jameson's explicit go)

The firm backend at api.keepance.com is now running the Phase-1 code.
- Prod DB + env backed up (`keepance-firm.sqlite.bak-*`, `/etc/keepance-firm-backend.env.bak-*`).
- Added to `/etc/keepance-firm-backend.env`: `LEMONSQUEEZY_WEBHOOK_SECRET` (from the off-repo secret file) + `FIRM_VARIANT_IDS=1769899`.
- `bun install` clean, `bun test` 152/152, `systemctl restart keepance-backend` → active.
- Guarded migration applied: `webhook_events.subscription_id` column added; existing tables/data intact.
- Verified live through the edge: `/healthz` ok; `/.well-known/seat-pubkey` ok; `POST /webhooks/lemonsqueezy` (unsigned) → 401; `POST /org/claim` (bad key) → 404 `license_key_not_found`.
- The LemonSqueezy webhook (id 109091) will now be accepted + provision orgs on a real Firm purchase. Rollback: restore the env + DB backups and restart (see §H).
