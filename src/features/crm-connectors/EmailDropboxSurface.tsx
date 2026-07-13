/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM copy needs its translation catalog in a separate product change. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Inbox, MailCheck, RefreshCw, Save, ShieldCheck } from 'lucide-react';
import { Button, Card } from '@/ui/kp';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import {
  mailCheckDropboxFolder,
  mailRetagMessageMatter,
  type MailListItem,
} from '@/platform/utils/mail-commands';
import { suggestDropboxHousehold, type DropboxHousehold } from './emailDropboxMatching';

type DropboxConfig = {
  folderId: string;
  provider: string;
  account: string;
};

type HouseholdLiveRecord = LiveCrmRecord & {
  kind: 'household';
  name: string;
};

type EmailDropboxConfigRecord = LiveCrmRecord & {
  kind: 'emailDropboxConfig';
  folderId?: unknown;
  provider?: unknown;
  account?: unknown;
};

const CONFIG_ID = 'email-dropbox-config:current-user';
const defaultConfig: DropboxConfig = { folderId: 'Lantern Dropbox', provider: '', account: '' };
const cardStyle = { display: 'grid', gap: 'var(--kp-space-sm)' } as const;

function displayDate(value: string | null): string {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleString();
}

function householdChoices(records: ReturnType<typeof useLiveCrmRecords>['records']): readonly DropboxHousehold[] {
  return records.flatMap((record) =>
    isHouseholdLiveRecord(record) && record.name.trim()
      ? [{ id: record.id, name: record.name }]
      : [],
  );
}

function isHouseholdLiveRecord(record: LiveCrmRecord): record is HouseholdLiveRecord {
  return record.kind === 'household' && typeof record['name'] === 'string';
}

function isEmailDropboxConfigRecord(record: LiveCrmRecord): record is EmailDropboxConfigRecord {
  return record.kind === 'emailDropboxConfig';
}

/**
 * Client-side replacement for a server BCC address. The connected mailbox is
 * the only source of email content; this surface reads its chosen folder and
 * files a local encrypted pointer after the advisor confirms the household.
 */
