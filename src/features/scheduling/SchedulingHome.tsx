import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CalendarDays,
  CalendarPlus,
  Clock,
  Copy,
  ExternalLink,
  Link as LinkIcon,
  MoreVertical,
  Plus,
  Send,
  SlidersHorizontal,
} from 'lucide-react';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import {
  Badge,
  Button,
  Card,
  CountBadge,
  EmptyState,
  IconButton,
  QuietStatus,
  RailShell,
  RailShellActionMenu,
  RailShellHeader,
  SlidePanel,
  TrustNote,
} from '@/ui/kp';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/ui/dropdown-menu';
import { Input } from '@/ui/input';
import { Label } from '@/ui/label';
import { openExternal } from '@/platform/utils/openExternal';
import { useProfileStore } from '@/platform/profile/profileStore';
import { cn } from '@/lib/utils';
import { computeOpenSlots } from './availability';
import { useSchedulingStore } from './schedulingStore';
import { renderSchedulingSurfaceRegistry } from './schedulingSurfaceRegistry';
import {
  WEEKDAYS,
  type BookableSlot,
  type BookingRequest,
  type BookingRequestStatus,
  type MeetingType,
  type Weekday,
} from './types';

const BOOKING_LINK_BASE = 'https://book.advisorprephero.com';
const PREVIEW_SLOT_COUNT = 5;

type SchedulingSection = 'upcoming' | 'availability' | 'meeting-types';

interface MeetingTypeDraft {
  id: string | null;
  name: string;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
}

