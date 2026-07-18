import { useMemo, useState } from 'react';
import { Button, Card } from '@/ui/kp';
import type { DirectoryContext } from '@/features/crm-clients';
import { crmDuplicatesCopy } from './copy';
import {
  findLikelyDuplicateHouseholds,
  type DuplicateHouseholdMatch,
} from './duplicateDetection';

function MatchReview({
  match,
  context,
}: {
  match: DuplicateHouseholdMatch;
  context: DirectoryContext;
}) {
  return (
    <Card
      data-testid={`crm-duplicates-match-${match.normalizedName}`}
      variant="raised"
    >
      <p>{crmDuplicatesCopy.explanation}</p>
      <ul>
        {match.records.map((record) => (
          <li key={record.id}>
            <strong>{record.name}</strong>
            <Button
              size="sm"
              variant="secondary"
              data-testid={`crm-duplicates-open-${record.id}`}
              onClick={() => {
                context.legacyRepository.openHousehold(record.id);
              }}
            >
              {crmDuplicatesCopy.openRecord}
            </Button>
          </li>
        ))}
      </ul>
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
  const [isReviewOpen, setReviewOpen] = useState(false);
  const matches = useMemo(
    () => findLikelyDuplicateHouseholds(context.records.households),
    [context.records.households]
  );

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
          aria-label="Duplicate household review"
        >
          <p data-testid="crm-duplicates-count">
            {crmDuplicatesCopy.resultCount(matches.length)}
          </p>
          {matches.length === 0 ? (
            <p>{crmDuplicatesCopy.noMatches}</p>
          ) : (
            matches.map((match) => (
              <MatchReview
                key={`${match.normalizedName}:${match.records.map((record) => record.id).join(':')}`}
                match={match}
                context={context}
              />
            ))
          )}
        </section>
      ) : null}
    </div>
  );
}
