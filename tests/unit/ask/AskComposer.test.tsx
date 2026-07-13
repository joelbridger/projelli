/// <reference types="@testing-library/jest-dom" />

import '@/i18n';
import { createRef } from 'react';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AskComposer } from '@/features/ask/AskComposer';

vi.mock('@/platform/privacy/ui/EgressIndicator', () => ({
  EgressIndicator: () => <div data-testid="egress-indicator-stub" />,
}));

function renderComposer(overrides: Partial<ComponentProps<typeof AskComposer>> = {}) {
  const props: ComponentProps<typeof AskComposer> = {
    variant: 'bottom',
    askScope: 'all-matters',
    setAskScope: vi.fn(),
    hasMatter: true,
    isSample: false,
    inputRef: createRef<HTMLInputElement>(),
    question: '',
    onQuestionChange: vi.fn(),
    onKeyDown: vi.fn(),
    onSubmit: vi.fn(),
    placeholder: 'Ask...',
    ariaLabel: 'Ask',
    isBusy: false,
    status: 'idle',
    submitLabel: 'Ask',
    egressProvider: null,
    egressMode: 'local-only',
    filesOnly: false,
    onFilesOnlyChange: vi.fn(),
    banner: <div data-testid="chat-file-access-consent">File access controls</div>,
    ...overrides,
  };
  render(<AskComposer {...props} />);
  return props;
}

describe('AskComposer answer-scope chip', () => {
  it('shows file-access permission beside the input instead of hiding it in settings', () => {
    renderComposer();

    expect(screen.getByTestId('ask-answer-scope-chip')).toHaveAttribute('aria-label', 'Answer settings');
    expect(screen.getByTestId('ask-answer-scope-chip')).toHaveTextContent('');
    expect(screen.getByTestId('chat-file-access-consent')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('ask-answer-scope-chip'));

    expect(screen.getByTestId('ask-answer-scope-popover')).toBeInTheDocument();
    expect(screen.getByTestId('ask-files-only-toggle')).toBeInTheDocument();
    expect(screen.getAllByTestId('chat-file-access-consent')).toHaveLength(1);
  });

  it('toggles files-only mode from inside the popover', () => {
    const props = renderComposer({ filesOnly: true });

    expect(screen.getByTestId('ask-answer-scope-chip')).toHaveTextContent('Files only');
    fireEvent.click(screen.getByTestId('ask-answer-scope-chip'));
    fireEvent.click(screen.getByTestId('ask-files-only-toggle'));

    expect(props.onFilesOnlyChange).toHaveBeenCalledWith(false);
  });
});
