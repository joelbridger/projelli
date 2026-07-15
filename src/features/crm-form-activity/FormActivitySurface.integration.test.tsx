import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CrmHomeShell } from '@/features/crm-home/CrmHome';
import type { CrmHomeAdapter } from '@/features/crm-home/types';
import { setDevFlagOverride } from '@/platform/flags';

const unusedAdapter = {} as CrmHomeAdapter;

afterEach(() => {
  setDevFlagOverride('form-activity', undefined);
});

describe('form activity flag-on CRM Home integration', () => {
  it('mounts the real surface through the flag, CRM Home shell, and live reader', async () => {
    setDevFlagOverride('form-activity', true);

    render(
      <CrmHomeShell adapter={unusedAdapter} initialRoute="form-activity" />
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
