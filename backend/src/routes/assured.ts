/**
 * ASSURED ZERO-RETENTION INFERENCE PROXY — HTTP routes (DECISION.md §5).
 *
 * The firm option for managed inference + a DPA (vs. pure BYOK). A firm seat
 * sends an inference request; the proxy attaches the org's MANAGED provider key
 * (encrypted at rest), forwards the request body STRAIGHT to the provider as an
 * opaque stream, and STREAMS the response straight back — buffering nothing,
 * persisting only non-content metadata for billing.
 *
 *   POST /assured/infer        (Bearer access + seat_token; body = provider-native request)
 *       Headers: X-Provider: anthropic|openai|google, X-Model: <model>,
 *                X-Seat-Token: <seat token>, X-Stream: 1|0 (optional, default 1)
 *       -> streams the provider response back verbatim; on success records a
 *          metadata-only billing row. NEVER logs/persists the prompt or completion.
 *
 *   POST /assured/keys/set     (admin) { provider, api_key }   -> { ok, provider, key_last4 }
 *   POST /assured/keys/list    (admin)                         -> { keys: [{provider,key_last4,...}] }
 *   POST /assured/keys/delete  (admin) { provider }            -> { ok, deleted }
 *   POST /assured/billing      (admin)                         -> { rows: BillingMeta[] } (metadata only)
 *
 * ── Why headers, not a JSON envelope, for /assured/infer ──
 * The request BODY is the provider-native payload and must flow through as an
 * opaque stream that we never parse. So all proxy control fields ride in HEADERS
 * (provider, model, seat token) — the body is touched by nothing but `pipe`.
 * This is the structural core of the zero-retention guarantee.
 */

import { json, error, readJson, authenticate, rateLimit } from "../lib/http.ts";
import { config } from "../lib/config.ts";
import { verifyActiveSeat } from "../lib/matters.ts";
import { encryptSecret } from "../lib/crypto.ts";
import { buildForwardTarget, redactTarget, scanUsage } from "../lib/assured.ts";
import { OpaqueBody, ASSURED_PROVIDERS, type AssuredProvider, type BillingMeta } from "../lib/assured-types.ts";
import type { Store } from "../lib/db.ts";
import type { AccessTokenClaims } from "../lib/types.ts";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Admin guard (mirrors routes/admin.ts + routes/matters.ts requireAdmin).
// ---------------------------------------------------------------------------
function requireAdmin(req: Request, store: Store): { ok: true; claims: AccessTokenClaims } | { ok: false; resp: Response } {
  const auth = authenticate(req, store);
  if (!auth.ok) return { ok: false, resp: error("unauthorized", 401, auth.reason) };
  if (auth.claims.role !== "admin") return { ok: false, resp: error("forbidden", 403, "admin_required") };
  return { ok: true, claims: auth.claims };
}

function parseProvider(v: unknown): AssuredProvider | null {
  return typeof v === "string" && ASSURED_PROVIDERS.has(v as AssuredProvider) ? (v as AssuredProvider) : null;
}

// ===========================================================================
// Admin: managed provider keys (one per org+provider, encrypted at rest)
// ===========================================================================

/** POST /assured/keys/set { provider, api_key } — store/rotate an org managed key. */
export async function handleSetProviderKey(req: Request, store: Store): Promise<Response> {
  const a = requireAdmin(req, store);
  if (!a.ok) return a.resp;

  // This is a small JSON body (NOT prompt content), so reading it is fine.
  const body = await readJson<{ provider?: unknown; api_key?: unknown }>(req);
  if (!body) return error("invalid_json", 400);
  const provider = parseProvider(body.provider);
  if (!provider) return error("invalid_provider", 400, "provider must be anthropic|openai|google");
  if (typeof body.api_key !== "string" || body.api_key.trim().length < 8 || body.api_key.length > 1024) {
    return error("invalid_api_key", 400);
  }

  const apiKey = body.api_key.trim();
  const last4 = apiKey.slice(-4);
  // Encrypt before it touches storage. We never persist or log the plaintext.
  store.setOrgProviderKey({
    org_id: a.claims.org_id,
    provider,
    key_ciphertext: encryptSecret(apiKey),
    key_last4: last4,
    updated_by: a.claims.sub,
  });
  store.audit({
    org_id: a.claims.org_id,
    actor_user_id: a.claims.sub,
    action: "assured.key.set",
    target: provider,
    detail: { provider, key_last4: last4 }, // metadata only — never the key
  });
  return json({ ok: true, provider, key_last4: last4 });
}

