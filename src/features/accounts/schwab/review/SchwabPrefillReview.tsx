import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card } from '@/ui/kp';
import { emitAuditEntry, type AuditWriteEntry } from '@/features/audit';
import {
  schwabAccountTypes,
  buildSchwabProposal,
  type SchwabAccountType,
  type SchwabFieldKey,
  type SchwabProposedField,
} from '../mapping';
import { schwabPrivateFacts } from '../private-facts';
import {
  buildApprovedSchwabPacket,
  findSchwabPacketReceipt,
  saveApprovedSchwabPacket,
  type SchwabPacketReceipt,
} from '../packet';
import type {
  SchwabApprovalResult,
  SchwabRedactedProposalStatus,
  SchwabReviewInput,
} from '../contracts';

type EditableField = SchwabProposedField & { confirmed: boolean };
function withState(fields: readonly SchwabProposedField[]): EditableField[] {
  return fields.map((field) => ({ ...field, confirmed: false }));
}
function auditEntry(
  householdId: string,
  packet: SchwabPacketReceipt,
  fields: readonly EditableField[]
): AuditWriteEntry {
  return {
    action: 'user_action',
    description: 'Approved a local Schwab prep packet.',
    model: undefined,
    inputs: {
      householdId,
      accountType: packet.accountType,
      fieldCount: packet.fieldCount,
      fields: fields.map((field) => ({
        key: field.key,
        source: field.source,
        confirmed: field.confirmed,
        sourceRefs: field.candidates
          .map((candidate) => candidate.sourceRef)
          .filter((sourceRef): sourceRef is string => Boolean(sourceRef)),
      })),
    },
    outputs: {
      packetId: packet.id,
      outputHash: packet.outputHash,
      path: `local:schwab-prep-packets/${packet.id}`,
    },
    userDecision: 'approved',
    metadata: { feature: 'schwab-prefill', packetLabel: packet.label },
  };
}

