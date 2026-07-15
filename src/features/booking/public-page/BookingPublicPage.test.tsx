import '@/i18n';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BookingPageSettings } from './BookingPageSettings';
import { BookingPublicPage, FlaggedBookingPublicPage } from './BookingPublicPage';
import { createBookingPageAvailabilityStub } from './availability';
import { createHostedBookingLink } from './hostedLink';
import { createLocalBookingImageSource, defaultBookingPageBranding, type BookingPageBranding } from './types';

const useFlagMock = vi.hoisted(() => vi.fn<() => boolean>());

vi.mock('@/platform/flags', () => ({
  useFlag: useFlagMock,
}));

const available = createBookingPageAvailabilityStub({
  state: 'available',
  dates: [
    { id: 'jul-21', label: 'Tue 21', accessibleLabel: 'Tuesday, July 21' },
    { id: 'jul-22', label: 'Wed 22', accessibleLabel: 'Wednesday, July 22' },
  ],
  slotsByDate: {
    'jul-21': [
      { id: '10-30', label: '10:30 AM' },
      { id: '1-30', label: '1:30 PM' },
    ],
    'jul-22': [{ id: '9-00', label: '9:00 AM' }],
  },
});

describe('BookingPublicPage', () => {
  it('renders supplied dates and slots, then only information fields after slot selection', () => {
    render(<BookingPublicPage availability={available} branding={defaultBookingPageBranding} />);

    expect(screen.getByTestId('booking-public-page-brand-header')).toHaveTextContent('Northstar Advisory');
    expect(screen.getByTestId('booking-public-page-advisor')).toHaveTextContent('Sarah Morgan');
    expect(screen.getByTestId('booking-public-page-meeting-details')).toHaveTextContent('45-minute planning meeting');
    expect(screen.getByTestId('booking-public-page-slot-10-30')).toBeInTheDocument();
    expect(screen.getByTestId('booking-public-page-privacy-reassurance')).toHaveTextContent('Private calendar details are never shown');
    expect(screen.queryByTestId('booking-public-page-confirmation-information')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('booking-public-page-slot-10-30'));

    expect(screen.getByTestId('booking-public-page-confirmation-information')).toHaveTextContent('10:30 AM');
    expect(screen.getByTestId('booking-public-page-confirmation-safety')).toHaveTextContent('No time is held');
    expect(screen.getByTestId('booking-public-page-disclosure')).toHaveTextContent('Registered investment adviser');
  });

  it('renders a safe unavailable state without slots or busy details', () => {
    render(
      <BookingPublicPage
        availability={createBookingPageAvailabilityStub({
          state: 'unavailable',
        })}
        branding={defaultBookingPageBranding}
      />
    );

    expect(screen.getByTestId('booking-public-page-unavailable')).toHaveTextContent('Booking is unavailable right now');
    expect(screen.queryByTestId(/booking-public-page-slot-/)).not.toBeInTheDocument();
    expect(screen.queryByText(/busy/i)).not.toBeInTheDocument();
  });

  it('renders a safe loading state without inventing dates or slots', () => {
    render(<BookingPublicPage availability={createBookingPageAvailabilityStub({ state: 'loading' })} branding={defaultBookingPageBranding} />);

    expect(screen.getByTestId('booking-public-page-loading')).toHaveTextContent('Checking available times');
    expect(screen.queryByRole('button', { name: /Tue 21/ })).not.toBeInTheDocument();
  });

  it('renders a validated local photo but blocks a remote source at runtime', () => {
    const { rerender } = render(
      <BookingPublicPage
        availability={available}
        branding={{
          ...defaultBookingPageBranding,
          advisorPhotoSource: createLocalBookingImageSource('/assets/sarah.png'),
        }}
      />
    );
    expect(screen.getByRole('img', { name: 'Sarah Morgan' })).toHaveAttribute('src', '/assets/sarah.png');

    const malformedBranding = {
      ...defaultBookingPageBranding,
      advisorPhotoSource: 'https://tracking.example/advisor.png',
    } as unknown as BookingPageBranding;
    rerender(<BookingPublicPage availability={available} branding={malformedBranding} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(() => createLocalBookingImageSource('https://tracking.example/advisor.png')).toThrow('advisor photo must be a local image source');
  });
});

describe('FlaggedBookingPublicPage', () => {
  it('renders nothing while booking-public-page is OFF', () => {
    useFlagMock.mockReturnValue(false);
    render(<FlaggedBookingPublicPage availability={available} branding={defaultBookingPageBranding} />);

    expect(useFlagMock).toHaveBeenCalledWith('booking-public-page');
    expect(screen.queryByTestId('booking-public-page')).not.toBeInTheDocument();
  });

  it('renders the public page while booking-public-page is ON', () => {
    useFlagMock.mockReturnValue(true);
    render(<FlaggedBookingPublicPage availability={available} branding={defaultBookingPageBranding} />);

    expect(screen.getByTestId('booking-public-page')).toBeInTheDocument();
  });
});

describe('BookingPageSettings', () => {
  it('provides the hosted-link rail, copy action, branding draft, and matching preview', async () => {
    let resolveCopy!: () => void;
    const pendingCopy = new Promise<void>((resolve) => {
      resolveCopy = resolve;
    });
    const copy = vi.fn().mockReturnValueOnce(pendingCopy).mockRejectedValueOnce(new Error('Clipboard unavailable'));
    const onBrandingChange = vi.fn();
    render(<BookingPageSettings availability={available} branding={defaultBookingPageBranding} onBrandingChange={onBrandingChange} onCopyLink={copy} pageId="sarah-morgan" />);

    expect(screen.getByTestId('booking-page-hosted-link')).toHaveTextContent('https://book.lantern.local/p/sarah-morgan');
    expect(screen.getByTestId('booking-page-settings-preview')).toHaveTextContent('Northstar Advisory');
    const copyButton = screen.getByTestId('booking-page-copy-link');
    fireEvent.click(copyButton);
    expect(copy).toHaveBeenCalledWith('https://book.lantern.local/p/sarah-morgan');
    expect(copyButton).not.toHaveTextContent('Copied');
    await act(async () => {
      resolveCopy();
      await pendingCopy;
    });
    expect(copyButton).toHaveTextContent('Copied');
    await act(async () => {
      fireEvent.click(copyButton);
      await Promise.resolve();
    });
    expect(copy).toHaveBeenCalledTimes(2);
    expect(copyButton).not.toHaveTextContent('Copied');
    fireEvent.change(screen.getByDisplayValue('Northstar Advisory'), {
      target: { value: 'Juniper Wealth' },
    });
    expect(onBrandingChange).toHaveBeenCalledWith(expect.objectContaining({ firmName: 'Juniper Wealth' }));
    fireEvent.click(screen.getByTestId('booking-page-preview-button'));
    expect(screen.getByTestId('booking-page-expanded-preview')).toBeInTheDocument();
  });

  it('disables copy when no copy callback is connected and never claims success', () => {
    render(<BookingPageSettings availability={available} branding={defaultBookingPageBranding} />);

    const copyButton = screen.getByTestId('booking-page-copy-link');
    expect(copyButton).toBeDisabled();
    fireEvent.click(copyButton);
    expect(copyButton).toHaveTextContent('Copy booking link');
    expect(copyButton).not.toHaveTextContent('Copied');
  });

  it('rejects remote advisor photo input before branding can change', () => {
    const onBrandingChange = vi.fn();
    render(<BookingPageSettings availability={available} branding={defaultBookingPageBranding} onBrandingChange={onBrandingChange} />);

    fireEvent.change(screen.getByLabelText('Local advisor photo source'), {
      target: { value: 'https://tracking.example/advisor.png' },
    });
    expect(screen.getByRole('alert')).toHaveTextContent('bundled or imported local image');
    expect(onBrandingChange).not.toHaveBeenCalled();
  });
});

describe('public-page boundary', () => {
  it('uses an injected presentation source and a local hosted-link adapter only', () => {
    const source = createBookingPageAvailabilityStub({ state: 'loading' });
    expect(Object.keys(source)).toEqual(['getPresentation']);
    expect(createHostedBookingLink({ pageId: 'safe path/one' })).toBe('https://book.lantern.local/p/safe%20path%2Fone');
  });
});