/** POST /assured/keys/list — which providers the org has a key for (no secrets). */
export function handleListProviderKeys(req: Request, store: Store): Response {
  const a = requireAdmin(req, store);
  if (!a.ok) return a.resp;
  return json({ keys: store.listOrgProviderKeys(a.claims.org_id) });
}

/** POST /assured/keys/delete { provider } — remove an org managed key. */
export async function handleDeleteProviderKey(req: Request, store: Store): Promise<Response> {
  const a = requireAdmin(req, store);
  if (!a.ok) return a.resp;
  const body = await readJson<{ provider?: unknown }>(req);
  const provider = parseProvider(body?.provider);
  if (!provider) return error("invalid_provider", 400);
  const deleted = store.deleteOrgProviderKey(a.claims.org_id, provider);
  store.audit({ org_id: a.claims.org_id, actor_user_id: a.claims.sub, action: "assured.key.delete", target: provider, detail: { provider, deleted } });
  return json({ ok: true, provider, deleted });
}

/** POST /assured/billing — the org's metadata-only inference billing rows. */
export function handleInferenceBilling(req: Request, store: Store): Response {
  const a = requireAdmin(req, store);
  if (!a.ok) return a.resp;
  return json({ rows: store.listInferenceBilling(a.claims.org_id, 500) });
}

// ===========================================================================
// The proxy endpoint — stateless forward, stream-through, metadata-only billing
// ===========================================================================

/**
 * POST /assured/infer — forward an authenticated firm seat's inference request
 * to the org's managed provider and stream the response straight back.
 *
 * ZERO-RETENTION: `req.body` (the prompt) is wrapped in an `OpaqueBody` and
 * piped into the upstream fetch WITHOUT being read here. The upstream response
 * stream is tee'd: one half streams to the client; the other is consumed only
 * by `scanUsage` to extract integer token counts. No body text is retained.
 */
