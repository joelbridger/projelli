/**
 * Types for the ASSURED ZERO-RETENTION INFERENCE PROXY (DECISION.md §5).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ZERO-RETENTION INVARIANT (read this before touching the data path):
 *
 *   The prompt (request body) and the completion (response body) flow through
 *   the proxy as OPAQUE STREAMS and are NEVER materialised into a string, never
 *   serialized, never written to the DB, a log line, a trace, or a queue. There
 *   is deliberately NO `store.save(body)` and NO `console.log(body)` anywhere on
 *   the data path. "Can't log it" is enforced BY CONSTRUCTION:
 *
 *     • `OpaqueBody` wraps a `ReadableStream` and exposes NO accessor that
 *       returns its content — no `.text()`, no `.json()`, no `toJSON`, and a
 *       `toString()`/`[inspect]` that returns a redaction marker. So if anyone
 *       ever passes a body to a logger or `JSON.stringify`, they get
 *       "[OpaqueBody <redacted>]", not the prompt.
 *     • Token counts for billing come from the PROVIDER's `usage` numbers,
 *       teed out of the response SSE — extracted as integers, with the text of
 *       the stream discarded. We never read the body to count tokens.
 *
 * The only thing persisted per request is non-content metadata (see
 * `BillingMeta`): ids, provider, model, token counts, latency, status, ts.
 * ════════════════════════════════════════════════════════════════════════════
 */

/** The AI providers the assured proxy can forward to. */
export type AssuredProvider = "anthropic" | "openai" | "google";

export const ASSURED_PROVIDERS: ReadonlySet<AssuredProvider> = new Set<AssuredProvider>([
  "anthropic",
  "openai",
  "google",
]);

/**
 * An OPAQUE request/response body. It wraps the raw bytes of a prompt (held in
 * TRANSIENT memory for the duration of one request — exactly the irreducible
 * minimum DECISION.md §5 calls out) and is the TYPE-LEVEL enforcement of the
 * zero-retention invariant: the bytes can be HANDED to an outbound `fetch` as a
 * body exactly once, but there is no method on this type that yields the content
 * as a string/object, and its stringification is a redaction marker — so it is
 * structurally incapable of being logged or serialized into a persistence sink.
 *
 * `take()` is the ONLY egress, and it is one-shot. The bytes are never copied
 * into anything we keep, never decoded, never inspected — they exist only inside
 * this object until handed to the upstream request, then are dropped with it.
 */
export class OpaqueBody {
  // `#bytes` is a true private field: it cannot be read by reflection,
  // `JSON.stringify`, spread, or `Object.keys`. The only egress is `take()`.
  #bytes: Uint8Array | null;
  #taken = false;

  constructor(bytes: Uint8Array | null) {
    this.#bytes = bytes;
  }

  /** True if there is a body at all (empty bodies have none). */
  get present(): boolean {
    return this.#bytes !== null;
  }

  /**
   * Hand the underlying bytes to a consumer EXACTLY ONCE (one-shot). Used only
   * to attach the body to an outbound `fetch`. After this, the body is consumed
   * and unavailable — there is no way to read it twice, and no accessor on this
   * type ever returns the content as text/JSON for logging or persistence.
   */
  take(): Uint8Array | null {
    if (this.#taken) throw new Error("OpaqueBody already consumed (one-shot)");
    this.#taken = true;
    const b = this.#bytes;
    this.#bytes = null;
    return b;
  }

  // ── Anti-logging surface ──────────────────────────────────────────────────
  // Anything that tries to render the body (a logger, JSON.stringify, template
  // interpolation, util.inspect) gets a redaction marker, NEVER the content.
  toString(): string {
    return "[OpaqueBody <redacted: zero-retention>]";
  }
  toJSON(): string {
    return "[OpaqueBody <redacted: zero-retention>]";
  }
  // Node's util.inspect hook (what `console.log` uses under the hood).
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return "[OpaqueBody <redacted: zero-retention>]";
  }
}

/**
 * Where + how to forward to a provider. The proxy builds this from the chosen
 * provider + the org's decrypted managed key (held transiently). The key lives
 * here ONLY for the lifetime of one request and is never logged: this object is
 * never passed to a logger, and `redactTarget()` is what we log instead.
 */
export interface ForwardTarget {
  provider: AssuredProvider;
  /** Absolute upstream URL the request body is piped to. */
  url: string;
  /** Outbound headers, including the provider auth header built from the key. */
  headers: Record<string, string>;
  /** HTTP method (always POST for these inference endpoints). */
  method: "POST";
}

/**
 * NON-CONTENT request metadata recorded for billing/quota. This is the ONLY
 * shape that touches durable storage per request. It has NO field capable of
 * holding a prompt or completion — by design, so a future careless `store.save`
 * still can't persist content. Token counts come from the provider usage.
 */
export interface BillingMeta {
  request_id: string;
  org_id: string;
  seat_id: string;
  provider: AssuredProvider;
  model: string;
  input_tokens: number;
  output_tokens: number;
  status: number; // upstream HTTP status
  latency_ms: number;
  ts: string; // ISO
}

/** A stored managed key row (the ciphertext is opaque; plaintext is never here). */
export interface ManagedProviderKey {
  org_id: string;
  provider: AssuredProvider;
  /** AES-256-GCM blob from crypto.encryptSecret — opaque, never returned/logged. */
  key_ciphertext: string;
  /** Last 4 chars of the plaintext key, for an admin to recognise it. Non-secret. */
  key_last4: string;
  updated_at: string;
  updated_by: string; // admin user_id
}

/**
 * Token usage scanned out of a provider's response stream. We accumulate ONLY
 * these integers; the surrounding text of the stream is never retained.
 */
export interface UsageCounts {
  input_tokens: number;
  output_tokens: number;
}
