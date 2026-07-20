/* eslint-disable lantern-i18n/no-hardcoded-string -- Frozen CRM copy needs its translation catalog in a separate product change. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { BRAND } from '@/config/brand';

type DropboxConfig = {
  folderId: string;
  provider: string;
  account: string;
};

type DropboxSurfaceState = {
  workspaceRoot: string | null;
  savedAccountContext: string | null;
  config: DropboxConfig;
  emails: readonly MailListItem[];
  selectedHouseholds: Record<string, string>;
  loading: boolean;
  status: string | null;
  error: string | null;
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
// This is an existing mailbox identifier, not product copy. Keep the lookup
// stable so an advisor's already-configured folder continues to work after a
// display-name change.
const LEGACY_DEFAULT_FOLDER_ID = 'Lantern Dropbox';
const DISPLAY_DEFAULT_FOLDER_NAME = `${BRAND.name} Dropbox`;
const defaultConfig: DropboxConfig = { folderId: LEGACY_DEFAULT_FOLDER_ID, provider: '', account: '' };
const cardStyle = { display: 'grid', gap: 'var(--kp-space-sm)' } as const;

function displayFolderName(folderId: string): string {
  return folderId === LEGACY_DEFAULT_FOLDER_ID ? DISPLAY_DEFAULT_FOLDER_NAME : folderId;
}

function folderIdFromDisplay(value: string): string {
  return value === DISPLAY_DEFAULT_FOLDER_NAME ? LEGACY_DEFAULT_FOLDER_ID : value;
}

function emptySurfaceState(
  workspaceRoot: string | null,
  savedAccountContext: string | null = null,
  config: DropboxConfig = defaultConfig,
): DropboxSurfaceState {
  return {
    workspaceRoot,
    savedAccountContext,
    config,
    emails: [],
    selectedHouseholds: {},
    loading: false,
    status: null,
    error: null,
  };
}

function mailboxContextKey(workspaceRoot: string | null, config: DropboxConfig): string {
  return JSON.stringify([workspaceRoot, config.folderId.trim(), config.provider, config.account.trim()]);
}

function configFromRecord(savedConfig: EmailDropboxConfigRecord): DropboxConfig {
  return {
    folderId: typeof savedConfig.folderId === 'string' ? savedConfig.folderId : defaultConfig.folderId,
    provider: typeof savedConfig.provider === 'string' ? savedConfig.provider : '',
    account: typeof savedConfig.account === 'string' ? savedConfig.account : '',
  };
}

function savedAccountContextKey(workspaceRoot: string | null, savedConfig: EmailDropboxConfigRecord | undefined): string | null {
  if (!savedConfig) return null;
  const config = configFromRecord(savedConfig);
  return JSON.stringify([workspaceRoot, config.provider, config.account.trim()]);
}

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
  const savedAccountContext = savedAccountContextKey(live.workspaceRoot, savedConfig);
  const savedSeed = useMemo(() => savedConfig ? configFromRecord(savedConfig) : defaultConfig, [savedConfig]);
  const [surfaceState, setSurfaceState] = useState<DropboxSurfaceState>(() => emptySurfaceState(live.workspaceRoot, savedAccountContext, savedSeed));
  // State is tagged with the workspace that produced it. On the first render of
  // a workspace switch, before effects run, expose an empty B state rather than
  // rendering A's local state for even one frame.
  const activeState = surfaceState.workspaceRoot === live.workspaceRoot &&
    surfaceState.savedAccountContext === savedAccountContext
    ? surfaceState
    : emptySurfaceState(live.workspaceRoot, savedAccountContext, savedSeed);
  const { config, emails, selectedHouseholds, loading, status, error } = activeState;
  const dirtyKeysRef = useRef<Set<keyof DropboxConfig>>(new Set());
  const requestSequenceRef = useRef(0);
  const renderedMailboxContextRef = useRef(mailboxContextKey(live.workspaceRoot, config));
  const renderedMailboxContext = mailboxContextKey(live.workspaceRoot, config);
  if (renderedMailboxContextRef.current !== renderedMailboxContext) {
    renderedMailboxContextRef.current = renderedMailboxContext;
    requestSequenceRef.current += 1;
  }

  const updateCurrentContext = useCallback((update: (current: DropboxSurfaceState) => DropboxSurfaceState) => {
    setSurfaceState((current) => {
      if (current.workspaceRoot !== live.workspaceRoot || current.savedAccountContext !== savedAccountContext) {
        return update(emptySurfaceState(live.workspaceRoot, savedAccountContext, savedSeed));
      }
      return update(current);
    });
  }, [live.workspaceRoot, savedAccountContext, savedSeed]);

  useEffect(() => {
    dirtyKeysRef.current.clear();
    requestSequenceRef.current += 1;
    setSurfaceState(emptySurfaceState(live.workspaceRoot, savedAccountContext, savedSeed));
    // savedAccountContext intentionally is handled by the seed effect below.
    // This effect owns only a genuine workspace boundary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live.workspaceRoot]);

  useEffect(() => {
    if (
      surfaceState.workspaceRoot !== live.workspaceRoot ||
      surfaceState.savedAccountContext !== savedAccountContext
    ) {
      dirtyKeysRef.current.clear();
      requestSequenceRef.current += 1;
      setSurfaceState({
        ...emptySurfaceState(live.workspaceRoot, savedAccountContext, savedSeed),
        ...(live.error ? { error: `Could not load this workspace's email dropbox: ${live.error}` } : {}),
      });
      return;
    }
    if (live.error) {
      dirtyKeysRef.current.clear();
      requestSequenceRef.current += 1;
      setSurfaceState({
        ...emptySurfaceState(live.workspaceRoot, savedAccountContext, savedSeed),
        error: `Could not load this workspace's email dropbox: ${live.error}`,
      });
      return;
    }
    if (!savedConfig) return;
    const seed = configFromRecord(savedConfig);
    updateCurrentContext((current) => {
      if (dirtyKeysRef.current.size === 0) return { ...current, config: seed };
      const next = { ...seed };
      for (const key of dirtyKeysRef.current) next[key] = current.config[key];
      return { ...current, config: next };
    });
  }, [live.error, live.workspaceRoot, savedAccountContext, savedConfig, savedSeed, surfaceState.savedAccountContext, surfaceState.workspaceRoot, updateCurrentContext]);

  const updateConfig = (key: keyof DropboxConfig, value: string) => {
    dirtyKeysRef.current.add(key);
    requestSequenceRef.current += 1;
    updateCurrentContext((current) => ({
      ...current,
      config: { ...current.config, [key]: value },
      emails: [],
      selectedHouseholds: {},
      loading: false,
      status: null,
      error: null,
    }));
  };

  const checkFolder = useCallback(async () => {
    const folderId = config.folderId.trim();
    if (!folderId) {
      updateCurrentContext((current) => ({ ...current, error: 'Name the mailbox folder or label first.' }));
      return;
    }
    const rootAtStart = live.workspaceRoot;
    const contextAtStart = mailboxContextKey(rootAtStart, config);
    const requestAtStart = ++requestSequenceRef.current;
    updateCurrentContext((current) => ({ ...current, loading: true, status: null, error: null }));
    const isCurrentRequest = () =>
      requestSequenceRef.current === requestAtStart &&
      renderedMailboxContextRef.current === contextAtStart;
    try {
      const page = await mailCheckDropboxFolder({
        folderName: folderId,
        ...(config.provider ? { provider: config.provider } : {}),
        ...(config.account.trim() ? { account: config.account.trim() } : {}),
      });
      if (!isCurrentRequest()) return;
      updateCurrentContext((current) => ({
        ...current,
        emails: page.items,
        selectedHouseholds: Object.fromEntries(page.items.map((email) => [
          email.id,
          suggestDropboxHousehold(email, households) ?? '',
        ])),
        status: page.items.length
          ? `${String(page.items.length)} email${page.items.length === 1 ? '' : 's'} ready for your review.`
          : 'Nothing is waiting in this folder yet.',
      }));
    } catch (reason) {
      if (!isCurrentRequest()) return;
      updateCurrentContext((current) => ({
        ...current,
        error: reason instanceof Error ? reason.message : 'Could not check this mailbox folder.',
      }));
    } finally {
      if (isCurrentRequest()) {
        updateCurrentContext((current) => ({ ...current, loading: false }));
      }
    }
  }, [config, households, live.workspaceRoot, updateCurrentContext]);

  // While this page is open, keep the selected local mailbox folder fresh.
  // The connected mail store remains the only place email content is read.
  useEffect(() => {
    if (!savedConfig || !config.folderId.trim()) return;
    void checkFolder();
    const refresh = window.setInterval(() => { void checkFolder(); }, 60_000);
    return () => { window.clearInterval(refresh); };
  }, [checkFolder, config.folderId, savedConfig]);

  async function saveConfig() {
    const folderId = config.folderId.trim();
    if (!folderId) {
      updateCurrentContext((current) => ({ ...current, error: 'Name the mailbox folder or label first.' }));
      return;
    }
    const rootAtStart = live.workspaceRoot;
    const contextAtStart = mailboxContextKey(rootAtStart, config);
    updateCurrentContext((current) => ({ ...current, error: null }));
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
      if (renderedMailboxContextRef.current === contextAtStart) {
        updateCurrentContext((current) => ({ ...current, status: 'This computer will check this folder while this dropbox is open.' }));
      }
    } catch (reason) {
      if (renderedMailboxContextRef.current === contextAtStart) {
        updateCurrentContext((current) => ({ ...current, error: reason instanceof Error ? reason.message : 'Could not save this dropbox.' }));
      }
    }
  }

  async function fileEmail(email: MailListItem) {
    const householdId = selectedHouseholds[email.id];
    if (!householdId) {
      updateCurrentContext((current) => ({ ...current, error: 'Choose the client this email belongs to before filing it.' }));
      return;
    }
    const household = households.find((candidate) => candidate.id === householdId);
    if (!household) {
      updateCurrentContext((current) => ({ ...current, error: 'Choose the client this email belongs to before filing it.' }));
      return;
    }
    const contextAtStart = mailboxContextKey(live.workspaceRoot, config);
    updateCurrentContext((current) => ({ ...current, error: null }));
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
      if (renderedMailboxContextRef.current !== contextAtStart) return;
      updateCurrentContext((current) => ({
        ...current,
        emails: current.emails.filter((candidate) => candidate.id !== email.id),
        status: `Filed “${email.subject || 'Untitled email'}” to ${household.name}.`,
      }));
    } catch (reason) {
      if (renderedMailboxContextRef.current === contextAtStart) {
        updateCurrentContext((current) => ({ ...current, error: reason instanceof Error ? reason.message : 'Could not file this email locally.' }));
      }
    }
  }

  return (
    <div data-testid="crm-email-dropbox-surface" style={{ padding: 'var(--kp-space-xl)', overflow: 'auto', width: '100%', display: 'grid', gap: 'var(--kp-space-md)', alignContent: 'start' }}>
      <SurfaceHeader Icon={Inbox} title="Email dropbox" description="File forwarded or BCC’d email from your connected inbox, without sending it through a CRM server." />
      <Card variant="raised" style={cardStyle}>
        <div><h2 style={{ margin: 0 }}>Set up your private dropbox</h2><p>{`Make a folder or label in your connected mailbox, such as “${BRAND.name} Dropbox.” Forward email to your own inbox or BCC yourself, then add that label. ${BRAND.name} reads it only on this computer.`}</p></div>
        <label>Mailbox folder or label<input data-testid="crm-email-dropbox-folder" value={displayFolderName(config.folderId)} onChange={(event) => { updateConfig('folderId', folderIdFromDisplay(event.target.value)); }} /></label>
        <label>Mail provider (optional)<select data-testid="crm-email-dropbox-provider" value={config.provider} onChange={(event) => { updateConfig('provider', event.target.value); }}><option value="">Any connected provider</option><option value="m365">Outlook</option><option value="gmail">Gmail</option><option value="imap">Other mail account</option></select></label>
        <label>Mailbox account (optional)<input data-testid="crm-email-dropbox-account" value={config.account} onChange={(event) => { updateConfig('account', event.target.value); }} placeholder="Leave blank to check every connected account" /></label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><Button data-testid="crm-email-dropbox-save" iconLeft={Save} onClick={() => { void saveConfig(); }}>Save dropbox</Button><Button data-testid="crm-email-dropbox-check" variant="secondary" iconLeft={RefreshCw} onClick={() => { void checkFolder(); }} disabled={loading}>{loading ? 'Checking…' : 'Check folder'}</Button></div>
        <p data-testid="crm-email-dropbox-private-note" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 6 }}><ShieldCheck size={16} /> {` Email never passes through a ${BRAND.name} server. The connected mailbox and this encrypted computer keep the content.`}</p>
      </Card>
      {status ? <p role="status" data-testid="crm-email-dropbox-status">{status}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      <Card variant="raised" style={cardStyle}>
        <div><h2 style={{ margin: 0 }}>Email waiting to be filed</h2><p>{`${BRAND.name} suggests a client from the sender and subject. You choose before an email is filed.`}</p></div>
        {!households.length ? <p data-testid="crm-email-dropbox-no-households">Add a client first, then return here to file their email.</p> : null}
        {!loading && emails.length === 0 ? <p data-testid="crm-email-dropbox-empty">Check your chosen mailbox folder to see email waiting to be filed.</p> : null}
        {emails.map((email) => <section key={email.id} data-testid={`crm-email-dropbox-email-${email.id}`} style={{ borderTop: '1px solid var(--kp-border)', paddingTop: 12, display: 'grid', gap: 8 }}>
          <div><strong>{email.subject || 'Untitled email'}</strong><div style={{ color: 'var(--color-slate-600)', fontSize: 13 }}>{email.fromName || email.fromAddr || 'Unknown sender'} · {displayDate(email.receivedDateTime)}</div><div style={{ color: 'var(--color-slate-600)', fontSize: 13 }}>{email.snippet}</div></div>
          <label>File to client<select data-testid={`crm-email-dropbox-household-${email.id}`} value={selectedHouseholds[email.id] ?? ''} onChange={(event) => { updateCurrentContext((current) => ({ ...current, selectedHouseholds: { ...current.selectedHouseholds, [email.id]: event.target.value } })); }}><option value="">Choose a client</option>{households.map((household) => <option key={household.id} value={household.id}>{household.name}</option>)}</select></label>
          <div><Button data-testid={`crm-email-dropbox-file-${email.id}`} iconLeft={MailCheck} disabled={!households.length} onClick={() => { void fileEmail(email); }}>File email locally</Button></div>
        </section>)}
      </Card>
    </div>
  );
}
