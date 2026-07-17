import {
  openContactRef,
  readAskContactSources,
  type AskContactSourcesBoundary,
} from '@/features/crm-contacts';

export function compileAskContactProducerImport(): void {
  const boundary: AskContactSourcesBoundary | null = null;
  void readAskContactSources(boundary);
  void openContactRef({
    kind: 'household',
    id: 'fixture-client',
    matterId: 'fixture-matter',
  });
}
