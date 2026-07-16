/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM copy needs its catalog in a separate change. */
/**
 * HouseholdConnectorSurface keeps email and calendar data in their existing
 * encrypted stores.  CRM receives only an ActivityEvent with a stable source
 * link, never a second copy of an email or calendar-event entity.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ExternalLink, Mail, Paperclip, RefreshCw } from 'lucide-react';
import { Button, Card } from '@/ui/kp';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import { useMatterStore } from '@/platform/matter/matterStore';
import { buildCalendarMatterMap, buildMailMatterMap, resolveMattersForCalendarEvent } from '@/platform/rag/matterResolver';
import { calendarListEvents, type CalendarEventDto } from '@/platform/utils/calendar-commands';
import { mailGetMessage, mailListMessagesByMatter, type MailListItem } from '@/platform/utils/mail-commands';
import type { CrmClientsActions, HouseholdRecord } from '@/features/crm-clients/adapters';

type ConnectorTab = 'email' | 'meetings';
type ConnectorItem = {
  sourceKind: 'email' | 'calendar_event';
  sourceId: string;
  occurredAt: string;
  summary: string;
};

function dateWindow() {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 90);
  const to = new Date(now);
  to.setDate(to.getDate() + 180);
  return { from: from.toISOString(), to: to.toISOString() };
}

function displayDate(value: string | null | undefined): string {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function actor() {
  return { userId: 'connector', display: 'Connected source', kind: 'system' as const };
}

/** A durable ActivityEvent reference to content owned by another subsystem. */
function connectorActivity(
  householdId: string,
  matterId: string,
  item: ConnectorItem,
) {
  return {
    id: `connector-activity:${item.sourceKind}:${item.sourceId}:${householdId}`,
    kind: 'activityEvent',
    matterId,
    at: item.occurredAt,
    actor: actor(),
    verb: item.sourceKind === 'email' ? 'connector.email_linked' : 'connector.meeting_linked',
    targetRef: { kind: 'household', id: householdId, matterId },
    householdId,
    summary: item.summary,
    // `entityRef` is intentionally a pointer, not a stored email/event body.
    // The linked subsystem remains the one place that owns the source data.
    payload: { entityRef: { kind: item.sourceKind, id: item.sourceId, matterId } },
    important: false,
  };
}

function useHouseholdConnectorContext(household: HouseholdRecord): { matterId: string; schedulingLinkUrl?: string } {
  const live = useLiveCrmRecords();
  return useMemo(() => {
    const record = live.records.find((candidate) => candidate.id === household.id);
    const matterId = typeof record?.matterId === 'string' && record.matterId ? record.matterId : household.id;
    const policyId = typeof record?.['servicePolicyId'] === 'string' ? record['servicePolicyId'] : undefined;
    const policy = policyId ? live.records.find((candidate) => candidate.kind === 'servicePolicy' && candidate.id === policyId) : undefined;
    const schedulingLinkUrl = typeof policy?.['schedulingLinkUrl'] === 'string'
      ? policy['schedulingLinkUrl']
      : household.schedulingLinkUrl;
    return { matterId, ...(schedulingLinkUrl ? { schedulingLinkUrl } : {}) };
  }, [household.id, household.schedulingLinkUrl, live.records]);
}

function useTimelineLinks(householdId: string, matterId: string, items: readonly ConnectorItem[]) {
  const live = useLiveCrmRecords();
  useEffect(() => {
    if (!items.length || !live.workspaceRoot) return;
    const existing = new Set(
      live.records
        .filter((record) => record.kind === 'activityEvent' && record['householdId'] === householdId)
        .map((record) => record.id),
    );
    for (const item of items) {
      const record = connectorActivity(householdId, matterId, item);
      if (!existing.has(record.id)) {
        // eslint-disable-next-line lantern-async/no-silent-failure -- A timeline link is best-effort; the connector remains the source of truth.
        void live.save(record).catch(() => {
          // The source data remains available even when this optional timeline
          // link cannot be saved (for example, while the workspace is closing).
        });
      }
    }
  }, [householdId, items, live, matterId]);
}

