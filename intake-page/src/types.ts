import type { FormRequest } from '@/platform/intake/types';

export interface IntakeFirm {
  name: string;
  accent: string;
  advisor_name: string;
  advisor_email: string;
  next_steps: string[];
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
}

export type AnswerPayload =
  | { kind: 'typed'; value: string | number; display_value?: string }
  | { kind: 'guided'; answer: Record<string, unknown> }
  | { kind: 'files'; files: File[] };
