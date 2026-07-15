import '@/i18n';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BookingPageSettings } from './BookingPageSettings';
import { BookingPublicPage } from './BookingPublicPage';
import { createBookingPageAvailabilityStub } from './availability';
import { createHostedBookingLink } from './hostedLink';
import { defaultBookingPageBranding } from './types';

const available = createBookingPageAvailabilityStub({
  state: 'available',
  dates: [
    { id: 'jul-21', label: 'Tue 21', accessibleLabel: 'Tuesday, July 21' },
    { id: 'jul-22', label: 'Wed 22', accessibleLabel: 'Wednesday, July 22' },
  ],
  slotsByDate: {
    'jul-21': [{ id: '10-30', label: '10:30 AM' }, { id: '1-30', label: '1:30 PM' }],
    'jul-22': [{ id: '9-00', label: '9:00 AM' }],
  },
});

describe('BookingPublicPage', () => {
  it('renders supplied dates and slots, then only information fields after slot selection', () => {
    render(<BookingPublicPage availability={available} branding={defaultBookingPageBranding} />);

    expect(screen.getByTestId('booking-public-page-brand-header')).toHaveTextContent('Northstar Advisory');
    expect(screen.getByTestId('booking-public-page-advisor')).toHaveTextContent('Sarah Morgan');
    expect(screen.getByTestId('booking-public-page-slot-10-30')).toBeInTheDocument();
    expect(screen.queryByTestId('booking-public-page-confirmation-information')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('booking-public-page-slot-10-30'));

    expect(screen.getByTestId('booking-public-page-confirmation-information')).toHaveTextContent('10:30 AM');
    expect(screen.getByTestId('booking-public-page-confirmation-safety')).toHaveTextContent('No time is held');
    expect(screen.getByTestId('booking-public-page-disclosure')).toHaveTextContent('Registered investment adviser');
  });

  it('renders a safe unavailable state without slots or busy details', () => {
    render(<BookingPublicPage availability={createBookingPageAvailabilityStub({ state: 'unavailable' })} branding={defaultBookingPageBranding} />);

    expect(screen.getByTestId('booking-public-page-unavailable')).toHaveTextContent('Booking is unavailable right now');
    expect(screen.queryByTestId(/booking-public-page-slot-/)).not.toBeInTheDocument();
    expect(screen.queryByText(/busy/i)).not.toBeInTheDocument();
  });

  it('renders a safe loading state without inventing dates or slots', () => {
    render(<BookingPublicPage availability={createBookingPageAvailabilityStub({ state: 'loading' })} branding={defaultBookingPageBranding} />);

    expect(screen.getByTestId('booking-public-page-loading')).toHaveTextContent('Checking available times');
    expect(screen.queryByRole('button', { name: /Tue 21/ })).not.toBeInTheDocument();
  });
});

describe('BookingPageSettings', () => {
  it('provides the hosted-link rail, copy action, branding draft, and matching preview', () => {
    const copy = vi.fn();
    const onBrandingChange = vi.fn();
    render(<BookingPageSettings availability={available} branding={defaultBookingPageBranding} onBrandingChange={onBrandingChange} onCopyLink={copy} pageId="sarah-morgan" />);

    expect(screen.getByTestId('booking-page-hosted-link')).toHaveTextContent('https://book.lantern.local/p/sarah-morgan');
    expect(screen.getByTestId('booking-page-settings-preview')).toHaveTextContent('Northstar Advisory');
    fireEvent.click(screen.getByTestId('booking-page-copy-link'));
    expect(copy).toHaveBeenCalledWith('https://book.lantern.local/p/sarah-morgan');
    fireEvent.change(screen.getByDisplayValue('Northstar Advisory'), { target: { value: 'Juniper Wealth' } });
    expect(onBrandingChange).toHaveBeenCalledWith(expect.objectContaining({ firmName: 'Juniper Wealth' }));
    fireEvent.click(screen.getByTestId('booking-page-preview-button'));
    expect(screen.getByTestId('booking-page-expanded-preview')).toBeInTheDocument();
  });
});

describe('public-page boundary', () => {
  it('uses an injected presentation source and a local hosted-link adapter only', () => {
    const source = createBookingPageAvailabilityStub({ state: 'loading' });
    expect(Object.keys(source)).toEqual(['getPresentation']);
    expect(createHostedBookingLink({ pageId: 'safe path/one' })).toBe('https://book.lantern.local/p/safe%20path%2Fone');
  });
});
