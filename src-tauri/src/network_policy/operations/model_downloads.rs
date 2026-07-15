//! Model-download egress operations — signed RAG/reranker/LLM model bytes from
//! Hugging Face, and the packaged voice model.

use crate::network_policy::{
    DestinationRule, EgressCategory, EgressDataClasses, EgressOperation,
};

// Hugging Face first resolves on huggingface.co, then redirects model bytes to
// its Xet storage CDN.  The download client follows redirects manually and
// authorizes every hop. `us.aws.cdn.hf.co` is the current file-storage host
// observed for all three production downloads (2026-07-11); keep this list
// synchronized with the downloader's redirect tests when Hugging Face changes
// its delivery network.
const HUGGING_FACE_MODEL_DOWNLOAD_HOSTS: &[&str] = &["huggingface.co", "us.aws.cdn.hf.co"];

pub const RAG_MODEL_DOWNLOAD: EgressOperation = EgressOperation {
    id: "rag-model-download",
    category: EgressCategory::ProductMaintenance,
    destination_rule: DestinationRule::ExactHosts(HUGGING_FACE_MODEL_DOWNLOAD_HOSTS),
    data_classes: EgressDataClasses {
        content: false,
        metadata: true,
        credential: false,
    },
    receipt_label: "RAG model download",
};
pub const RERANKER_MODEL_DOWNLOAD: EgressOperation = EgressOperation {
    id: "reranker-model-download",
    category: EgressCategory::ProductMaintenance,
    destination_rule: DestinationRule::ExactHosts(HUGGING_FACE_MODEL_DOWNLOAD_HOSTS),
    data_classes: EgressDataClasses {
        content: false,
        metadata: true,
        credential: false,
    },
    receipt_label: "reranker model download",
};
pub const LOCAL_LLM_MODEL_DOWNLOAD: EgressOperation = EgressOperation {
    id: "local-llm-model-download",
    category: EgressCategory::ProductMaintenance,
    destination_rule: DestinationRule::ExactHosts(HUGGING_FACE_MODEL_DOWNLOAD_HOSTS),
    data_classes: EgressDataClasses {
        content: false,
        metadata: true,
        credential: false,
    },
    receipt_label: "local LLM model download",
};
pub const VOICE_MODEL_DOWNLOAD: EgressOperation = EgressOperation {
    id: "voice-model-download",
    category: EgressCategory::ProductMaintenance,
    // Canonical product setting: src/config/brand.ts → BRAND.urls.voices.
    // Rust cannot import TypeScript at runtime, so keep this literal paired
    // with the generated brand configuration and its URL below in tts.rs.
    destination_rule: DestinationRule::ExactHosts(&["advisorprephero.com"]),
    data_classes: EgressDataClasses {
        content: false,
        metadata: true,
        credential: false,
    },
    receipt_label: "voice model download",
};

/// This domain's egress slice. Registered once in `operations::EGRESS_MODULES`.
pub const MODEL_DOWNLOAD_OPERATIONS: &[EgressOperation] = &[
    RAG_MODEL_DOWNLOAD,
    RERANKER_MODEL_DOWNLOAD,
    LOCAL_LLM_MODEL_DOWNLOAD,
    VOICE_MODEL_DOWNLOAD,
];