export function EmailDropboxSurface() {
  const live = useLiveCrmRecords();
  const households = useMemo(() => householdChoices(live.records), [live.records]);
  const savedConfig = live.records.find((record): record is EmailDropboxConfigRecord => record.id === CONFIG_ID && isEmailDropboxConfigRecord(record));
  const [config, setConfig] = useState<DropboxConfig>(defaultConfig);
  const [emails, setEmails] = useState<readonly MailListItem[]>([]);
  const [selectedHouseholds, setSelectedHouseholds] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!savedConfig) return;
    setConfig({
      folderId: typeof savedConfig.folderId === 'string' ? savedConfig.folderId : defaultConfig.folderId,
      provider: typeof savedConfig.provider === 'string' ? savedConfig.provider : '',
      account: typeof savedConfig.account === 'string' ? savedConfig.account : '',
    });
  }, [savedConfig]);

  const checkFolder = useCallback(async () => {
    const folderId = config.folderId.trim();
    if (!folderId) {
      setError('Name the mailbox folder or label first.');
      return;
    }
    setLoading(true);
    setStatus(null);
    setError(null);
    try {
      const page = await mailCheckDropboxFolder({
        folderName: folderId,
        ...(config.provider ? { provider: config.provider } : {}),
        ...(config.account.trim() ? { account: config.account.trim() } : {}),
      });
      setEmails(page.items);
      setSelectedHouseholds(Object.fromEntries(page.items.map((email) => [
        email.id,
        suggestDropboxHousehold(email, households) ?? '',
      ])));
      setStatus(page.items.length
        ? `${page.items.length} email${page.items.length === 1 ? '' : 's'} ready for your review.`
        : 'Nothing is waiting in this folder yet.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not check this mailbox folder.');
    } finally {
      setLoading(false);
    }
  }, [config, households]);

  // While this page is open, keep the selected local mailbox folder fresh.
  // The connected mail store remains the only place email content is read.
  useEffect(() => {
    if (!savedConfig || !config.folderId.trim()) return;
    void checkFolder();
    const refresh = window.setInterval(() => { void checkFolder(); }, 60_000);
    return () => window.clearInterval(refresh);
  }, [checkFolder, config.folderId, savedConfig]);

  async function saveConfig() {
    const folderId = config.folderId.trim();
    if (!folderId) {
      setError('Name the mailbox folder or label first.');
      return;
    }
    setError(null);
    try {
      const now = new Date().toISOString();
      await live.save({
        id: CONFIG_ID,
        kind: 'emailDropboxConfig',
        matterId: 'firm_home',
        createdAt: typeof savedConfig?.createdAt === 'string' ? savedConfig.createdAt : now,
        updatedAt: now,
        folderId,
        provider: config.provider,
        account: config.account.trim(),
        enabled: true,
      });
      setStatus('This computer will check this folder while this dropbox is open.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save this dropbox.');
    }
  }

  async function fileEmail(email: MailListItem) {
    const householdId = selectedHouseholds[email.id];
    if (!householdId) {
      setError('Choose the client this email belongs to before filing it.');
      return;
    }
    const household = households.find((candidate) => candidate.id === householdId);
    if (!household) {
      setError('Choose the client this email belongs to before filing it.');
      return;
    }
    setError(null);
    try {
      // This changes only local encrypted mail filing. It never sends an email
    // or copies its body to a server.
      await mailRetagMessageMatter(email.id, householdId);
      const now = new Date().toISOString();
      await live.save({
        id: `email-dropbox:${email.id}:${householdId}`,
        kind: 'emailActivity',
        matterId: householdId,
        householdId,
        createdAt: now,
        updatedAt: now,
        messageId: email.id,
        provider: email.provider,
        account: email.account,
        folderId: email.folderId,
        subject: email.subject || 'Untitled email',
        fromName: email.fromName || email.fromAddr || 'Unknown sender',
        receivedAt: email.receivedDateTime,
        summary: `Filed email: ${email.subject || 'Untitled email'}`,
        status: 'filed',
        source: 'client-side-email-dropbox',
      });
      setEmails((current) => current.filter((candidate) => candidate.id !== email.id));
      setStatus(`Filed “${email.subject || 'Untitled email'}” to ${household.name}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not file this email locally.');
    }
  }

  return (
    <div data-testid="crm-email-dropbox-surface" style={{ padding: 'var(--kp-space-xl)', overflow: 'auto', width: '100%', display: 'grid', gap: 'var(--kp-space-md)', alignContent: 'start' }}>
      <SurfaceHeader Icon={Inbox} title="Email dropbox" description="File forwarded or BCC’d email from your connected inbox, without sending it through a CRM server." />
      <Card variant="raised" style={cardStyle}>
        <div><h2 style={{ margin: 0 }}>Set up your private dropbox</h2><p>Make a folder or label in your connected mailbox, such as “Lantern Dropbox.” Forward email to your own inbox or BCC yourself, then add that label. Lantern reads it only on this computer.</p></div>
        <label>Mailbox folder or label<input data-testid="crm-email-dropbox-folder" value={config.folderId} onChange={(event) => setConfig((current) => ({ ...current, folderId: event.target.value }))} /></label>
        <label>Mail provider (optional)<select data-testid="crm-email-dropbox-provider" value={config.provider} onChange={(event) => setConfig((current) => ({ ...current, provider: event.target.value }))}><option value="">Any connected provider</option><option value="m365">Outlook</option><option value="gmail">Gmail</option><option value="imap">Other mail account</option></select></label>
        <label>Mailbox account (optional)<input data-testid="crm-email-dropbox-account" value={config.account} onChange={(event) => setConfig((current) => ({ ...current, account: event.target.value }))} placeholder="Leave blank to check every connected account" /></label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Button data-testid="crm-email-dropbox-save" iconLeft={Save} onClick={() => { void saveConfig(); }}>Save dropbox</Button><Button data-testid="crm-email-dropbox-check" variant="secondary" iconLeft={RefreshCw} onClick={() => { void checkFolder(); }} disabled={loading}>{loading ? 'Checking…' : 'Check folder'}</Button></div>
        <p data-testid="crm-email-dropbox-private-note" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 6 }}><ShieldCheck size={16} /> Email never passes through a Lantern server. The connected mailbox and this encrypted computer keep the content.</p>
      </Card>
      {status ? <p role="status" data-testid="crm-email-dropbox-status">{status}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <Card variant="raised" style={cardStyle}>
        <div><h2 style={{ margin: 0 }}>Email waiting to be filed</h2><p>Lantern suggests a client from the sender and subject. You choose before an email is filed.</p></div>
        {!households.length ? <p data-testid="crm-email-dropbox-no-households">Add a client first, then return here to file their email.</p> : null}
        {!loading && emails.length === 0 ? <p data-testid="crm-email-dropbox-empty">Check your chosen mailbox folder to see email waiting to be filed.</p> : null}
        {emails.map((email) => <section key={email.id} data-testid={`crm-email-dropbox-email-${email.id}`} style={{ borderTop: '1px solid var(--kp-border)', paddingTop: 12, display: 'grid', gap: 8 }}>
          <div><strong>{email.subject || 'Untitled email'}</strong><div style={{ color: 'var(--color-slate-600)', fontSize: 13 }}>{email.fromName || email.fromAddr || 'Unknown sender'} · {displayDate(email.receivedDateTime)}</div><div style={{ color: 'var(--color-slate-600)', fontSize: 13 }}>{email.snippet}</div></div>
          <label>File to client<select data-testid={`crm-email-dropbox-household-${email.id}`} value={selectedHouseholds[email.id] ?? ''} onChange={(event) => setSelectedHouseholds((current) => ({ ...current, [email.id]: event.target.value }))}><option value="">Choose a client</option>{households.map((household) => <option key={household.id} value={household.id}>{household.name}</option>)}</select></label>
          <div><Button data-testid={`crm-email-dropbox-file-${email.id}`} iconLeft={MailCheck} disabled={!households.length} onClick={() => { void fileEmail(email); }}>File email locally</Button></div>
        </section>)}
      </Card>
    </div>
  );
}
