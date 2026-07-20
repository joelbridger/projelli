/* eslint-disable lantern-i18n/no-hardcoded-string, react-refresh/only-export-components -- Frozen CRM copy needs its catalog in a separate product change; the recipient-review helpers live with the surface like the sibling CRM registry files. */
/**
 * A firm email broadcast is intentionally a collection of separate, reviewed
 * sends. The CRM stores the plan and its outcome, while the existing mail
 * connector remains the sole owner of the actual message delivery.
 */
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, MailCheck, Send, Sparkles } from 'lucide-react';
import { Button } from '@/ui/kp';
import { SurfaceHeader } from '@/ui/SurfaceHeader';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import {
  mailConnectedAccounts,
  mailSend,
  type ConnectedAccount,
} from '@/platform/utils/mail-commands';
import { applyViewQuery } from '@/features/crm-views/viewQuery';
import { BRAND } from '@/config/brand';

type BroadcastRecipient = {
  id: string;
  householdId: string;
  householdName: string;
  personName: string;
  email: string;
};

type RecipientReviewCandidate = BroadcastRecipient & {
  personId: string;
  collection: 'members' | 'externalParties';
};

type SavedHouseholdView = LiveCrmRecord & {
  name?: string;
  query?: { entity?: unknown; filters?: unknown; sort?: unknown };
};

const panel = {
  border: '1px solid var(--kp-border)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--kp-surface)',
  padding: 'var(--kp-space-md)',
} as const;

const muted = {
  color: 'var(--kp-text-faint)',
  fontSize: 'var(--kp-font-sm)',
} as const;

function string(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function verifiedEmail(person: Record<string, unknown>): string | null {
  const verifiedRecipient = person['verifiedRecipient'];
  if (
    verifiedRecipient &&
    typeof verifiedRecipient === 'object' &&
    (verifiedRecipient as { verified?: unknown }).verified === true &&
    (verifiedRecipient as { channel?: unknown }).channel === 'email'
  )
    return string((verifiedRecipient as { address?: unknown }).address);
  if (!string(person['verifiedAt'])) return null;
  const emails = Array.isArray(person['emails']) ? person['emails'] : [];
  for (const entry of emails) {
    if (!entry || typeof entry !== 'object') continue;
    const address = string((entry as { address?: unknown }).address);
    if (address) return address;
  }
  return string(person['channel']);
}

function emailForReview(person: Record<string, unknown>): string | null {
  const emails: readonly unknown[] = Array.isArray(person['emails'])
    ? (person['emails'] as readonly unknown[])
    : [];
  const primary = emails.find(
    (entry) =>
      entry &&
      typeof entry === 'object' &&
      ((entry as { primary?: unknown }).primary === true ||
        (entry as { principal?: unknown }).principal === true)
  );
  const ordered = primary
    ? [primary, ...emails.filter((entry) => entry !== primary)]
    : emails;
  for (const entry of ordered) {
    if (!entry || typeof entry !== 'object') continue;
    const address = string((entry as { address?: unknown }).address);
    if (address) return address;
  }
  return null;
}

/** Only email addresses that have already passed the recipient check may enter a broadcast. */
export function recipientsForHouseholds(
  households: readonly LiveCrmRecord[]
): readonly BroadcastRecipient[] {
  const seen = new Set<string>();
  const recipients: BroadcastRecipient[] = [];
  for (const household of households) {
    const householdName = string(household['name']) ?? 'Unnamed household';
    const people: readonly unknown[] = [
      ...(Array.isArray(household['members'])
        ? (household['members'] as readonly unknown[])
        : []),
      ...(Array.isArray(household['externalParties'])
        ? (household['externalParties'] as readonly unknown[])
        : []),
    ];
    for (const value of people) {
      if (!value || typeof value !== 'object') continue;
      const person = value as Record<string, unknown>;
      const email = verifiedEmail(person);
      if (!email || seen.has(email.toLowerCase())) continue;
      seen.add(email.toLowerCase());
      const personName = string(person['name']) ?? email;
      recipients.push({
        id: `${household.id}:${string(person['id']) ?? email}`,
        householdId: household.id,
        householdName,
        personName,
        email,
      });
    }
  }
  return recipients;
}

/**
 * People are only candidates until an advisor deliberately confirms the exact
 * address. Keeping this separate from recipientsForHouseholds prevents a
 * review screen from accidentally weakening the send guard.
 */
export function recipientReviewCandidatesForHouseholds(
  households: readonly LiveCrmRecord[]
): readonly RecipientReviewCandidate[] {
  const candidates: RecipientReviewCandidate[] = [];
  for (const household of households) {
    const householdName = string(household['name']) ?? 'Unnamed household';
    for (const collection of ['members', 'externalParties'] as const) {
      const people = Array.isArray(household[collection])
        ? household[collection]
        : [];
      for (const value of people) {
        if (!value || typeof value !== 'object') continue;
        const person = value as Record<string, unknown>;
        if (verifiedEmail(person)) continue;
        const email = emailForReview(person);
        if (!email) continue;
        const personId = string(person['id']) ?? email;
        candidates.push({
          id: `${household.id}:${personId}`,
          personId,
          householdId: household.id,
          householdName,
          personName: string(person['name']) ?? email,
          email,
          collection,
        });
      }
    }
  }
  return candidates;
}

/** Writes the review result into the same household record the send gate reads. */
export function verifyRecipientOnHousehold(
  household: LiveCrmRecord,
  candidate: RecipientReviewCandidate,
  verifiedAt: string
): LiveCrmRecord {
  const people: readonly unknown[] = Array.isArray(
    household[candidate.collection]
  )
    ? (household[candidate.collection] as readonly unknown[])
    : [];
  const matchesCandidate = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false;
    const person = value as Record<string, unknown>;
    const id = string(person['id']) ?? emailForReview(person);
    return id === candidate.personId;
  };
  if (!people.some(matchesCandidate))
    throw new Error('This person is no longer in the selected client list.');
  const updatedPeople = people.map((value) => {
    if (!matchesCandidate(value)) return value;
    const person = value as Record<string, unknown>;
    return {
      ...person,
      verifiedRecipient: {
        verified: true,
        verifiedAt,
        verifiedBy: 'advisor',
        channel: 'email',
        address: candidate.email,
      },
    };
  });
  return {
    ...household,
    [candidate.collection]: updatedPeople,
    updatedAt: verifiedAt,
  };
}

