/**
 * Phase B / B6 — on a MERGED client the same fact can surface from a file source
 * and a CRM source and land in two different sections (differing only in casing).
 * dedupeAcrossSections collapses it to one entry and merges the sources so it
 * cites both origins.
 */
import { describe, it, expect } from 'vitest';
import { dedupeAcrossSections } from '@/platform/clientMap/updater';
import type { ClientMapSection, ClientMapItem, SourceRef } from '@/platform/clientMap/types';

function item(id: string, text: string, sources: SourceRef[]): ClientMapItem {
  return { id, text, origin: 'ai', isAssumption: false, sources, updatedAt: 't' };
}

describe('dedupeAcrossSections (B6)', () => {
  it('collapses a cross-section duplicate (file + CRM, casing differs) and merges sources', () => {
    const sections: ClientMapSection[] = [
      {
        id: 's1', kind: 'core', key: 'story', title: 'Story',
        items: [item('a', 'Risk tolerance is Moderate', [{ kind: 'document', ref: '/risk.pdf', snippet: 'moderate' }])],
      },
      {
        id: 's2', kind: 'core', key: 'standing', title: 'Standing',
        items: [item('b', 'risk tolerance is moderate', [{ kind: 'crm', ref: 'crm:contact:1', snippet: 'moderate' }])],
      },
    ];
    const out = dedupeAcrossSections(sections);
    // One entry across the whole map (the second section's duplicate is dropped).
    expect(out.flatMap((s) => s.items)).toHaveLength(1);
    expect(out[1]!.items).toHaveLength(0);
    // The kept item cites BOTH the file and the CRM source.
    expect(out[0]!.items[0]!.sources.map((s) => s.kind).sort()).toEqual(['crm', 'document']);
  });

  it('keeps genuinely different facts in different sections', () => {
    const sections: ClientMapSection[] = [
      { id: 's1', kind: 'core', key: 'story', title: 'Story', items: [item('a', 'Risk tolerance is moderate', [])] },
      { id: 's2', kind: 'core', key: 'standing', title: 'Standing', items: [item('b', 'Next review is in April', [])] },
    ];
    expect(dedupeAcrossSections(sections).flatMap((s) => s.items)).toHaveLength(2);
  });

  it('does NOT collapse two distinct facts that differ only by a NUMBER (even file + CRM)', () => {
    // High token overlap (would collapse under the loose token-overlap test) but
    // the dollar amounts differ — these are two real, distinct account facts.
    const sections: ClientMapSection[] = [
      {
        id: 's1', kind: 'core', key: 'story', title: 'Story',
        items: [item('a', 'Brokerage account balance is $50,000', [{ kind: 'document', ref: '/stmt.pdf', snippet: '50000' }])],
      },
      {
        id: 's2', kind: 'core', key: 'standing', title: 'Standing',
        items: [item('b', 'Brokerage account balance is $120,000', [{ kind: 'crm', ref: 'crm:contact:1', snippet: '120000' }])],
      },
    ];
    // BOTH facts survive — advisors must keep every distinct figure.
    expect(dedupeAcrossSections(sections).flatMap((s) => s.items)).toHaveLength(2);
  });

  it('does NOT collapse exact-text duplicates that are NOT a file+CRM pair', () => {
    // Two document-sourced items with identical text in different sections: strict
    // rule keeps both (collapse is reserved for overlapping sources or file+CRM).
    const sections: ClientMapSection[] = [
      {
        id: 's1', kind: 'core', key: 'story', title: 'Story',
        items: [item('a', 'Owns a vacation home', [{ kind: 'document', ref: '/a.pdf', snippet: 'home' }])],
      },
      {
        id: 's2', kind: 'core', key: 'standing', title: 'Standing',
        items: [item('b', 'owns a vacation home', [{ kind: 'document', ref: '/b.pdf', snippet: 'home' }])],
      },
    ];
    expect(dedupeAcrossSections(sections).flatMap((s) => s.items)).toHaveLength(2);
  });
});
