import {
  openDocumentCitation,
  readAskDocumentSources,
  type AskDocumentSourcesBoundary,
} from '@/features/crm-documents';

export function compileAskDocumentProducerImport(): void {
  const boundary: AskDocumentSourcesBoundary | null = null;
  void readAskDocumentSources(boundary);
  void openDocumentCitation({
    kind: 'document',
    id: 'Clients/fixture/plan.pdf',
    label: 'Plan',
    matterId: 'fixture-matter',
  });
}
