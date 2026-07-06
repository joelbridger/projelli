import '@/i18n';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { SetupProgress } from '@/platform/utils/setup-progress-commands';
import { EMPTY_SETUP_PROGRESS } from '@/platform/utils/setup-progress-commands';

let mockProgress: SetupProgress | null = null;

vi.mock('@/platform/hooks/useSetupProgress', () => ({
  useSetupProgress: () => mockProgress,
}));

import { StillImportingBanner } from './StillImportingBanner';

function progressWith(overrides: Partial<SetupProgress>): SetupProgress {
  return { ...EMPTY_SETUP_PROGRESS, ...overrides };
}

/**
 * QA-90 — while connectors are still importing email/files/CRM data, the Ask
 * surface shows a small non-blocking note so a half-empty answer during a
 * demo reads as "still importing," not "broken." It must auto-hide the
 * instant every content source finishes, and stay quiet for AI-model
 * downloads (a different signal, not a content import).
 */
describe('StillImportingBanner — QA-90', () => {
  beforeEach(() => {
    mockProgress = null;
  });

  it('renders nothing before the first snapshot arrives', () => {
    mockProgress = null;
    render(<StillImportingBanner />);
    expect(screen.queryByTestId('ask-still-importing-banner')).toBeNull();
  });

  it('renders nothing when nothing is importing', () => {
    mockProgress = progressWith({});
    render(<StillImportingBanner />);
    expect(screen.queryByTestId('ask-still-importing-banner')).toBeNull();
  });

  it('shows the banner while email is syncing', () => {
    mockProgress = progressWith({
      email: { connected: true, accounts: [], syncing: true, messagesImported: 12 },
    });
    render(<StillImportingBanner />);
    expect(screen.getByTestId('ask-still-importing-banner')).toBeTruthy();
    expect(screen.getByText(/still bringing in your files and email/i)).toBeTruthy();
  });

  it('shows the banner while OneDrive is syncing', () => {
    mockProgress = progressWith({
      oneDrive: { syncing: true, status: 'syncing', itemsChecked: 4, itemsImported: 1 },
    });
    render(<StillImportingBanner />);
    expect(screen.getByTestId('ask-still-importing-banner')).toBeTruthy();
  });

  it('shows the banner while Wealthbox CRM is syncing', () => {
    mockProgress = progressWith({
      crm: { connected: true, syncing: true, householdsProcessed: 2, recordsIndexed: 10 },
    });
    render(<StillImportingBanner />);
    expect(screen.getByTestId('ask-still-importing-banner')).toBeTruthy();
  });

  it('shows the banner while workspace file indexing is running', () => {
    mockProgress = progressWith({
      fileIndex: { indexing: true, processed: 3, total: 10, percent: 30 },
    });
    render(<StillImportingBanner />);
    expect(screen.getByTestId('ask-still-importing-banner')).toBeTruthy();
  });

  it('hides once every source has finished', () => {
    mockProgress = progressWith({
      email: { connected: true, accounts: [], syncing: false, messagesImported: 100 },
      oneDrive: { syncing: false, status: 'done', itemsChecked: 10, itemsImported: 10 },
    });
    render(<StillImportingBanner />);
    expect(screen.queryByTestId('ask-still-importing-banner')).toBeNull();
  });

  it('does not show for an AI model download alone (not a content import)', () => {
    mockProgress = progressWith({
      ai: {
        mode: 'local',
        state: 'downloading',
        percent: 40,
        cloudKeyPresent: false,
        localLlm: { state: 'downloading', percent: 40 },
        searchModel: { state: 'none', percent: null },
      },
    });
    render(<StillImportingBanner />);
    expect(screen.queryByTestId('ask-still-importing-banner')).toBeNull();
  });
});
