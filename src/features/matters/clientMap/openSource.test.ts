// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  dispatchOpenSource,
  OPEN_ADDEPAR_EVENT,
  OPEN_BOX_EVENT,
  OPEN_JOTFORM_EVENT,
  OPEN_SHAREFILE_EVENT,
  OPEN_ZOCKS_EVENT,
} from './openSource';
import type { SourceRef } from '@/platform/clientMap/types';

describe('dispatchOpenSource carries the snippet for new connector citations', () => {
  const cases: Array<[SourceRef['kind'], string]> = [
    ['box', OPEN_BOX_EVENT],
    ['jotform', OPEN_JOTFORM_EVENT],
    ['sharefile', OPEN_SHAREFILE_EVENT],
    ['zocks', OPEN_ZOCKS_EVENT],
    ['addepar', OPEN_ADDEPAR_EVENT],
  ];

  for (const [kind, event] of cases) {
    it(`includes both sourceId and snippet for ${kind}`, () => {
      const ref: SourceRef = {
        kind,
        ref: `${kind}:src-1`,
        snippet: 'the cited passage',
      };
      const captured: Array<{ sourceId?: string; snippet?: string }> = [];
      const handler = (e: Event) => {
        captured.push((e as CustomEvent<{ sourceId?: string; snippet?: string }>).detail);
      };
      window.addEventListener(event, handler);
      try {
        dispatchOpenSource('matter-1', ref);
      } finally {
        window.removeEventListener(event, handler);
      }
      // The panel reads detail.snippet to show the quote, so both must be present.
      expect(captured).toHaveLength(1);
      expect(captured[0]?.sourceId).toBe(`${kind}:src-1`);
      expect(captured[0]?.snippet).toBe('the cited passage');
    });
  }
});
