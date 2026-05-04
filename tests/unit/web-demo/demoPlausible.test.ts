/**
 * Stream D-web Group VII · Task 7.1 — demoPlausible tests.
 *
 * Verifies the Plausible wrapper:
 *   - Calls window.plausible with the right event name + props.
 *   - No-ops cleanly when window.plausible is undefined.
 *   - Session-once events fire exactly once per session.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  trackDemoLoaded,
  trackDemoAiFirstMessage,
  trackDemoLimitHit,
  trackDemoDownloadClicked,
  trackDemoByokUsed,
  _resetDemoPlausibleFlagsForTests,
} from '@/web-demo/demoPlausible';

interface PlausibleCall {
  event: string;
  props?: Record<string, unknown>;
}

function installFakePlausible(): { calls: PlausibleCall[]; restore: () => void } {
  const calls: PlausibleCall[] = [];
  const original = (window as unknown as { plausible?: unknown }).plausible;
  (window as unknown as { plausible: (e: string, o?: { props?: Record<string, unknown> }) => void }).plausible = (
    event,
    options,
  ) => {
    calls.push({
      event,
      ...(options?.props ? { props: options.props } : {}),
    });
  };
  return {
    calls,
    restore: () => {
      if (original === undefined) {
        delete (window as unknown as { plausible?: unknown }).plausible;
      } else {
        (window as unknown as { plausible: unknown }).plausible = original;
      }
    },
  };
}

describe('demoPlausible', () => {
  let plausible: ReturnType<typeof installFakePlausible>;

  beforeEach(() => {
    window.sessionStorage.clear();
    _resetDemoPlausibleFlagsForTests();
    plausible = installFakePlausible();
  });

  afterEach(() => {
    plausible.restore();
    window.sessionStorage.clear();
  });

  it('trackDemoLoaded fires demo_loaded with no props', () => {
    trackDemoLoaded();
    expect(plausible.calls).toEqual([{ event: 'demo_loaded' }]);
  });

  it('trackDemoAiFirstMessage fires once per session', () => {
    trackDemoAiFirstMessage();
    trackDemoAiFirstMessage();
    trackDemoAiFirstMessage();
    expect(plausible.calls).toHaveLength(1);
    expect(plausible.calls[0]?.event).toBe('demo_ai_first_message');
  });

  it('trackDemoLimitHit includes the reason prop', () => {
    trackDemoLimitHit('count');
    trackDemoLimitHit('rate-limited');
    expect(plausible.calls).toEqual([
      { event: 'demo_limit_hit', props: { reason: 'count' } },
      { event: 'demo_limit_hit', props: { reason: 'rate-limited' } },
    ]);
  });

  it('trackDemoDownloadClicked includes surface and optional os', () => {
    trackDemoDownloadClicked('banner');
    trackDemoDownloadClicked('exit_modal', 'mac');
    expect(plausible.calls).toEqual([
      { event: 'demo_download_clicked', props: { surface: 'banner' } },
      {
        event: 'demo_download_clicked',
        props: { surface: 'exit_modal', os: 'mac' },
      },
    ]);
  });

  it('trackDemoByokUsed fires once per session', () => {
    trackDemoByokUsed();
    trackDemoByokUsed();
    expect(plausible.calls).toHaveLength(1);
    expect(plausible.calls[0]?.event).toBe('demo_byok_used');
  });

  it('no-ops cleanly when window.plausible is undefined', () => {
    plausible.restore();
    delete (window as unknown as { plausible?: unknown }).plausible;
    expect(() => {
      trackDemoLoaded();
      trackDemoLimitHit('count');
      trackDemoDownloadClicked('banner');
    }).not.toThrow();
  });

  it('survives a throwing plausible function', () => {
    const spy = vi
      .fn()
      .mockImplementation(() => {
        throw new Error('plausible boom');
      });
    (window as unknown as { plausible: typeof spy }).plausible = spy;
    expect(() => trackDemoLoaded()).not.toThrow();
    expect(spy).toHaveBeenCalled();
  });
});
