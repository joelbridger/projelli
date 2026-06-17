import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VisionWarningBanner } from '@/features/ask/chat/VisionWarningBanner';

describe('VisionWarningBanner', () => {
  it('displays the error message', () => {
    render(
      <VisionWarningBanner
        message="claude-3-5-haiku does not support images."
        suggestedModel="claude-3-haiku-20240307"
        onSwitchModel={vi.fn()}
      />
    );
    expect(screen.getByText(/does not support images/)).toBeTruthy();
  });

  it('shows the switch button when suggestedModel is non-empty', () => {
    render(
      <VisionWarningBanner
        message="Model X does not support images."
        suggestedModel="claude-3-haiku-20240307"
        onSwitchModel={vi.fn()}
      />
    );
    expect(screen.getByTestId('vision-warning-switch-button')).toBeTruthy();
  });

  it('hides the switch button when suggestedModel is empty string', () => {
    render(
      <VisionWarningBanner
        message="Unknown provider."
        suggestedModel=""
        onSwitchModel={vi.fn()}
      />
    );
    expect(screen.queryByTestId('vision-warning-switch-button')).toBeNull();
  });

  it('calls onSwitchModel with the suggested model on click', () => {
    const onSwitch = vi.fn();
    render(
      <VisionWarningBanner
        message="Switch needed."
        suggestedModel="gpt-4o-mini"
        onSwitchModel={onSwitch}
      />
    );
    fireEvent.click(screen.getByTestId('vision-warning-switch-button'));
    expect(onSwitch).toHaveBeenCalledWith('gpt-4o-mini');
  });

  it('has role=alert for screen readers', () => {
    render(
      <VisionWarningBanner
        message="Error."
        suggestedModel=""
        onSwitchModel={vi.fn()}
      />
    );
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