/** Compatibility implementation kept intact behind the descriptor registry. */
export function LegacySchedulingSurface() {
  const { t } = useTranslation();
  const [activeSection, setActiveSection] = useState<SchedulingSection>('upcoming');
  const [copiedAction, setCopiedAction] = useState<string | null>(null);
  const [meetingTypeDraft, setMeetingTypeDraft] = useState<MeetingTypeDraft | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const [nowUtc] = useState(() => new Date().toISOString());

  const advisorTimezone = useProfileStore((state) => state.advisorTimezone);
  const setAdvisorTimezone = useProfileStore((state) => state.setAdvisorTimezone);
  const bookingSlug = useSchedulingStore((state) => state.bookingSlug);
  const bookingRequests = useSchedulingStore((state) => state.bookingRequests);
  const rule = useSchedulingStore((state) => state.availabilityRule);
  const setDayEnabled = useSchedulingStore((state) => state.setDayEnabled);
  const updateWorkingHours = useSchedulingStore((state) => state.updateWorkingHours);
  const addMeetingType = useSchedulingStore((state) => state.addMeetingType);
  const updateMeetingType = useSchedulingStore((state) => state.updateMeetingType);
  const removeMeetingType = useSchedulingStore((state) => state.removeMeetingType);
  const confirmBookingRequest = useSchedulingStore((state) => state.confirmBookingRequest);
  const declineBookingRequest = useSchedulingStore((state) => state.declineBookingRequest);
  const setMinNoticeHours = useSchedulingStore((state) => state.setMinNoticeHours);
  const setMaxHorizonDays = useSchedulingStore((state) => state.setMaxHorizonDays);

  const safeTimezone = useMemo(() => usableTimezone(advisorTimezone), [advisorTimezone]);
  const slug = bookingSlug.slug || 'my-booking-link';
  const bookingLink = `${BOOKING_LINK_BASE}/${slug}`;
  const visibleRequests = useMemo(
    () =>
      bookingRequests
        .filter((request) => request.status === 'pending' || request.status === 'confirmed')
        .slice()
        .sort((a, b) => a.requestedSlotUtc.localeCompare(b.requestedSlotUtc)),
    [bookingRequests],
  );
  const pendingCount = visibleRequests.filter((request) => request.status === 'pending').length;
  const nextOpenSlots = useMemo(
    () =>
      buildNextOpenSlots({
        bookingRequests,
        meetingTypes: rule.meetingTypes,
        nowUtc,
        advisorTimezone: safeTimezone,
        rule,
      }),
    [bookingRequests, nowUtc, rule, safeTimezone],
  );

  const copyBookingLink = async () => {
    await copyToClipboard(bookingLink);
    setCopiedAction('link');
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = window.setTimeout(() => {
      setCopiedAction(null);
    }, 1800);
  };

  const handlePreview = () => {
    void openExternal(bookingLink).catch(reportSchedulingActionError);
  };

  const handleShare = async () => {
    const sharePayload = {
      title: t('scheduling.surface.booking-link.share-title'),
      text: t('scheduling.surface.booking-link.share-text'),
      url: bookingLink,
    };
    const nav = navigator as Navigator & {
      share?: (data: typeof sharePayload) => Promise<void>;
    };
    if (typeof nav.share === 'function') {
      await nav.share(sharePayload).catch(reportSchedulingActionError);
      return;
    }
    await copyBookingLink();
  };

  const copyBookingLinkSafely = () => {
    void copyBookingLink().catch(reportSchedulingActionError);
  };

  const openAddMeetingType = () => {
    setMeetingTypeDraft({
      id: null,
      name: t('scheduling.surface.meeting-types.new-default-name'),
      durationMin: 30,
      bufferBeforeMin: 0,
      bufferAfterMin: 15,
    });
  };

  const openEditMeetingType = (meetingType: MeetingType) => {
    setMeetingTypeDraft({
      id: meetingType.id,
      name: meetingType.name,
      durationMin: meetingType.durationMin,
      bufferBeforeMin: meetingType.bufferBeforeMin,
      bufferAfterMin: meetingType.bufferAfterMin,
    });
  };

  const closeMeetingTypePanel = () => {
    setMeetingTypeDraft(null);
  };

  const saveMeetingType = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!meetingTypeDraft) return;
    const payload = {
      name: meetingTypeDraft.name.trim() || t('scheduling.surface.meeting-types.new-default-name'),
      durationMin: meetingTypeDraft.durationMin,
      bufferBeforeMin: meetingTypeDraft.bufferBeforeMin,
      bufferAfterMin: meetingTypeDraft.bufferAfterMin,
    };
    if (meetingTypeDraft.id) {
      updateMeetingType(meetingTypeDraft.id, payload);
    } else {
      addMeetingType(payload);
    }
    closeMeetingTypePanel();
  };

  const railItems = [
    {
      id: 'upcoming',
      label: t('scheduling.surface.rail.upcoming'),
      supportingText: t('scheduling.surface.rail.upcoming-support'),
      leading: <CalendarDays size={14} strokeWidth={1.75} aria-hidden />,
      trailing: pendingCount > 0 ? <CountBadge count={pendingCount} /> : undefined,
      testId: 'scheduling-rail-upcoming',
    },
    {
      id: 'availability',
      label: t('scheduling.surface.rail.availability'),
      supportingText: t('scheduling.surface.rail.availability-support'),
      leading: <Clock size={14} strokeWidth={1.75} aria-hidden />,
      testId: 'scheduling-rail-availability',
    },
    {
      id: 'meeting-types',
      label: t('scheduling.surface.rail.meeting-types'),
      supportingText: t('scheduling.surface.rail.meeting-types-support'),
      leading: <CalendarPlus size={14} strokeWidth={1.75} aria-hidden />,
      testId: 'scheduling-rail-meeting-types',
    },
  ];

  return (
    <div
      data-testid="scheduling-surface"
      style={{
        display: 'flex',
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        flexDirection: 'column',
        background: 'var(--color-background)',
      }}
    >
      <div style={{ padding: 'var(--kp-surface-header-pad)', borderBottom: '1px solid var(--kp-divider)', flexShrink: 0 }}>
        <SurfaceHeader
          Icon={CalendarDays}
          iconColor="var(--kp-accent)"
          title={t('scheduling.surface.title')}
          description={t('scheduling.surface.description')}
          testId="scheduling-surface-header"
          actions={
            <IconButton
              icon={MoreVertical}
              label={t('scheduling.surface.header-menu-label')}
              variant="secondary"
              size="sm"
              data-testid="scheduling-header-actions"
            />
          }
        />
      </div>

      <RailShell
        header={
          <RailShellHeader
            title={t('scheduling.surface.rail.title')}
            menuAction={
              <RailShellActionMenu label={t('scheduling.surface.rail.menu-label')}>
                <DropdownMenuItem data-testid="scheduling-rail-copy-link" onSelect={copyBookingLinkSafely}>
                  <Copy className="h-4 w-4" aria-hidden />
                  {t('scheduling.surface.booking-link.copy')}
                </DropdownMenuItem>
                <DropdownMenuItem data-testid="scheduling-rail-add-meeting-type" onSelect={openAddMeetingType}>
                  <Plus className="h-4 w-4" aria-hidden />
                  {t('scheduling.surface.meeting-types.add')}
                </DropdownMenuItem>
              </RailShellActionMenu>
            }
          />
        }
        listAriaLabel={t('scheduling.surface.rail.list-label')}
        items={railItems}
        activeId={activeSection}
        onSelect={(id) => { setActiveSection(id as SchedulingSection); }}
        contentClassName="bg-[var(--color-background)]"
      >
        {activeSection === 'upcoming' ? (
          <UpcomingPanel
            bookingLink={bookingLink}
            copied={copiedAction === 'link'}
            nextOpenSlots={nextOpenSlots}
            requests={visibleRequests}
            meetingTypes={rule.meetingTypes}
            timezone={safeTimezone}
            onCopy={copyBookingLinkSafely}
            onPreview={handlePreview}
            onShare={() => { void handleShare().catch(reportSchedulingActionError); }}
            onConfirm={confirmBookingRequest}
            onDecline={declineBookingRequest}
          />
        ) : null}

        {activeSection === 'availability' ? (
          <AvailabilityPanel
            nextOpenSlots={nextOpenSlots}
            timezone={safeTimezone}
            rawTimezone={advisorTimezone}
            onTimezoneChange={setAdvisorTimezone}
            minNoticeHours={rule.minNoticeHours}
            maxHorizonDays={rule.maxHorizonDays}
            onMinNoticeChange={setMinNoticeHours}
            onMaxHorizonChange={setMaxHorizonDays}
            workingHours={rule.workingHours}
            onDayEnabledChange={setDayEnabled}
            onWorkingHoursChange={updateWorkingHours}
          />
        ) : null}

        {activeSection === 'meeting-types' ? (
          <MeetingTypesPanel
            meetingTypes={rule.meetingTypes}
            nextOpenSlots={nextOpenSlots}
            timezone={safeTimezone}
            onAdd={openAddMeetingType}
            onEdit={openEditMeetingType}
            onRemove={removeMeetingType}
          />
        ) : null}
      </RailShell>

      <MeetingTypePanel
        draft={meetingTypeDraft}
        onDraftChange={setMeetingTypeDraft}
        onClose={closeMeetingTypePanel}
        onSubmit={saveMeetingType}
      />
    </div>
  );
}

