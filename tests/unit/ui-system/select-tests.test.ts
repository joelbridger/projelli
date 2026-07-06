import { describe, it, expect } from 'vitest';
// @ts-expect-error — plain .mjs pure-logic module, no d.ts
import { selectTests } from '../../../scripts/ui-system/lib/select-tests.mjs';

describe('Tier S test auto-selection (round-2 P1)', () => {
  it('picks the co-located test for a changed component', () => {
    const changed = ['src/ui/kp/SegmentedToggle.tsx'];
    const exists = (p: string) => p === 'src/ui/kp/SegmentedToggle.test.tsx';
    expect(selectTests(changed, exists)).toEqual(['src/ui/kp/SegmentedToggle.test.tsx']);
  });

  it('returns EMPTY when a changed component has no test (gate must then FAIL)', () => {
    const changed = ['src/features/ask/AskComposer.tsx'];
    const exists = () => false;
    expect(selectTests(changed, exists)).toEqual([]);
  });

  it('includes a changed test file directly', () => {
    const changed = ['src/app/shell/layout/Spine.test.tsx'];
    const exists = (p: string) => p === 'src/app/shell/layout/Spine.test.tsx';
    expect(selectTests(changed, exists)).toEqual(['src/app/shell/layout/Spine.test.tsx']);
  });

  it('finds a non-co-located test via basename resolver', () => {
    const changed = ['src/features/ask/AskComposer.tsx'];
    const exists = () => false;
    const find = (bn: string) => (bn === 'AskComposer' ? ['tests/unit/ask/AskComposer.test.tsx'] : []);
    expect(selectTests(changed, exists, find)).toEqual(['tests/unit/ask/AskComposer.test.tsx']);
  });

  it('ignores non-UI changed files (no co-located scan)', () => {
    expect(selectTests(['src/platform/x.ts', 'docs/readme.md'], () => true)).toEqual([]);
  });
});
