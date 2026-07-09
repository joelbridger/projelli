import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Link as LinkIcon } from 'lucide-react';
import { Label } from '@/ui/label';
import { Input } from '@/ui/input';
import { cn } from '@/lib/utils';
import { useProfileStore } from '@/platform/profile/profileStore';
import { useSchedulingStore } from './schedulingStore';
import { WEEKDAYS, type MeetingType } from './types';

const BOOKING_LINK_BASE = 'https://book.advisorprephero.com';

function numberValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function SchedulingSettings() {
  const { t } = useTranslation();
  const advisorTimezone = useProfileStore((state) => state.advisorTimezone);
  const setAdvisorTimezone = useProfileStore((state) => state.setAdvisorTimezone);
  const bookingSlug = useSchedulingStore((state) => state.bookingSlug);
  const rule = useSchedulingStore((state) => state.availabilityRule);
  const setBookingSlug = useSchedulingStore((state) => state.setBookingSlug);
  const setDayEnabled = useSchedulingStore((state) => state.setDayEnabled);
  const updateWorkingHours = useSchedulingStore((state) => state.updateWorkingHours);
  const updateMeetingType = useSchedulingStore((state) => state.updateMeetingType);
  const setMinNoticeHours = useSchedulingStore((state) => state.setMinNoticeHours);
  const setMaxHorizonDays = useSchedulingStore((state) => state.setMaxHorizonDays);
  const slug = bookingSlug.slug || 'my-booking-link';
  const bookingLink = `${BOOKING_LINK_BASE}/${slug}`;

  return (
    <div className="space-y-8" data-testid="scheduling-settings">
      <section className="space-y-3" aria-labelledby="scheduling-link-heading">
        <div className="flex items-center gap-2">
          <LinkIcon className="h-4 w-4 text-primary" aria-hidden />
          <h3 id="scheduling-link-heading" className="text-sm font-semibold text-foreground">
            {t('settings.scheduling.link.title')}
          </h3>
        </div>
        <div className="rounded-md border border-border/60 bg-background p-3">
          <Label htmlFor="scheduling-slug" className="text-xs font-medium text-muted-foreground">
            {t('settings.scheduling.link.slug-label')}
          </Label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Input
              id="scheduling-slug"
              data-testid="scheduling-slug-input"
              value={bookingSlug.slug}
              onChange={(event) => { setBookingSlug(event.target.value); }}
              className="h-9 max-w-sm text-sm"
            />
            <div
              data-testid="scheduling-booking-link"
              className="flex min-h-9 flex-1 items-center rounded-md border border-border/60 bg-muted/40 px-3 text-sm text-muted-foreground"
            >
              {bookingLink}
            </div>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {t('settings.scheduling.link.placeholder-note')}
          </p>
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="scheduling-hours-heading">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-primary" aria-hidden />
          <h3 id="scheduling-hours-heading" className="text-sm font-semibold text-foreground">
            {t('settings.scheduling.hours.title')}
          </h3>
        </div>
        <div className="rounded-md border border-border/60">
          {WEEKDAYS.map((weekday) => {
            const hours = rule.workingHours[weekday];
            const enabled = hours.length > 0;
            const firstRange = hours[0] ?? { startLocal: '09:00', endLocal: '17:00' };
            return (
              <div
                key={weekday}
                className="flex flex-col gap-3 border-b border-border/50 p-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <input
                    type="checkbox"
                    data-testid={`scheduling-day-toggle-${weekday}`}
                    checked={enabled}
                    onChange={(event) => { setDayEnabled(weekday, event.target.checked); }}
                    className="h-4 w-4 rounded border-border"
                  />
                  {t(`settings.scheduling.weekdays.${weekday}`)}
                </label>
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
                      updateWorkingHours(weekday, { startLocal: event.target.value });
                    }}
                    className="h-8 w-28 text-sm"
                  />
                  <span className="text-xs text-muted-foreground">
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
                      updateWorkingHours(weekday, { endLocal: event.target.value });
                    }}
                    className="h-8 w-28 text-sm"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="scheduling-meetings-heading">
        <h3 id="scheduling-meetings-heading" className="text-sm font-semibold text-foreground">
          {t('settings.scheduling.meetings.title')}
        </h3>
        <div className="space-y-3">
          {rule.meetingTypes.map((meetingType) => (
            <MeetingTypeRow
              key={meetingType.id}
              meetingType={meetingType}
              onChange={(updates) => { updateMeetingType(meetingType.id, updates); }}
            />
          ))}
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="scheduling-rules-heading">
        <h3 id="scheduling-rules-heading" className="text-sm font-semibold text-foreground">
          {t('settings.scheduling.rules.title')}
        </h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            id="scheduling-timezone"
            label={t('settings.scheduling.rules.timezone-label')}
          >
            <Input
              id="scheduling-timezone"
              data-testid="scheduling-timezone-input"
              value={advisorTimezone}
              onChange={(event) => { setAdvisorTimezone(event.target.value); }}
              className="h-9 text-sm"
            />
          </Field>
          <Field
            id="scheduling-min-notice"
            label={t('settings.scheduling.rules.min-notice-label')}
          >
            <Input
              id="scheduling-min-notice"
              data-testid="scheduling-min-notice-input"
              type="number"
              min={0}
              value={rule.minNoticeHours}
              onChange={(event) => { setMinNoticeHours(numberValue(event.target.value)); }}
              className="h-9 text-sm"
            />
          </Field>
          <Field
            id="scheduling-max-horizon"
            label={t('settings.scheduling.rules.max-horizon-label')}
          >
            <Input
              id="scheduling-max-horizon"
              data-testid="scheduling-max-horizon-input"
              type="number"
              min={1}
              value={rule.maxHorizonDays}
              onChange={(event) => { setMaxHorizonDays(numberValue(event.target.value)); }}
              className="h-9 text-sm"
            />
          </Field>
        </div>
      </section>
    </div>
  );
}

