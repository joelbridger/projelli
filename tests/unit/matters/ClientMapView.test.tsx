// tests/unit/matters/ClientMapView.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ClientMapView } from '@/features/matters/ClientMapView';
import { emptyClientMap } from '@/platform/clientMap/types';
import type { ClientMap } from '@/platform/clientMap/types';

function mapWithItem(): ClientMap {
  const m = emptyClientMap('m1');
  const household = m.sections[0]!;
  const goals = m.sections[1]!;
  const money = m.sections[2]!;
  household.items.push({
    id: 'i1', text: 'Acme sued Beta for breach', origin: 'ai', isAssumption: false,
    sources: [{ kind: 'document', ref: '/Acme/complaint.docx', snippet: 'breach' }], updatedAt: 't',
  });
  // Two more sourced facts so the level (recomputed live from sections, not just
  // read off the fixture) actually lands on "getting-there" per deriveCompleteness.
  goals.items.push(
    { id: 'i3', text: 'Client wants to retire by 60', origin: 'ai', isAssumption: false, sources: [{ kind: 'document', ref: '/plan.pdf', snippet: 'retire' }], updatedAt: 't' },
    { id: 'i4', text: 'Client wants capital preservation', origin: 'ai', isAssumption: false, sources: [{ kind: 'document', ref: '/plan.pdf', snippet: 'preserve' }], updatedAt: 't' },
  );
  // An assumption has no source; it must still show its text in the "assuming" list.
  const assumed = {
    id: 'i2', text: 'Client likely wants a fast settlement', origin: 'ai' as const,
    isAssumption: true, sources: [], updatedAt: 't',
  };
  money.items.push(assumed);
  m.completeness = {
    level: 'getting-there',
    know: [household.items[0]!, goals.items[0]!, goals.items[1]!],
    assuming: [assumed],
    ask: [{ text: 'What is the damages figure?', sectionKey: 'money' }],
  };
  return m;
}

describe('ClientMapView', () => {
  it('renders the four core sections in order', () => {
    render(<ClientMapView map={emptyClientMap('m1')} onOpenSource={vi.fn()} onEditItem={vi.fn()} />);
    ['household', 'goals', 'money', 'followups'].forEach((k) =>
      expect(screen.getByTestId(`clientmap-section-${k}`)).toBeInTheDocument(),
    );
  });

  it('renders item text, sources, the completeness level, and assumption text', () => {
    const onOpenSource = vi.fn();
    render(<ClientMapView map={mapWithItem()} onOpenSource={onOpenSource} onEditItem={vi.fn()} />);
    // A known fact appears both in its section and in the "what I know" list (the confidence lens).
    expect(screen.getAllByText('Acme sued Beta for breach').length).toBeGreaterThan(0);
    expect(screen.getByTestId('clientmap-completeness-level')).toHaveTextContent('Getting there');
    expect(screen.getByText('What is the damages figure?')).toBeInTheDocument();
    // Regression lock: the "what I'm assuming" list must show the assumption TEXT,
    // not an empty bullet (assumptions carry no source links).
    const completeness = screen.getByTestId('clientmap-completeness');
    expect(within(completeness).getByText('Client likely wants a fast settlement')).toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId('clientmap-source-link')[0]!);
    expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({ ref: '/Acme/complaint.docx' }));
  });
});
