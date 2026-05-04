/**
 * Stream D-web Group IV · Task 4.4 — DemoModeBanner tests.
 *
 * Verifies the banner renders, exposes its testid, and that the download
 * CTA carries the UTM parameters Plausible needs to attribute exits to the
 * banner surface specifically.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DemoModeBanner, DEMO_BANNER_DOWNLOAD_URL } from '@/web-demo/DemoModeBanner';

describe('DemoModeBanner', () => {
  it('renders the banner with its testid', () => {
    render(<DemoModeBanner />);
    expect(screen.getByTestId('demo-mode-banner')).toBeInTheDocument();
  });

  it('shows the download CTA', () => {
    render(<DemoModeBanner />);
    const button = screen.getByTestId('demo-banner-download-button');
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent(/download/i);
  });

  it('CTA href is UTM-tagged for the banner surface', () => {
    render(<DemoModeBanner />);
    // Button asChild forwards data-testid to the <a> Slot directly.
    const anchor = screen.getByTestId('demo-banner-download-button');
    const href = anchor.getAttribute('href');
    expect(href).toBe(DEMO_BANNER_DOWNLOAD_URL);
    expect(href).toContain('utm_source=demo');
    expect(href).toContain('utm_campaign=v2-launch');
    expect(href).toContain('utm_content=banner');
  });
});
