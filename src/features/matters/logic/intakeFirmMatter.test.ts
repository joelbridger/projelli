import { describe, expect, it } from 'vitest';
import { firmMatterIdForIntakeSharing } from './intakeFirmMatter';

describe('firmMatterIdForIntakeSharing', () => {
  it('does not publish an intake key for a local-only matter', () => {
    expect(firmMatterIdForIntakeSharing({ shared: false, firmMatterId: 'firm-1' })).toBeNull();
    expect(firmMatterIdForIntakeSharing({ shared: false })).toBeNull();
  });

  it('uses the promoted firm matter id, never the local id', () => {
    expect(firmMatterIdForIntakeSharing({ shared: true, firmMatterId: 'firm-matter-1' })).toBe('firm-matter-1');
  });
});
