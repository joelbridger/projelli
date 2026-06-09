/**
 * ASSURED ZERO-RETENTION INFERENCE PROXY — data-path core (DECISION.md §5).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ZERO-RETENTION INVARIANT — enforced by construction in THIS file:
 *
 *   1. The PROMPT (request body) is taken as a `ReadableStream` wrapped in an
 *      `OpaqueBody` and piped DIRECTLY into the upstream `fetch`. It is never
 *      `.text()`'d, never parsed, never assigned to a variable we keep, never
 *      passed to `store.*` or `console.*`. (assured-types.ts OpaqueBody makes
 *      that structurally true: it has no content accessor and stringifies to a
 *      redaction marker.)
 *
 *   2. The COMPLETION (response body) is streamed straight back to the client.
 *      To bill, we `tee()` the upstream stream: branch A is returned to the
 *      client untouched; branch B is consumed ONLY by `scanUsage`, which reads
 *      bytes, finds the provider's `usage` numbers, accumulates INTEGERS, and
 *      DISCARDS every chunk of text. No completion text is ever retained.
 *
 *   3. The ONLY durable write per request is a `BillingMeta` row — ids, model,
 *      token counts, status, latency, ts. No body field exists on that type or
 *      that table.
 *
 *   There is intentionally NO code path here (or anywhere on the proxy) that
 *   writes a request/response body to disk, DB, a log line, or a queue. The
 *   guard test (`assured-proxy.test.ts`) feeds a unique sentinel prompt and
 *   asserts it appears in NEITHER the DB NOR any captured log output.
 *
 *   Honest caveat (documented for the firm): the UPSTREAM PROVIDER still
 *   receives the prompt in plaintext — that is inherent to any proxy that must
 *   speak to the model at all. Our guarantee is that *Keepance* retains nothing;
 *   the firm must additionally configure provider-side Zero-Data-Retention /
 *   no-training terms on the managed account (Anthropic ZDR, OpenAI ZDR/no-train,
 *   Google no-train). The proxy stamps `X-Keepance-No-Retention: true` so the
 *   guarantee is visible per response.
 * ════════════════════════════════════════════════════════════════════════════
 */

import { config } from "./config.ts";
import { decryptSecret } from "./crypto.ts";
import type { Store } from "./db.ts";
import { OpaqueBody, type AssuredProvider, type ForwardTarget, type UsageCounts } from "./assured-types.ts";

