import { createElement } from 'react';
import { isEnabled as isFlagEnabled } from '@/platform/flags/router';
import {
  type DirectoryContribution,
  type DirectoryResult,
} from '@/features/crm-clients';
import { SortDirectoryTool } from './SortDirectoryTool';
import { isDirectorySortChoice, type DirectorySortChoice } from './sortState';

function nameCompare(left: DirectoryResult, right: DirectoryResult): number {
  const byName = left.record.name.localeCompare(right.record.name, undefined, {
    sensitivity: 'base',
  });
  return byName || left.record.id.localeCompare(right.record.id);
}

function timestamp(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Newer timestamps come first. Missing or invalid timestamps always follow
 * dated records, then use the public name and id fields as a stable fallback.
 */
function newestFirst(
  left: DirectoryResult,
  right: DirectoryResult,
  readTimestamp: (result: DirectoryResult) => string | undefined
): number {
  const leftTimestamp = timestamp(readTimestamp(left));
  const rightTimestamp = timestamp(readTimestamp(right));
  if (leftTimestamp !== null && rightTimestamp !== null) {
    const byTimestamp = rightTimestamp - leftTimestamp;
    if (byTimestamp !== 0) return byTimestamp;
  } else if (leftTimestamp !== null) {
    return -1;
  } else if (rightTimestamp !== null) {
    return 1;
  }
  return nameCompare(left, right);
}

function compareDirectoryResults(
  choice: DirectorySortChoice,
  left: DirectoryResult,
  right: DirectoryResult
): number {
  if (choice === 'name-ascending') return nameCompare(left, right);
  if (choice === 'created') {
    return newestFirst(left, right, (result) => result.record.createdAt);
  }
  return newestFirst(left, right, (result) => result.record.lastActivityAt);
}

/** The single stateful public directory contribution owned by CRM list sort. */
export const crmListSortDirectoryContribution = {
  namespace: 'crm-list-sort',
  tools: [
    {
      id: 'crm-list-sort',
      order: 54,
      isEnabled: () => isFlagEnabled('crm-list-sort'),
      mount: (context) => createElement(SortDirectoryTool, { context }),
    },
  ],
  queries: [
    {
      id: 'crm-list-sort',
      order: 54,
      isActive: (context) =>
        isFlagEnabled('crm-list-sort') && isDirectorySortChoice(context.featureState.get()),
      compare: (left, right, context) => {
        const choice = context.featureState.get();
        return choice ? compareDirectoryResults(choice, left, right) : 0;
      },
    },
  ],
} satisfies DirectoryContribution<DirectorySortChoice>;
