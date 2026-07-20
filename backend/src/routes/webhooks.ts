/**
 * LemonSqueezy webhook handler.
 *
 *   POST /webhooks/lemonsqueezy
 *       X-Signature: <HMAC-SHA256 hex of raw body under LEMONSQUEEZY_WEBHOOK_SECRET>
 *       -> 200 on success or non-Firm product
 *       -> 401 if signature invalid
 *       -> 400 if body malformed
 *
 * Handles subscription_created (and order_created) where the variant matches
 * the Firm plan (by variant id in FIRM_VARIANT_IDS or by variant name containing
 * 'Firm'). Idempotent on the event id (webhook_events table). Non-Firm events
 * get a 200 + ignore. No email is sent.
 *
 * Provisioned org: status='unclaimed', plan='practice', seat_limit=max(3, quantity).
 * License key stored as HMAC hash only (same scheme as existing keys).
 */

import { json, error } from "../lib/http.ts";
import { readCappedText, type HttpRequest } from "../lib/requestBody.ts";
import { createHmac, timingSafeEqual } from "node:crypto";
import { randomBytes } from "node:crypto";
import { hmacHash } from "../lib/crypto.ts";
import { config } from "../lib/config.ts";
import type { Store } from "../lib/db.ts";
import type { ProfessionPack } from "../lib/types.ts";

const DEFAULT_FIRM_PACKS: ProfessionPack[] = ["advisor"];

/**
 * 256 KB cap on a LemonSqueezy webhook delivery.
 *
 * WHY THIS NUMBER: a real `subscription_created` payload is a single order +
 * subscription object — a few KB; the largest LS event documented (an order
 * with many line items) is still well under 100 KB. 256 KB is ~30x the
 * realistic payload, so no legitimate delivery is ever refused, while a hostile
 * caller is cut off at a quarter of a megabyte instead of Bun's 128 MB default
 * (which, being Content-Length-only, was in practice unbounded here).
 *
 * Deliberately NOT the same number as the intake upload or assured prompt caps:
 * a webhook has no reason to carry megabytes, and a shared global cap would
 * have to be sized for the largest consumer, handing this unauthenticated route
 * a ceiling it does not need.
 */
export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

// ---------------------------------------------------------------------------
// HMAC-SHA256 signature verification
// ---------------------------------------------------------------------------

