import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card } from '@/ui/kp';
import { useFlag } from '@/platform/flags';
import type { HouseholdRecord } from '../../adapters';
import {
  EMPTY_EMPLOYMENT_INFORMATION,
  type EmploymentInformation,
  type EmploymentMemberInformation,
} from './types';
import {
  persistEmploymentInformation,
  readEmploymentInformation,
} from './persistence';

interface EmploymentSectionProps {
  household: HouseholdRecord;
  onSaveHousehold?: (household: HouseholdRecord) => Promise<void> | void;
  /** Test-only override; production visibility always uses the feature flag. */
  enabled?: boolean;
}

const emptyMemberInformation: EmploymentMemberInformation = {
  occupation: '',
  employer: '',
};

function memberInformation(
  information: EmploymentInformation,
  memberId: string
): EmploymentMemberInformation {
  return information.members[memberId] ?? emptyMemberInformation;
}

function formatIncome(
  amount: number | undefined,
  locale: string
): string | undefined {
  if (amount === undefined) return undefined;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function EmploymentSection({
  household,
  onSaveHousehold,
  enabled,
}: EmploymentSectionProps) {
  const { t, i18n } = useTranslation();
  const flagEnabled = useFlag('record-employment');
  const visible = enabled ?? flagEnabled;
  const [editing, setEditing] = useState(false);
  const [information, setInformation] = useState(() =>
    readEmploymentInformation(household)
  );
  const firstMemberId = household.members[0]?.id ?? '';
  const [selectedMemberId, setSelectedMemberId] = useState(firstMemberId);

  useEffect(() => {
    setInformation(readEmploymentInformation(household));
    setSelectedMemberId((current) =>
      household.members.some((member) => member.id === current)
        ? current
        : (household.members[0]?.id ?? '')
    );
  }, [household]);

  if (!visible) return null;

  const selectedInformation = selectedMemberId
    ? memberInformation(information, selectedMemberId)
    : emptyMemberInformation;
  const income = formatIncome(
    information.householdGrossAnnualIncome,
    i18n.language
  );

  const updateMember = (
    field: keyof EmploymentMemberInformation,
    value: string
  ) => {
    if (!selectedMemberId) return;
    setInformation((current) => ({
      ...current,
      members: {
        ...current.members,
        [selectedMemberId]: {
          ...memberInformation(current, selectedMemberId),
          [field]: value,
        },
      },
    }));
  };

  const save = async () => {
    const payload = persistEmploymentInformation(household, information);
    await onSaveHousehold?.(payload);
    setEditing(false);
  };

  return (
    <Card
      variant="raised"
      data-testid="crm-employment-section"
      style={{ display: 'grid', gap: 16, marginTop: 14 }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: 18 }}>{t('employment.title')}</h2>
          <p
            style={{
              margin: '4px 0 0',
              color: 'var(--color-muted-foreground)',
            }}
          >
            {t('employment.helper')}
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setEditing((current) => !current)}
          data-testid="crm-employment-edit"
        >
          {editing ? t('employment.close-edit') : t('employment.edit')}
        </Button>
      </div>

      {household.members.length === 0 ? (
        <p data-testid="crm-employment-no-members">
          {t('employment.no-members')}
        </p>
      ) : (
        <>
          <label style={{ display: 'grid', gap: 4, maxWidth: 320 }}>
            <span>{t('employment.member-label')}</span>
            <select
              value={selectedMemberId}
              onChange={(event) => setSelectedMemberId(event.target.value)}
              data-testid="crm-employment-member"
              disabled={!editing}
            >
              {household.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>

          {editing ? (
            <div style={{ display: 'grid', gap: 12 }}>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>{t('employment.occupation-label')}</span>
                <input
                  value={selectedInformation.occupation}
                  onChange={(event) =>
                    updateMember('occupation', event.target.value)
                  }
                  data-testid="crm-employment-occupation"
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>{t('employment.employer-label')}</span>
                <input
                  value={selectedInformation.employer}
                  onChange={(event) =>
                    updateMember('employer', event.target.value)
                  }
                  data-testid="crm-employment-employer"
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>{t('employment.occupation-start-label')}</span>
                <input
                  type="date"
                  value={selectedInformation.occupationStart ?? ''}
                  onChange={(event) =>
                    updateMember('occupationStart', event.target.value)
                  }
                  data-testid="crm-employment-start"
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>{t('employment.planned-retirement-label')}</span>
                <input
                  type="date"
                  value={selectedInformation.plannedRetirement ?? ''}
                  onChange={(event) =>
                    updateMember('plannedRetirement', event.target.value)
                  }
                  data-testid="crm-employment-retirement"
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>{t('employment.reduced-schedule-label')}</span>
                <input
                  value={selectedInformation.reducedScheduleContext ?? ''}
                  onChange={(event) =>
                    updateMember('reducedScheduleContext', event.target.value)
                  }
                  data-testid="crm-employment-reduced-schedule"
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>{t('employment.gross-income-label')}</span>
                <input
                  type="number"
                  min="0"
                  value={information.householdGrossAnnualIncome ?? ''}
                  onChange={(event) => {
                    const next = event.target.value;
                    setInformation((current) => {
                      const nextInformation = { ...current };
                      if (next === '') {
                        delete nextInformation.householdGrossAnnualIncome;
                      } else {
                        nextInformation.householdGrossAnnualIncome =
                          Number(next);
                      }
                      return nextInformation;
                    });
                  }}
                  data-testid="crm-employment-income"
                />
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  size="sm"
                  onClick={() => void save()}
                  data-testid="crm-employment-save"
                >
                  {t('employment.save')}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setInformation(readEmploymentInformation(household));
                    setEditing(false);
                  }}
                >
                  {t('employment.cancel')}
                </Button>
              </div>
            </div>
          ) : (
            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(140px, auto) 1fr',
                gap: '8px 16px',
                margin: 0,
              }}
            >
              <dt>{t('employment.occupation-label')}</dt>
              <dd
                style={{ margin: 0 }}
                data-testid="crm-employment-occupation-value"
              >
                {selectedInformation.occupation || t('employment.not-set')}
              </dd>
              <dt>{t('employment.employer-label')}</dt>
              <dd style={{ margin: 0 }}>
                {selectedInformation.employer || t('employment.not-set')}
              </dd>
              <dt>{t('employment.occupation-start-label')}</dt>
              <dd style={{ margin: 0 }}>
                {selectedInformation.occupationStart || t('employment.not-set')}
              </dd>
              <dt>{t('employment.planned-retirement-label')}</dt>
              <dd style={{ margin: 0 }}>
                {selectedInformation.plannedRetirement ||
                  t('employment.not-set')}
                {selectedInformation.reducedScheduleContext
                  ? ` · ${selectedInformation.reducedScheduleContext}`
                  : ''}
              </dd>
              <dt>{t('employment.gross-income-label')}</dt>
              <dd
                style={{ margin: 0 }}
                data-testid="crm-employment-income-value"
              >
                {income ?? t('employment.not-set')}
              </dd>
            </dl>
          )}
        </>
      )}
    </Card>
  );
}

/** Keeps the local-state fallback explicit when a record has no extension yet. */
export const employmentEmptyInformation = EMPTY_EMPLOYMENT_INFORMATION;
