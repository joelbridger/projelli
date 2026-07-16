export type DirectorySortChoice = 'recent' | 'created' | 'name-ascending';

export const DEFAULT_SORT: DirectorySortChoice = 'recent';
export const SORT_PREFERENCE_NAMESPACE = 'crm-list-sort';

export function isDirectorySortChoice(value: unknown): value is DirectorySortChoice {
  return value === 'recent' || value === 'created' || value === 'name-ascending';
}
