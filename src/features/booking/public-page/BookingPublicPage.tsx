import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFlag } from '@/platform/flags';
import type { BookingPageAvailabilityConsumer, BookingPageSlotOption } from './availability';
import type { BookingPageBranding } from './types';

export interface BookingPublicPageProps {
  branding: BookingPageBranding;
  availability: BookingPageAvailabilityConsumer;
}

type PageStep = 'pick-time' | 'confirmation-information';

const cardStyle = {
  background: 'white',
  border: '1px solid var(--kp-divider, #e4e7ec)',
  borderRadius: 14,
};

/**
 * Public-facing presentation only. Selecting a source-provided slot reveals
 * information fields, but does not hold a time, write a booking, or submit.
 */
export function BookingPublicPage({ branding, availability }: BookingPublicPageProps) {
  const { t } = useTranslation();
  const presentation = availability.getPresentation();
  const [selectedDateId, setSelectedDateId] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<BookingPageSlotOption | null>(null);
  const [step, setStep] = useState<PageStep>('pick-time');
  const dates = presentation.state === 'available' ? presentation.dates : [];
  const activeDateId = selectedDateId && dates.some((date) => date.id === selectedDateId)
    ? selectedDateId
    : (dates[0]?.id ?? null);
  const activeDate = dates.find((date) => date.id === activeDateId);
  const slots = useMemo(() => {
    if (presentation.state !== 'available' || !activeDateId) return [];
    return presentation.slotsByDate[activeDateId] ?? [];
  }, [activeDateId, presentation]);

  const selectSlot = (slot: BookingPageSlotOption) => {
    setSelectedSlot(slot);
    setStep('confirmation-information');
  };

  return (
    <main data-testid="booking-public-page" style={{ background: '#f7f8fa', color: '#182230', minHeight: '100%', padding: 24 }}>
      <div style={{ margin: '0 auto', maxWidth: 1080 }}>
        <header data-testid="booking-public-page-brand-header" style={{ alignItems: 'center', display: 'flex', gap: 12, marginBottom: 24 }}>
          <div aria-hidden style={{ alignItems: 'center', background: '#173f5f', borderRadius: 10, color: 'white', display: 'flex', fontSize: 18, fontWeight: 700, height: 42, justifyContent: 'center', width: 42 }}>
            {branding.firmMark}
          </div>
          <div>
            <strong style={{ fontSize: 18 }}>{branding.firmName}</strong>
            <div style={{ color: '#667085', fontSize: 14 }}>{branding.landingCopy}</div>
          </div>
        </header>

        <div style={{ display: 'grid', gap: 20, gridTemplateColumns: 'minmax(240px, .78fr) minmax(0, 1.4fr)' }}>
          <aside data-testid="booking-public-page-advisor" style={{ ...cardStyle, padding: 24 }}>
            {branding.advisorPhotoUrl ? (
              <img alt={branding.advisorName} src={branding.advisorPhotoUrl} style={{ borderRadius: '50%', height: 68, objectFit: 'cover', width: 68 }} />
            ) : (
              <div aria-hidden style={{ alignItems: 'center', background: '#e8eef4', borderRadius: '50%', color: '#173f5f', display: 'flex', fontWeight: 700, height: 68, justifyContent: 'center', width: 68 }}>
                {branding.advisorName.split(' ').map((part) => part[0]).join('').slice(0, 2)}
              </div>
            )}
            <h1 style={{ fontSize: 22, marginBottom: 6, marginTop: 18 }}>{t('booking-public-page.public.meet-with', { advisor: branding.advisorName })}</h1>
            <p style={{ color: '#667085', lineHeight: 1.55, marginTop: 0 }}>{branding.advisorTitle}</p>
            <hr style={{ border: 0, borderTop: '1px solid #eaecf0', margin: '22px 0' }} />
            <strong>{branding.meetingTitle}</strong>
            <p style={{ color: '#667085', lineHeight: 1.55 }}>{branding.meetingDescription}</p>
          </aside>

          <section data-testid="booking-public-page-picker" style={{ ...cardStyle, minWidth: 0, padding: 28 }}>
            {presentation.state === 'loading' ? (
              <PageNotice testId="booking-public-page-loading" title={t('booking-public-page.public.loading-title')} body={t('booking-public-page.public.loading-body')} />
            ) : null}
            {presentation.state === 'unavailable' ? (
              <PageNotice testId="booking-public-page-unavailable" title={t('booking-public-page.public.unavailable-title')} body={presentation.message || t('booking-public-page.public.unavailable-body')} />
            ) : null}
            {presentation.state === 'available' && step === 'pick-time' ? (
              <>
                <span style={{ color: '#175cd3', fontSize: 13, fontWeight: 700 }}>{t('booking-public-page.public.step-pick')}</span>
                <h2 style={{ fontSize: 28, margin: '8px 0' }}>{t('booking-public-page.public.choose-time')}</h2>
                <p style={{ color: '#667085', marginTop: 0 }}>{t('booking-public-page.public.source-only')}</p>
                <div aria-label={t('booking-public-page.public.date-picker')} style={{ display: 'grid', gap: 8, gridTemplateColumns: `repeat(${Math.max(dates.length, 1)}, minmax(0, 1fr))`, margin: '24px 0' }}>
                  {dates.map((date) => (
                    <button aria-pressed={date.id === activeDateId} key={date.id} onClick={() => { setSelectedDateId(date.id); setSelectedSlot(null); }} style={dateButtonStyle(date.id === activeDateId)} type="button">
                      {date.label}
                    </button>
                  ))}
                </div>
                <h3 style={{ fontSize: 16 }}>{activeDate?.accessibleLabel}</h3>
                {slots.length > 0 ? (
                  <div aria-label={t('booking-public-page.public.time-picker')} style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(112px, 1fr))' }}>
                    {slots.map((slot) => (
                      <button data-testid={`booking-public-page-slot-${slot.id}`} key={slot.id} onClick={() => selectSlot(slot)} style={slotButtonStyle} type="button">{slot.label}</button>
                    ))}
                  </div>
                ) : (
                  <PageNotice testId="booking-public-page-no-source-slots" title={t('booking-public-page.public.no-slots-title')} body={t('booking-public-page.public.no-slots-body')} />
                )}
              </>
            ) : null}
            {presentation.state === 'available' && step === 'confirmation-information' ? (
              <ConfirmationInformation
                advisorName={branding.advisorName}
                onBack={() => setStep('pick-time')}
                selectedDate={activeDate?.accessibleLabel}
                selectedSlot={selectedSlot?.label}
              />
            ) : null}
          </section>
        </div>

        <footer data-testid="booking-public-page-disclosure" style={{ color: '#667085', display: 'flex', fontSize: 12, gap: 12, justifyContent: 'space-between', marginTop: 20 }}>
          <span>{branding.disclosure}</span>
          <span>{branding.privacyLabel}</span>
        </footer>
      </div>
    </main>
  );
}

