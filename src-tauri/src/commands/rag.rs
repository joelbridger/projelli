// RAG (Retrieval-Augmented Generation) commands - Phase 2 stubs.
//
// The real implementation lands in Phase 3 (M1: LanceDB + fastembed-rs +
// e5-small). Phase 2 defines the command surface + result type so the
// frontend can wire hooks/UI against the final API today and only swap the
// implementation later.
//
// Once M1 lands:
//   - `rag_index_file` and `rag_index_workspace` populate a local
//     LanceDB table living under `<app-data>/rag/*`.
//   - `rag_retrieve` embeds the query with e5-small and returns the
//     top-k nearest chunks.
//
// For now every command returns a structured "not implemented" error.

use serde::{Deserialize, Serialize};

/// One result row returned by `rag_retrieve`. The shape is frozen in Phase
/// 2 so frontend UI can be built against it:
///   - `path`: absolute path of the source file
///   - `chunk_text`: the matching paragraph / chunk of text (verbatim)
///   - `score`: cosine similarity in `[0.0, 1.0]` — higher is better
///   - `paragraph_index`: zero-based index of the chunk within its file
///     (so the UI can deep-link and anchor to it)
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Hit {
    pub path: String,
    pub chunk_text: String,
    pub score: f32,
    pub paragraph_index: u32,
}

const NOT_IMPLEMENTED: &str =
    "RAG is not implemented in Phase 2 — scaffolding lands in Phase 3 (M1).";

#[tauri::command]
pub async fn rag_index_file(_path: String) -> Result<(), String> {
    Err(NOT_IMPLEMENTED.to_string())
}

#[tauri::command]
pub async fn rag_index_workspace() -> Result<(), String> {
    Err(NOT_IMPLEMENTED.to_string())
}

#[tauri::command]
pub async fn rag_retrieve(_query: String, _top_k: u32) -> Result<Vec<Hit>, String> {
    Err(NOT_IMPLEMENTED.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hit_serializes_camel_case_for_frontend() {
        let hit = Hit {
            path: "/w/doc.md".into(),
            chunk_text: "para".into(),
            score: 0.87,
            paragraph_index: 3,
        };
        let s = serde_json::to_string(&hit).expect("serialize");
        // Frontend types will read `paragraphIndex`, not `paragraph_index`.
        assert!(s.contains("\"paragraphIndex\":3"), "got {}", s);
        assert!(s.contains("\"chunkText\":\"para\""), "got {}", s);
        assert!(s.contains("\"score\":0.87"), "got {}", s);
        assert!(s.contains("\"path\":\"/w/doc.md\""), "got {}", s);
    }

    #[test]
    fn hit_round_trips_through_json() {
        let hit = Hit {
            path: "/a".into(),
            chunk_text: "b".into(),
            score: 0.5,
            paragraph_index: 1,
        };
        let s = serde_json::to_string(&hit).unwrap();
        let back: Hit = serde_json::from_str(&s).unwrap();
        assert_eq!(hit, back);
    }
}
