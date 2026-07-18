/** Copy owned by the duplicate-review extension. */
export const crmDuplicatesCopy = {
  button: 'Find duplicates',
  noMatches: 'No likely duplicate households found.',
  resultCount: (count: number) =>
    `${String(count)} possible duplicate ${count === 1 ? 'pair' : 'pairs'}`,
  explanation:
    'These names match after ignoring capitalization, spacing, and punctuation.',
  review: 'Review records',
  openRecord: 'Open record',
  reviewOnly: 'Review only. This tool does not merge, edit, or delete records.',
} as const;
