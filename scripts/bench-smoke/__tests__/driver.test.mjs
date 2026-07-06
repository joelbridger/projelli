import { describe, it, expect, vi } from 'vitest';
import {
  Driver,
  DriverError,
  buildOriginProbeScript,
  formatOriginProbeFailure,
  originOf,
  selectSameOriginProbe,
} from '../driver.mjs';

describe('originOf', () => {
  it('returns a URL origin and rejects invalid input as null', () => {
    expect(originOf('http://localhost:5173/foo')).toBe('http://localhost:5173');
    expect(originOf('not a url')).toBeNull();
  });
});

describe('buildOriginProbeScript', () => {
  it('probes every configured app origin from inside the WebView', () => {
    const script = buildOriginProbeScript(['http://127.0.0.1:5173', 'http://[::1]:5173']);
    expect(script).toContain('http://127.0.0.1:5173');
    expect(script).toContain('http://[::1]:5173');
    expect(script).toContain("cache: 'no-store'");
  });
});

describe('selectSameOriginProbe', () => {
  it('selects the reachable probe whose origin matches the WebView page', () => {
    const result = selectSameOriginProbe('http://localhost:5173/', [
      { url: 'http://127.0.0.1:5173', origin: 'http://127.0.0.1:5173', ok: true, status: 200 },
      { url: 'http://localhost:5173', origin: 'http://localhost:5173', ok: true, status: 200 },
    ]);
    expect(result.same.url).toBe('http://localhost:5173');
  });

  it('keeps the exact IPv4/IPv6 split visible when only the wrong origin answers', () => {
    const result = selectSameOriginProbe('http://[::1]:5173/', [
      { url: 'http://127.0.0.1:5173', origin: 'http://127.0.0.1:5173', ok: true, status: 200 },
      { url: 'http://[::1]:5173', origin: 'http://[::1]:5173', ok: false, error: 'fetch failed' },
    ]);
    expect(result.same).toBeUndefined();
    expect(result.otherReachable.map((p) => p.origin)).toEqual(['http://127.0.0.1:5173']);
    expect(formatOriginProbeFailure(result)).toMatch(/bench wiring problem/);
  });
});

describe('Driver.assertSameOrigin', () => {
  it('fails loudly when the probe origin and WebView origin differ', async () => {
    const driver = new Driver({
      appOrigins: ['http://127.0.0.1:5173', 'http://[::1]:5173'],
    });
    driver.currentUrl = vi.fn().mockResolvedValue('http://[::1]:5173/');
    driver.evalJs = vi.fn().mockResolvedValue([
      { url: 'http://127.0.0.1:5173', origin: 'http://127.0.0.1:5173', ok: true, status: 200 },
      { url: 'http://[::1]:5173', origin: 'http://[::1]:5173', ok: false, error: 'fetch failed' },
    ]);

    await expect(driver.assertSameOrigin()).rejects.toThrow(DriverError);
    await expect(driver.assertSameOrigin()).rejects.toThrow(/not proof of stale bundled code/);
  });
});
