import { useMemo, useState } from 'react';
import { Button, Card } from '@/ui/kp';
import type { DirectoryContext } from '@/features/crm-clients';
import {
  useContactRecordStore,
  type ContactRef,
} from '@/features/crm-contacts';
import { crmDuplicatesCopy } from './copy';
import {
  findLikelyDuplicateContacts,
  type DuplicateContactMatch,
} from './duplicateDetection';
import {
  duplicateMatchKey,
  duplicateReviewPreferences,
  readDuplicateReviewState,
  type DuplicateReviewDisposition,
  type DuplicateReviewState,
} from './reviewState';

function explanationFor(match: DuplicateContactMatch): string {
  return match.explanation === 'same-normalized-contact-name'
    ? crmDuplicatesCopy.sameNormalizedNameExplanation
    : crmDuplicatesCopy.knownAliasExplanation;
}

function MatchReview({
  match,
  disposition,
  onDisposition,
  onOpen,
  onOpenError,
}: {
  match: DuplicateContactMatch;
  disposition: DuplicateReviewDisposition | undefined;
  onDisposition: (disposition: DuplicateReviewDisposition) => void;
  onOpen: (ref: ContactRef) => Promise<void>;
  onOpenError: () => void;
}) {
  return (
    <Card
      data-testid={`crm-duplicates-match-${match.normalizedName}`}
      variant="raised"
    >
      <p>{explanationFor(match)}</p>
      <ul>
        {match.records.map((record) => (
          <li key={record.id}>
            <strong>{record.name}</strong>
            <Button
              size="sm"
              variant="secondary"
              data-testid={`crm-duplicates-open-${record.id}`}
              onClick={() => {
                void onOpen(record.ref).catch(onOpenError);
              }}
            >
              {crmDuplicatesCopy.openRecord}
            </Button>
          </li>
        ))}
      </ul>
      {disposition ? (
        <p
          data-testid={`crm-duplicates-disposition-${duplicateMatchKey(match)}`}
        >
          {disposition === 'reviewed'
            ? crmDuplicatesCopy.reviewed
            : crmDuplicatesCopy.dismissed}
        </p>
      ) : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button
          size="sm"
          variant="secondary"
          data-testid={`crm-duplicates-review-${duplicateMatchKey(match)}`}
          onClick={() => {
            onDisposition('reviewed');
          }}
        >
          {crmDuplicatesCopy.markReviewed}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          data-testid={`crm-duplicates-dismiss-${duplicateMatchKey(match)}`}
          onClick={() => {
            onDisposition('dismissed');
          }}
        >
          {crmDuplicatesCopy.dismiss}
        </Button>
      </div>
      <p>{crmDuplicatesCopy.reviewOnly}</p>
    </Card>
  );
}

/** Enabled-only child: it receives the directory's existing read projection and never loads or writes records. */
export function CrmDuplicatesDirectoryTool({
  context,
}: {
  context: DirectoryContext;
}) {
  const contactStore = useContactRecordStore();
  const [isReviewOpen, setReviewOpen] = useState(false);
  const [reviewState, setReviewState] = useState<DuplicateReviewState>(
    readDuplicateReviewState
  );
  const [openError, setOpenError] = useState(false);
  const matches = useMemo(
    () => findLikelyDuplicateContacts(contactStore.listDirectory()),
    [contactStore]
  );
  const openContact = async (ref: ContactRef) => {
    const screen = await contactStore.resolve(ref);
    if (!screen) throw new Error('Contact record is unavailable.');
    context.legacyRepository.openHousehold(screen.ref.matterId);
  };
  const saveDisposition = (
    match: DuplicateContactMatch,
    disposition: DuplicateReviewDisposition
  ) => {
    const next = { ...reviewState, [duplicateMatchKey(match)]: disposition };
    duplicateReviewPreferences.save(next);
    setReviewState(next);
  };

  return (
    <div data-testid="crm-directory-duplicates">
      <Button
        size="sm"
        variant="secondary"
        data-testid="crm-directory-duplicates-toggle"
        onClick={() => {
          setReviewOpen((open) => !open);
        }}
      >
        {crmDuplicatesCopy.button}
      </Button>
      {isReviewOpen ? (
        <section
          data-testid="crm-duplicates-review"
          aria-label="Duplicate contact review"
        >
          <p data-testid="crm-duplicates-count">
            {crmDuplicatesCopy.resultCount(matches.length)}
          </p>
          {openError ? <p role="alert">{crmDuplicatesCopy.openError}</p> : null}
          {matches.length === 0 ? (
            <p>{crmDuplicatesCopy.noMatches}</p>
          ) : (
            matches.map((match) => (
              <MatchReview
                key={`${match.normalizedName}:${match.records.map((record) => record.id).join(':')}`}
                match={match}
                disposition={reviewState[duplicateMatchKey(match)]}
                onDisposition={(disposition) => {
                  saveDisposition(match, disposition);
                }}
                onOpen={openContact}
                onOpenError={() => {
                  setOpenError(true);
                }}
              />
            ))
          )}
        </section>
      ) : null}
    </div>
  );
}
