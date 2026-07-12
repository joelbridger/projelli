import type { EgressOperation } from './types';

/** Deterministic source for the published inventory and the CI artifact. */
export function formatInventoryMarkdown(operations: readonly EgressOperation[]): string {
  const rows = [...operations]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((operation) => [
      operation.id,
      operation.category,
      operation.recipient,
      operation.dataClasses.join(', '),
      operation.destination.allowedOrigins.join(', ') || 'user selected',
      operation.destination.redirects,
    ]);
  return [
    '| Operation | Category | Recipient | Data | Allowed host | Redirects |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}
