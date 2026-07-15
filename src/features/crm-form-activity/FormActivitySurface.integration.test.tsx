import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CrmHome } from '@/features/crm-home/CrmHome';
import { setDevFlagOverride } from '@/platform/flags';

afterEach(() => {
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
