import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Loader2, Save } from 'lucide-react';
import { openExternal } from '@/platform/utils/openExternal';
import type { MeetingFollowUpDraft } from './meetingFollowUpStore';
import {
  loadProviderDraftAccounts,
  parseFollowUpRecipients,
  providerDraftsUrl,
  saveProviderFollowUpDraft,
  type ProviderDraftAccount,
} from './followUpDraftsOnlyAdapter';

/* eslint-disable lantern-i18n/no-hardcoded-string */

export interface FollowUpDraftsOnlySavedResult {
  readonly draftId: string;
  readonly provider: 'm365' | 'gmail';
  readonly account: string;
  readonly accountLabel: string;
  readonly handoffState: 'opened-drafts' | 'open-failed';
  readonly meetingId: string;
  readonly householdRef: string;
  readonly matterId: string;
  readonly draft: MeetingFollowUpDraft;
}

export interface FollowUpDraftsOnlyUnresolvedAttempt {
  readonly provider: 'm365' | 'gmail';
  readonly account: string;
  readonly accountLabel: string;
}

export interface FollowUpDraftsOnlyEditorProps {
  readonly meetingId: string;
  readonly householdRef: string;
  readonly matterId: string;
  readonly draft: MeetingFollowUpDraft;
  readonly savedToDrafts?: boolean;
  readonly savedProvider?: 'm365' | 'gmail';
  readonly savedAccountLabel?: string;
  /** A durable pre-call receipt exists, so another provider save is unsafe. */
  readonly unresolvedAttempt?: FollowUpDraftsOnlyUnresolvedAttempt;
  readonly initialHandoffState?: 'idle' | 'opened-drafts' | 'open-failed';
  readonly onDraftChange?: (draft: MeetingFollowUpDraft) => void;
  readonly onProviderSaveAttempt?: (
    attempt: Omit<FollowUpDraftsOnlySavedResult, 'draftId' | 'handoffState'>
  ) => Promise<void>;
  readonly onProviderSaveUnresolved?: (
    attempt: Omit<FollowUpDraftsOnlySavedResult, 'draftId' | 'handoffState'>
  ) => Promise<void>;
  readonly onDraftSaved?: (
    result: FollowUpDraftsOnlySavedResult
  ) => void | Promise<void>;
}

type EditorStatus =
  | 'loading'
  | 'idle'
  | 'saving'
  | 'saved'
  | 'load-error'
  | 'receipt-error'
  | 'unresolved';

const labelStyle: CSSProperties = {
  width: 60,
  flexShrink: 0,
  fontSize: 'var(--kp-font-2xs)',
  fontWeight: 'var(--kp-weight-semibold)',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--color-muted-foreground)',
};

const inputStyle: CSSProperties = {
  flex: 1,
  border: '1px solid var(--color-border)',
  borderRadius: 5,
  padding: '5px 8px',
  fontSize: 'var(--kp-font-sm)',
  fontFamily: 'var(--font-sans)',
  background: 'var(--color-background)',
  color: 'var(--color-foreground)',
};

/**
 * Meeting follow-ups can only be edited and saved into provider Drafts.
 * Its import graph intentionally contains no email-delivery or AI provider path.
 */
