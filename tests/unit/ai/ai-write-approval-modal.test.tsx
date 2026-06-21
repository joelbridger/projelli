/**
 * BUG-060 — the AI file-change approval modal. Verifies it renders the pending
 * request from the approval store (path + before/after diff), and that clicking
 * Approve / Skip settles the awaiting tool executor with the right decision.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AiWriteApprovalModal } from '@/features/ask/AiWriteApprovalModal';
import { useAiApprovalStore } from '@/platform/ai/aiApprovalStore';

describe('AiWriteApprovalModal', () => {
  beforeEach(() => {
    useAiApprovalStore.setState({ pending: null });
  });
  afterEach(() => {
    useAiApprovalStore.getState().resolvePending('skip');
    useAiApprovalStore.setState({ pending: null });
    cleanup();
  });

  it('renders nothing when no approval is pending', () => {
    render(<AiWriteApprovalModal />);
    expect(screen.queryByTestId('ai-write-approval-modal')).toBeNull();
  });

  it('shows the path + a before/after diff for an overwrite, and Approve resolves the request', async () => {
    const decision = useAiApprovalStore.getState().request({
      op: { kind: 'overwrite_file', path: 'Clients/Acme/brief.md' },
      beforeText: 'old line',
      afterText: 'new line',
      binary: false,
    });
    render(<AiWriteApprovalModal />);

    expect(screen.getByTestId('ai-write-approval-modal')).toBeTruthy();
    expect(screen.getByTestId('ai-approval-path').textContent).toContain('Clients/Acme/brief.md');
    const preview = screen.getByTestId('ai-approval-preview');
    expect(preview.textContent).toContain('old line');
    expect(preview.textContent).toContain('new line');

    fireEvent.click(screen.getByTestId('ai-approval-approve'));
    await expect(decision).resolves.toBe('approve');
  });

  it('Skip resolves the request with "skip"', async () => {
    const decision = useAiApprovalStore.getState().request({
      op: { kind: 'delete_file', path: 'old.md' },
      beforeText: 'doomed content',
      binary: false,
    });
    render(<AiWriteApprovalModal />);

    expect(screen.getByTestId('ai-approval-path').textContent).toContain('old.md');
    fireEvent.click(screen.getByTestId('ai-approval-skip'));
    await expect(decision).resolves.toBe('skip');
  });

  it('shows a summary (no text diff) for a binary file', () => {
    void useAiApprovalStore.getState().request({
      op: { kind: 'overwrite_file', path: 'contract.docx' },
      binary: true,
    });
    render(<AiWriteApprovalModal />);
    expect(screen.getByTestId('ai-approval-binary')).toBeTruthy();
    expect(screen.queryByTestId('ai-approval-preview')).toBeNull();
  });
});