/** Generic scheduling shell. New calendar and booking surfaces register mounts. */
export function SchedulingHome() {
  const state = useSchedulingStore();
  return <>{renderSchedulingSurfaceRegistry({ state })}</>;
}

function UpcomingPanel({
  bookingLink,
  copied,
  nextOpenSlots,
  requests,
  meetingTypes,
  timezone,
  onCopy,
  onPreview,
  onShare,
  onConfirm,
  onDecline,
}: {
  bookingLink: string;
  copied: boolean;
  nextOpenSlots: BookableSlot[];
  requests: BookingRequest[];
  meetingTypes: MeetingType[];
  timezone: string;
  onCopy: () => void;
  onPreview: () => void;
  onShare: () => void;
  onConfirm: (requestId: string) => void;
  onDecline: (requestId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <SurfaceScroll>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <BookingLinkCard
            bookingLink={bookingLink}
            copied={copied}
            onCopy={onCopy}
            onPreview={onPreview}
            onShare={onShare}
          />
          <section aria-labelledby="scheduling-upcoming-heading" className="flex min-w-0 flex-col gap-3">
            <SectionHeading
              id="scheduling-upcoming-heading"
              title={t('scheduling.surface.upcoming.title')}
              body={t('scheduling.surface.upcoming.body')}
            />
            {requests.length === 0 ? (
              <Card variant="flat" data-testid="scheduling-upcoming-empty">
                <EmptyState
                  compact
                  icon={CalendarDays}
                  title={t('scheduling.surface.upcoming.empty-title')}
                  actions={
                    <Button size="sm" variant="secondary" iconLeft={Copy} onClick={onCopy} data-testid="scheduling-empty-copy-link">
                      {t('scheduling.surface.booking-link.copy')}
                    </Button>
                  }
                />
              </Card>
            ) : (
              <Card variant="flat" data-testid="scheduling-bookings-list">
                <div className="divide-y divide-[var(--kp-divider)]">
                  {requests.map((request) => {
                    const meetingTypeName = meetingTypes.find((type) => type.id === request.meetingTypeId)?.name;
                    return (
                      <BookingRow
                        key={request.id}
                        request={request}
                        timezone={timezone}
                        onConfirm={onConfirm}
                        onDecline={onDecline}
                        {...(meetingTypeName ? { meetingTypeName } : {})}
                      />
                    );
                  })}
                </div>
              </Card>
            )}
          </section>
        </div>
        <NextOpenSlotsCard slots={nextOpenSlots} timezone={timezone} />
      </div>
    </SurfaceScroll>
  );
}

function BookingLinkCard({
  bookingLink,
  copied,
  onCopy,
  onPreview,
  onShare,
}: {
  bookingLink: string;
  copied: boolean;
  onCopy: () => void;
  onPreview: () => void;
  onShare: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Card variant="raised" data-testid="scheduling-booking-link-card">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-[var(--kp-accent-soft)] text-[var(--kp-accent)]">
            <LinkIcon size={16} strokeWidth={1.75} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="m-0 text-[length:var(--kp-font-lg)] font-semibold text-[var(--kp-navy)]">
              {t('scheduling.surface.booking-link.title')}
            </h2>
            <p className="m-0 text-[length:var(--kp-font-sm)] text-[var(--kp-text-faint)]">
              {t('scheduling.surface.booking-link.body')}
            </p>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2 rounded-md border border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] p-3 sm:flex-row sm:items-center">
          <code
            data-testid="scheduling-booking-link"
            className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[length:var(--kp-font-sm)] text-[var(--kp-navy)]"
          >
            {bookingLink}
          </code>
          {copied ? <QuietStatus data-testid="scheduling-booking-link-copied">{t('scheduling.surface.booking-link.copied')}</QuietStatus> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" iconLeft={Copy} onClick={onCopy} data-testid="scheduling-copy-link">
            {t('scheduling.surface.booking-link.copy')}
          </Button>
          <Button size="sm" variant="secondary" iconLeft={ExternalLink} onClick={onPreview} data-testid="scheduling-preview-link">
            {t('scheduling.surface.booking-link.preview')}
          </Button>
          <Button size="sm" variant="secondary" iconLeft={Send} onClick={onShare} data-testid="scheduling-share-link">
            {t('scheduling.surface.booking-link.share')}
          </Button>
        </div>
        <TrustNote data-testid="scheduling-booking-link-trust">
          {t('scheduling.surface.booking-link.trust')}
        </TrustNote>
      </div>
    </Card>
  );
}

function BookingRow({
  request,
  meetingTypeName,
  timezone,
  onConfirm,
  onDecline,
}: {
  request: BookingRequest;
  meetingTypeName?: string;
  timezone: string;
  onConfirm: (requestId: string) => void;
  onDecline: (requestId: string) => void;
}) {
  const { t } = useTranslation();
  const typeName = meetingTypeName ?? t('scheduling.surface.upcoming.unknown-meeting');
  return (
    <div
      data-testid={`scheduling-booking-row-${request.id}`}
      className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-semibold text-[var(--kp-navy)]">{request.clientName}</span>
          <span aria-hidden className="text-[var(--kp-text-faint)]">·</span>
          <span className="text-[length:var(--kp-font-sm)] text-[var(--kp-text-dim)]">{typeName}</span>
        </div>
        <div className="mt-1 text-[length:var(--kp-font-sm)] text-[var(--kp-text-faint)]">
          {formatDateTime(request.requestedSlotUtc, timezone)}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <BookingStatus status={request.status} />
        {request.status === 'pending' ? (
          <>
            <Button size="sm" variant="primary" onClick={() => { onConfirm(request.id); }} data-testid={`scheduling-confirm-${request.id}`}>
              {t('scheduling.surface.upcoming.confirm')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => { onDecline(request.id); }} data-testid={`scheduling-decline-${request.id}`}>
              {t('scheduling.surface.upcoming.decline')}
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function BookingStatus({ status }: { status: BookingRequestStatus }) {
  const { t } = useTranslation();
  if (status === 'confirmed') {
    return <QuietStatus data-testid="scheduling-booking-status-confirmed">{t('scheduling.surface.status.confirmed')}</QuietStatus>;
  }
  if (status === 'pending') {
    return (
      <Badge variant="warning" size="sm" data-testid="scheduling-booking-status-pending">
        {t('scheduling.surface.status.pending')}
      </Badge>
    );
  }
  if (status === 'declined') {
    return <QuietStatus state="failure">{t('scheduling.surface.status.declined')}</QuietStatus>;
  }
  return <QuietStatus state="pending">{t('scheduling.surface.status.expired')}</QuietStatus>;
}

function AvailabilityPanel({
  nextOpenSlots,
  timezone,
  rawTimezone,
  onTimezoneChange,
  minNoticeHours,
  maxHorizonDays,
  onMinNoticeChange,
  onMaxHorizonChange,
  workingHours,
  onDayEnabledChange,
  onWorkingHoursChange,
}: {
  nextOpenSlots: BookableSlot[];
  timezone: string;
  rawTimezone: string;
  onTimezoneChange: (timezone: string) => void;
  minNoticeHours: number;
  maxHorizonDays: number;
  onMinNoticeChange: (hours: number) => void;
  onMaxHorizonChange: (days: number) => void;
  workingHours: Record<Weekday, Array<{ startLocal: string; endLocal: string }>>;
  onDayEnabledChange: (weekday: Weekday, enabled: boolean) => void;
  onWorkingHoursChange: (weekday: Weekday, updates: { startLocal?: string; endLocal?: string }) => void;
}) {
  const { t } = useTranslation();
  return (
    <SurfaceScroll>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-labelledby="scheduling-availability-heading" className="flex min-w-0 flex-col gap-3">
          <SectionHeading
            id="scheduling-availability-heading"
            title={t('scheduling.surface.availability.title')}
            body={t('scheduling.surface.availability.body')}
          />
          <Card variant="flat" data-testid="scheduling-availability-card">
            <div className="divide-y divide-[var(--kp-divider)]">
              {WEEKDAYS.map((weekday) => {
                const hours = workingHours[weekday];
                const enabled = hours.length > 0;
                const firstRange = hours[0] ?? { startLocal: '09:00', endLocal: '17:00' };
                return (
                  <div key={weekday} className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      <Switch
                        checked={enabled}
                        onChange={(checked) => { onDayEnabledChange(weekday, checked); }}
                        label={t('scheduling.surface.availability.day-toggle-label', {
                          day: t(`settings.scheduling.weekdays.${weekday}`),
                        })}
                        testId={`scheduling-day-toggle-${weekday}`}
                      />
                      <div className="min-w-0">
                        <div className="font-semibold text-[var(--kp-navy)]">{t(`settings.scheduling.weekdays.${weekday}`)}</div>
                        <div className="text-[length:var(--kp-font-xs)] text-[var(--kp-text-faint)]">
                          {enabled ? t('scheduling.surface.availability.available') : t('scheduling.surface.availability.closed')}
                        </div>
                      </div>
                    </div>
                    <div className={cn('flex items-center gap-2', !enabled && 'opacity-50')}>
                      <Input
                        aria-label={t('settings.scheduling.hours.start-label', {
                          day: t(`settings.scheduling.weekdays.${weekday}`),
                        })}
                        type="time"
                        value={firstRange.startLocal}
                        disabled={!enabled}
                        data-testid={`scheduling-start-${weekday}`}
                        onChange={(event) => {
                          onWorkingHoursChange(weekday, { startLocal: event.target.value });
                        }}
                        className="h-8 w-28 text-sm"
                      />
                      <span className="text-[length:var(--kp-font-xs)] text-[var(--kp-text-faint)]">
                        {t('settings.scheduling.hours.to')}
                      </span>
                      <Input
                        aria-label={t('settings.scheduling.hours.end-label', {
                          day: t(`settings.scheduling.weekdays.${weekday}`),
                        })}
                        type="time"
                        value={firstRange.endLocal}
                        disabled={!enabled}
                        data-testid={`scheduling-end-${weekday}`}
                        onChange={(event) => {
                          onWorkingHoursChange(weekday, { endLocal: event.target.value });
                        }}
                        className="h-8 w-28 text-sm"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <details data-testid="scheduling-advanced" className="rounded-lg border border-[var(--kp-divider)] bg-[var(--color-background)]">
            <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-[length:var(--kp-font-sm)] font-semibold text-[var(--kp-navy)]">
              <SlidersHorizontal size={14} strokeWidth={1.75} aria-hidden />
              {t('scheduling.surface.availability.advanced-title')}
            </summary>
            <div className="grid gap-4 border-t border-[var(--kp-divider)] p-4 md:grid-cols-3">
              <Field id="scheduling-timezone" label={t('settings.scheduling.rules.timezone-label')}>
                <Input
                  id="scheduling-timezone"
                  data-testid="scheduling-timezone-input"
                  value={rawTimezone}
                  onChange={(event) => { onTimezoneChange(event.target.value); }}
                  className="h-9 text-sm"
                />
              </Field>
              <NumberField
                id="scheduling-min-notice"
                label={t('settings.scheduling.rules.min-notice-label')}
                value={minNoticeHours}
                min={0}
                onChange={onMinNoticeChange}
              />
              <NumberField
                id="scheduling-max-horizon"
                label={t('settings.scheduling.rules.max-horizon-label')}
                value={maxHorizonDays}
                min={1}
                onChange={onMaxHorizonChange}
              />
            </div>
          </details>
        </section>
        <NextOpenSlotsCard slots={nextOpenSlots} timezone={timezone} />
      </div>
    </SurfaceScroll>
  );
}

function MeetingTypesPanel({
  meetingTypes,
  nextOpenSlots,
  timezone,
  onAdd,
  onEdit,
  onRemove,
}: {
  meetingTypes: MeetingType[];
  nextOpenSlots: BookableSlot[];
  timezone: string;
  onAdd: () => void;
  onEdit: (meetingType: MeetingType) => void;
  onRemove: (meetingTypeId: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <SurfaceScroll>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section aria-labelledby="scheduling-meeting-types-heading" className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <SectionHeading
              id="scheduling-meeting-types-heading"
              title={t('scheduling.surface.meeting-types.title')}
              body={t('scheduling.surface.meeting-types.body')}
            />
            <Button size="sm" variant="primary" iconLeft={Plus} onClick={onAdd} data-testid="scheduling-add-meeting-type">
              {t('scheduling.surface.meeting-types.add')}
            </Button>
          </div>
          <Card variant="flat" data-testid="scheduling-meeting-types-list">
            <div className="divide-y divide-[var(--kp-divider)]">
              {meetingTypes.map((meetingType) => (
                <div key={meetingType.id} className="flex items-center justify-between gap-3 px-4 py-3" data-testid={`scheduling-meeting-type-${meetingType.id}`}>
                  <div className="min-w-0">
                    <div className="font-semibold text-[var(--kp-navy)]">{meetingType.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-[length:var(--kp-font-sm)] text-[var(--kp-text-faint)]">
                      <span>{t('scheduling.surface.meeting-types.duration-summary', { minutes: meetingType.durationMin })}</span>
                      <span aria-hidden>·</span>
                      <span>{t('scheduling.surface.meeting-types.buffer-summary', {
                        before: meetingType.bufferBeforeMin,
                        after: meetingType.bufferAfterMin,
                      })}</span>
                    </div>
                  </div>
                  <RailShellActionMenu label={t('scheduling.surface.meeting-types.row-menu-label', { name: meetingType.name })}>
                    <DropdownMenuItem data-testid={`scheduling-edit-meeting-type-${meetingType.id}`} onSelect={() => { onEdit(meetingType); }}>
                      {t('scheduling.surface.meeting-types.edit')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      data-testid={`scheduling-delete-meeting-type-${meetingType.id}`}
                      disabled={meetingTypes.length <= 1}
                      onSelect={() => { onRemove(meetingType.id); }}
                    >
                      {t('scheduling.surface.meeting-types.delete')}
                    </DropdownMenuItem>
                  </RailShellActionMenu>
                </div>
              ))}
            </div>
          </Card>
        </section>
        <NextOpenSlotsCard slots={nextOpenSlots} timezone={timezone} />
      </div>
    </SurfaceScroll>
  );
}

function MeetingTypePanel({
  draft,
  onDraftChange,
  onClose,
  onSubmit,
}: {
  draft: MeetingTypeDraft | null;
  onDraftChange: (draft: MeetingTypeDraft | null) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useTranslation();
  if (!draft) {
    return null;
  }
  const updateDraft = (updates: Partial<MeetingTypeDraft>) => {
    onDraftChange({ ...draft, ...updates });
  };
  return (
    <SlidePanel
      open
      onClose={onClose}
      title={
        <div>
          <div className="text-[length:var(--kp-font-lg)] font-semibold text-[var(--kp-navy)]">
            {draft.id ? t('scheduling.surface.meeting-types.edit-title') : t('scheduling.surface.meeting-types.add-title')}
          </div>
          <div className="mt-1 text-[length:var(--kp-font-sm)] text-[var(--kp-text-faint)]">
            {t('scheduling.surface.meeting-types.panel-body')}
          </div>
        </div>
      }
      closeLabel={t('scheduling.surface.meeting-types.close')}
      data-testid="scheduling-meeting-type-panel"
    >
      <form className="flex h-full flex-col gap-4" onSubmit={onSubmit}>
        <Field id="scheduling-meeting-type-name" label={t('settings.scheduling.meetings.name-label')}>
          <Input
            id="scheduling-meeting-type-name"
            data-testid="scheduling-meeting-type-name"
            value={draft.name}
            onChange={(event) => { updateDraft({ name: event.target.value }); }}
            className="h-9 text-sm"
          />
        </Field>
        <NumberField
          id="scheduling-meeting-type-duration"
          label={t('settings.scheduling.meetings.duration-label')}
          value={draft.durationMin}
          min={1}
          onChange={(value) => { updateDraft({ durationMin: value }); }}
        />
        <NumberField
          id="scheduling-meeting-type-buffer-before"
          label={t('settings.scheduling.meetings.buffer-before-label')}
          value={draft.bufferBeforeMin}
          min={0}
          onChange={(value) => { updateDraft({ bufferBeforeMin: value }); }}
        />
        <NumberField
          id="scheduling-meeting-type-buffer-after"
          label={t('settings.scheduling.meetings.buffer-after-label')}
          value={draft.bufferAfterMin}
          min={0}
          onChange={(value) => { updateDraft({ bufferAfterMin: value }); }}
        />
        <div className="mt-auto flex justify-end gap-2 border-t border-[var(--kp-divider)] pt-4">
          <Button size="sm" variant="secondary" onClick={onClose} data-testid="scheduling-cancel-meeting-type">
            {t('scheduling.surface.meeting-types.cancel')}
          </Button>
          <Button size="sm" variant="primary" type="submit" data-testid="scheduling-save-meeting-type">
            {t('scheduling.surface.meeting-types.save')}
          </Button>
        </div>
      </form>
    </SlidePanel>
  );
}

function NextOpenSlotsCard({ slots, timezone }: { slots: BookableSlot[]; timezone: string }) {
  const { t } = useTranslation();
  return (
    <Card variant="raised" className="self-start" data-testid="scheduling-next-open-slots">
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="m-0 text-[length:var(--kp-font-md)] font-semibold text-[var(--kp-navy)]">
            {t('scheduling.surface.preview.title')}
          </h2>
          <p className="m-0 mt-1 text-[length:var(--kp-font-xs)] text-[var(--kp-text-faint)]">
            {t('scheduling.surface.preview.body')}
          </p>
        </div>
        {slots.length === 0 ? (
          <p className="m-0 text-[length:var(--kp-font-sm)] text-[var(--kp-text-faint)]" data-testid="scheduling-no-open-slots">
            {t('scheduling.surface.preview.empty')}
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {slots.slice(0, PREVIEW_SLOT_COUNT).map((slot) => (
              <div
                key={`${slot.meetingTypeId}-${slot.startUtc}`}
                className="rounded-md border border-[var(--kp-divider)] px-3 py-2"
                data-testid="scheduling-open-slot"
              >
                <div className="text-[length:var(--kp-font-sm)] font-semibold text-[var(--kp-navy)]">
                  {formatDateTime(slot.startUtc, timezone)}
                </div>
                <div className="mt-0.5 text-[length:var(--kp-font-xs)] text-[var(--kp-text-faint)]">
                  {slot.meetingTypeName}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

function SurfaceScroll({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-[var(--kp-card-pad)]" data-testid="scheduling-content-scroll">
      <div className="max-w-[1120px]">{children}</div>
    </div>
  );
}

function SectionHeading({ id, title, body }: { id: string; title: string; body: string }) {
  return (
    <div>
      <h2 id={id} className="m-0 text-[length:var(--kp-font-lg)] font-semibold text-[var(--kp-navy)]">
        {title}
      </h2>
      <p className="m-0 mt-1 max-w-[48rem] text-[length:var(--kp-font-sm)] leading-[var(--kp-leading-normal)] text-[var(--kp-text-faint)]">
        {body}
      </p>
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function NumberField({
  id,
  label,
  value,
  min,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field id={id} label={label}>
      <Input
        id={id}
        data-testid={`${id}-input`}
        type="number"
        min={min}
        value={value}
        onChange={(event) => {
          onChange(numberValue(event.target.value, min));
        }}
        className="h-9 text-sm"
      />
    </Field>
  );
}

function Switch({
  checked,
  onChange,
  label,
  testId,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      data-testid={testId}
      onClick={() => { onChange(!checked); }}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        checked ? 'bg-primary' : 'bg-muted',
      )}
    >
      <span
        className={cn(
          'pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}

function buildNextOpenSlots({
  bookingRequests,
  meetingTypes,
  nowUtc,
  advisorTimezone,
  rule,
}: {
  bookingRequests: BookingRequest[];
  meetingTypes: MeetingType[];
  nowUtc: string;
  advisorTimezone: string;
  rule: ReturnType<typeof useSchedulingStore.getState>['availabilityRule'];
}): BookableSlot[] {
  const nowMs = Date.parse(nowUtc);
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const rangeEndMs = safeNowMs + Math.max(1, rule.maxHorizonDays) * 24 * 60 * 60 * 1000;
  return computeOpenSlots({
    rule,
    busyFreeSnapshot: {
      busy: bookingRequests
        .filter((request) => request.status === 'pending' || request.status === 'confirmed')
        .flatMap((request) => {
          const meetingType = meetingTypes.find((type) => type.id === request.meetingTypeId);
          const startMs = Date.parse(request.requestedSlotUtc);
          if (!Number.isFinite(startMs)) return [];
          const durationMin = meetingType?.durationMin ?? 30;
          return [{
            startUtc: request.requestedSlotUtc,
            endUtc: new Date(startMs + durationMin * 60_000).toISOString().replace('.000Z', 'Z'),
          }];
        })
        .filter((block) => Number.isFinite(Date.parse(block.startUtc)) && Number.isFinite(Date.parse(block.endUtc))),
    },
    rangeStartUtc: new Date(safeNowMs).toISOString(),
    rangeEndUtc: new Date(rangeEndMs).toISOString(),
    advisorTimezone,
    nowUtc,
  }).slice(0, PREVIEW_SLOT_COUNT);
}

async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

function reportSchedulingActionError(error: unknown): void {
  console.warn('[Scheduling] Action failed:', error);
}

function numberValue(value: string, min: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.round(parsed));
}

function usableTimezone(timezone: string): string {
  const fallbackTimezone = browserTimezone();
  const trimmed = timezone.trim();
  if (!trimmed) return fallbackTimezone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format(new Date());
    return trimmed;
  } catch {
    return fallbackTimezone;
  }
}

function browserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York';
}

function formatDateTime(iso: string, timezone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const safeTimezone = usableTimezone(timezone);
  const dateLabel = new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: safeTimezone,
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: safeTimezone,
  }).format(date);
  const abbreviation = shouldShowTimezoneLabel(safeTimezone)
    ? timezoneAbbreviation(date, safeTimezone)
    : '';
  const zoneLabel = abbreviation ? ` ${abbreviation}` : '';
  return `${dateLabel} · ${timeLabel}${zoneLabel}`;
}

function shouldShowTimezoneLabel(timezone: string): boolean {
  return timezone !== browserTimezone();
}

function timezoneAbbreviation(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'short',
  }).formatToParts(date);
  const label = parts.find((part) => part.type === 'timeZoneName')?.value ?? '';
  return label === 'UTC' || label === 'GMT' ? '' : label;
}

export default SchedulingHome;
