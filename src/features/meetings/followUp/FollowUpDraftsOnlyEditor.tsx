import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Loader2, Save } from 'lucide-react';
import type { ConnectedAccount } from '@/platform/utils/mail-commands';
import type { MeetingFollowUpDraft } from './meetingFollowUpStore';
import {
  loadOutlookDraftAccounts,
  parseFollowUpRecipients,
  saveOutlookFollowUpDraft,
} from './followUpDraftsOnlyAdapter';

/* eslint-disable lantern-i18n/no-hardcoded-string */

export interface FollowUpDraftsOnlySavedResult {
  readonly draftId: string;
  readonly meetingId: string;
  readonly householdRef: string;
  readonly matterId: string;
  readonly draft: MeetingFollowUpDraft;
}

export interface FollowUpDraftsOnlyEditorProps {
  readonly meetingId: string;
  readonly householdRef: string;
  readonly matterId: string;
  readonly draft: MeetingFollowUpDraft;
  readonly savedToDrafts?: boolean;
  readonly onDraftChange?: (draft: MeetingFollowUpDraft) => void;
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
  | 'save-error';

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
 * Meeting follow-ups can only be edited and saved into Outlook Drafts.
 * Its import graph intentionally contains no email-delivery or AI provider path.
 */
export function FollowUpDraftsOnlyEditor({
  meetingId,
  householdRef,
  matterId,
  draft: initialDraft,
  savedToDrafts = false,
  onDraftChange,
  onDraftSaved,
}: FollowUpDraftsOnlyEditorProps) {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [accountIndex, setAccountIndex] = useState(0);
  const [draft, setDraft] = useState<MeetingFollowUpDraft>(initialDraft);
  const [status, setStatus] = useState<EditorStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const savedAtMount = useRef(savedToDrafts);

  useEffect(() => {
    const lifecycle = { cancelled: false };
    void loadOutlookDraftAccounts()
      .then((outlookAccounts) => {
        if (lifecycle.cancelled) return;
        setAccounts(outlookAccounts);
        setStatus(savedAtMount.current ? 'saved' : 'idle');
      })
      .catch(() => {
        if (lifecycle.cancelled) return;
        setStatus('load-error');
        setError('Outlook could not be checked. Try again.');
      });
    return () => {
      lifecycle.cancelled = true;
    };
  }, [householdRef, loadAttempt, matterId, meetingId]);

  const updateDraft = (next: Partial<MeetingFollowUpDraft>) => {
    const edited = { ...draft, ...next };
    setDraft(edited);
    setStatus('idle');
    setError(null);
    onDraftChange?.(edited);
  };

  const account = accounts[accountIndex];
  const canSave =
    account != null &&
    parseFollowUpRecipients(draft.to).length > 0 &&
    draft.body.trim() !== '' &&
    (status === 'idle' || status === 'save-error');

  const saveToDrafts = () => {
    if (!account || !canSave) return;
    setStatus('saving');
    setError(null);
    void saveOutlookFollowUpDraft({
      account,
      meetingId,
      householdRef,
      matterId,
      draft,
    })
      .then(async (draftId) => {
        try {
          await onDraftSaved?.({
            draftId,
            meetingId,
            householdRef,
            matterId,
            draft,
          });
          setStatus('saved');
        } catch {
          setStatus('saved');
          setError(
            'Saved to Outlook Drafts, but the local meeting status could not be updated.'
          );
        }
      })
      .catch(() => {
        setStatus('save-error');
        setError(
          'The draft was not saved to Outlook. Check the connection and try again.'
        );
      });
  };

  if (status === 'loading') {
    return (
      <div data-testid="meeting-follow-up-loading" aria-live="polite">
        Checking Outlook.
      </div>
    );
  }

  if (status === 'load-error') {
    return (
      <div
        data-testid="meeting-follow-up-local-error"
        role="alert"
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        <span>{error}</span>
        <button
          type="button"
          data-testid="meeting-follow-up-retry"
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
        Connect Outlook in Settings before saving this follow-up to Drafts.
      </div>
    );
  }

  return (
    <div
      data-testid="follow-up-drafts-only-editor"
      data-capability-mode="outlook-drafts-only"
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
              data-testid="followup-account"
              value={accountIndex}
              onChange={(event) => {
                setAccountIndex(Number(event.target.value));
              }}
              style={inputStyle}
            >
              {accounts.map((outlookAccount, index) => (
                <option key={`m365:${outlookAccount.account}`} value={index}>
                  {outlookAccount.label}
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
              data-testid="followup-to"
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
            Review the recipients before saving. Outlook will not send this
            draft.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={labelStyle}>Subject</span>
          <input
            type="text"
            data-testid="followup-subject"
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
            data-testid="followup-body"
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
        {(status === 'idle' || status === 'save-error') && (
          <p
            data-testid="meeting-follow-up-edited"
            aria-live="polite"
            style={{
              fontSize: 'var(--kp-font-xs)',
              color: 'var(--color-muted-foreground)',
            }}
          >
            Edited locally. Nothing has been saved to Outlook yet.
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
            Saved to Outlook Drafts. Nothing was sent.
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
          Saves as a draft in Outlook. You send it later from your own inbox.
        </span>
        <button
          type="button"
          data-testid="followup-save-drafts"
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
          Save to Outlook Drafts
        </button>
      </div>
    </div>
  );
}
