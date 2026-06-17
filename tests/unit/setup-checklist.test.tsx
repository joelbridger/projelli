/**
 * SetupChecklist unit tests.
 *
 * Mocks the three async connection checks and the synchronous hooks so the
 * component can be rendered in jsdom without Tauri / native dependencies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before the component import.
// ---------------------------------------------------------------------------

vi.mock('@/hooks/useApiKeys', () => ({
  useApiKeys: vi.fn(),
}));

vi.mock('@/hooks/useFirm', () => ({
  useFirm: vi.fn(),
}));

vi.mock('@/utils/mail-commands', () => ({
  mailIsConnected: vi.fn(),
  gmailIsConnected: vi.fn(),
  mailImapIsConnected: vi.fn(),
}));

import { SetupChecklist } from '@/features/settings/SetupChecklist';
import { useApiKeys } from '@/hooks/useApiKeys';
import { useFirm } from '@/hooks/useFirm';
import { mailIsConnected, gmailIsConnected, mailImapIsConnected } from '@/utils/mail-commands';

// ---------------------------------------------------------------------------
// Helper to set up mocks for each test variant
// ---------------------------------------------------------------------------

function setupMocks({
  aiConnected = false,
  emailConnected = false,
  firmSignedIn = false,
}: {
  aiConnected?: boolean;
  emailConnected?: boolean;
  firmSignedIn?: boolean;
} = {}) {
  vi.mocked(useApiKeys).mockReturnValue({
    apiKeys: aiConnected ? [{ provider: 'anthropic', key: 'sk-ant-test', isValid: true }] : [],
    handleSaveApiKey: vi.fn(),
    handleDeleteApiKey: vi.fn(),
  });

  vi.mocked(useFirm).mockReturnValue({
    isSignedIn: firmSignedIn,
  } as ReturnType<typeof useFirm>);

  vi.mocked(mailIsConnected).mockResolvedValue(emailConnected);
  vi.mocked(gmailIsConnected).mockResolvedValue(false);
  vi.mocked(mailImapIsConnected).mockResolvedValue(false);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SetupChecklist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the checklist container', async () => {
    setupMocks();
    render(
      <SetupChecklist onRestartOnboarding={() => {}} onNavigate={() => {}} />,
    );
    expect(screen.getByTestId('setup-checklist')).toBeTruthy();
  });

  it('shows all three row labels', async () => {
    setupMocks();
    render(
      <SetupChecklist onRestartOnboarding={() => {}} onNavigate={() => {}} />,
    );
    expect(screen.getByText('AI connected')).toBeTruthy();
    expect(screen.getByText('Email connected')).toBeTruthy();
    expect(screen.getByText('Firm')).toBeTruthy();
  });

  it('shows Set up buttons when nothing is connected', async () => {
    setupMocks({ aiConnected: false, emailConnected: false, firmSignedIn: false });
    render(
      <SetupChecklist onRestartOnboarding={() => {}} onNavigate={() => {}} />,
    );
    // Wait for the async email check to resolve
    await waitFor(() => {
      const buttons = screen.getAllByRole('button', { name: /set up/i });
      // AI and firm rows resolve synchronously; email resolves async
      expect(buttons.length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows Manage when AI is connected', async () => {
    setupMocks({ aiConnected: true });
    render(
      <SetupChecklist onRestartOnboarding={() => {}} onNavigate={() => {}} />,
    );
    await waitFor(() => {
      // At least the AI row should say Manage once email check resolves
      expect(screen.getAllByRole('button', { name: /manage/i }).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows Manage for email row when email is connected', async () => {
    setupMocks({ emailConnected: true });
    render(
      <SetupChecklist onRestartOnboarding={() => {}} onNavigate={() => {}} />,
    );
    await waitFor(() => {
      const manageButtons = screen.getAllByRole('button', { name: /manage/i });
      expect(manageButtons.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('calls onNavigate("ai") when AI row action is clicked', async () => {
    setupMocks({ aiConnected: false });
    const onNavigate = vi.fn();
    render(
      <SetupChecklist onRestartOnboarding={() => {}} onNavigate={onNavigate} />,
    );
    // Wait for email check to resolve so buttons are enabled
    await waitFor(() => {
      const buttons = screen.getAllByRole('button', { name: /set up|manage/i });
      expect(buttons.length).toBeGreaterThanOrEqual(1);
    });
    // The first non-restart button is the AI row
    const aiButton = screen.getAllByRole('button', { name: /set up|manage/i })[0]!;
    fireEvent.click(aiButton);
    expect(onNavigate).toHaveBeenCalledWith('ai');
  });

  it('shows restart button and calls onRestartOnboarding', async () => {
    setupMocks();
    const onRestart = vi.fn();
    render(
      <SetupChecklist onRestartOnboarding={onRestart} onNavigate={() => {}} />,
    );
    const restartBtn = screen.getByRole('button', { name: /restart guided setup/i });
    expect(restartBtn).toBeTruthy();
    fireEvent.click(restartBtn);
    expect(onRestart).toHaveBeenCalledTimes(1);
  });

  it('shows the "data and keys are kept" note', () => {
    setupMocks();
    render(
      <SetupChecklist onRestartOnboarding={() => {}} onNavigate={() => {}} />,
    );
    expect(screen.getByText(/your data and keys are kept/i)).toBeTruthy();
  });
});
