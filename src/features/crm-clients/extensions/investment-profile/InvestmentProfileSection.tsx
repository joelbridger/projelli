import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card } from '@/ui/kp';
import { useFlag } from '@/platform/flags';
import type { HouseholdRecordShellContext } from '../../recordRegistry';
import {
  INVESTMENT_OBJECTIVES,
  RISK_TOLERANCES,
  TIME_HORIZONS,
  type InvestmentProfile,
} from './investmentProfile';
import { readInvestmentProfile, withInvestmentProfile } from './persistence';

export function InvestmentProfileSection({
  household,
  onSaveHousehold,
}: Pick<HouseholdRecordShellContext, 'household' | 'onSaveHousehold'>) {
  const enabled = useFlag('record-investment-profile');
  const { t } = useTranslation();
  const persistedProfile = useMemo(
    () => readInvestmentProfile(household),
    [household]
  );
  const persistedSignature = JSON.stringify(persistedProfile);
  const [draft, setDraft] = useState<InvestmentProfile>(persistedProfile);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [hasConflict, setHasConflict] = useState(false);
  const dirtyRef = useRef(false);
  const baselineSignatureRef = useRef(persistedSignature);

  useEffect(() => {
    if (persistedSignature === baselineSignatureRef.current) return;
    if (dirtyRef.current) {
      setHasConflict(true);
      return;
    }
    setDraft(persistedProfile);
    baselineSignatureRef.current = persistedSignature;
    setHasConflict(false);
    setSaveError(false);
  }, [persistedProfile, persistedSignature]);

  if (!enabled) return null;

  const setField = <Field extends keyof InvestmentProfile>(
    field: Field,
    value: InvestmentProfile[Field]
  ) => {
    dirtyRef.current = true;
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const useLatestProfile = () => {
    setDraft(persistedProfile);
    baselineSignatureRef.current = persistedSignature;
    dirtyRef.current = false;
    setHasConflict(false);
    setSaveError(false);
  };

  return (
    <Card
      variant="raised"
      data-testid="investment-profile-section"
      style={{ display: 'grid', gap: 16, marginTop: 16 }}
    >
      <div>
        <h2 style={{ margin: 0 }}>{t('investmentProfile.title')}</h2>
        <p style={{ margin: '4px 0 0', color: 'var(--color-slate-500)' }}>
          {t('investmentProfile.helper')}
        </p>
      </div>
      <form
        style={{
          display: 'grid',
          gap: 12,
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
        }}
        onSubmit={(event) => {
          event.preventDefault();
          if (hasConflict) return;
          void (async () => {
            setSaveError(false);
            setSaving(true);
            try {
              if (!onSaveHousehold) {
                throw new Error(
                  'Investment profile persistence is unavailable.'
                );
              }
              const nextHousehold = withInvestmentProfile(household, draft);
              const savedProfile = readInvestmentProfile(nextHousehold);
              // Mark this exact profile as our own pending save before the
              // parent can synchronously publish it back to us.
              baselineSignatureRef.current = JSON.stringify(savedProfile);
              await onSaveHousehold(nextHousehold);
              dirtyRef.current = false;
              setHasConflict(false);
              setDraft(savedProfile);
            } finally {
              setSaving(false);
            }
          })().catch(() => {
            setSaveError(true);
          });
        }}
      >
        <ProfileSelect
          id="investment-objective"
          label={t('investmentProfile.fields.objective')}
          value={draft.investmentObjective}
          onChange={(value) => {
            setField('investmentObjective', value);
          }}
          emptyLabel={t('investmentProfile.notSet')}
          options={INVESTMENT_OBJECTIVES.map((value) => ({
            value,
            label: t(`investmentProfile.objectives.${value}`),
          }))}
        />
        <ProfileSelect
          id="risk-tolerance"
          label={t('investmentProfile.fields.riskTolerance')}
          value={draft.riskTolerance}
          onChange={(value) => {
            setField('riskTolerance', value);
          }}
          emptyLabel={t('investmentProfile.notSet')}
          options={RISK_TOLERANCES.map((value) => ({
            value,
            label: t(`investmentProfile.risk.${value}`),
          }))}
        />
        <ProfileSelect
          id="time-horizon"
          label={t('investmentProfile.fields.timeHorizon')}
          value={draft.timeHorizon}
          onChange={(value) => {
            setField('timeHorizon', value);
          }}
          emptyLabel={t('investmentProfile.notSet')}
          options={TIME_HORIZONS.map((value) => ({
            value,
            label: t(`investmentProfile.horizons.${value}`),
          }))}
        />
        <label htmlFor="liquidity-need" style={{ display: 'grid', gap: 6 }}>
          <span>{t('investmentProfile.fields.liquidityNeed')}</span>
          <input
            id="liquidity-need"
            value={draft.liquidityNeed}
            maxLength={280}
            placeholder={t('investmentProfile.liquidityPlaceholder')}
            onChange={(event) => {
              setField('liquidityNeed', event.target.value);
            }}
          />
        </label>
        <div style={{ gridColumn: '1 / -1' }}>
          <Button
            type="submit"
            size="sm"
            loading={saving}
            data-testid="investment-profile-save"
          >
            {t('investmentProfile.save')}
          </Button>
          {saveError ? (
            <p role="alert">{t('investmentProfile.saveError')}</p>
          ) : null}
          {hasConflict ? (
            <div role="alert" style={{ marginTop: 8 }}>
              <p>{t('investmentProfile.conflict')}</p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={useLatestProfile}
                data-testid="investment-profile-use-latest"
              >
                {t('investmentProfile.useLatest')}
              </Button>
            </div>
          ) : null}
        </div>
      </form>
    </Card>
  );
}

function ProfileSelect<Value extends string>({
  id,
  label,
  value,
  onChange,
  emptyLabel,
  options,
}: {
  id: string;
  label: string;
  value: Value | '';
  onChange: (value: Value | '') => void;
  emptyLabel: string;
  options: readonly { value: Value; label: string }[];
}) {
  return (
    <label htmlFor={id} style={{ display: 'grid', gap: 6 }}>
      <span>{label}</span>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value as Value | '');
        }}
      >
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
