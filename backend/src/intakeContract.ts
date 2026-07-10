export interface SealedManifest {
  submission_id: string;
  item_id: string;
  content_type: string;
  file_names: string[];
  chunk_hashes: string[];
  chunk_count: number;
  session_id?: string;
}

export interface SubmissionEnvelope {
  intake_id: string;
  item_id: string;
  submission_id: string;
  manifest_ciphertext_b64: string;
  wrapped_content_key_b64: string;
  chunk_count: number;
  submitted_at: string;
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