function verifyLsSignature(rawBody: string, signature: string): boolean {
  const secret = config.lemonSqueezyWebhookSecret;
  if (!secret) return false; // misconfigured; fail closed

  let expected: Buffer;
  try {
    expected = createHmac("sha256", secret).update(rawBody).digest();
  } catch {
    return false;
  }

  // Signature may arrive as a hex string (LS sends lowercase hex).
  let provided: Buffer;
  try {
    // Accept both hex (LS default) and base64.
    if (/^[0-9a-f]{64}$/i.test(signature.trim())) {
      provided = Buffer.from(signature.trim(), "hex");
    } else {
      provided = Buffer.from(signature.trim(), "base64");
    }
  } catch {
    return false;
  }

  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if a variant id or name matches the Firm plan config. */
function isFirmVariant(variantId: string | number | null, variantName: string | null): boolean {
  const name = variantName ?? "";
  if (/firm/i.test(name)) return true;

  if (variantId == null) return false;
  const idStr = String(variantId);
  const configuredIds = config.firmVariantIds
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return configuredIds.includes(idStr);
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleLemonSqueezyWebhook(req: HttpRequest, store: Store): Promise<Response> {
  // Read the raw body (needed for HMAC verification before any parsing).
  //
  // This route is UNAUTHENTICATED and has no rate limit, and until this change
  // it had no body cap of ANY kind — not even a Content-Length check. A 300 MB
  // chunked POST was buffered whole and only then answered 401 (measured: RSS
  // 61.0 MB -> 375.6 MB peak). The read now streams and aborts at the cap.
  const read = await readCappedText(req, MAX_WEBHOOK_BODY_BYTES);
  if (!read.ok) return read.tooLarge ? error("payload_too_large", 413) : error("read_error", 400);
  const rawBody = read.value;
  if (!rawBody) return error("empty_body", 400);

  // Verify signature.
  const sig = req.headers.get("x-signature") ?? "";
  if (!verifyLsSignature(rawBody, sig)) {
    return error("invalid_signature", 401, "X-Signature verification failed");
  }

  // Parse body.
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return error("invalid_json", 400);
  }

  // Extract event name and event id for idempotency.
  const meta = (payload.meta ?? {}) as Record<string, unknown>;
  const eventName = (meta.event_name as string) ?? "";
  // LS event ids: meta.webhook_id is the unique delivery id (stable on retry).
  const eventId = (meta.webhook_id as string) ?? "";

  if (!eventId) return error("missing_event_id", 400, "meta.webhook_id is required");

  // Webhook 109091 is configured for BOTH subscription_created and
  // order_created. One purchase fires BOTH events. We provision ONLY on
  // subscription_created; order_created is acknowledged as a no-op so the
  // same purchase never provisions two orgs.
  if (eventName === "order_created") {
    // Acknowledge gracefully — no provisioning for order_created.
    return json({ ok: true, ignored: true, reason: "order_created_no_provision" });
  }

  if (eventName !== "subscription_created") {
    // Unhandled event type: acknowledge gracefully.
    return json({ ok: true, ignored: true, reason: "event_type_not_handled" });
  }

  // Extract the variant info to determine if this is a Firm purchase.
  const data = (payload.data ?? {}) as Record<string, unknown>;
  const attrs = (data.attributes ?? {}) as Record<string, unknown>;

  // LS subscription_created: first_subscription_item has variant_id + variant_name.
  const firstItem = (
    (attrs.first_subscription_item as Record<string, unknown> | undefined)
  ) ?? {};
  const variantId = (firstItem.variant_id as string | number | null) ?? null;
  const variantName = (firstItem.variant_name as string | null) ?? null;

  if (!isFirmVariant(variantId, variantName)) {
    return json({ ok: true, ignored: true, reason: "non_firm_product" });
  }

  // Derive the subscription identifier for second-level idempotency.
  // LS subscription_created: data.id is the subscription resource id.
  const subscriptionId = (data.id as string) ?? null;

  // Idempotency: skip if already processed (by event_id OR subscription_id).
  const isNew = store.recordWebhookEventWithSubscription(eventId, subscriptionId);
  if (!isNew) {
    return json({ ok: true, duplicate: true });
  }

  // Determine quantity. Grant EXACTLY the seats purchased (charge-aligned):
  // the 3-seat minimum is enforced softly at checkout via a prefilled quantity,
  // not by inflating the grant beyond what the buyer paid for. (Policy change
  // green-lit 2026-06-10; previously max(3, quantity), which granted 3 seats for
  // a reduced-to-1 purchase.)
  const quantity =
    typeof firstItem.quantity === "number" && firstItem.quantity > 0 ? firstItem.quantity : 1;
  const seatLimit = quantity;

  // Derive org name from customer name or email domain.
  const customerName = (attrs.customer_name as string) ?? (attrs.user_name as string) ?? "";
  const customerEmail = (attrs.user_email as string) ?? (attrs.customer_email as string) ?? "";
  const orgName =
    customerName.trim() ||
    (customerEmail.includes("@") ? customerEmail.split("@")[1]?.split(".")[0] ?? "Firm" : "Firm");

  // Extract and store the license key hash.
  // LS subscription_created: meta.custom_data.license_key, else attrs.identifier.
  // Fall back to a generated key if LS didn't include one.
  const customData = (meta.custom_data as Record<string, unknown>) ?? {};
  const payloadKey = (customData.license_key as string) ?? (attrs.identifier as string) ?? null;
  const rawKey = payloadKey ?? generateLicenseKey();
  const keySource = payloadKey ? "payload" : "generated_fallback";

  // Wrap org creation + status override + license key creation in a single
  // transaction so a crash between steps cannot create an unclaimed org with
  // no claimable key, or record the dedupe row and then fail to provision.
  const keyHash = hmacHash(rawKey);
  const { org } = store.db.transaction(() => {
    const newOrg = store.createOrg({
      name: orgName,
      plan: "practice",
      packs: DEFAULT_FIRM_PACKS,
      seat_limit: seatLimit,
      billing_customer_id: (attrs.customer_id as string) ?? null,
    });
    // Override status to 'unclaimed' (createOrg defaults to 'active').
    store.setOrgStatus(newOrg.org_id, "unclaimed");
    store.createLicenseKey({
      org_id: newOrg.org_id,
      key_hash: keyHash,
      plan: "practice",
      packs: DEFAULT_FIRM_PACKS,
      seat_limit: seatLimit,
    });
    return { org: newOrg };
  })();

  store.audit({
    org_id: org.org_id,
    actor_user_id: null,
    action: "webhook.lemonsqueezy",
    target: org.org_id,
    detail: { event_name: eventName, event_id: eventId, variant_id: variantId, seat_limit: seatLimit, key_source: keySource },
  });

  return json({ ok: true, org_id: org.org_id, seat_limit: seatLimit });
}

// ---------------------------------------------------------------------------
// Local key generation (reused from crypto but avoid circular import)
// ---------------------------------------------------------------------------
function generateLicenseKey(): string {
  return randomBytes(24).toString("hex");
}
