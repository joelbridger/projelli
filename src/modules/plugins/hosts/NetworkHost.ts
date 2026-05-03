// Plugin runner — Network host adapter (Wave 3).
//
// Plugins call `api.network.fetch(url, opts?)`. The bridge enforces the
// `network` permission. This host:
//
//   1. Calls `globalThis.fetch(url, opts)`. The full RequestInit surface is
//      passed through unchanged. Plugins are sandboxed in a worker with the
//      app's own origin, so `fetch` follows whatever CORS policy the app
//      itself follows.
//   2. Materializes the response body fully (no streaming in v2.0 per spec).
//      Body is text-decoded for textual content types and base64-encoded for
//      binary. The `bodyEncoding` field on `PluginNetworkResponse` tells the
//      plugin which.
//   3. Serializes headers to a plain `Record<string, string>` so the
//      response survives the postMessage structured clone.
//
// We deliberately don't redact response bodies or headers here — the plugin
// already has the `network` permission, which is gated on user consent at
// install time (Stream C4 wires the consent dialog).
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.4
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (task 6.4)

import type { PluginNetworkResponse } from '@/types/plugin';

import type { PluginApiDispatchCall } from '../PluginAPIBridge';

export class NetworkHostError extends Error {
  readonly code: 'invalid-args' | 'internal';
  constructor(code: 'invalid-args' | 'internal', message: string) {
    super(message);
    this.code = code;
    this.name = 'NetworkHostError';
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface NetworkHostOptions {
  /** Inject a fetch implementation (tests). Defaults to `globalThis.fetch`. */
  fetchImpl?: FetchLike;
}

export class NetworkHost {
  private readonly fetchImpl: FetchLike;

  constructor(options: NetworkHostOptions = {}) {
    this.fetchImpl =
      options.fetchImpl ??
      ((input: string, init?: RequestInit) => globalThis.fetch(input, init));
  }

  handlesMethod(method: string): boolean {
    return method === 'network.fetch';
  }

  async handle(call: PluginApiDispatchCall): Promise<unknown> {
    if (call.method !== 'network.fetch') {
      throw new NetworkHostError('invalid-args', `NetworkHost cannot handle method ${call.method}`);
    }
    const url = call.args[0];
    if (typeof url !== 'string' || url.length === 0) {
      throw new NetworkHostError('invalid-args', 'network.fetch url must be a non-empty string');
    }
    const init = (call.args[1] ?? undefined) as RequestInit | undefined;

    let response: Response;
    try {
      response = await this.fetchImpl(url, init);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'fetch failed';
      throw new NetworkHostError('internal', message);
    }

    return serializeResponse(response);
  }
}

async function serializeResponse(response: Response): Promise<PluginNetworkResponse> {
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  const contentType = (headers['content-type'] ?? '').toLowerCase();
  const isText = isTextualContentType(contentType);

  let body: string;
  let bodyEncoding: 'utf-8' | 'base64';
  if (isText) {
    body = await response.text();
    bodyEncoding = 'utf-8';
  } else {
    const buffer = await response.arrayBuffer();
    body = arrayBufferToBase64(buffer);
    bodyEncoding = 'base64';
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    body,
    bodyEncoding,
    url: response.url,
    ok: response.ok,
  };
}

function isTextualContentType(contentType: string): boolean {
  if (!contentType) return true; // Default to text when missing.
  return (
    contentType.startsWith('text/') ||
    contentType.includes('json') ||
    contentType.includes('xml') ||
    contentType.includes('javascript') ||
    contentType.includes('css') ||
    contentType.includes('html') ||
    contentType.includes('svg+xml') ||
    contentType.includes('x-www-form-urlencoded')
  );
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000; // Avoid stack overflow for large bodies.
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}