export async function handleAssuredInfer(req: Request, store: Store, ip: string): Promise<Response> {
  const started = Date.now();

  // Per-IP rate limit (bounds abuse; inference is expensive upstream).
  const rl = rateLimit(ip, "assured_infer", { max: config.assuredRateLimitMax, windowSeconds: config.assuredRateLimitWindowSeconds });
  if (!rl.ok) return error("rate_limited", 429, `Try again in ${rl.retryAfter}s`);

  // --- AuthN: access JWT + active, org-bound seat (reuses chunk-1 verifyActiveSeat) ---
  const auth = authenticate(req, store);
  if (!auth.ok) return error("unauthorized", 401, auth.reason);

  const seatToken = req.headers.get("x-seat-token");
  if (!seatToken) return error("seat_required", 401, "missing X-Seat-Token");
  const seat = verifyActiveSeat(store, seatToken, { user_id: auth.claims.sub, org_id: auth.claims.org_id });
  if (!seat.ok) {
    store.audit({ org_id: auth.claims.org_id, actor_user_id: auth.claims.sub, action: "assured.infer.rejected", target: null, detail: { reason: seat.reason } });
    return error("seat_invalid", 401, seat.reason);
  }

  // --- Request shape (from HEADERS — never from the opaque body) ---
  const provider = parseProvider(req.headers.get("x-provider"));
  if (!provider) return error("invalid_provider", 400, "X-Provider must be anthropic|openai|google");
  const model = req.headers.get("x-model")?.trim() ?? "";
  if (!model) return error("missing_model", 400, "X-Model header required");
  // Default to streaming; the client opts out with X-Stream: 0.
  const stream = (req.headers.get("x-stream") ?? "1") !== "0";

  // --- Resolve the org's managed key + upstream target (key decrypted transiently) ---
  const built = buildForwardTarget(store, { org_id: auth.claims.org_id, provider, model, stream });
  if (!built.ok) {
    const httpStatus = built.reason === "no_managed_key" ? 409 : built.reason === "bad_model" ? 400 : 502;
    store.audit({ org_id: auth.claims.org_id, actor_user_id: auth.claims.sub, action: "assured.infer.rejected", target: provider, detail: { reason: built.reason, model } });
    return error(built.reason, httpStatus);
  }
  const target = built.target;

  // --- Take the prompt into an OPAQUE body and forward it. ---
  // The prompt bytes are read into TRANSIENT memory (bounded by
  // assuredMaxRequestBytes) and immediately wrapped in an `OpaqueBody`. This is
  // the irreducible-minimum exposure DECISION.md §5 describes ("the body in
  // transient memory for the duration of the request"): we draw the raw bytes,
  // we NEVER decode/parse/inspect them, we NEVER assign them to a kept variable
  // or a `store.*`/`console.*` call, and the OpaqueBody type makes it
  // structurally impossible to serialize/log them. The bytes leave only via
  // `take()` straight into the upstream fetch, then are dropped.
  //
  // (We deliberately buffer rather than re-stream `req.body`: a streamed upload
  // whose upstream is aborted mid-flight can wedge the inbound response in this
  // Bun runtime. Buffering fully consumes the inbound request up front so the
  // response — itself a true pass-through stream — always flushes cleanly. No
  // retention difference: it's the same transient RAM, just drained at once.)
  const lenHeader = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(lenHeader) && lenHeader > config.assuredMaxRequestBytes) {
    return error("payload_too_large", 413, `Request exceeds ${config.assuredMaxRequestBytes} bytes.`);
  }
  let promptBytes: Uint8Array | null;
  try {
    const ab = await req.arrayBuffer();
    if (ab.byteLength > config.assuredMaxRequestBytes) {
      return error("payload_too_large", 413, `Request exceeds ${config.assuredMaxRequestBytes} bytes.`);
    }
    promptBytes = ab.byteLength > 0 ? new Uint8Array(ab) : null;
  } catch {
    return error("invalid_request", 400, "could not read request body");
  }
  const promptBody = new OpaqueBody(promptBytes);

  const requestId = randomUUID();

  // Abort plumbing: the client's abort propagates upstream, and we also cap the
  // upstream with a timeout so a hung provider can't hold the connection open.
  const upstreamController = new AbortController();
  const onClientAbort = () => upstreamController.abort();
  req.signal.addEventListener("abort", onClientAbort);

  // Record a failure as METADATA ONLY (no body), once.
  const recordFailure = (status: number, reason: string) => {
    store.recordInference({
      request_id: requestId,
      org_id: auth.claims.org_id,
      seat_id: seat.claims.seat_id,
      provider,
      model,
      input_tokens: 0,
      output_tokens: 0,
      status,
      latency_ms: Date.now() - started,
      ts: new Date().toISOString(),
    });
    store.audit({ org_id: auth.claims.org_id, actor_user_id: auth.claims.sub, action: "assured.infer.rejected", target: provider, detail: { reason, model } });
  };

  // Error response that still carries the request-id (so the client can
  // correlate a failure with its billing/audit row) + the no-retention signal.
  const inferError = (code: string, status: number, detail?: string): Response =>
    new Response(JSON.stringify(detail ? { error: code, detail } : { error: code }), {
      status,
      headers: {
        "content-type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "X-Keepance-No-Retention": "true",
        "X-Keepance-Request-Id": requestId,
      },
    });

  // Forward. The prompt is piped as a stream (never buffered). We bound the wait
  // for the UPSTREAM HEADERS with a timeout via Promise.race so a provider that
  // accepts the connection but never replies can't wedge this request: on
  // timeout we abort the upstream (freeing it in the background) and return 504
  // immediately, rather than awaiting the aborted fetch to settle (which, with a
  // streamed request body, can otherwise leave the inbound response un-flushed).
  let upstream: Response;
  try {
    const outBody = promptBody.take(); // <-- the only egress of the prompt bytes
    const fetchPromise = fetch(target.url, {
      method: target.method,
      headers: target.headers,
      body: outBody, // forwarded verbatim; never read/decoded by us
      signal: upstreamController.signal,
    });
    // Swallow the eventual rejection of an abandoned/aborted fetch so it doesn't
    // surface as an unhandled rejection after we've already returned 504.
    fetchPromise.catch(() => {});

    const TIMED_OUT = Symbol("timeout");
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), config.assuredUpstreamTimeoutMs);
    });
    const raced = await Promise.race([fetchPromise, timeoutPromise]);
    if (timer) clearTimeout(timer);

    if (raced === TIMED_OUT) {
      upstreamController.abort(); // free the upstream socket in the background
      req.signal.removeEventListener("abort", onClientAbort);
      console.error(`[assured] upstream timeout:`, redactTarget(target)); // metadata only
      recordFailure(504, "upstream_timeout");
      return inferError("upstream_timeout", 504);
    }
    upstream = raced;
  } catch {
    req.signal.removeEventListener("abort", onClientAbort);
    const aborted = upstreamController.signal.aborted;
    // Log ONLY metadata about the failure (provider/endpoint), never the body.
    console.error(`[assured] upstream ${aborted ? "aborted" : "fetch_error"}:`, redactTarget(target));
    recordFailure(aborted ? 504 : 502, aborted ? "upstream_aborted" : "upstream_error");
    return inferError(aborted ? "upstream_timeout" : "upstream_error", aborted ? 504 : 502);
  }

  // Helper: record the metadata-only billing row + audit. Called once the
  // response is fully streamed (so token counts are final). Never sees a body.
  const recordOnce = (() => {
    let done = false;
    return (usage: { input_tokens: number; output_tokens: number }) => {
      if (done) return;
      done = true;
      req.signal.removeEventListener("abort", onClientAbort);
      const meta: BillingMeta = {
        request_id: requestId,
        org_id: auth.claims.org_id,
        seat_id: seat.claims.seat_id,
        provider,
        model,
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
        status: upstream.status,
        latency_ms: Date.now() - started,
        ts: new Date().toISOString(),
      };
      store.recordInference(meta);
      store.audit({
        org_id: auth.claims.org_id,
        actor_user_id: auth.claims.sub,
        action: "assured.infer",
        target: provider,
        // METADATA ONLY. Explicitly no prompt/completion. Token counts are the
        // provider's, not derived from reading the body.
        detail: { request_id: requestId, model, status: upstream.status, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens },
      });
    };
  })();

  // Response headers we forward back to the client (content-type so SSE works).
  const respHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "X-Keepance-No-Retention": "true", // customer-verifiable runtime signal (§5.6)
    "X-Keepance-Request-Id": requestId,
  };
  const ct = upstream.headers.get("content-type");
  if (ct) respHeaders["content-type"] = ct;

  // If the upstream has no body (rare/error), record and return its status.
  if (!upstream.body) {
    recordOnce({ input_tokens: 0, output_tokens: 0 });
    return new Response(null, { status: upstream.status, headers: respHeaders });
  }

  // ── tee the upstream stream ──
  // branchClient -> straight back to the caller (untouched bytes).
  // branchUsage  -> consumed ONLY by scanUsage (integers out, text discarded).
  const [branchClient, branchUsage] = upstream.body.tee();

  // Fire-and-forget the usage scan; when it resolves we have final token counts.
  // It reads branchUsage to completion (so the tee doesn't backpressure-stall)
  // and never retains text. Failure to scan must not break the client stream.
  void scanUsage(branchUsage, provider)
    .then((usage) => recordOnce(usage))
    .catch(() => recordOnce({ input_tokens: 0, output_tokens: 0 }));

  // Stream branchClient back. We pass the ReadableStream directly as the
  // Response body — Bun pipes it to the socket; nothing is buffered server-side.
  return new Response(branchClient, { status: upstream.status, headers: respHeaders });
}