function MeetingTypeRow({
  meetingType,
  onChange,
}: {
  meetingType: MeetingType;
  onChange: (updates: Partial<MeetingType>) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="rounded-md border border-border/60 p-3"
      data-testid={`scheduling-meeting-type-${meetingType.id}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field
          id={`scheduling-meeting-name-${meetingType.id}`}
          label={t('settings.scheduling.meetings.name-label')}
          className="sm:flex-1"
        >
          <Input
            id={`scheduling-meeting-name-${meetingType.id}`}
            data-testid={`scheduling-meeting-name-${meetingType.id}`}
            value={meetingType.name}
            onChange={(event) => { onChange({ name: event.target.value }); }}
            className="h-9 text-sm"
          />
        </Field>
        <Field
          id={`scheduling-meeting-duration-${meetingType.id}`}
          label={t('settings.scheduling.meetings.duration-label')}
        >
          <Input
            id={`scheduling-meeting-duration-${meetingType.id}`}
            data-testid={`scheduling-meeting-duration-${meetingType.id}`}
            type="number"
            min={1}
            value={meetingType.durationMin}
            onChange={(event) => { onChange({ durationMin: numberValue(event.target.value) }); }}
            className="h-9 text-sm"
          />
        </Field>
        <Field
          id={`scheduling-buffer-before-${meetingType.id}`}
          label={t('settings.scheduling.meetings.buffer-before-label')}
        >
          <Input
            id={`scheduling-buffer-before-${meetingType.id}`}
            data-testid={`scheduling-buffer-before-${meetingType.id}`}
            type="number"
            min={0}
            value={meetingType.bufferBeforeMin}
            onChange={(event) => { onChange({ bufferBeforeMin: numberValue(event.target.value) }); }}
            className="h-9 text-sm"
          />
        </Field>
        <Field
          id={`scheduling-buffer-after-${meetingType.id}`}
          label={t('settings.scheduling.meetings.buffer-after-label')}
        >
          <Input
            id={`scheduling-buffer-after-${meetingType.id}`}
            data-testid={`scheduling-buffer-after-${meetingType.id}`}
            type="number"
            min={0}
            value={meetingType.bufferAfterMin}
            onChange={(event) => { onChange({ bufferAfterMin: numberValue(event.target.value) }); }}
            className="h-9 text-sm"
          />
        </Field>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  children,
  className,
}: {
  id: string;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

export default SchedulingSettings;
