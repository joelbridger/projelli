import '@/i18n';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RetentionSettings } from './RetentionSettings';
import { useRetentionPolicyStore } from '@/platform/privacy/retentionPolicyStore';

vi.mock('@/platform/privacy/retentionRunner', () => ({ runRetentionSweep: vi.fn().mockResolvedValue(null) }));

beforeEach(() => {
  useRetentionPolicyStore.setState({ policies: {}, lastSweep: {}, pendingRagCleanup: {} });
});

describe('RetentionSettings', () => {
  it('shows keep-everything by default and saves a mode change to the store', () => {
    render(<RetentionSettings workspaceRoot="/ws" />);
    expect(screen.getByTestId('retention-mode-keep-everything')).toHaveProperty('checked', true);
    fireEvent.click(screen.getByTestId('retention-mode-summary-only'));
    expect(useRetentionPolicyStore.getState().getPolicy('/ws').mode).toBe('summary-only');
  });
  it('exposes the days input only for the delete-after-days mode and clamps it', () => {
    render(<RetentionSettings workspaceRoot="/ws" />);
    fireEvent.click(screen.getByTestId('retention-mode-delete-audio-after-days'));
    const days = screen.getByTestId('retention-days');
    fireEvent.change(days, { target: { value: '0' } });
    expect(useRetentionPolicyStore.getState().getPolicy('/ws').audioRetentionDays).toBe(1);
  });
});
