/**
 * Shared vocabulary for settings sections.
 *
 * The platform owns these stable ids because the settings schema and store use
 * them without loading the Settings feature. Feature-owned registries consume
 * this type; platform code must never import a feature to discover it.
 */
export interface SettingsSectionMap {
  workspace: true;
  ai: true;
  privacy: true;
  scheduling: true;
  voice: true;
  advanced: true;
  help: true;
  organization: true;
}

export type SettingsSectionId = Extract<keyof SettingsSectionMap, string>;
