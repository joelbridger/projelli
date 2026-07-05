import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useClientMapStore } from './clientMapStore';
import { emptyClientMap } from './types';
import type { ClientMapItem } from './types';
import { setMatterAuditEmitter } from '@/platform/matter/matterStore';

function at<T>(arr: T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`expected index ${String(i)} to exist`);
  return v;
}

const item = (id: string, text: string, ref: string, snippet: string): ClientMapItem => ({
  id, text, origin: 'ai', isAssumption: false,
  sources: [{ kind: 'document', ref, snippet }], updatedAt: '2026-06-01T00:00:00.000Z',
});

describe('clientMapStore beneficiary consistency wiring', () => {
  beforeEach(() => {
    useClientMapStore.setState({ maps: {}, clientQuestions: {} });
  });
  afterEach(() => {
    setMatterAuditEmitter(null);
  });

  it('surfaces a beneficiary mismatch as a gap question on setMap', () => {
    const map = emptyClientMap('m1');
    map.lastBuiltAt = '2026-07-01T00:00:00.000Z';
    at(map.sections, 0).items = [
      item('i1', 'Trust names Susan', 'Clients/H/Family-Trust.pdf', 'REVOCABLE LIVING TRUST. Primary beneficiary: Susan Henderson.'),
      item('i2', 'IRA names Karen', 'Clients/H/ira-benef.pdf', 'IRA BENEFICIARY DESIGNATION FORM. Primary beneficiary: Karen Henderson 100%'),
    ];
    useClientMapStore.getState().setMap('m1', map);
    const stored = useClientMapStore.getState().getMap('m1');
    const gap = stored?.completeness.ask[0];
    expect(gap?.text.startsWith('Beneficiary check:')).toBe(true);
    expect(gap?.sectionKey).toBe('household');
  });

  it('audit-logs when a beneficiary gap is resolved', () => {
    const emitter = vi.fn();
    setMatterAuditEmitter(emitter);
    const map = emptyClientMap('m1');
    map.lastBuiltAt = '2026-07-01T00:00:00.000Z';
    at(map.sections, 0).items = [
      item('i1', 'Trust names Susan', 'Clients/H/Family-Trust.pdf', 'REVOCABLE LIVING TRUST. Primary beneficiary: Susan Henderson.'),
      item('i2', 'IRA names Karen', 'Clients/H/ira-benef.pdf', 'IRA BENEFICIARY DESIGNATION FORM. Primary beneficiary: Karen Henderson 100%'),
    ];
    useClientMapStore.getState().setMap('m1', map);
    const gapText = useClientMapStore.getState().getMap('m1')?.completeness.ask[0]?.text ?? '';
    expect(gapText.startsWith('Beneficiary check:')).toBe(true);

    useClientMapStore.getState().markGapResolved('m1', gapText);

    expect(emitter).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'beneficiary_finding_dismissed' }),
    );
  });

  it('does not re-audit a non-beneficiary gap', () => {
    const emitter = vi.fn();
    setMatterAuditEmitter(emitter);
    const map = emptyClientMap('m1');
    useClientMapStore.setState({ maps: { m1: map } });
    useClientMapStore.getState().markGapResolved('m1', 'Some ordinary gap question');
    expect(emitter).not.toHaveBeenCalled();
  });
});