function HouseholdEmail({ household, matterId, actions }: { household: HouseholdRecord; matterId: string; actions?: CrmClientsActions }) {
  const matters = useMatterStore((state) => state.matters);
  const [items, setItems] = useState<readonly MailListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [openedBody, setOpenedBody] = useState<string | null>(null);
  const matterMap = useMemo(() => buildMailMatterMap(matters), [matters]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await mailListMessagesByMatter(matterId, matterMap, {
        sortBy: 'date', sortDesc: true, limit: 50, offset: 0,
      });
      setItems(page.items);
      setTotal(page.total);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load this household’s email.');
    } finally {
      setLoading(false);
    }
  }, [matterId, matterMap]);
  useEffect(() => { void load().catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : 'Could not load this household’s email.'); }); }, [load]);
  const links = useMemo<readonly ConnectorItem[]>(() => items.map((item) => ({
    sourceKind: 'email', sourceId: item.id, occurredAt: item.receivedDateTime ?? new Date(0).toISOString(), summary: 'Email linked from the mail store',
  })), [items]);
  useTimelineLinks(household.id, matterId, links);

  async function open(item: MailListItem) {
    setOpenedId(item.id);
    setOpenedBody(null);
    try {
      const message = await mailGetMessage(item.id);
      setOpenedBody(message.body);
    } catch (reason) {
      setOpenedBody(reason instanceof Error ? reason.message : 'Could not open this email.');
    }
  }

  return <div data-testid="crm-household-email" style={{ display: 'grid', gap: 12, marginTop: 14 }}>
    <Card variant="raised">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div><h2 style={{ margin: 0 }}>Email</h2><p style={{ marginBottom: 0 }}>Email stays in your connected mail store. This list only shows email filed to {household.name}.</p></div>
        <div style={{ display: 'flex', gap: 8 }}><Button size="sm" variant="secondary" iconLeft={RefreshCw} data-testid="crm-household-email-refresh" onClick={() => { void load().catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : 'Could not load this household’s email.'); }); }}>Refresh</Button><Button size="sm" iconLeft={Mail} data-testid="crm-open-mail-surface" onClick={() => { actions?.onDraftEmail?.({ kind: 'open_mail_surface', contactRef: { kind: 'household', id: household.id, matterId, label: household.name }, contextRefs: [{ kind: 'household', id: household.id, matterId, label: household.name }], source: 'crm_contact' }); }}>Draft email</Button></div>
      </div>
      {loading ? <p data-testid="crm-household-email-loading">Loading household email…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {!loading && !error && items.length === 0 ? <p data-testid="crm-household-email-empty">No email is filed to this household yet. File a mail folder or message to this household in Email.</p> : null}
      {!loading && !error && items.length > 0 ? <p data-testid="crm-household-email-count">{total} email thread{total === 1 ? '' : 's'} filed to this household.</p> : null}
      <div style={{ display: 'grid', gap: 8 }}>
        {items.map((item) => <button key={item.id} type="button" data-testid={`crm-household-email-${item.id}`} onClick={() => { void open(item).catch((reason: unknown) => { setOpenedBody(reason instanceof Error ? reason.message : 'Could not open this email.'); }); }} style={{ textAlign: 'left', border: '1px solid var(--kp-border)', background: 'white', borderRadius: 8, padding: 10, cursor: 'pointer' }}>
          <strong>{item.subject || 'No subject'}</strong>{item.hasAttachments ? <Paperclip size={14} style={{ marginLeft: 6, verticalAlign: 'text-bottom' }} aria-label="Has attachment" /> : null}
          <div style={{ fontSize: 13 }}>{item.fromName || item.fromAddr} · {displayDate(item.receivedDateTime)}</div>
          <div style={{ fontSize: 13, color: 'var(--color-slate-600)' }}>{item.snippet}</div>
        </button>)}
      </div>
      {openedId ? <section data-testid="crm-household-email-open" style={{ marginTop: 12, borderTop: '1px solid var(--kp-border)', paddingTop: 12 }}><strong>Opened email</strong><p style={{ whiteSpace: 'pre-wrap' }}>{openedBody ?? 'Loading…'}</p></section> : null}
    </Card>
  </div>;
}

