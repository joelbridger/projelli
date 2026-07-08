import '@/i18n';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StillImportingBanner } from './StillImportingBanner';

/**
 * QA-90 — while connectors are still importing email/files/CRM data, the Ask
 * surface shows a small non-blocking note so a half-empty answer during a
 * demo reads as "still importing," not "broken." It must auto-hide the
 * instant every content source finishes. The underlying source-by-source
 * logic is covered by isImportingContent (setup-progress-commands.test.ts)
 * and useStillImporting.test.ts — this test only covers the show/hide render.
 */
describe('StillImportingBanner — QA-90', () => {
  it('renders nothing while nothing is importing', () => {
    render(<StillImportingBanner importing={false} />);
    expect(screen.queryByTestId('ask-still-importing-banner')).toBeNull();
  });

  it('shows the plain-language note while a content source is importing', () => {
    render(<StillImportingBanner importing />);
    expect(screen.getByTestId('ask-still-importing-banner')).toBeTruthy();
    expect(screen.getByText(/importing files and email/i)).toBeTruthy();
  });
});