function householdViews(
  records: readonly LiveCrmRecord[]
): readonly SavedHouseholdView[] {
  return records.filter(
    (record): record is SavedHouseholdView =>
      record.kind === 'savedView' &&
      record['surface'] === 'households' &&
      !!record['query'] &&
      typeof record['query'] === 'object' &&
      (record['query'] as { entity?: unknown }).entity === 'household'
  );
}

function displayViewName(view: SavedHouseholdView): string {
  return string(view.name) ?? 'Untitled saved view';
}

function broadcastRecord(
  id: string,
  selectedView: SavedHouseholdView,
  subject: string,
  body: string,
  recipients: readonly BroadcastRecipient[],
  approvals: ReadonlySet<string>,
  account: ConnectedAccount | null,
  prior?: LiveCrmRecord
): LiveCrmRecord {
  const now = new Date().toISOString();
  return {
    ...prior,
    id,
    kind: 'emailBroadcast',
    matterId: 'firm_home',
    createdAt: prior?.createdAt ?? now,
    updatedAt: now,
    state: 'ready_for_review',
    savedViewId: selectedView.id,
    savedViewName: displayViewName(selectedView),
    subject,
    body,
    account: account
      ? {
          provider: account.provider,
          account: account.account,
          label: account.label,
        }
      : null,
    recipients: recipients.map((recipient) => ({
      ...recipient,
      approved: approvals.has(recipient.id),
    })),
  };
}

function resultMessage(sent: number, failed: number): string {
  if (!failed)
    return `${String(sent)} separate email${sent === 1 ? '' : 's'} sent.`;
  return `${String(sent)} sent. ${String(failed)} still need attention.`;
}

