// tests/unit/matters/ClientMapView.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClientMapView } from '@/features/matters/ClientMapView';
import { emptyClientMap } from '@/platform/clientMap/types';
import type { ClientMap } from '@/platform/clientMap/types';

function mapWithItem(): ClientMap {
  const m = emptyClientMap('m1');
  m.sections[0].items.push({
    id: 'i1', text: 'Acme sued Beta for breach', origin: 'ai', isAssumption: false,
    sources: [{ kind: 'document', ref: '/Acme/complaint.docx', snippet: 'breach' }], updatedAt: 't',
  });
  m.completeness = { level: 'getting-there', know: [m.sections[0].items[0]], assuming: [], ask: ['What is the damages figure?'] };
  return m;
}

describe('ClientMapView', () => {
  it('renders the five core sections in order', () => {
    render(<ClientMapView map={emptyClientMap('m1')} onOpenSource={vi.fn()} onEditItem={vi.fn()} />);
    ['story', 'people', 'standing', 'upcoming', 'next'].forEach((k) =>
      expect(screen.getByTestId(`clientmap-section-${k}`)).toBeInTheDocument(),
    );
  });

  it('renders an item with a clickable source and the completeness level', () => {
    const onOpenSource = vi.fn();
    render(<ClientMapView map={mapWithItem()} onOpenSource={onOpenSource} onEditItem={vi.fn()} />);
    expect(screen.getByText('Acme sued Beta for breach')).toBeInTheDocument();
    expect(screen.getByTestId('clientmap-completeness-level')).toHaveTextContent('Getting there');
    expect(screen.getByText('What is the damages figure?')).toBeInTheDocument();
    fireEvent.click(screen.getAllByTestId('clientmap-source-link')[0]);
    expect(onOpenSource).toHaveBeenCalledWith(expect.objectContaining({ ref: '/Acme/complaint.docx' }));
  });
});
