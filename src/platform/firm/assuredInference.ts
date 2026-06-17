/**
 * assuredInference — route a provider-native request through the firm's
 * zero-retention proxy (`POST /assured/infer`) instead of BYOK-direct.
 *
 * The assured proxy is unusual by design: the BODY must be the provider-native
 * payload (Anthropic /v1/messages, OpenAI /v1/chat/completions, Google
 * :generateContent) passed through UNTOUCHED, and the control fields ride in
 * HTTP HEADERS:
 *   Authorization: Bearer <access_token>
 *   X-Seat-Token:  <a valid, active seat token>
 *   X-Provider:    anthropic | openai | google
 *   X-Model:       <provider model id>
 *   X-Stream:      "1" | "0"
 *
 * So we DON'T change how each provider builds its request body. We only rewrite
 * the destination URL + headers right before the fetch: point at the assured
 * endpoint and swap the provider-native auth header (`x-api-key` / `Authorization`
 * / `?key=`) for the assured control headers. The proxy attaches the org's
 * MANAGED provider key server-side and forwards verbatim, streaming back.
 *
 * BYOK-direct and Local-only are unchanged: a provider with no `AssuredRoute`
 * behaves exactly as before.
 */

import { getFirmApiBase } from './firmConfig';
import { FIRM_ENDPOINTS, type AssuredProvider } from './contract';

/** Per-request assured routing, set on a provider when assured mode is active. */
export interface AssuredRoute {
  provider: AssuredProvider;
  model: string;
  accessToken: string;
  seatToken: string;
  /** Defaults to true (the providers stream). */
  stream?: boolean;
}

export interface AssuredRequest {
  url: string;
  headers: Record<string, string>;
}

/**
 * Given a provider's intended `(url, headers)` for a vendor-native call,
 * return the rewritten `(url, headers)` that sends the SAME body through the
 * assured proxy. The provider's `Content-Type` (and any other non-auth header)
 * is preserved; the vendor auth headers are stripped because the proxy injects
 * the managed key. Pure — easy to unit test.
 */
export function buildAssuredRequest(
  route: AssuredRoute,
  originalHeaders: Record<string, string>,
): AssuredRequest {
  const url = `${getFirmApiBase()}${FIRM_ENDPOINTS.assuredInfer}`;

  // Start from the provider's headers, then drop every vendor-auth header so a
  // BYOK key never leaks to the proxy, and add the assured control headers.
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(originalHeaders)) {
    const lower = k.toLowerCase();
    if (
      lower === 'x-api-key' || // Anthropic
      lower === 'authorization' || // OpenAI (we set our own below)
      lower === 'anthropic-dangerous-direct-browser-access'
    ) {
      continue;
    }
    headers[k] = v;
  }
  headers['Authorization'] = `Bearer ${route.accessToken}`;
  headers['X-Seat-Token'] = route.seatToken;
  headers['X-Provider'] = route.provider;
  headers['X-Model'] = route.model;
  headers['X-Stream'] = route.stream === false ? '0' : '1';

  return { url, headers };
}

/**
 * Apply an OPTIONAL assured route to a provider's `(url, headers)`. When the
 * route is undefined (BYOK-direct / local), the inputs pass through unchanged.
 * This is the single call each provider makes right before fetch.
 */
export function applyAssuredRoute(
  route: AssuredRoute | undefined,
  url: string,
  headers: Record<string, string>,
): AssuredRequest {
  if (!route) return { url, headers };
  return buildAssuredRequest(route, headers);
}