function HouseholdMeetings({ household, matterId, schedulingLinkUrl }: { household: HouseholdRecord; matterId: string; schedulingLinkUrl?: string }) {
  const matters = useMatterStore((state) => state.matters);
  const [events, setEvents] = useState<readonly CalendarEventDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const matterMap = useMemo(() => buildCalendarMatterMap(matters), [matters]);
  const { from, to } = useMemo(dateWindow, []);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const all = await calendarListEvents(from, to);
      setEvents(all.filter((event) => resolveMattersForCalendarEvent(event, matterMap).includes(matterId)));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load this household’s meetings.');
    } finally {
      setLoading(false);
    }
  }, [from, matterId, matterMap, to]);
  useEffect(() => { void load().catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : 'Could not load this household’s meetings.'); }); }, [load]);
  const links = useMemo<readonly ConnectorItem[]>(() => events.map((event) => ({
    sourceKind: 'calendar_event', sourceId: event.id, occurredAt: event.startUtc, summary: 'Meeting linked from the calendar connector',
  })), [events]);
  useTimelineLinks(household.id, matterId, links);

  return <div data-testid="crm-household-meetings" style={{ display: 'grid', gap: 12, marginTop: 14 }}>
    <Card variant="raised">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div><h2 style={{ margin: 0 }}>Meetings</h2><p style={{ marginBottom: 0 }}>Meetings stay in your connected calendar. This list shows meetings matched to {household.name}.</p></div>
        <Button size="sm" variant="secondary" iconLeft={RefreshCw} data-testid="crm-household-meetings-refresh" onClick={() => { void load().catch((reason: unknown) => { setError(reason instanceof Error ? reason.message : 'Could not load this household’s meetings.'); }); }}>Refresh</Button>
      </div>
      {schedulingLinkUrl ? <p><Button size="sm" iconLeft={ExternalLink} data-testid="crm-household-scheduling-link" onClick={() => { window.open(schedulingLinkUrl, '_blank', 'noopener,noreferrer'); }}>Schedule with this household</Button></p> : <p data-testid="crm-household-scheduling-empty">A firm admin has not added a scheduling link for this service tier.</p>}
      {loading ? <p data-testid="crm-household-meetings-loading">Loading household meetings…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {!loading && !error && events.length === 0 ? <p data-testid="crm-household-meetings-empty">No meetings are linked to this household yet. Connect a calendar and teach the client match when needed.</p> : null}
      <div style={{ display: 'grid', gap: 8 }}>
        {events.map((event) => <div key={event.id} data-testid={`crm-household-meeting-${event.id}`} style={{ border: '1px solid var(--kp-border)', borderRadius: 8, padding: 10 }}>
          <strong><CalendarDays size={15} aria-hidden="true" style={{ marginRight: 6, verticalAlign: 'text-bottom' }} />{event.title || 'Untitled meeting'}</strong>
          <div style={{ fontSize: 13 }}>{displayDate(event.startUtc)} to {displayDate(event.endUtc)}</div>
          <div style={{ fontSize: 13, color: 'var(--color-slate-600)' }}>{event.attendees.map((attendee) => attendee.name || attendee.email).join(', ') || 'No attendees listed'}</div>
        </div>)}
      </div>
    </Card>
  </div>;
}

export function HouseholdConnectorSurface({ tab, household, actions }: { tab: ConnectorTab; household: HouseholdRecord; actions?: CrmClientsActions | undefined }) {
  const { matterId, schedulingLinkUrl } = useHouseholdConnectorContext(household);
  return tab === 'email'
    ? <HouseholdEmail household={household} matterId={matterId} {...(actions ? { actions } : {})} />
    : <HouseholdMeetings household={household} matterId={matterId} {...(schedulingLinkUrl ? { schedulingLinkUrl } : {})} />;
}