// ---------------------------------------------------------------------------
// Upstream base URLs. Defaults match the production endpoints used by the
// desktop client's providers (src/modules/models/fetchUtils.ts). Each is env-
// overridable so a deployment can pin a region/proxy — and so tests can point
// at a LOCAL FAKE provider with no real network calls.
// ---------------------------------------------------------------------------
function baseUrlFor(provider: AssuredProvider): string {
  switch (provider) {
    case "anthropic":
      return (process.env.ASSURED_ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
    case "openai":
      return (process.env.ASSURED_OPENAI_BASE_URL || "https://api.openai.com").replace(/\/+$/, "");
    case "google":
      return (process.env.ASSURED_GOOGLE_BASE_URL || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
  }
}

export type BuildTargetResult =
  | { ok: true; target: ForwardTarget }
  | { ok: false; reason: "no_managed_key" | "key_unreadable" | "bad_model" };

/**
 * Build the forward target for an org+provider+model: resolve the upstream URL +
 * endpoint, decrypt the org's managed key into TRANSIENT memory, and attach the
 * provider auth header. The decrypted key lives only inside the returned
 * `headers` object for the duration of one request; we never log it and never
 * return it to the client (the route never echoes `target`).
 *
 * `model` is needed for Google (its URL embeds the model) and is recorded as
 * billing metadata for all providers. It is validated as a plain identifier so
 * it can't smuggle a path/query into the upstream URL.
 */
export function buildForwardTarget(
  store: Store,
  input: { org_id: string; provider: AssuredProvider; model: string; stream: boolean },
): BuildTargetResult {
  if (!/^[A-Za-z0-9._:\-]{1,128}$/.test(input.model)) return { ok: false, reason: "bad_model" };

  const row = store.getOrgProviderKey(input.org_id, input.provider);
  if (!row) return { ok: false, reason: "no_managed_key" };
  const key = decryptSecret(row.key_ciphertext);
  if (!key) return { ok: false, reason: "key_unreadable" };

  const base = baseUrlFor(input.provider);
  let url: string;
  const headers: Record<string, string> = { "content-type": "application/json" };

  switch (input.provider) {
    case "anthropic":
      url = `${base}/v1/messages`;
      headers["x-api-key"] = key;
      headers["anthropic-version"] = "2023-06-01";
      break;
    case "openai":
      url = `${base}/v1/chat/completions`;
      headers["authorization"] = `Bearer ${key}`;
      break;
    case "google": {
      // Google embeds model + key in the URL. We send the key as a header where
      // supported (x-goog-api-key) AND keep the SSE alt param for streaming.
      const method = input.stream ? "streamGenerateContent" : "generateContent";
      const sse = input.stream ? "&alt=sse" : "";
      url = `${base}/v1beta/models/${encodeURIComponent(input.model)}:${method}?key=${encodeURIComponent(key)}${sse}`;
      headers["x-goog-api-key"] = key;
      break;
    }
  }

  return { ok: true, target: { provider: input.provider, url, headers, method: "POST" } };
}

/** What we log INSTEAD of a target — proves no key/url-with-key ever hits a log. */
export function redactTarget(t: ForwardTarget): Record<string, unknown> {
  return { provider: t.provider, method: t.method, endpoint: t.url.split("?")[0] };
}

// ---------------------------------------------------------------------------
// Usage scanner. Reads the *tee'd* response stream, extracts ONLY integer token
// counts from the provider's `usage`/`usageMetadata`, and discards all text.
//
// Handles both SSE (streaming) and a single JSON object (non-streaming), across
// all three providers. It NEVER stores, returns, or logs any text — only the
// two integers. If a provider omits usage (some streaming modes), counts stay 0
// and the metadata row simply records 0 (we never fabricate from the body).
// ---------------------------------------------------------------------------
export async function scanUsage(stream: ReadableStream<Uint8Array>, provider: AssuredProvider): Promise<UsageCounts> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let input_tokens = 0;
  let output_tokens = 0;

  // Pull integer usage out of one parsed JSON object (an SSE event or a whole
  // non-streamed response), per provider's shape. Anthropic reports input once
  // (message_start) and output incrementally (message_delta), so we MAX output
  // rather than overwrite-to-last for safety; OpenAI/Google report final totals.
  const absorb = (obj: unknown): void => {
    if (!obj || typeof obj !== "object") return;
    const o = obj as Record<string, any>;
    if (provider === "anthropic") {
      const startUsage = o?.message?.usage ?? (o?.type === "message_start" ? o?.message?.usage : undefined);
      if (startUsage?.input_tokens != null) input_tokens = Number(startUsage.input_tokens) || input_tokens;
      if (o?.usage?.input_tokens != null) input_tokens = Number(o.usage.input_tokens) || input_tokens;
      if (o?.usage?.output_tokens != null) output_tokens = Math.max(output_tokens, Number(o.usage.output_tokens) || 0);
    } else if (provider === "openai") {
      if (o?.usage) {
        if (o.usage.prompt_tokens != null) input_tokens = Number(o.usage.prompt_tokens) || input_tokens;
        if (o.usage.completion_tokens != null) output_tokens = Number(o.usage.completion_tokens) || output_tokens;
      }
    } else {
      // google
      const um = o?.usageMetadata;
      if (um) {
        if (um.promptTokenCount != null) input_tokens = Number(um.promptTokenCount) || input_tokens;
        if (um.candidatesTokenCount != null) output_tokens = Math.max(output_tokens, Number(um.candidatesTokenCount) || 0);
      }
    }
  };

  // Try to parse the running buffer as a single JSON object (non-SSE responses).
  const tryWholeJson = (text: string): void => {
    const t = text.trim();
    if (!t.startsWith("{") && !t.startsWith("[")) return;
    try {
      absorb(JSON.parse(t));
    } catch {
      /* not yet complete / not whole-JSON; SSE path below handles deltas */
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      // Decode to find SSE `data:` lines. We deliberately do NOT keep this text:
      // it lives only in `buffer`, is scanned for usage, and is dropped.
      buffer += decoder.decode(value, { stream: true });

      // SSE framing: events are separated by newlines; `data:` lines carry JSON.
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          absorb(JSON.parse(data));
        } catch {
          /* skip unparseable SSE line */
        }
      }
      // Cap the retained buffer so a non-SSE (single huge JSON) response can't
      // grow memory unbounded here. For non-SSE we only need the usage object,
      // which providers put at the END, so keep a bounded tail. If a whole small
      // JSON fits, parse it; otherwise rely on the SSE path above.
      if (buffer.length > 256 * 1024) {
        tryWholeJson(buffer);
        buffer = buffer.slice(buffer.length - 64 * 1024);
      }
    }
    // Flush: handle a non-SSE response that arrived as one JSON object, and any
    // trailing SSE data line with no terminating newline.
    const tail = buffer.trim();
    if (tail.startsWith("data:")) {
      const data = tail.slice(5).trim();
      if (data && data !== "[DONE]") {
        try {
          absorb(JSON.parse(data));
        } catch {
          /* ignore */
        }
      }
    } else {
      tryWholeJson(tail);
    }
  } finally {
    reader.releaseLock();
  }

  return { input_tokens, output_tokens };
}
