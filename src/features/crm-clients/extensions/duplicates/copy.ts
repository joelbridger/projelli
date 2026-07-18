/** Copy owned by the duplicate-review extension. */
export const crmDuplicatesCopy = {
  button: 'Find duplicates',
  noMatches: 'No likely duplicate contacts found.',
  resultCount: (count: number) =>
    `${String(count)} possible duplicate ${count === 1 ? 'pair' : 'pairs'}`,
  sameNormalizedNameExplanation:
    'These names match after ignoring capitalization, spacing, and punctuation.',
  knownAliasExplanation:
    'These contacts share a last name and a known first-name alias.',
  review: 'Review records',
  openRecord: 'Open record',
  openError: 'This contact could not be opened.',
  markReviewed: 'Mark reviewed',
  dismiss: 'Dismiss',
  reviewed: 'Reviewed',
  dismissed: 'Dismissed',
  reviewOnly: 'Review only. This tool does not merge, edit, or delete records.',
} as const;
