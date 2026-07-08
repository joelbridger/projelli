import '@/i18n';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RetentionSettings } from './RetentionSettings';
import { useRetentionPolicyStore } from '@/platform/privacy/retentionPolicyStore';
import { runRetentionSweep } from '@/platform/privacy/retentionRunner';

vi.mock('@/platform/privacy/retentionRunner', () => ({ runRetentionSweep: vi.fn().mockResolvedValue(null) }));

beforeEach(() => {
  useRetentionPolicyStore.setState({ policies: {}, lastSweep: {}, pendingRagCleanup: {} });
});

describe('RetentionSettings', () => {
  it('shows keep-everything by default and saves a mode change to the store', () => {
    render(<RetentionSettings workspaceRoot="/ws" />);
    expect(screen.getByTestId('retention-summary').textContent).toContain('Keep everything');
    expect(screen.queryByTestId('retention-mode-keep-everything')).toBeNull();
    fireEvent.click(screen.getByTestId('retention-change'));
    expect(screen.getByTestId('retention-mode-keep-everything')).toHaveProperty('checked', true);
    fireEvent.click(screen.getByTestId('retention-mode-summary-only'));
    expect(useRetentionPolicyStore.getState().getPolicy('/ws').mode).toBe('summary-only');
  });
  it('exposes the days input only for the delete-after-days mode and clamps it', () => {
    render(<RetentionSettings workspaceRoot="/ws" />);
    fireEvent.click(screen.getByTestId('retention-change'));
    fireEvent.click(screen.getByTestId('retention-mode-delete-audio-after-days'));
    const days = screen.getByTestId('retention-days');
    fireEvent.change(days, { target: { value: '0' } });
    expect(useRetentionPolicyStore.getState().getPolicy('/ws').audioRetentionDays).toBe(1);
  });
  it('keeps cleanup in the more-actions menu', async () => {
    render(<RetentionSettings workspaceRoot="/ws" />);
    expect(screen.queryByTestId('retention-run-now')).toBeNull();
    fireEvent.pointerDown(screen.getByTestId('retention-more-actions'), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByTestId('retention-run-now'));
    await waitFor(() => {
      expect(runRetentionSweep).toHaveBeenCalledWith('/ws', { force: true });
    });
  });
});