export function CrmBroadcastSurface() {
  const live = useLiveCrmRecords();
  const [viewId, setViewId] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [aiBrief, setAiBrief] = useState('');
  const [accounts, setAccounts] = useState<readonly ConnectedAccount[]>([]);
  const [accountKey, setAccountKey] = useState('');
  const [approved, setApproved] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const [broadcastId, setBroadcastId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  const [reviewingRecipient, setReviewingRecipient] =
    useState<RecipientReviewCandidate | null>(null);
  const [verifyingRecipient, setVerifyingRecipient] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void mailConnectedAccounts()
      .then((next) => {
        if (cancelled) return;
        setAccounts(next);
        setAccountKey(
          (current) =>
            current || (next[0] ? `${next[0].provider}:${next[0].account}` : '')
        );
      })
      .catch(() => {
        if (!cancelled)
          setMessage(
            'Could not check the connected email accounts. Try again before sending.'
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const views = useMemo(() => householdViews(live.records), [live.records]);
  const savedBroadcasts = useMemo(
    () => live.records.filter((record) => record.kind === 'emailBroadcast'),
    [live.records]
  );
  const selectedView = views.find((view) => view.id === viewId) ?? null;
  const selectedHouseholds = useMemo(() => {
    if (!selectedView || !selectedView.query) return [];
    return applyViewQuery(
      live.records.filter((record) => record.kind === 'household'),
      selectedView.query as Parameters<typeof applyViewQuery>[1]
    );
  }, [live.records, selectedView]);
  const recipients = useMemo(
    () => recipientsForHouseholds(selectedHouseholds),
    [selectedHouseholds]
  );
  const reviewCandidates = useMemo(
    () => recipientReviewCandidatesForHouseholds(selectedHouseholds),
    [selectedHouseholds]
  );
  const account =
    accounts.find(
      (item) => `${item.provider}:${item.account}` === accountKey
    ) ?? null;
  const canSave =
    !!selectedView &&
    !!subject.trim() &&
    !!body.trim() &&
    recipients.length > 0 &&
    !saving;
  const approvedRecipients = recipients.filter((recipient) =>
    approved.has(recipient.id)
  );
  const canSend =
    canSave && !!account && approvedRecipients.length > 0 && !sending;

  const verifyRecipient = async () => {
    if (!reviewingRecipient || verifyingRecipient) return;
    const household = live.records.find(
      (record) => record.id === reviewingRecipient.householdId
    );
    if (!household) {
      setMessage(
        'This client list changed. Choose it again before reviewing this email.'
      );
      setReviewingRecipient(null);
      return;
    }
    setVerifyingRecipient(true);
    setMessage(null);
    try {
      await live.save(
        verifyRecipientOnHousehold(
          household,
          reviewingRecipient,
          new Date().toISOString()
        )
      );
      setMessage(
        `${reviewingRecipient.personName}'s email is verified and can now be reviewed for this broadcast.`
      );
      setReviewingRecipient(null);
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : 'Could not verify this email. Nothing was changed.'
      );
    } finally {
      setVerifyingRecipient(false);
    }
  };

  const saveDraft = async (): Promise<LiveCrmRecord | null> => {
    if (!selectedView || !canSave) return null;
    setSaving(true);
    setMessage(null);
    try {
      const id = broadcastId ?? `email-broadcast:${crypto.randomUUID()}`;
      const prior = live.records.find((record) => record.id === id);
      const saved = await live.save(
        broadcastRecord(
          id,
          selectedView,
          subject.trim(),
          body.trim(),
          recipients,
          approved,
          account,
          prior
        )
      );
      setBroadcastId(id);
      setMessage('Saved. Review each recipient before any email is sent.');
      return saved;
    } catch (reason) {
      setMessage(
        reason instanceof Error
          ? reason.message
          : 'Could not save this broadcast.'
      );
      return null;
    } finally {
      setSaving(false);
    }
  };

  const proposeWithAi = () => {
    if (!selectedView) {
      setMessage(
        `Choose a saved client list before asking ${BRAND.name} for a draft.`
      );
      return;
    }
    if (!aiBrief.trim()) {
      setMessage(`Tell ${BRAND.name} what this email should cover first.`);
      return;
    }
    setDrafting(true);
    setMessage(null);
    void import('@/features/email/resolveEmailProvider')
      .then(({ buildProviderAsync }) => buildProviderAsync())
      .then((provider) =>
        provider.sendMessage(
          [
            'Draft a short, clear email for a financial-advisory firm.',
            `Audience: ${String(recipients.length)} already-verified recipients from the saved list “${displayViewName(selectedView)}”.`,
            `What the advisor wants to say: ${aiBrief.trim()}`,
            'Return only the email body. Do not include a greeting with a person’s name, a subject line, or any promise you cannot verify.',
          ].join('\n')
        )
      )
      .then((response) => {
        setBody(response.content.trim());
        setMessage(
          `${BRAND.name} proposed a draft. Edit it until it is right, then review every recipient.`
        );
      })
      .catch((reason: unknown) => {
        setMessage(
          reason instanceof Error
            ? reason.message
            : `${BRAND.name} could not draft this email. You can still write it yourself.`
        );
      })
      .finally(() => {
        setDrafting(false);
      });
  };

  const sendApproved = () => {
    if (!selectedView || !account || !canSend) return;
    setSending(true);
    setMessage(null);
    void (async () => {
      const current = await saveDraft();
      if (!current) return;
      const outcomes: Array<{
        recipient: BroadcastRecipient;
        sentAt?: string;
        error?: string;
      }> = [];
      for (const recipient of approvedRecipients) {
        try {
          await mailSend(
            account.provider,
            account.account,
            [recipient.email],
            [],
            [],
            subject.trim(),
            body.trim()
          );
          outcomes.push({ recipient, sentAt: new Date().toISOString() });
        } catch (reason) {
          outcomes.push({
            recipient,
            error:
              reason instanceof Error
                ? reason.message
                : 'Could not send this email.',
          });
        }
      }
      const sent = outcomes.filter((outcome) => outcome.sentAt).length;
      const failed = outcomes.length - sent;
      await live.save({
        ...current,
        updatedAt: new Date().toISOString(),
        state: failed ? 'partially_sent' : 'sent',
        delivery: outcomes.map((outcome) => ({
          recipientId: outcome.recipient.id,
          email: outcome.recipient.email,
          ...(outcome.sentAt
            ? { sentAt: outcome.sentAt }
            : { error: outcome.error }),
        })),
      });
      setMessage(resultMessage(sent, failed));
    })()
      .catch((reason: unknown) => {
        setMessage(
          reason instanceof Error
            ? reason.message
            : 'Could not complete the approved sends.'
        );
      })
      .finally(() => {
        setSending(false);
      });
  };

  const reopenBroadcast = (record: LiveCrmRecord) => {
    setBroadcastId(record.id);
    setViewId(string(record['savedViewId']) ?? '');
    setSubject(string(record['subject']) ?? '');
    setBody(string(record['body']) ?? '');
    const recipients = Array.isArray(record['recipients'])
      ? record['recipients']
      : [];
    setApproved(
      new Set(
        recipients.flatMap((recipient) => {
          if (!recipient || typeof recipient !== 'object') return [];
          const item = recipient as { id?: unknown; approved?: unknown };
          return item.approved === true && typeof item.id === 'string'
            ? [item.id]
            : [];
        })
      )
    );
    const storedAccount = record['account'];
    if (storedAccount && typeof storedAccount === 'object') {
      const value = storedAccount as { provider?: unknown; account?: unknown };
      if (
        typeof value.provider === 'string' &&
        typeof value.account === 'string'
      )
        setAccountKey(`${value.provider}:${value.account}`);
    }
    setMessage(
      'Saved broadcast reopened. Check the message and each recipient before sending.'
    );
  };

  return (
    <main
      data-testid="crm-broadcast-surface"
      style={{
        flex: 1,
        overflow: 'auto',
        padding: 'var(--kp-space-lg)',
        display: 'grid',
        alignContent: 'start',
        gap: 'var(--kp-space-md)',
      }}
    >
      <SurfaceHeader
        Icon={Send}
        title="Email broadcast"
        description={`Write one message for a saved client list. ${BRAND.name} sends only the people you review and approve.`}
      />
      {live.error ? (
        <section role="alert" style={panel}>
          Could not load broadcasts: {live.error}
        </section>
      ) : null}
      <section style={panel}>
        <h2 style={{ marginTop: 0 }}>1. Choose the client list</h2>
        {views.length ? (
          <label>
            Saved client list
            <select
              data-testid="crm-broadcast-view"
              value={viewId}
              onChange={(event) => {
                setViewId(event.target.value);
                setApproved(new Set());
                setBroadcastId(null);
                setMessage(null);
              }}
            >
              <option value="">Choose a saved client list</option>
              {views.map((view) => (
                <option key={view.id} value={view.id}>
                  {displayViewName(view)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div data-testid="crm-broadcast-empty" role="status">
            <strong>Start with a saved client list.</strong>
            <p style={muted}>
              Go to Saved views, choose Households, add the filter you need, and
              save it. This keeps a broadcast tied to a list you can inspect.
            </p>
          </div>
        )}
        {selectedView ? (
          <p data-testid="crm-broadcast-recipient-count" style={muted}>
            {String(recipients.length)} verified recipient
            {recipients.length === 1 ? '' : 's'} in this list. People without a
            verified email are left out.
          </p>
        ) : null}
      </section>
      <section style={panel}>
        <h2 style={{ marginTop: 0 }}>2. Write the message</h2>
        <label style={{ display: 'grid', gap: 4, maxWidth: 760 }}>
          {`
          What should ${BRAND.name} cover?
          `}<input
            data-testid="crm-broadcast-ai-brief"
            value={aiBrief}
            onChange={(event) => {
              setAiBrief(event.target.value);
            }}
            placeholder="For example: invite clients to our September market update"
          />
        </label>
        <Button
          data-testid="crm-broadcast-ai-draft"
          variant="secondary"
          iconLeft={Sparkles}
          disabled={drafting}
          onClick={proposeWithAi}
          style={{ marginTop: 8 }}
        >
          {drafting ? `${BRAND.name} is drafting…` : `Ask ${BRAND.name} for a draft`}
        </Button>
        <label
          style={{ display: 'grid', gap: 4, marginTop: 12, maxWidth: 760 }}
        >
          Subject
          <input
            data-testid="crm-broadcast-subject"
            value={subject}
            onChange={(event) => {
              setSubject(event.target.value);
            }}
            placeholder="A clear, helpful subject"
          />
        </label>
        <label
          style={{ display: 'grid', gap: 4, marginTop: 12, maxWidth: 760 }}
        >
          Message
          <textarea
            data-testid="crm-broadcast-body"
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
            }}
            placeholder="Write or edit the message here"
            rows={8}
          />
        </label>
      </section>
      <section style={panel}>
        <h2 style={{ marginTop: 0 }}>3. Review every recipient</h2>
        {!selectedView ? (
          <p style={muted}>
            Choose a saved client list to see the people who can receive this
            email.
          </p>
        ) : (
          <>
            {recipients.length ? (
              <div
                data-testid="crm-broadcast-previews"
                style={{ display: 'grid', gap: 8 }}
              >
                {recipients.map((recipient) => (
                  <label
                    key={recipient.id}
                    data-testid={`crm-broadcast-recipient-${recipient.id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'start',
                      gap: 8,
                      border: '1px solid var(--kp-border)',
                      borderRadius: 8,
                      padding: 10,
                    }}
                  >
                    <input
                      data-testid={`crm-broadcast-approve-${recipient.id}`}
                      type="checkbox"
                      checked={approved.has(recipient.id)}
                      onChange={() => {
                        setApproved((current) => {
                          const next = new Set(current);
                          if (next.has(recipient.id)) next.delete(recipient.id);
                          else next.add(recipient.id);
                          return next;
                        });
                      }}
                    />
                    <span>
                      <strong>{recipient.personName}</strong> ·{' '}
                      {recipient.householdName}
                      <br />
                      <span style={muted}>{recipient.email}</span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p
                data-testid="crm-broadcast-no-verified-recipients"
                role="status"
              >
                This saved list has no verified email recipients yet. Review an
                email below before sending.
              </p>
            )}
            {reviewCandidates.length ? (
              <div
                data-testid="crm-broadcast-recipient-reviews"
                style={{ display: 'grid', gap: 8, marginTop: 12 }}
              >
                <strong>People who still need review</strong>
                <p style={{ ...muted, margin: 0 }}>
                  Check the exact email address before marking it ready for a
                  broadcast.
                </p>
                {reviewCandidates.map((candidate) => (
                  <Button
                    key={candidate.id}
                    data-testid={`crm-broadcast-review-${candidate.id}`}
                    variant="secondary"
                    onClick={() => {
                      setReviewingRecipient(candidate);
                    }}
                    style={{
                      justifyContent: 'space-between',
                      textAlign: 'left',
                    }}
                  >
                    <span>
                      {candidate.personName} · {candidate.householdName}
                      <br />
                      <span style={muted}>{candidate.email}</span>
                    </span>
                    <span>Review recipient</span>
                  </Button>
                ))}
              </div>
            ) : null}
          </>
        )}
      </section>
      <section style={panel}>
        <h2 style={{ marginTop: 0 }}>
          4. Save, then send only what you approved
        </h2>
        {accounts.length ? (
          <label>
            Send from
            <select
              data-testid="crm-broadcast-account"
              value={accountKey}
              onChange={(event) => {
                setAccountKey(event.target.value);
              }}
            >
              <option value="">Choose an email account</option>
              {accounts.map((item) => (
                <option
                  key={`${item.provider}:${item.account}`}
                  value={`${item.provider}:${item.account}`}
                >
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p data-testid="crm-broadcast-no-account" style={muted}>
            Connect an email account before sending. You can still save this
            reviewed message for later.
          </p>
        )}
        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}
        >
          <Button
            data-testid="crm-broadcast-save"
            variant="secondary"
            iconLeft={CheckCircle2}
            disabled={!canSave}
            onClick={() => {
              // eslint-disable-next-line lantern-async/no-silent-failure -- saveDraft catches its own errors into UI state (setSaveError)
              void saveDraft();
            }}
          >
            {saving ? 'Saving…' : 'Save reviewed message'}
          </Button>
          <Button
            data-testid="crm-broadcast-send-approved"
            iconLeft={MailCheck}
            disabled={!canSend}
            onClick={sendApproved}
          >
            {sending
              ? 'Sending approved emails…'
              : `Send ${String(approvedRecipients.length)} approved email${approvedRecipients.length === 1 ? '' : 's'}`}
          </Button>
        </div>
        <p style={muted}>
          {`
          Each approved person receives a separate email. ${BRAND.name} never sends a
          broadcast on its own.
        `}</p>
        {message ? (
          <p data-testid="crm-broadcast-status" role="status">
            {message}
          </p>
        ) : null}
      </section>
      {savedBroadcasts.length ? (
        <section data-testid="crm-broadcast-saved" style={panel}>
          <h2 style={{ marginTop: 0 }}>Saved broadcasts</h2>
          <p style={muted}>
            Open a saved message to continue its review. Nothing is sent when
            you open it.
          </p>
          <div style={{ display: 'grid', gap: 8 }}>
            {savedBroadcasts.map((record) => {
              const savedRecipients = Array.isArray(record['recipients'])
                ? record['recipients']
                : [];
              const approvedCount = savedRecipients.filter(
                (recipient) =>
                  recipient &&
                  typeof recipient === 'object' &&
                  (recipient as { approved?: unknown }).approved === true
              ).length;
              return (
                <Button
                  key={record.id}
                  data-testid={`crm-broadcast-saved-${record.id}`}
                  variant="secondary"
                  onClick={() => {
                    reopenBroadcast(record);
                  }}
                  style={{ justifyContent: 'space-between', textAlign: 'left' }}
                >
                  <span>
                    {string(record['subject']) ?? 'Untitled email'}
                    <br />
                    <span style={muted}>
                      {string(record['savedViewName']) ?? 'Saved client list'} ·{' '}
                      {String(approvedCount)} approved
                    </span>
                  </span>
                  <span>
                    {record['state'] === 'sent'
                      ? 'Sent'
                      : record['state'] === 'partially_sent'
                        ? 'Needs attention'
                        : 'Ready for review'}
                  </span>
                </Button>
              );
            })}
          </div>
        </section>
      ) : null}
      {reviewingRecipient ? (
        <section
          aria-label="Review recipient"
          data-testid="crm-broadcast-review-dialog"
          role="dialog"
          style={{
            ...panel,
            position: 'sticky',
            bottom: 16,
            boxShadow: 'var(--kp-shadow-lg)',
          }}
        >
          <h2 style={{ marginTop: 0 }}>Review recipient</h2>
          <p>
            Confirm that <strong>{reviewingRecipient.personName}</strong> can
            receive broadcast email at{' '}
            <strong>{reviewingRecipient.email}</strong>.
          </p>
          <p style={muted}>
            This does not send anything. It only makes this address available
            for a later, separate approval.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button
              data-testid="crm-broadcast-confirm-recipient"
              disabled={verifyingRecipient}
              onClick={() => {
                // eslint-disable-next-line lantern-async/no-silent-failure -- verifyRecipient catches its own errors into UI state
                void verifyRecipient();
              }}
            >
              {verifyingRecipient ? 'Verifying…' : 'Verify email'}
            </Button>
            <Button
              data-testid="crm-broadcast-cancel-recipient"
              disabled={verifyingRecipient}
              variant="secondary"
              onClick={() => {
                setReviewingRecipient(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </section>
      ) : null}
    </main>
  );
}
