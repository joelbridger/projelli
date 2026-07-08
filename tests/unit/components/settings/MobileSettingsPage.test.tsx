/**
 * MobileSettingsPage (Stream D1).
 *
 * The page renders four compact provider rows. Each row shows one-line
 * guidance, a "Full guide" link to the matching website docs page, and
 * where stable a deep link button to open the provider's iOS app.
 *
 * What this guards:
 *   - All four provider labels render with stable testids.
 *   - iCloud shows its content and the documented Files deep link.
 *   - The "Full guide" link points at /docs/mobile-access/<provider> on advisorprephero.com.
 *   - The Dropbox row exposes the documented dbapi-2 deep link.
 *   - Syncthing has no deep link (intentional, no stable iOS scheme).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MobileSettingsPage } from '@/features/settings/MobileSettingsPage';

afterEach(() => {
  cleanup();
});

describe('MobileSettingsPage', () => {
  it('renders all four provider rows', () => {
    render(<MobileSettingsPage />);
    expect(screen.getByTestId('mobile-tab-icloud')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-tab-dropbox')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-tab-syncthing')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-tab-gdrive')).toBeInTheDocument();
  });

  it('shows iCloud and exposes the Files deep link', () => {
    render(<MobileSettingsPage />);
    expect(screen.getByTestId('mobile-panel-icloud')).toBeInTheDocument();
    const deepLink = screen.getByTestId('mobile-deeplink-icloud');
    expect(deepLink).toHaveAttribute('href', 'shareddocuments://');
    const fullGuide = screen.getByTestId('mobile-docs-icloud');
    expect(fullGuide).toHaveAttribute(
      'href',
      'https://advisorprephero.com/docs/mobile-access/icloud',
    );
  });

  it('shows the Dropbox dbapi-2 deep link', () => {
    render(<MobileSettingsPage />);
    expect(screen.getByTestId('mobile-panel-dropbox')).toBeInTheDocument();
    const deepLink = screen.getByTestId('mobile-deeplink-dropbox');
    expect(deepLink).toHaveAttribute('href', 'dbapi-2://1/connect');
    expect(screen.getByTestId('mobile-docs-dropbox')).toHaveAttribute(
      'href',
      'https://advisorprephero.com/docs/mobile-access/dropbox',
    );
  });

  it('shows Google Drive and its full-guide link', () => {
    render(<MobileSettingsPage />);
    expect(screen.getByTestId('mobile-panel-gdrive')).toBeInTheDocument();
    expect(screen.getByTestId('mobile-docs-gdrive')).toHaveAttribute(
      'href',
      'https://advisorprephero.com/docs/mobile-access/google-drive',
    );
  });

  it('does not render a deep link for Syncthing (no stable iOS scheme)', () => {
    render(<MobileSettingsPage />);
    expect(screen.getByTestId('mobile-panel-syncthing')).toBeInTheDocument();
    expect(screen.queryByTestId('mobile-deeplink-syncthing')).not.toBeInTheDocument();
    expect(screen.getByTestId('mobile-docs-syncthing')).toHaveAttribute(
      'href',
      'https://advisorprephero.com/docs/mobile-access/syncthing',
    );
  });
});
