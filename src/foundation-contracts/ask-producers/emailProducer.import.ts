import {
  readAskEmailDescriptors,
  type AskEmailDescriptorsBoundary,
} from '@/features/crm-connectors';

export function compileAskEmailProducerImport(): void {
  const boundary: AskEmailDescriptorsBoundary | null = null;
  void readAskEmailDescriptors(boundary);
}
