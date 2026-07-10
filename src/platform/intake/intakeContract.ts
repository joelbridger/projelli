export interface DocumentDetectiveManifestEntry {
  tier: 'tier1';
  slot_index: number;
  warning_reason?: 'wrong_doc' | 'wrong_side_of_license' | 'duplicate_license_side' | 'unsupported_or_unreadable';
  expected?: 'drivers_license' | 'tax_return' | 'pay_stub' | 'bank_statement' | 'brokerage_statement' | 'ira_statement' | 'credit_card_statement' | 'other_financial' | 'unknown' | 'front' | 'back';
  observed?: 'drivers_license' | 'tax_return' | 'pay_stub' | 'bank_statement' | 'brokerage_statement' | 'ira_statement' | 'credit_card_statement' | 'other_financial' | 'unknown';
  side?: 'front' | 'back' | 'unknown';
  kept_anyway: boolean;
}

export interface SealedManifest {
  submission_id: string;
  item_id: string;
  content_type: string;
  file_names: string[];
  chunk_hashes: string[];
  chunk_count: number;
  document_detective?: DocumentDetectiveManifestEntry[];
}

export interface SubmissionEnvelope {
  intake_id: string;
  item_id: string;
  submission_id: string;
  manifest_ciphertext_b64: string;
  wrapped_content_key_b64: string;
  chunk_count: number;
  submitted_at: string;
  session_id?: string;
}

export interface ChunkUpload {
  intake_id: string;
  item_id: string;
  submission_id: string;
  index: number;
  ciphertext_b64: string;
}

export interface SubmitManifest {
  intake_id: string;
  item_id: string;
  submission_id: string;
  manifest_ciphertext_b64: string;
  wrapped_content_key_b64: string;
}

export interface BundleResponse {
  checklist_ciphertext_b64: string;
  state_ciphertext_b64: string;
  checklist_version: number;
  finalized_item_ids: string[];
}

export interface StateBlob {
  ciphertext_b64: string;
}
