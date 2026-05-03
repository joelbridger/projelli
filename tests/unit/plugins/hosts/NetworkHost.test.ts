// Tests for NetworkHost.
//
// Coverage:
//  - happy path: network.fetch returns a serialized PluginNetworkResponse
//  - text content types are returned as utf-8
//  - binary / unknown content types are returned as base64
//  - response headers are flattened to a Record<string, string>
//  - rejects empty / non-string url
//  - fetch rejection surfaces as internal error
//  - rejects unknown methods
//  - handlesMethod is true only for network.fetch

import { describe, it, expect, beforeEach } from 'vitest';

import { NetworkHost, NetworkHostError, type FetchLike } from '@/modules/plugins/hosts/NetworkHost';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Response(JSON.stringify(body), { status: 200, ...init, headers });
}

function binaryResponse(bytes: Uint8Array, contentType = 'application/octet-stream'): Response {
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': contentType },
  });
}

let calls: Array<{ url: string; init?: RequestInit }>;
let fetchImpl: FetchLike;
let host: NetworkHost;

beforeEach(() => {
  calls = [];
  fetchImpl = async (url, init) => {
    if (init !== undefined) calls.push({ url, init });
    else calls.push({ url });
    return jsonResponse({ ok: true });
  };
  host = new NetworkHost({ fetchImpl });
});

describe('NetworkHost.handle (happy path)', () => {
  it('forwards url + init to fetch and returns a serialized response', async () => {
    const result = (await host.handle({
      pluginId: 'p',
      method: 'network.fetch',
      args: ['https://example.com/api', { method: 'POST', body: 'hi' }],
    })) as {
      status: number;
      headers: Record<string, string>;
      body: string;
      bodyEncoding: 'utf-8' | 'base64';
      ok: boolean;
    };
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://example.com/api');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.bodyEncoding).toBe('utf-8');
    expect(JSON.parse(result.body)).toEqual({ ok: true });
    expect(result.headers['content-type']).toContain('application/json');
  });

  it('returns text bodies as utf-8 for text/* content types', async () => {
    host = new NetworkHost({
      fetchImpl: async () =>
        new Response('plain text', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
    });
    const result = (await host.handle({
      pluginId: 'p',
      method: 'network.fetch',
      args: ['https://example.com/text'],
    })) as { body: string; bodyEncoding: string };
    expect(result.bodyEncoding).toBe('utf-8');
    expect(result.body).toBe('plain text');
  });

  it('returns binary bodies as base64 for non-text content types', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    host = new NetworkHost({
      fetchImpl: async () => binaryResponse(bytes, 'image/png'),
    });
    const result = (await host.handle({
      pluginId: 'p',
      method: 'network.fetch',
      args: ['https://example.com/x.png'],
    })) as { body: string; bodyEncoding: string };
    expect(result.bodyEncoding).toBe('base64');
    expect(result.body).toBe(btoa(String.fromCharCode(...bytes)));
  });
});

describe('NetworkHost.handle (errors)', () => {
  it('rejects empty / non-string urls', async () => {
    await expect(
      host.handle({ pluginId: 'p', method: 'network.fetch', args: [''] }),
    ).rejects.toThrow(NetworkHostError);
    await expect(
      host.handle({ pluginId: 'p', method: 'network.fetch', args: [42] }),
    ).rejects.toThrow(NetworkHostError);
  });

  it('surfaces fetch rejection as internal error', async () => {
    host = new NetworkHost({
      fetchImpl: async () => {
        throw new Error('network unreachable');
      },
    });
    await expect(
      host.handle({ pluginId: 'p', method: 'network.fetch', args: ['https://example.com/x'] }),
    ).rejects.toMatchObject({ code: 'internal', message: 'network unreachable' });
  });

  it('rejects unknown methods', async () => {
    await expect(
      host.handle({ pluginId: 'p', method: 'network.post', args: [] }),
    ).rejects.toThrow(NetworkHostError);
  });
});

describe('NetworkHost.handlesMethod', () => {
  it('returns true only for network.fetch', () => {
    expect(host.handlesMethod('network.fetch')).toBe(true);
    expect(host.handlesMethod('network.post')).toBe(false);
    expect(host.handlesMethod('ai.invoke')).toBe(false);
  });
});

describe('NetworkHost — error responses', () => {
  it('surfaces non-2xx status with ok=false but does not throw', async () => {
    host = new NetworkHost({
      fetchImpl: async () => new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } }),
    });
    const result = (await host.handle({
      pluginId: 'p',
      method: 'network.fetch',
      args: ['https://example.com/missing'],
    })) as { status: number; ok: boolean };
    expect(result.status).toBe(404);
    expect(result.ok).toBe(false);
  });
});
