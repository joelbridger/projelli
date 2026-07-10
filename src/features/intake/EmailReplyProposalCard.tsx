import { useEffect, useMemo, useState } from 'react';
import { Mail, ShieldAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/ui/button';
import {
  acceptEmailReplyProposal,
  dismissEmailReplyProposal,
  type EmailReplyAcceptResult,
} from '@/platform/intake/emailReplyAccept';
import {
  emailReplyProposalList,
  isEmailReplyProposalItemSelectable,
  type EmailReplyProposalRecord,
} from '@/platform/intake/emailReplyProposalStore';
import { EmailReplyProposalRow } from './EmailReplyProposalRow';
import { EmailReplyReviewModal } from './EmailReplyReviewModal';

export interface EmailReplyProposalCardProps {
  matterId: string;
  advisorId: string;
  onAccepted?: (result: EmailReplyAcceptResult) => void;
}

function defaultSelectedIds(proposal: EmailReplyProposalRecord): Set<string> {
  return new Set(
    proposal.items
      .filter((row) => row.checkedByDefault && isEmailReplyProposalItemSelectable(row))
      .map((row) => row.id)
  );
}

export function EmailReplyProposalCard({
  matterId,
  advisorId,
  onAccepted,
}: EmailReplyProposalCardProps) {
  const { t } = useTranslation();
  const [proposals, setProposals] = useState<EmailReplyProposalRecord[]>([]);
  const [selectedByProposal, setSelectedByProposal] = useState<Record<string, Set<string>>>({});
  const [restrictedByProposal, setRestrictedByProposal] = useState<Record<string, Set<string>>>({});
  const [reviewProposalId, setReviewProposalId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const reviewProposal = useMemo(
    () => proposals.find((proposal) => proposal.proposalId === reviewProposalId) ?? null,
    [proposals, reviewProposalId]
  );

  const load = () => {
    void emailReplyProposalList(matterId)
      .then((records) => {
        setProposals(records);
        setSelectedByProposal((current) => {
          const next = { ...current };
          for (const proposal of records) {
            if (!next[proposal.proposalId]) {
              next[proposal.proposalId] = defaultSelectedIds(proposal);
            }
          }
          return next;
        });
      })
      .catch((loadError: unknown) => {
        setError(loadError instanceof Error ? loadError.message : t('intake.email-reply.load-error'));
      });
  };

  useEffect(() => {
    load();
    const interval = window.setInterval(load, 5000);
    return () => {
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matterId]);

  if (proposals.length === 0) return null;

  const toggle = (proposalId: string, rowId: string) => {
    setSelectedByProposal((current) => {
      const nextSet = new Set(current[proposalId] ?? []);
      if (nextSet.has(rowId)) nextSet.delete(rowId);
      else nextSet.add(rowId);
      return { ...current, [proposalId]: nextSet };
    });
  };

  const toggleRestricted = (
    proposalId: string,
    rowId: string,
    approved: boolean
  ) => {
    setRestrictedByProposal((current) => {
      const nextSet = new Set(current[proposalId] ?? []);
      if (approved) nextSet.add(rowId);
      else nextSet.delete(rowId);
      return { ...current, [proposalId]: nextSet };
    });
  };

  const accept = async (proposal: EmailReplyProposalRecord) => {
    const selected = selectedByProposal[proposal.proposalId] ?? new Set<string>();
    setAcceptingId(proposal.proposalId);
    setError('');
    try {
      const result = await acceptEmailReplyProposal({
        proposalId: proposal.proposalId,
        selectedRowIds: Array.from(selected),
        approvedRestrictedRowIds: Array.from(
          restrictedByProposal[proposal.proposalId] ?? new Set<string>()
        ),
        advisorId,
      });
      if (onAccepted) {
        onAccepted(result);
      }
      if (result.status === 'accepted') {
        setProposals((current) =>
          current.filter((candidate) => candidate.proposalId !== proposal.proposalId)
        );
      } else {
        setError(t('intake.email-reply.partial-error'));
        load();
      }
      setReviewProposalId(null);
    } catch (acceptError: unknown) {
      setError(
        acceptError instanceof Error
          ? acceptError.message
          : t('intake.email-reply.accept-error')
      );
    } finally {
      setAcceptingId(null);
    }
  };

  const acceptFromUi = (proposal: EmailReplyProposalRecord): void => {
    void accept(proposal).catch((acceptError: unknown) => {
      setError(
        acceptError instanceof Error
          ? acceptError.message
          : t('intake.email-reply.accept-error')
      );
    });
  };

  const dismiss = async (proposal: EmailReplyProposalRecord) => {
    setDismissingId(proposal.proposalId);
    setError('');
    try {
      await dismissEmailReplyProposal({
        proposalId: proposal.proposalId,
        advisorId,
      });
      setProposals((current) =>
        current.filter((candidate) => candidate.proposalId !== proposal.proposalId)
      );
      setReviewProposalId(null);
    } catch (dismissError: unknown) {
      setError(
        dismissError instanceof Error
          ? dismissError.message
          : t('intake.email-reply.dismiss-error')
      );
    } finally {
      setDismissingId(null);
    }
  };

  const dismissFromUi = (proposal: EmailReplyProposalRecord): void => {
    void dismiss(proposal).catch((dismissError: unknown) => {
      setError(
        dismissError instanceof Error
          ? dismissError.message
          : t('intake.email-reply.dismiss-error')
      );
    });
  };

  return (
    <section
      data-testid="email-reply-proposal-card"
      style={{
        border: '1px solid var(--kp-warning-line)',
        borderRadius: 8,
        background: 'var(--kp-warning-bg)',
        padding: 14,
        display: 'grid',
        gap: 12,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <Mail aria-hidden size={17} style={{ color: 'var(--kp-warning)' }} />
            <h3
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 800,
                color: 'var(--kp-navy)',
              }}
            >
              {t('intake.email-reply.title')}
            </h3>
            <span
              data-testid="email-reply-non-e2ee-label"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                border: '1px solid var(--kp-warning-line)',
                borderRadius: 999,
                padding: '4px 8px',
                background: 'var(--kp-surface-card)',
                color: 'var(--kp-warning)',
                fontSize: 11,
                fontWeight: 800,
              }}
            >
              <ShieldAlert aria-hidden size={13} />
              {t('intake.email-reply.channel-label')}
            </span>
          </div>
          <p
            style={{
              margin: '6px 0 0',
              color: 'var(--color-muted-foreground)',
              fontSize: 12,
            }}
          >
            {t('intake.email-reply.helper')}
          </p>
        </div>
      </div>

      {error ? (
        <div style={{ color: 'var(--kp-danger)', fontSize: 12 }}>{error}</div>
      ) : null}

      {proposals.map((proposal) => {
        const selectedIds =
          selectedByProposal[proposal.proposalId] ?? defaultSelectedIds(proposal);
        const restrictedIds =
          restrictedByProposal[proposal.proposalId] ?? new Set<string>();
        return (
          <div
            key={proposal.proposalId}
            style={{
              borderTop: '1px solid var(--kp-warning-line)',
              paddingTop: 10,
              display: 'grid',
              gap: 8,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
              }}
            >
              <div style={{ color: 'var(--kp-navy)', fontSize: 13, fontWeight: 800 }}>
                {t('intake.email-reply.source-line', { sender: proposal.sender })}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setReviewProposalId(proposal.proposalId);
                }}
              >
                {t('intake.email-reply.review')}
              </Button>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {proposal.items.map((row) => (
                <EmailReplyProposalRow
                  key={row.id}
                  row={row}
                  checked={selectedIds.has(row.id)}
                  restrictedApproved={restrictedIds.has(row.id)}
                  onToggle={(rowId) => {
                    toggle(proposal.proposalId, rowId);
                  }}
                  onRestrictedApprove={(rowId, approved) => {
                    toggleRestricted(proposal.proposalId, rowId, approved);
                  }}
                />
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button
                type="button"
                variant="outline"
                disabled={
                  acceptingId === proposal.proposalId ||
                  dismissingId === proposal.proposalId
                }
                onClick={() => {
                  dismissFromUi(proposal);
                }}
              >
                {t('intake.email-reply.dismiss')}
              </Button>
              <Button
                type="button"
                disabled={
                  acceptingId === proposal.proposalId ||
                  dismissingId === proposal.proposalId ||
                  selectedIds.size === 0
                }
                onClick={() => {
                  acceptFromUi(proposal);
                }}
              >
                {t('intake.email-reply.accept-selected')}
              </Button>
            </div>
          </div>
        );
      })}

      {reviewProposal ? (
        <EmailReplyReviewModal
          proposal={reviewProposal}
          selectedIds={
            selectedByProposal[reviewProposal.proposalId] ??
            defaultSelectedIds(reviewProposal)
          }
          restrictedApprovedIds={
            restrictedByProposal[reviewProposal.proposalId] ?? new Set<string>()
          }
          onToggle={(rowId) => {
            toggle(reviewProposal.proposalId, rowId);
          }}
          onRestrictedApprove={(rowId, approved) => {
            toggleRestricted(reviewProposal.proposalId, rowId, approved);
          }}
          onAccept={() => {
            acceptFromUi(reviewProposal);
          }}
          onDismiss={() => {
            dismissFromUi(reviewProposal);
          }}
          onClose={() => {
            setReviewProposalId(null);
          }}
          accepting={acceptingId === reviewProposal.proposalId}
          dismissing={dismissingId === reviewProposal.proposalId}
        />
      ) : null}
    </section>
  );
}