export function SchwabPrefillReview({ household }: SchwabReviewInput) {
  const { t } = useTranslation();
  const [accountType, setAccountType] =
    useState<SchwabAccountType>('individual');
  const [facts, setFacts] = useState<
    Awaited<ReturnType<typeof schwabPrivateFacts.listMasked>>
  >([]);
  const [fields, setFields] = useState<EditableField[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<SchwabPacketReceipt | undefined>();
  const revealedFacts = useRef(new Map<string, string>());
  const [revealedFactIds, setRevealedFactIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const activeRevealScope = `${household.id}:${accountType}`;
  const revealScope = useRef(activeRevealScope);
  const activeRevealScopeRef = useRef(activeRevealScope);
  const revealSessionActiveRef = useRef(true);
  activeRevealScopeRef.current = activeRevealScope;
  useEffect(() => {
    revealSessionActiveRef.current = true;
    return () => {
      revealSessionActiveRef.current = false;
    };
  }, []);
  useEffect(() => {
    const sessionReveals = revealedFacts.current;
    sessionReveals.clear();
    revealScope.current = activeRevealScope;
    setRevealedFactIds(new Set());
    return () => {
      sessionReveals.clear();
    };
  }, [activeRevealScope]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setFields([]);
    setError(null);
    void schwabPrivateFacts
      .listMasked(household.id)
      .then((next) => {
        if (live) setFacts(next);
      })
      .catch(() => {
        if (live) setError(t('schwabPrefill.loadError'));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [household.id, t]);
  const proposed = useMemo(
    () => buildSchwabProposal(accountType, { household, facts }),
    [accountType, facts, household]
  );
  useEffect(() => {
    setFields(withState(proposed));
    setReceipt(findSchwabPacketReceipt(household.id, accountType));
  }, [accountType, household.id, proposed]);
  const proposalStatus: SchwabRedactedProposalStatus = {
    accountType,
    fieldCount: fields.length,
    unresolvedConflictCount: fields.filter((field) => field.conflict).length,
    ready:
      fields.length > 0 &&
      fields.every(
        (field) =>
          !field.conflict &&
          (field.required
            ? Boolean(field.value.trim()) && field.confirmed
            : !field.value.trim() || field.confirmed)
      ),
  };
  const ready = proposalStatus.ready;
  function update(key: SchwabFieldKey, value: string) {
    setFields((current) =>
      current.map((field) =>
        field.key === key
          ? {
              ...field,
              value,
              source: 'blank',
              conflict: false,
              confirmed: false,
            }
          : field
      )
    );
  }
  function choose(key: SchwabFieldKey, value: string): void {
    const candidate = fields
      .find((field) => field.key === key)
      ?.candidates.find((item) => item.value === value);
    if (!candidate) return;
    setFields((current) =>
      current.map((field) =>
        field.key === key
          ? {
              ...field,
              value: candidate.value,
              source: candidate.source,
              conflict: false,
              confirmed: false,
            }
          : field
      )
    );
  }
  async function reveal(factId: string): Promise<void> {
    const scope = activeRevealScope;
    try {
      const value = await schwabPrivateFacts.reveal(household.id, factId);
      if (
        !revealSessionActiveRef.current ||
        activeRevealScopeRef.current !== scope
      )
        return;
      revealedFacts.current.set(factId, value);
      setRevealedFactIds((current) => new Set(current).add(factId));
    } catch {
      if (
        !revealSessionActiveRef.current ||
        activeRevealScopeRef.current !== scope
      )
        return;
      setError(t('schwabPrefill.revealError'));
    }
  }
  async function approve(): Promise<SchwabApprovalResult | undefined> {
    if (!ready || saving) return undefined;
    setSaving(true);
    setError(null);
    try {
      const values = Object.fromEntries(
        fields.map((field) => [field.key, field.value])
      ) as Record<SchwabFieldKey, string>;
      const prepared = buildApprovedSchwabPacket({
        householdId: household.id,
        accountType,
        values,
      });
      const audit = await emitAuditEntry(
        auditEntry(household.id, prepared.receipt, fields)
      );
      const packet = saveApprovedSchwabPacket(prepared, audit.id);
      setReceipt(packet.receipt);
      return { status: 'approved', receipt: packet.receipt };
    } catch {
      setError(t('schwabPrefill.auditStalled'));
      return { status: 'stalled', receipt: undefined };
    } finally {
      setSaving(false);
    }
  }
  return (
    <section
      data-testid="schwab-prefill-review"
      style={{ display: 'grid', gap: 16, padding: 16 }}
    >
      <div>
        <h2>{t('schwabPrefill.title')}</h2>
        <p>{t('schwabPrefill.description')}</p>
      </div>
      <label>
        {t('schwabPrefill.accountType')}
        <select
          aria-label={t('schwabPrefill.accountType')}
          value={accountType}
          onChange={(event) => {
            revealedFacts.current.clear();
            setRevealedFactIds(new Set());
            setAccountType(event.target.value as SchwabAccountType);
          }}
        >
          {schwabAccountTypes.map((type) => (
            <option key={type} value={type}>
              {t(`schwabPrefill.types.${type}`)}
            </option>
          ))}
        </select>
      </label>
      {loading ? (
        <p>{t('schwabPrefill.loading')}</p>
      ) : (
        <Card variant="raised" style={{ padding: 16 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'minmax(140px, 1fr) minmax(180px, 1fr) minmax(90px, auto)',
              gap: 10,
            }}
          >
            <strong>{t('schwabPrefill.existing')}</strong>
            <strong>{t('schwabPrefill.application')}</strong>
            <strong>{t('schwabPrefill.confirm')}</strong>
            {fields.map((field) => {
              const privateCandidate = field.secret
                ? field.candidates.find(
                    (candidate) =>
                      candidate.value === field.value && candidate.sourceRef
                  )
                : undefined;
              const privateFactId = privateCandidate?.sourceRef;
              const revealedValue =
                privateFactId &&
                revealScope.current === activeRevealScope &&
                revealedFactIds.has(privateFactId)
                  ? revealedFacts.current.get(privateFactId)
                  : undefined;
              return (
                <div key={field.key} style={{ display: 'contents' }}>
                  <div>
                    <strong>{t(`schwabPrefill.fields.${field.label}`)}</strong>
                    <p>
                      {field.candidates
                        .map((candidate) => candidate.value)
                        .join(' / ') || t('schwabPrefill.none')}
                    </p>
                    {field.conflict ? (
                      <>
                        <p role="alert">{t('schwabPrefill.conflict')}</p>
                        <select
                          aria-label={`${t('schwabPrefill.chooseSource')} ${t(`schwabPrefill.fields.${field.label}`)}`}
                          defaultValue=""
                          onChange={(event) => {
                            choose(field.key, event.target.value);
                          }}
                        >
                          <option value="" disabled>
                            {t('schwabPrefill.chooseSource')}
                          </option>
                          {field.candidates.map((candidate) => (
                            <option
                              key={`${candidate.source}-${candidate.value}`}
                              value={candidate.value}
                            >
                              {candidate.value}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : null}
                    {privateFactId ? (
                      <div>
                        <Button
                          size="sm"
                          onClick={() => {
                            void reveal(privateFactId).catch(() => {
                              setError(t('schwabPrefill.revealError'));
                            });
                          }}
                        >
                          {t('schwabPrefill.reveal')}
                        </Button>
                        {revealedValue ? (
                          <output
                            data-testid={`schwab-prefill-revealed-${field.key}`}
                          >
                            {revealedValue}
                          </output>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <input
                    aria-label={t(`schwabPrefill.fields.${field.label}`)}
                    value={field.value}
                    onChange={(event) => {
                      update(field.key, event.target.value);
                    }}
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={field.confirmed}
                      disabled={field.conflict || !field.value.trim()}
                      onChange={(event) => {
                        setFields((current) =>
                          current.map((item) =>
                            item.key === field.key
                              ? { ...item, confirmed: event.target.checked }
                              : item
                          )
                        );
                      }}
                    />
                    {t('schwabPrefill.confirm')}
                  </label>
                </div>
              );
            })}
          </div>
        </Card>
      )}
      {error ? <p role="alert">{error}</p> : null}
      {receipt ? (
        <p data-testid="schwab-prefill-receipt">{t('schwabPrefill.saved')}</p>
      ) : (
        <Button
          disabled={!ready || saving}
          onClick={() => {
            void approve().catch(() => {
              setError(t('schwabPrefill.auditStalled'));
            });
          }}
        >
          {saving ? t('schwabPrefill.saving') : t('schwabPrefill.approve')}
        </Button>
      )}
    </section>
  );
}
