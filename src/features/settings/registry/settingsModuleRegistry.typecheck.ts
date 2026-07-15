import type { SettingsSectionId } from './types';

const registeredSection: SettingsSectionId = 'privacy';
void registeredSection;

// This is the seam probe: a misspelled registry id must never type-check.
// @ts-expect-error -- section ids are closed until a feature augments SettingsSectionMap.
const typoSection: SettingsSectionId = 'privacey';
void typoSection;
