import { DocumentExtractionProposalCard } from './DocumentExtractionProposalCard';
import type { DocumentExtractionAcceptResult } from '@/platform/intake/documentExtractionAccept';

/** Standalone by design. A later onboarding lane owns where it is mounted. */
export interface DocumentExtractionReviewPanelProps { matterId: string; advisorId: string; onAccepted?: (result: DocumentExtractionAcceptResult) => void; }
export function DocumentExtractionReviewPanel(props: DocumentExtractionReviewPanelProps) { return <DocumentExtractionProposalCard {...props} />; }
