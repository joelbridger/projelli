import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { NoticeCardConsentSection } from './NoticeCardConsentSection';
import { ConsentDialog } from '../ConsentDialog';

describe('NoticeCardConsentSection', () => {
  it('shows the offer toggle with the meeting tag and toggles', () => {
    const onToggle = vi.fn();
    render(
      <NoticeCardConsentSection
        offer={{ platform: 'teams', meetingTitle: 'Henderson quarterly review' }}
        checked
        onToggle={onToggle}
      />,
    );
    expect(screen.getByTestId('notice-card-offer')).toBeTruthy();
    expect(screen.getByTestId('notice-card-offer-tag').textContent).toContain('Henderson quarterly review');
    const toggle = screen.getByTestId('notice-card-toggle') as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('shows the Zoom native-record self-attest only for Zoom', () => {
    const { rerender } = render(
      <NoticeCardConsentSection
        offer={{ platform: 'zoom', meetingTitle: 'Q3 call' }}
        checked
        onToggle={() => {}}
        zoomNativeRecord={{ checked: false, onToggle: vi.fn() }}
      />,
    );
    expect(screen.queryByTestId('notice-card-zoom-native')).toBeTruthy();
    rerender(
      <NoticeCardConsentSection
        offer={{ platform: 'teams' }}
        checked
        onToggle={() => {}}
        zoomNativeRecord={{ checked: false, onToggle: vi.fn() }}
      />,
    );
    expect(screen.queryByTestId('notice-card-zoom-native')).toBeNull();
  });

  it('shows the honest Meet fallback (no toggle) for Google Meet', () => {
    render(<NoticeCardConsentSection offer={{ platform: 'meet' }} checked onToggle={() => {}} />);
    expect(screen.getByTestId('notice-card-meet-fallback')).toBeTruthy();
    expect(screen.queryByTestId('notice-card-toggle')).toBeNull();
  });

  it('shows a manual paste input when there is no auto offer', () => {
    const onManual = vi.fn();
    render(<NoticeCardConsentSection checked={false} onToggle={() => {}} onManualUrlChange={onManual} />);
    const input = screen.getByTestId('notice-card-manual-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'https://zoom.us/j/1' } });
    expect(onManual).toHaveBeenCalledWith('https://zoom.us/j/1');
  });

  it('renders nothing when there is neither an offer nor a manual handler', () => {
    const { container } = render(<NoticeCardConsentSection checked={false} onToggle={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('ConsentDialog integration', () => {
  it('never blocks: the Start button ignores the Notice Card toggle state', () => {
    const onConfirm = vi.fn();
    render(
      <ConsentDialog
        open
        consentMode="one-party"
        standingConsent={null}
        onOpenChange={() => {}}
        onConfirm={onConfirm}
        noticeCard={{ offer: { platform: 'teams', meetingTitle: 'X' }, checked: false, onToggle: () => {} }}
      />,
    );
    // The card toggle is present but Start is gated only by the consent checkbox.
    expect(screen.getByTestId('notice-card-offer')).toBeTruthy();
    fireEvent.click(screen.getByTestId('consent-checkbox'));
    fireEvent.click(screen.getByTestId('consent-start-button'));
    expect(onConfirm).toHaveBeenCalled();
  });
});
