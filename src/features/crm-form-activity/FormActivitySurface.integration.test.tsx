import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CrmHome } from '@/features/crm-home/CrmHome';
import { setDevFlagOverride } from '@/platform/flags';

afterEach(async () => {
  // Unmount before changing the shared flag. Otherwise the live CRM reader
  // can schedule a final update against a half-torn-down tree, which used to
  // surface as an intermittent unhandled error in the broad suite.
  cleanup();
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  setDevFlagOverride('form-activity', undefined);
});

describe('form activity flag-on CRM Home integration', () => {
  it('mounts the real surface through the flag, CRM Home shell, and live reader', async () => {
    setDevFlagOverride('form-activity', true);

    render(
      <CrmHome initialRoute="form-activity" />
    );

    expect(
      screen.getByTestId('crm-home-nav-form-activity')
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('form-activity-surface')).toBeInTheDocument();
      expect(screen.getByTestId('form-activity-empty')).toHaveTextContent(
        /No form submissions/i
      );
    });
  });
});
