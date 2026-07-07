import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@/i18n';
import { RecordingNoticeSettings } from '@/features/settings/RecordingNoticeSettings';
import { useSettingsStore } from '@/platform/settings/settingsStore';

describe('RecordingNoticeSettings info help', () => {
  beforeEach(() => {
    useSettingsStore.setState({ values: {} });
  });

  it('keeps policy help icons outside the selectable policy buttons', () => {
    render(<RecordingNoticeSettings />);

    const help = screen.getByRole('button', { name: 'About Standard' });
    expect(help.parentElement?.closest('button')).toBeNull();

    fireEvent.mouseEnter(help);
    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Every notice step is offered',
    );
  });

  it('still selects the policy through the card button', () => {
    render(<RecordingNoticeSettings />);

    fireEvent.click(screen.getByTestId('notice-policy-strict'));

    expect(useSettingsStore.getState().getSetting('meetings.noticePolicy')).toBe(
      'strict',
    );
  });
});
