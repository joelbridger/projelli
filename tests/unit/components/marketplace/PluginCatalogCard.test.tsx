import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PluginCatalogCard } from '@/components/marketplace/PluginCatalogCard';
import type { CatalogEntry } from '@/types/marketplace';

const SAMPLE: CatalogEntry = {
  id: 'word-counter',
  name: 'Word Counter',
  description: 'Counts words in your editor.',
  version: '1.2.0',
  author: { name: 'Jameson Daines', githubUser: 'jamesondaines' },
  category: 'utility',
  tags: ['editor', 'word-count'],
  installUrl: 'https://example.test/wc.tar.gz',
  manifestUrl: 'https://example.test/wc-manifest.json',
  minKeepanceVersion: '2.0.0',
  publishedAt: '2026-04-28T00:00:00.000Z',
  updatedAt: '2026-04-28T00:00:00.000Z',
};

describe('PluginCatalogCard', () => {
  afterEach(() => cleanup());

  it('renders name, description, version, and author', () => {
    const onSelect = vi.fn();
    render(<PluginCatalogCard entry={SAMPLE} onSelect={onSelect} />);
    expect(
      screen.getByTestId(`plugin-catalog-card-${SAMPLE.id}-name`),
    ).toHaveTextContent('Word Counter');
    expect(
      screen.getByTestId(`plugin-catalog-card-${SAMPLE.id}-description`),
    ).toHaveTextContent('Counts words in your editor.');
    expect(
      screen.getByTestId(`plugin-catalog-card-${SAMPLE.id}`),
    ).toHaveTextContent('v1.2.0');
    expect(
      screen.getByTestId(`plugin-catalog-card-${SAMPLE.id}`),
    ).toHaveTextContent('by Jameson Daines');
  });

  it('renders a placeholder when no screenshot is provided', () => {
    const onSelect = vi.fn();
    render(<PluginCatalogCard entry={SAMPLE} onSelect={onSelect} />);
    const slot = screen.getByTestId(
      `plugin-catalog-card-${SAMPLE.id}-screenshot`,
    );
    expect(slot.querySelector('img')).toBeNull();
  });

  it('renders the first screenshot when present', () => {
    const onSelect = vi.fn();
    const withShot: CatalogEntry = {
      ...SAMPLE,
      screenshots: ['https://example.test/a.png', 'https://example.test/b.png'],
    };
    render(<PluginCatalogCard entry={withShot} onSelect={onSelect} />);
    const slot = screen.getByTestId(
      `plugin-catalog-card-${SAMPLE.id}-screenshot`,
    );
    const img = slot.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('https://example.test/a.png');
  });

  it('shows the permission count badge when permissionCount is provided', () => {
    const onSelect = vi.fn();
    render(
      <PluginCatalogCard
        entry={SAMPLE}
        permissionCount={3}
        onSelect={onSelect}
      />,
    );
    const badge = screen.getByTestId(
      `plugin-catalog-card-${SAMPLE.id}-permission-count`,
    );
    expect(badge).toHaveTextContent('3 permissions');
  });

  it('uses singular copy when permissionCount is 1', () => {
    const onSelect = vi.fn();
    render(
      <PluginCatalogCard
        entry={SAMPLE}
        permissionCount={1}
        onSelect={onSelect}
      />,
    );
    expect(
      screen.getByTestId(`plugin-catalog-card-${SAMPLE.id}-permission-count`),
    ).toHaveTextContent('1 permission');
  });

  it('hides the permission badge when permissionCount is undefined', () => {
    const onSelect = vi.fn();
    render(<PluginCatalogCard entry={SAMPLE} onSelect={onSelect} />);
    expect(
      screen.queryByTestId(
        `plugin-catalog-card-${SAMPLE.id}-permission-count`,
      ),
    ).not.toBeInTheDocument();
  });

  it('clicking the card calls onSelect with the entry id', () => {
    const onSelect = vi.fn();
    render(<PluginCatalogCard entry={SAMPLE} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId(`plugin-catalog-card-${SAMPLE.id}`));
    expect(onSelect).toHaveBeenCalledWith(SAMPLE.id);
  });

  it('clicking the inline Install CTA also calls onSelect (and only once)', () => {
    const onSelect = vi.fn();
    render(<PluginCatalogCard entry={SAMPLE} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId(`plugin-catalog-card-${SAMPLE.id}-cta`));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(SAMPLE.id);
  });

  it('shows "Installed" copy when installed and not stale', () => {
    const onSelect = vi.fn();
    render(<PluginCatalogCard entry={SAMPLE} installed onSelect={onSelect} />);
    expect(
      screen.getByTestId(`plugin-catalog-card-${SAMPLE.id}-cta`),
    ).toHaveTextContent('Installed');
  });

  it('shows "Update" copy when installed and update available', () => {
    const onSelect = vi.fn();
    render(
      <PluginCatalogCard
        entry={SAMPLE}
        installed
        updateAvailable
        onSelect={onSelect}
      />,
    );
    expect(
      screen.getByTestId(`plugin-catalog-card-${SAMPLE.id}-cta`),
    ).toHaveTextContent('Update');
  });

  it('Enter key on the card invokes onSelect', () => {
    const onSelect = vi.fn();
    render(<PluginCatalogCard entry={SAMPLE} onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByTestId(`plugin-catalog-card-${SAMPLE.id}`), {
      key: 'Enter',
    });
    expect(onSelect).toHaveBeenCalledWith(SAMPLE.id);
  });
});
