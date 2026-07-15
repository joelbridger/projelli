declare module '../../recordRegistry' {
  interface HouseholdSectionIdMap {
    employment: true;
  }
}

export { employmentHouseholdSection } from './employmentSectionDescriptor';
export {
  persistEmploymentInformation,
  readEmploymentInformation,
} from './persistence';
export {
  EMPTY_EMPLOYMENT_INFORMATION,
  EMPLOYMENT_EXTENSION_KEY,
  isEmploymentInformation,
  type EmploymentInformation,
  type EmploymentMemberInformation,
} from './types';
