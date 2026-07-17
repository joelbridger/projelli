import type { HouseholdRecordShellSectionDescriptor } from '../../recordRegistry';
import { EmploymentSection } from './EmploymentSection';
import { readEmploymentInformation } from './persistence';

function employmentSectionKey(
  household: Parameters<HouseholdRecordShellSectionDescriptor['mount']>[0]['household']
): string {
  const information = readEmploymentInformation(household);
  const memberInformation = Object.entries(information.members)
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
    .map(([memberId, member]) => [
      memberId,
      member.occupation,
      member.employer,
      member.occupationStart,
      member.plannedRetirement,
      member.reducedScheduleContext,
    ]);

  return JSON.stringify([
    household.id,
    household.members.map((member) => member.id),
    information.householdGrossAnnualIncome,
    memberInformation,
  ]);
}

/** Ordered after Professional contacts (10) and before the remaining profile sections. */
export const employmentHouseholdSection: HouseholdRecordShellSectionDescriptor = {
  id: 'employment',
  order: 20,
  tab: 'client_map',
  mount: ({ household, onSaveHousehold }) => (
    <EmploymentSection
      key={employmentSectionKey(household)}
      household={household}
      {...(onSaveHousehold ? { onSaveHousehold } : {})}
    />
  ),
};
