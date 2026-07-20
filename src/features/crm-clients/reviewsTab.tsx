/* eslint-disable lantern-i18n/no-hardcoded-string, react-refresh/only-export-components -- CRM tab descriptors and their frozen copy live together with the other registry surfaces. */
import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { FileUp, ListChecks } from 'lucide-react';
import { AcatsReviewScreen } from '@/features/acats/AcatsReviewScreen';
import { useAcatsReviewStore } from '@/features/acats/acatsReviewStore';
import { ExternalWriteReviewCard } from '@/features/planning/ExternalWriteReviewCard';
import { useExternalWriteQueueStore } from '@/platform/state/externalWriteQueueStore';
import { Button, Card } from '@/ui/kp';
import type { HouseholdTabDescriptor, HouseholdTabSurfaceProps } from './tabRegistry';
import { BRAND } from '@/config/brand';

function ClientReviewsTab({ household }: HouseholdTabSurfaceProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isReadingStatement, setIsReadingStatement] = useState(false);
  const [statementError, setStatementError] = useState<string | null>(null);
  const draft = useAcatsReviewStore((state) => state.draft);
  const setDraft = useAcatsReviewStore((state) => state.setDraft);
  const externalWrites = useExternalWriteQueueStore((state) => state.items);
  const householdDraft = draft?.matterId === household.id ? draft : null;
  const householdWriteCount = useMemo(
    () => externalWrites.filter((item) => item.data.matterId === household.id).length,
    [externalWrites, household.id],
  );

  async function readStatement(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    setStatementError(null);
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setStatementError('Choose a PDF account statement.');
      input.value = '';
      return;
    }

    setIsReadingStatement(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { extractAcatsDraftFromPdfBytes } = await import('@/features/acats/extraction');
      const nextDraft = await extractAcatsDraftFromPdfBytes(bytes, {
        matterId: household.id,
        sourcePath: file.name,
      });
      setDraft(nextDraft);
    } catch (error) {
      console.warn('[ClientReviewsTab] Could not read the account statement:', error);
      setStatementError(`${BRAND.name} could not read that statement. Try another PDF.`);
    } finally {
      setIsReadingStatement(false);
      input.value = '';
    }
  }

  return (
    <section
      data-testid="client-reviews-tab"
      style={{ display: 'grid', gap: 16, padding: 16 }}
    >
      <div>
        <h2 style={{ margin: 0, color: 'var(--kp-navy)', fontSize: 20 }}>Reviews</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--color-muted-foreground)', fontSize: 13 }}>
          Check account transfers and outside-app updates for {household.name} before anything is approved.
        </p>
      </div>

      {householdDraft ? (
        <AcatsReviewScreen draft={householdDraft} />
      ) : (
        <Card variant="raised" style={{ padding: 16 }} data-testid="acats-review-entry">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--kp-navy)', fontWeight: 750 }}>
                <FileUp size={17} aria-hidden />
                Start an account transfer
              </div>
              <p style={{ margin: '5px 0 0', color: 'var(--color-muted-foreground)', fontSize: 13 }}>
                {`
                Choose the delivering firm’s PDF statement. ${BRAND.name} will pull out the facts for your review.
              `}</p>
            </div>
            <Button
              size="sm"
              disabled={isReadingStatement}
              onClick={() => inputRef.current?.click()}
              data-testid="acats-choose-statement"
            >
              {isReadingStatement ? 'Reading statement…' : 'Choose statement'}
            </Button>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            data-testid="acats-statement-input"
            style={{ display: 'none' }}
            onChange={(event) => {
              readStatement(event).catch((error: unknown) => {
                console.warn('[ClientReviewsTab] Statement reader failed unexpectedly:', error);
                setIsReadingStatement(false);
                setStatementError(`${BRAND.name} could not read that statement. Try another PDF.`);
              });
            }}
          />
          {statementError ? <p role="alert" style={{ margin: '10px 0 0', color: 'var(--color-destructive)', fontSize: 13 }}>{statementError}</p> : null}
        </Card>
      )}

      <section data-testid="external-write-review-entry">
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8, color: 'var(--kp-navy)', fontWeight: 750 }}>
          <ListChecks size={17} aria-hidden />
          RightCapital and Holistiplan approvals
        </div>
        {householdWriteCount > 0 ? (
          <ExternalWriteReviewCard matterId={household.id} />
        ) : (
          <Card variant="raised" style={{ padding: 16, color: 'var(--color-muted-foreground)', fontSize: 13 }}>
            No outside-app updates are waiting for review for this client.
          </Card>
        )}
      </section>
    </section>
  );
}

export const reviewsTab: HouseholdTabDescriptor = {
  id: 'reviews',
  label: 'Reviews',
  icon: ListChecks,
  route: 'reviews',
  Component: ClientReviewsTab,
};
