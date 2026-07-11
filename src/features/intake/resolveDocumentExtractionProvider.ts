import {
  resolveEmailProvider,
  type ResolvedEmailProvider,
} from '@/features/email/resolveEmailProvider';

export type ResolvedDocumentExtractionProvider = ResolvedEmailProvider;

/**
 * Document extraction sends client document text to a model, so it must use
 * the same Local-only, Assured, and BYOK provider resolution as email reply
 * classification. Keeping this as a separate entry point lets the intake
 * pipeline remain independent while preserving that privacy policy.
 */
export async function resolveDocumentExtractionProvider(): Promise<ResolvedDocumentExtractionProvider> {
  return resolveEmailProvider();
}
