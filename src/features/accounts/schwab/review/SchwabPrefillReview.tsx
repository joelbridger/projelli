import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card } from '@/ui/kp';
import { emitAuditEntry, type AuditWriteEntry } from '@/features/audit';
import {
  schwabAccountTypes,
  buildSchwabProposal,
  type SchwabAccountType,
  type SchwabFieldKey,
  type SchwabHousehold,
  type SchwabProposedField,
} from '../mapping';
import { schwabPrivateFacts } from '../private-facts';
import {
  findSchwabPacketReceipt,
  saveApprovedSchwabPacket,
  type SchwabPacketReceipt,
} from '../packet';

type EditableField = SchwabProposedField & { confirmed: boolean };
function withState(fields: readonly SchwabProposedField[]): EditableField[] {
  return fields.map((field) => ({ ...field, confirmed: false }));
}
function auditEntry(
  householdId: string,
  packet: SchwabPacketReceipt
): AuditWriteEntry {
  return {
    action: 'user_action',
    description: 'Approved a local Schwab prep packet.',
    model: undefined,
    inputs: {
      householdId,
      accountType: packet.accountType,
      fieldCount: packet.fieldCount,
    },
    outputs: { packetId: packet.id, outputHash: packet.outputHash },
    userDecision: 'approved',
    metadata: { feature: 'schwab-prefill', packetLabel: packet.label },
  };
}

export function SchwabPrefillReview({
  household,
}: {
  household: SchwabHousehold;
}) {
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
    setReceipt(findSchwabPacketReceipt(household.id));
  }, [household.id, proposed]);
  const ready =
    fields.length > 0 &&
    fields.every(
      (field) =>
        (!field.required || field.value.trim()) &&
        !field.conflict &&
        field.confirmed
    );
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
  async function approve() {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    try {
      const values = Object.fromEntries(
        fields.map((field) => [field.key, field.value])
      ) as Record<SchwabFieldKey, string>;
      const pendingReceipt = {
        id: 'pending',
        householdId: household.id,
        accountType,
        approvedAt: '',
        fieldCount: fields.length,
        outputHash: 'pending',
        auditEntryId: '',
        label: 'Schwab prep packet' as const,
      };
      const audit = await emitAuditEntry(
        auditEntry(household.id, pendingReceipt)
      );
      const packet = saveApprovedSchwabPacket({
        householdId: household.id,
        accountType,
        values,
        auditEntryId: audit.id,
      });
      setReceipt(packet.receipt);
    } catch {
      setError(t('schwabPrefill.auditStalled'));
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
            {fields.map((field) => (
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
            ))}
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
