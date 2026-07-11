import type { FormRequest } from '@/platform/intake/types';
import type { WelcomeJourney } from '@/platform/intake/welcomeJourneyDefaults';
import type { DocumentDetectiveManifestEntry } from '@/platform/intake/documentDetectiveTypes';

export interface IntakeFirm {
  name: string;
  accent: string;
  advisor_name: string;
  advisor_email: string;
  next_steps: string[];
  journey: WelcomeJourney;
}

export interface IntakeChecklist extends FormRequest {
  client_first_name: string;
  /** Older links can be missing branding, so the page normalizes this at runtime. */
  firm?: Partial<IntakeFirm>;
}

export interface ResumeState {
  current_item_id?: string;
  completion_flags?: Record<string, true>;
  confirmations?: Record<string, string>;
  skipped_item_ids?: string[];
  pending_uploads?: Record<string, { submission_id: string; chunk_count: number; content_key_b64?: string }>;
  /** Advisor-side state, still sealed with the page state. */
  journey_state?: 'not_started' | 'in_progress' | 'reviewing' | 'paperwork' | 'signature_ready' | 'active_client' | 'expired' | 'revoked' | 'completed_old_link';
  current_milestone_id?: string;
  handoff_person_name?: string;
  phone_completed_item_ids?: string[];
}

export type AnswerPayload =
  | { kind: 'typed'; value: string | number; display_value?: string }
  | { kind: 'guided'; answer: Record<string, unknown> }
  | {
      kind: 'files';
      files: File[];
      file_slot_indexes?: number[];
      document_detective?: DocumentDetectiveManifestEntry[];
    };