function PageNotice({ body, testId, title }: { body: string; testId: string; title: string }) {
  return <div data-testid={testId} role="status" style={{ background: '#f8fafc', border: '1px solid #e4e7ec', borderRadius: 10, color: '#475467', padding: 18 }}><strong style={{ color: '#182230', display: 'block', marginBottom: 6 }}>{title}</strong>{body}</div>;
}

function ConfirmationInformation({ advisorName, onBack, selectedDate, selectedSlot }: { advisorName: string; onBack: () => void; selectedDate?: string; selectedSlot?: string }) {
  const { t } = useTranslation();
  return <div data-testid="booking-public-page-confirmation-information"><span style={{ color: '#175cd3', fontSize: 13, fontWeight: 700 }}>{t('booking-public-page.public.step-information')}</span><h2 style={{ fontSize: 28, margin: '8px 0' }}>{t('booking-public-page.public.confirm-title')}</h2><p style={{ color: '#667085' }}>{selectedDate} · {selectedSlot} · {t('booking-public-page.public.with-advisor', { advisor: advisorName })}</p><div style={{ display: 'grid', gap: 14, marginTop: 24 }}><label>{t('booking-public-page.public.name')}<input autoComplete="name" style={inputStyle} /></label><label>{t('booking-public-page.public.email')}<input autoComplete="email" style={inputStyle} type="email" /></label><label>{t('booking-public-page.public.discussion')}<textarea style={{ ...inputStyle, minHeight: 92 }} /></label></div><PageNotice testId="booking-public-page-confirmation-safety" title={t('booking-public-page.public.not-connected-title')} body={t('booking-public-page.public.not-connected-body')} /><button onClick={onBack} style={{ ...slotButtonStyle, marginTop: 18 }} type="button">{t('booking-public-page.public.back')}</button></div>;
}

export function FlaggedBookingPublicPage(props: BookingPublicPageProps) {
  const enabled = useFlag('booking-public-page');
  if (!enabled) return null;
  return <BookingPublicPage {...props} />;
}

const dateButtonStyle = (selected: boolean) => ({ background: selected ? '#173f5f' : 'white', border: `1px solid ${selected ? '#173f5f' : '#d0d5dd'}`, borderRadius: 9, color: selected ? 'white' : '#344054', cursor: 'pointer', minHeight: 48, padding: '8px 10px' });
const slotButtonStyle = { background: 'white', border: '1px solid #98a2b3', borderRadius: 8, color: '#344054', cursor: 'pointer', minHeight: 42, padding: '9px 12px' };
const inputStyle = { border: '1px solid #d0d5dd', borderRadius: 8, boxSizing: 'border-box' as const, display: 'block', marginTop: 6, padding: 10, width: '100%' };
