import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card } from '@/ui/kp';
import type { HouseholdRecordShellContext } from '../../recordRegistry';
import {
  COMPLIANCE_DATES_DATA_KEY,
  persistComplianceDates,
} from './persistence';
import {
  COMPLIANCE_DATE_FIELDS,
  type ComplianceDateField,
} from './types';
import { readComplianceDates, validateComplianceDates } from './validation';

const fieldTranslationKeys: Record<ComplianceDateField, string> = {
  advisoryAgreementSignedOn: 'advisory-agreement',
  investmentPolicyStatementUpdatedOn: 'investment-policy-statement',
  formAdvDeliveredOn: 'form-adv-delivered',
  formCrsDeliveredOn: 'form-crs-delivered',
  privacyNoticeDeliveredOn: 'privacy-notice',
  financialPlanningAgreementRenewedOn: 'financial-planning-agreement',
};

function dateForInput(value: string | null): string {
  return value ?? '';
}

function displayDate(value: string | null, locale: string): string | null {
  if (!value) return null;
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}

function displayComplianceDate(
  value: string | null,
  field: ComplianceDateField,
  locale: string,
  t: (key: string, options: { date: string }) => string
): string | null {
  const date = displayDate(value, locale);
  return date ? t(`complianceDates.statuses.${field}`, { date }) : null;
}

/** Flag-gated Details section for dated written-agreement evidence. */
export function WrittenAgreementsSection({
  household,
  onSaveHousehold,
}: Pick<HouseholdRecordShellContext, 'household' | 'onSaveHousehold'>) {
  const { i18n, t } = useTranslation();
  const saved = readComplianceDates(
    household.extensionData?.[COMPLIANCE_DATES_DATA_KEY]
  );
  const [draft, setDraft] = useState(saved);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (field: ComplianceDateField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value || null }));
    setError(null);
  };

  const save = async () => {
    const result = validateComplianceDates(draft);
    if (!result.valid) {
      setError(t('complianceDates.validation.invalid-date'));
      return;
    }
    if (!onSaveHousehold) return;
    await onSaveHousehold(persistComplianceDates(household, result.value));
    setEditing(false);
  };

  const handleSave = () => {
    void save().catch(() => {
      setError(t('complianceDates.saveFailed'));
    });
  };

  return (
    <Card
      variant="raised"
      data-testid="compliance-dates-written-agreements"
      style={{ marginTop: 14 }}
    >
      <div
        style={{
          display: 'flex',
          gap: 12,
          justifyContent: 'space-between',
          alignItems: 'start',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <strong>{t('complianceDates.title')}</strong>
          <p
            style={{
              margin: '4px 0 0',
              color: 'var(--color-muted-foreground)',
            }}
          >
            {t('complianceDates.helper')}
          </p>
        </div>
        {editing ? null : (
          <Button
            size="sm"
            variant="secondary"
            data-testid="compliance-dates-edit"
            onClick={() => {
              setEditing(true);
            }}
          >
            {t('complianceDates.edit')}
          </Button>
        )}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
          marginTop: 16,
        }}
      >
        {COMPLIANCE_DATE_FIELDS.map((field) => {
          const label = t(
            `complianceDates.fields.${fieldTranslationKeys[field]}`
          );
          return editing ? (
            <label
              key={field}
              style={{ display: 'grid', gap: 5, fontSize: 13 }}
            >
              <span>{label}</span>
              <input
                type="text"
                placeholder="YYYY-MM-DD"
                value={dateForInput(draft[field])}
                data-testid={`compliance-dates-input-${field}`}
                onChange={(event) => {
                  update(field, event.target.value);
                }}
              />
            </label>
          ) : (
            <div key={field} data-testid={`compliance-dates-row-${field}`}>
              <small style={{ color: 'var(--color-muted-foreground)' }}>
                {label}
              </small>
              <strong style={{ display: 'block', marginTop: 3 }}>
                {displayComplianceDate(draft[field], field, i18n.language, t) ??
                  t('complianceDates.missing')}
              </strong>
            </div>
          );
        })}
      </div>
      {editing ? (
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            marginTop: 16,
            flexWrap: 'wrap',
          }}
        >
          <Button
            size="sm"
            data-testid="compliance-dates-save"
            onClick={handleSave}
          >
            {t('complianceDates.save')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setDraft(saved);
              setError(null);
              setEditing(false);
            }}
          >
            {t('complianceDates.cancel')}
          </Button>
          {error ? <span role="alert">{error}</span> : null}
        </div>
      ) : null}
    </Card>
  );
}
