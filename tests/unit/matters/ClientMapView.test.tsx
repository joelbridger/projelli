// tests/unit/matters/ClientMapView.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ClientMapView } from '@/features/matters/ClientMapView';
import { emptyClientMap } from '@/platform/clientMap/types';
import type { ClientMap } from '@/platform/clientMap/types';

function mapWithItem(): ClientMap {
  const m = emptyClientMap('m1');
  m.sections[0].items.push({
    id: 'i1', text: 'Acme sued Beta for breach', origin: 'ai', isAssumption: false,
    sources: [{ kind: 'document', ref: '/Acme/complaint.docx', snippet: 'breach' }], updatedAt: 't',
  });
  // An assumption has no source; it must still show its text in the "assuming" list.
  const assumed = {
    id: 'i2', text: 'Client likely wants a fast settlement', origin: 'ai' as const,
    isAssumption: true, sources: [], updatedAt: 't',
  };
  m.sections[2].items.push(assumed);
  m.completeness = {
    level: 'getting-there',
    know: [m.sections[0].items[0]],
    assuming: [assumed],
    ask: ['What is the damages figure?'],
  };
  return m;
}

describe('ClientMapView', () => {
  it('renders the five core sections in order', () => {
    render(<ClientMapView map={emptyClientMap('m1')} onOpenSource={vi.fn()} onEditItem={vi.fn()} />);
    ['story', 'people', 'standing', 'upcoming', 'next'].forEach((k) =>
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
    fireEvent.click(screen.getAllByTestId('clientmap-source-link')[0]);
    expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({ ref: '/Acme/complaint.docx' }));
  });
});
