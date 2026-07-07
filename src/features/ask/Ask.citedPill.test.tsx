import '@/i18n';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Ask } from './Ask';
import { resetCitationVerificationForTests } from './citationVerification';
import type { AnswerBlock, AnswerCitation, AskTurn } from './askHelpers';
import type { CitationVerdict } from '@/platform/utils/tauri-commands';

const { ragVerifyCitationsBatchMock, useAskMock } = vi.hoisted(() => ({
  ragVerifyCitationsBatchMock: vi.fn(),
  useAskMock: vi.fn(),
}));

vi.mock('@/platform/utils/tauri-commands', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/utils/tauri-commands')>();
  return {
    ...original,
    ragVerifyCitationsBatch: (...args: unknown[]): unknown => ragVerifyCitationsBatchMock(...args),
  };
});

vi.mock('@/platform/rag/MemoryService', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/platform/rag/MemoryService')>();
  return {
    ...original,
    isMemoryEnabled: () => true,
  };
});

vi.mock('./useAsk', () => ({
  useAsk: (...args: unknown[]): unknown => useAskMock(...args),
}));

function citation(overrides: Partial<AnswerCitation> = {}): AnswerCitation {
  return {
    n: 1,
    label: 'Retirement Plan.docx',
    excerpt: 'The plan targets retirement at age 62.',
    path: 'Clients/Jane/Retirement Plan.docx',
    locator: 'paragraph 4',
    verified: false,
    grounded: true,
    paragraphIndex: 4,
    id: 'chunk-retirement-plan',
    matterId: 'matter-jane',
    ...overrides,
  };
}

function turnWithMixedAnswer(): AskTurn {
  const cite = citation();
  const files: AnswerBlock = {
    kind: 'files',
    text: 'The client wants to retire at 62. {1}',
    citations: [cite],
  };
  const general: AnswerBlock = {
    kind: 'general',
    text: 'Confirm the plan still fits before the next review.',
    citations: [],
  };

  return {
    question: 'What is the retirement goal?',
    answer: `${files.text}\n\n${general.text}`,
    citations: [cite],
    sources: [],
    blocks: [files, general],
  };
}

function setUseAskReturn(turns: AskTurn[]) {
  useAskMock.mockReturnValue({
    activeMatter: null,
    chatId: 'ask-global',
    askScope: 'all-matters',
    setAskScope: vi.fn(),
    turns,
    streamingTurn: null,
    question: '',
    setQuestion: vi.fn(),
    selected: null,
    selectedTurnIdx: null,
    errorMsg: null,
    status: 'idle',
    answerStalled: false,
    localAiStarting: false,
    localEvaluating: false,
    savingIdx: null,
    displayedProvider: 'none',
    confidentialityMode: 'local-only',
    bottomRef: React.createRef<HTMLDivElement>(),
    composerInputRef: React.createRef<HTMLInputElement>(),
    railSessions: [],
    railCollapsed: false,
    toggleRailCollapsed: vi.fn(),
    filesOnly: false,
    setFilesOnly: vi.fn(),
    stillImporting: false,
    handleCitationSelect: vi.fn(),
    handleNewAsk: vi.fn(),
    handleLoadSession: vi.fn(),
    handleAsk: vi.fn(),
    handleKeyDown: vi.fn(),
    handleSaveToDocument: vi.fn(),
    onOpenFileAtPath: undefined,
    isBusy: false,
    demoQuestions: [],
    exportConsentDialogProps: {
      open: false,
      onOpenChange: vi.fn(),
      description: 'Confirm',
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    },
    fileAccessConsent: { state: 'unasked' },
    fileAccessConsentScope: { kind: 'allMatters' },
    setFileAccessConsent: vi.fn(),
  });
}

beforeEach(() => {
  resetCitationVerificationForTests();
  ragVerifyCitationsBatchMock.mockReset();
  useAskMock.mockReset();
});

describe('Ask — cited tally pill opens sources', () => {
  it('opens the collapsed sources panel when the green cited-claims pill is clicked', async () => {
    ragVerifyCitationsBatchMock.mockResolvedValue([
      { verdict: 'verified' } satisfies CitationVerdict,
    ]);
    setUseAskReturn([turnWithMixedAnswer()]);

    render(<Ask />);

    expect(screen.getByTestId('ask-sources-pane').dataset['collapsed']).toBe('true');

    const citedPill = await screen.findByRole('button', {
      name: /1 claim cited from your files/i,
    });
    fireEvent.click(citedPill);

    expect(screen.getByTestId('ask-sources-pane').dataset['collapsed']).toBe('false');
    await waitFor(() => {
      expect(screen.getByText('Retirement Plan.docx')).toBeTruthy();
    });
  });
});
