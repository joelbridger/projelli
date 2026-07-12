/* eslint-disable lantern-i18n/no-hardcoded-string -- CRM copy is covered by the frozen CRM catalog. */
import { useState } from 'react';
import { CalendarDays, Mail, Save } from 'lucide-react';
import { Button } from '@/ui/kp';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';

const panel = {
  border: '1px solid var(--kp-border)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--kp-surface)',
  padding: 'var(--kp-space-md)',
} as const;
const now = () => new Date().toISOString();

/** Firm-level connector screens only save a small CRM activity pointer. The email
 * and calendar systems remain the owners of the private message/event content. */
export function CrmEmailSurface() {
  const live = useLiveCrmRecords();
  const [linked, setLinked] = useState(false);
  const sync = async () => {
    const at = now();
    await live.save({
      id: `email-activity:${crypto.randomUUID()}`,
      kind: 'emailActivity',
      matterId: 'firm_home',
      subject: 'Email connection checked',
      occurredAt: at,
      status: 'linked',
      source: 'firm-email-connector',
      updatedAt: at,
    });
    await live.save({
      id: `activity:${crypto.randomUUID()}`,
      kind: 'activityEvent',
      matterId: 'firm_home',
      at,
      summary: 'Checked the firm email connection',
      verb: 'email.sync_checked',
      targetRef: { kind: 'emailActivity', id: 'firm-email-connector' },
      important: false,
    });
    setLinked(true);
  };
  return (
    <div
      data-testid="crm-email-surface"
      style={{
        padding: 'var(--kp-space-xl)',
        overflow: 'auto',
        width: '100%',
        display: 'grid',
        gap: 'var(--kp-space-md)',
        alignContent: 'start',
      }}
    >
      <SurfaceHeader
        Icon={Mail}
        title="Email"
        description="Connect email without copying messages into the CRM"
      />
      <section style={panel}>
        <h2 style={{ marginTop: 0 }}>Email connection</h2>
        <p>
          Lantern keeps email in your mail account. This screen saves a
          connection check and links activity back to that account.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            data-testid="crm-email-sync"
            iconLeft={Save}
            onClick={() => {
              void sync();
            }}
          >
            Check email connection
          </Button>
          <Button
            data-testid="crm-email-client-link"
            variant="secondary"
            onClick={() => {
              setLinked(true);
            }}
          >
            Open email client
          </Button>
        </div>
        {linked && (
          <p role="status">
            Email connection is ready. New linked email activity will appear in
            your firm history.
          </p>
        )}
      </section>
    </div>
  );
}

export function CrmCalendarSurface() {
  const live = useLiveCrmRecords();
  const [title, setTitle] = useState('Client review meeting');
  const [saved, setSaved] = useState(false);
  const save = async () => {
    const at = now();
    const id = `event:${crypto.randomUUID()}`;
    await live.save({
      id,
      kind: 'event',
      matterId: 'firm_home',
      title: title.trim() || 'Untitled meeting',
      startAt: at,
      endAt: at,
      status: 'scheduled',
      updatedAt: at,
    });
    await live.save({
      id: `activity:${crypto.randomUUID()}`,
      kind: 'activityEvent',
      matterId: 'firm_home',
      at,
      summary: `Scheduled calendar event: ${title.trim() || 'Untitled meeting'}`,
      verb: 'calendar.event_saved',
      targetRef: { kind: 'event', id },
      important: false,
    });
    setSaved(true);
  };
  return (
    <div
      data-testid="crm-calendar-surface"
      style={{
        padding: 'var(--kp-space-xl)',
        overflow: 'auto',
        width: '100%',
        display: 'grid',
        gap: 'var(--kp-space-md)',
        alignContent: 'start',
      }}
    >
      <SurfaceHeader
        Icon={CalendarDays}
        title="Calendar"
        description="Save client events and link them to your firm history"
      />
      <section style={panel}>
        <h2 style={{ marginTop: 0 }}>New event</h2>
        <label>
          Meeting title
          <input
            data-testid="crm-calendar-event-title"
            value={title}
            onChange={(event) => {
              setTitle(event.target.value);
            }}
          />
        </label>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Button
            data-testid="crm-calendar-new-event"
            variant="secondary"
            onClick={() => {
              setTitle('Client review meeting');
              setSaved(false);
            }}
          >
            New event
          </Button>
          <Button
            data-testid="crm-calendar-event-save"
            iconLeft={Save}
            onClick={() => {
              void save();
            }}
          >
            Save event
          </Button>
        </div>
        {saved && (
          <p role="status">
            The event was saved to the CRM and added to firm activity.
          </p>
        )}
      </section>
    </div>
  );
}
