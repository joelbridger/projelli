import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { TemplateCatalogCard } from '@/components/marketplace/TemplateCatalogCard';
import type { CatalogEntry } from '@/types/marketplace';

const SAMPLE: CatalogEntry = {
  id: 'investor-update-v1',
  name: 'Monthly Investor Update',
  description: 'Walks you through the monthly investor update.',
  version: '1.0.0',
  author: { name: 'Jameson Daines', githubUser: 'jamesondaines' },
  category: 'investor',
  tags: ['investor', 'update'],
  installUrl: 'https://example.test/x.tar.gz',
  manifestUrl: 'https://example.test/manifest.json',
  minProjelliVersion: '2.0.0',
  publishedAt: '2026-04-28T00:00:00.000Z',
  updatedAt: '2026-04-28T00:00:00.000Z',
};

describe('TemplateCatalogCard', () => {
  afterEach(() => cleanup());

  it('renders name, description, version, author and a placeholder when no screenshot', () => {
    const onSelect = vi.fn();
    render(<TemplateCatalogCard entry={SAMPLE} onSelect={onSelect} />);
    expect(
      screen.getByTestId(`template-catalog-card-${SAMPLE.id}-name`),
    ).toHaveTextContent('Monthly Investor Update');
    expect(
      screen.getByTestId(`template-catalog-card-${SAMPLE.id}-description`),
    ).toHaveTextContent('Walks you through the monthly investor update.');
    expect(
      screen.getByTestId(`template-catalog-card-${SAMPLE.id}`),
    ).toHaveTextContent('v1.0.0');
    expect(
      screen.getByTestId(`template-catalog-card-${SAMPLE.id}`),
    ).toHaveTextContent('by Jameson Daines');
    // Placeholder image area still rendered.
    expect(
      screen.getByTestId(`template-catalog-card-${SAMPLE.id}-screenshot`),
    ).toBeInTheDocument();
  });

  it('renders the first screenshot if present', () => {
    const onSelect = vi.fn();
    const withScreenshot: CatalogEntry = {
      ...SAMPLE,
      screenshots: ['https://example.test/shot1.png', 'https://example.test/shot2.png'],
    };
    render(<TemplateCatalogCard entry={withScreenshot} onSelect={onSelect} />);
    const slot = screen.getByTestId(
      `template-catalog-card-${SAMPLE.id}-screenshot`,
    );
    const img = slot.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('https://example.test/shot1.png');
  });

  it('clicking the card calls onSelect', () => {
    const onSelect = vi.fn();
    render(<TemplateCatalogCard entry={SAMPLE} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId(`template-catalog-card-${SAMPLE.id}`));
    expect(onSelect).toHaveBeenCalledWith(SAMPLE.id);
  });

  it('clicking the inline Install CTA also calls onSelect (and only once)', () => {
    const onSelect = vi.fn();
    render(<TemplateCatalogCard entry={SAMPLE} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId(`template-catalog-card-${SAMPLE.id}-cta`));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(SAMPLE.id);
  });

  it('shows "Installed" copy when installed and not stale', () => {
    const onSelect = vi.fn();
    render(<TemplateCatalogCard entry={SAMPLE} installed onSelect={onSelect} />);
    expect(
      screen.getByTestId(`template-catalog-card-${SAMPLE.id}-cta`),
    ).toHaveTextContent('Installed');
  });

  it('shows "Update" copy when installed and update available', () => {
    const onSelect = vi.fn();
    render(
      <TemplateCatalogCard
        entry={SAMPLE}
        installed
        updateAvailable
        onSelect={onSelect}
      />,
    );
    expect(
      screen.getByTestId(`template-catalog-card-${SAMPLE.id}-cta`),
    ).toHaveTextContent('Update');
  });

  it('Enter key on the card invokes onSelect', () => {
    const onSelect = vi.fn();
    render(<TemplateCatalogCard entry={SAMPLE} onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByTestId(`template-catalog-card-${SAMPLE.id}`), {
      key: 'Enter',
    });
    expect(onSelect).toHaveBeenCalledWith(SAMPLE.id);
  });
});
