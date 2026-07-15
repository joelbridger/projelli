/** Employment data belongs to this feature's namespaced household extension. */
export const EMPLOYMENT_EXTENSION_KEY = 'crm.employment' as const;

export interface EmploymentMemberInformation {
  occupation: string;
  employer: string;
  occupationStart?: string;
  plannedRetirement?: string;
  reducedScheduleContext?: string;
}

export interface EmploymentInformation {
  version: 1;
  members: Readonly<Record<string, EmploymentMemberInformation>>;
  householdGrossAnnualIncome?: number;
}

export const EMPTY_EMPLOYMENT_INFORMATION: EmploymentInformation = {
  version: 1,
  members: {},
};

function isOptionalText(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isEmploymentMemberInformation(
  value: unknown
): value is EmploymentMemberInformation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const member = value as Record<string, unknown>;
  return (
    typeof member.occupation === 'string' &&
    typeof member.employer === 'string' &&
    isOptionalText(member.occupationStart) &&
    isOptionalText(member.plannedRetirement) &&
    isOptionalText(member.reducedScheduleContext)
  );
}

/** Validates persisted JSON before it reaches the editable record surface. */
export function isEmploymentInformation(
  value: unknown
): value is EmploymentInformation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) return false;
  if (
    !candidate.members ||
    typeof candidate.members !== 'object' ||
    Array.isArray(candidate.members)
  )
    return false;
  if (
    candidate.householdGrossAnnualIncome !== undefined &&
    (typeof candidate.householdGrossAnnualIncome !== 'number' ||
      !Number.isFinite(candidate.householdGrossAnnualIncome) ||
      candidate.householdGrossAnnualIncome < 0)
  )
    return false;

  return Object.entries(candidate.members as Record<string, unknown>).every(
    ([memberId, member]) =>
      memberId.length > 0 && isEmploymentMemberInformation(member)
  );
}