export function FollowUpDraftsOnlyEditor({
  meetingId,
  householdRef,
  matterId,
  draft: initialDraft,
  savedToDrafts = false,
  savedProvider,
  savedAccountLabel,
  unresolvedAttempt,
  initialHandoffState = 'idle',
  onDraftChange,
  onProviderSaveAttempt,
  onProviderSaveUnresolved,
  onDraftSaved,
}: FollowUpDraftsOnlyEditorProps) {
  const [accounts, setAccounts] = useState<ProviderDraftAccount[]>([]);
  const [accountIndex, setAccountIndex] = useState(0);
  const [draft, setDraft] = useState<MeetingFollowUpDraft>(initialDraft);
  const [status, setStatus] = useState<EditorStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [localUnresolvedAttempt, setLocalUnresolvedAttempt] =
    useState<FollowUpDraftsOnlyUnresolvedAttempt | null>(null);
  const savedAtMount = useRef(savedToDrafts);
  const providerSaveStarted = useRef(false);
  const mounted = useRef(true);
  const [handoffState, setHandoffState] = useState<
    'idle' | 'opened-drafts' | 'open-failed'
  >(initialHandoffState);

  useEffect(() => {
    if (unresolvedAttempt) {
      setStatus('unresolved');
      return;
    }
    const lifecycle = { cancelled: false };
    void loadProviderDraftAccounts()
      .then((providerAccounts) => {
        if (lifecycle.cancelled) return;
        setAccounts(providerAccounts);
        setStatus(savedAtMount.current ? 'saved' : 'idle');
      })
      .catch(() => {
        if (lifecycle.cancelled) return;
        setStatus('load-error');
        setError('Your draft accounts could not be checked. Try again.');
      });
    return () => {
      lifecycle.cancelled = true;
    };
  }, [householdRef, loadAttempt, matterId, meetingId, unresolvedAttempt]);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    []
  );

  const updateDraft = (next: Partial<MeetingFollowUpDraft>) => {
    const edited = { ...draft, ...next };
    setDraft(edited);
    setHandoffState('idle');
    setStatus('idle');
    setError(null);
    onDraftChange?.(edited);
  };

  const account = accounts[accountIndex];
  const savedAccount = savedProvider
    ? accounts.find((providerAccount) => providerAccount.provider === savedProvider)
    : account;
  const savedProviderName =
    savedProvider === 'gmail'
      ? 'Gmail'
      : savedProvider === 'm365'
        ? 'Outlook'
        : (savedAccount?.label ?? 'your provider');
  const selectedAccountLabel =
    savedAccountLabel ?? savedAccount?.label ?? 'the selected account';
  const canSave =
    account != null &&
    parseFollowUpRecipients(draft.to).length > 0 &&
    draft.body.trim() !== '' &&
    (status === 'idle' || status === 'receipt-error');

  const openDrafts = async (
    saved: Omit<FollowUpDraftsOnlySavedResult, 'handoffState'>
  ): Promise<'opened-drafts' | 'open-failed'> => {
    try {
      await openExternal(providerDraftsUrl(saved.provider));
      setHandoffState('opened-drafts');
      return 'opened-drafts';
    } catch {
      setHandoffState('open-failed');
      return 'open-failed';
    }
  };

  const recordSavedDraft = async (
    saved: Omit<FollowUpDraftsOnlySavedResult, 'handoffState'>
  ) => {
    const nextHandoffState = await openDrafts(saved);
    try {
      await onDraftSaved?.({ ...saved, handoffState: nextHandoffState });
      setStatus('saved');
    } catch {
      void onProviderSaveUnresolved?.(saved);
      setLocalUnresolvedAttempt({
        provider: saved.provider,
        account: saved.account,
        accountLabel: saved.accountLabel,
      });
      setStatus('unresolved');
      setError(
        'Lantern cannot confirm this meeting was updated. Inspect this provider Drafts folder and do not save another draft.'
      );
    }
  };

  const saveToDrafts = () => {
    if (!account || !canSave || providerSaveStarted.current) return;
    if (!onProviderSaveAttempt) {
      setStatus('receipt-error');
      setError(
        'Lantern could not safely record this draft attempt. Nothing was saved.'
      );
      return;
    }
    providerSaveStarted.current = true;
    setStatus('saving');
    setError(null);
    const attempt = {
      provider: account.provider,
      account: account.account,
      accountLabel: account.label,
      meetingId,
      householdRef,
      matterId,
      draft,
    } as const;
    void (async () => {
      try {
        await onProviderSaveAttempt(attempt);
        if (!mounted.current) return;
      } catch {
        providerSaveStarted.current = false;
        setStatus('receipt-error');
        setError(
          'Lantern could not safely record this draft attempt. Nothing was saved.'
        );
        return;
      }
      try {
        const draftId = await saveProviderFollowUpDraft({
          account,
          meetingId,
          householdRef,
          matterId,
          draft,
        });
        await recordSavedDraft({ ...attempt, draftId });
      } catch {
        void onProviderSaveUnresolved?.(attempt);
        setLocalUnresolvedAttempt(attempt);
        setStatus('unresolved');
        setError(
          `Lantern cannot confirm whether ${account.label} created this draft. Inspect that account's Drafts folder and do not save another draft.`
        );
      }
    })();
  };

  if (status === 'loading') {
    return (
      <div data-testid="followup-drafts-loading" aria-live="polite">
        Checking your draft accounts.
      </div>
    );
  }

  const lockedAttempt = unresolvedAttempt ?? localUnresolvedAttempt;
  if (lockedAttempt || status === 'unresolved') {
    const locked = lockedAttempt;
    const providerName = locked?.provider === 'gmail' ? 'Gmail' : 'Outlook';
    const accountLabel = locked?.accountLabel ?? 'the selected account';
    return (
      <div
        data-testid="meeting-follow-up-unresolved"
        role="alert"
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <span>
          Lantern cannot confirm whether a draft was created in {providerName}{' '}
          Drafts. If another account opens, switch to {accountLabel}, then
          inspect its Drafts folder. Do not save another provider draft for this
          meeting.
        </span>
        {error != null && <span>{error}</span>}
        {locked && (
          <button
            type="button"
            data-testid="followup-drafts-open-locked-folder"
            onClick={() => {
              void openExternal(providerDraftsUrl(locked.provider));
            }}
            style={{ alignSelf: 'flex-start' }}
          >
            Open {providerName} Drafts
          </button>
        )}
      </div>
    );
  }

  if (status === 'load-error') {
    return (
      <div
        data-testid="followup-drafts-local-error"
        role="alert"
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <span>{error}</span>
        <button
          type="button"
          data-testid="followup-drafts-retry"
          onClick={() => {
            setStatus('loading');
            setError(null);
            setAccounts([]);
            setAccountIndex(0);
            setLoadAttempt((value) => value + 1);
          }}
          style={{ alignSelf: 'flex-start' }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (accounts.length === 0) {
    return (
      <div data-testid="meeting-follow-up-blocked">
        Connect Outlook or Gmail in Settings before saving this follow-up to
        Drafts.
      </div>
    );
  }

  return (
    <div
      data-testid="follow-up-drafts-only-editor"
      data-capability-mode="provider-drafts-only"
      style={{
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--color-background)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: 'var(--kp-space-sm) var(--kp-card-pad)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--kp-space-xs)',
        }}
      >
        {accounts.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={labelStyle}>Account</span>
            <select
              data-testid="followup-drafts-account"
              value={accountIndex}
              onChange={(event) => {
                setAccountIndex(Number(event.target.value));
              }}
              style={inputStyle}
            >
              {accounts.map((providerAccount, index) => (
                <option
                  key={`${providerAccount.provider}:${providerAccount.account}`}
                  value={index}
                >
                  {providerAccount.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={labelStyle}>To</span>
            <input
              type="text"
              data-testid="followup-drafts-to"
              placeholder="client@example.com"
              value={draft.to}
              onChange={(event) => {
                updateDraft({ to: event.target.value });
              }}
              style={inputStyle}
            />
          </div>
          <div
            style={{
              marginLeft: 68,
              marginTop: 5,
              fontSize: 'var(--kp-font-2xs)',
              color: 'var(--color-muted-foreground)',
            }}
          >
            Review the recipients before saving. Your mail provider will not
            send this draft.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={labelStyle}>Subject</span>
          <input
            type="text"
            data-testid="followup-drafts-subject"
            value={draft.subject}
            onChange={(event) => {
              updateDraft({ subject: event.target.value });
            }}
            style={inputStyle}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <span style={labelStyle}>Message</span>
          <textarea
            data-testid="followup-drafts-body"
            rows={12}
            value={draft.body}
            onChange={(event) => {
              updateDraft({ body: event.target.value });
            }}
            style={{
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              padding: '10px 12px',
              fontSize: 'var(--kp-font-sm)',
              fontFamily: 'var(--font-sans)',
              lineHeight: 1.6,
              background: 'var(--color-background)',
              color: 'var(--color-foreground)',
              resize: 'vertical',
            }}
          />
        </div>

        {error != null && (
          <p
            role="alert"
            style={{
              fontSize: 'var(--kp-font-xs)',
              color: 'var(--kp-danger)',
            }}
          >
            {error}
          </p>
        )}
        {(status === 'idle' || status === 'receipt-error') && (
          <p
            data-testid="followup-drafts-edited"
            aria-live="polite"
            style={{
              fontSize: 'var(--kp-font-xs)',
              color: 'var(--color-muted-foreground)',
            }}
          >
            Edited locally. Nothing has been saved to a provider yet.
          </p>
        )}
        {status === 'saved' && (
          <p
            data-testid="meeting-follow-up-saved"
            style={{
              fontSize: 'var(--kp-font-xs)',
              color: 'var(--kp-success)',
            }}
          >
            {handoffState === 'opened-drafts'
              ? `Saved to ${savedProviderName} Drafts. That folder is open. If another account opens, switch to ${selectedAccountLabel}, then review and press Send there. Nothing was sent.`
              : `Saved to ${savedProviderName} Drafts. Open ${savedProviderName} Drafts. If another account opens, switch to ${selectedAccountLabel}, then review and press Send there. Nothing was sent.`}
          </p>
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: 'var(--kp-space-xs) var(--kp-card-pad)',
          borderTop: '1px solid var(--color-border)',
        }}
      >
        <span
          style={{
            flex: 1,
            fontSize: 'var(--kp-font-2xs)',
            color: 'var(--color-muted-foreground)',
          }}
        >
          Saves as a draft in your selected provider. You review and send it
          later there.
        </span>
        <button
          type="button"
          data-testid="followup-drafts-save"
          disabled={!canSave}
          onClick={saveToDrafts}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 18px',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--kp-font-sm)',
            fontWeight: 'var(--kp-weight-semibold)',
            background: 'var(--kp-action-bg)',
            color: 'var(--kp-action-fg)',
            border: 'none',
            cursor: canSave ? 'pointer' : 'default',
            opacity: canSave ? 1 : 0.6,
          }}
        >
          {status === 'saving' ? (
            <Loader2
              style={{
                width: 'var(--kp-icon-sm)',
                height: 'var(--kp-icon-sm)',
                animation: 'spin 1s linear infinite',
              }}
            />
          ) : (
            <Save
              style={{
                width: 'var(--kp-icon-sm)',
                height: 'var(--kp-icon-sm)',
              }}
            />
          )}
          {`Save to ${account?.label ?? 'Drafts'}`}
        </button>
      </div>
    </div>
  );
}
