//! Jotform sync engine: fetch forms, store submissions, render, and index.

use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use sha2::{Digest, Sha256};

use crate::commands::jotform::model::{
    JotformMatterMapEntry, JotformNeedsAssignment, JotformSubmission,
};
use crate::commands::jotform::render::{answer_value, render_submission, submission_source_id};
use crate::commands::jotform::source::JotformSource;
use crate::commands::jotform::store::JotformStore;
use crate::commands::rag::store::UNASSIGNED_MATTER;

const PAGE_LIMIT: u32 = 100;

#[derive(Debug, Default, Clone)]
pub struct JotformIngestReport {
    pub forms_fetched: u32,
    pub submissions_fetched: u32,
    pub submissions_changed: u32,
    pub submissions_skipped_unchanged: u32,
    pub pages_fetched: u32,
    pub needs_assignment: Vec<JotformNeedsAssignment>,
    /// Every submission source id Jotform still returned this sync. Used after a
    /// successful full scan to prune rows/chunks for submissions that have
    /// vanished from Jotform.
    pub seen_source_ids: Vec<String>,
    pub cancelled: bool,
}

#[derive(Debug, Clone)]
pub struct JotformIndexItem {
    pub source_id: String,
    pub text: String,
    pub matter_id: String,
    pub content_hash: String,
}

#[derive(Debug, Default, Clone)]
pub struct JotformSyncReport {
    pub ingest: JotformIngestReport,
    pub submissions_indexed: u32,
    pub records_indexed: u32,
    /// Submissions pruned this sync because they vanished from Jotform.
    pub pruned: u32,
    pub cancelled: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SubmitterIdentity {
    pub name: String,
    pub email: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Assignment {
    pub matter_id: String,
    pub needs_assignment: bool,
    pub reason: String,
}

pub fn content_hash(json: &str) -> String {
    hex::encode(Sha256::digest(json.as_bytes()))
}

pub async fn ingest(
    source: &dyn JotformSource,
    store: &JotformStore,
    matter_map: &[JotformMatterMapEntry],
    cancel: &AtomicBool,
) -> anyhow::Result<JotformIngestReport> {
    let mut report = JotformIngestReport::default();
    let forms = source.list_forms().await?;
    report.forms_fetched = forms.len() as u32;
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    for form in forms {
        if cancel.load(Ordering::SeqCst) {
            report.cancelled = true;
            return Ok(report);
        }
        let form_id = form.form_id.trim();
        if form_id.is_empty() {
            continue;
        }
        let mut offset = 0u32;
        loop {
            if cancel.load(Ordering::SeqCst) {
                report.cancelled = true;
                return Ok(report);
            }
            let mut submissions = source.list_form_submissions(form_id, offset).await?;
            report.pages_fetched += 1;
            if submissions.is_empty() {
                break;
            }

            let page_len = submissions.len() as u32;
            for mut submission in submissions.drain(..) {
                if cancel.load(Ordering::SeqCst) {
                    report.cancelled = true;
                    return Ok(report);
                }
                if submission.form_id.trim().is_empty() {
                    submission.form_id = form_id.to_string();
                }
                if submission.id.trim().is_empty() {
                    continue;
                }
                report.submissions_fetched += 1;
                let source_id = submission_source_id(&submission.form_id, &submission.id);
                seen.insert(source_id.clone());
                let assignment = resolve_submission_matter(&submission, matter_map);
                let identity = submitter_identity(&submission);
                let submitter = display_submitter(&identity);
                let json = serde_json::to_string(&submission)?;
                let hash = content_hash(&json);
                let changed = store.upsert_submission(
                    &source_id,
                    &submission.form_id,
                    &submission.id,
                    &form.title,
                    &assignment.matter_id,
                    &submitter,
                    &hash,
                    &json,
                    assignment.needs_assignment,
                    &assignment.reason,
                )?;
                if changed {
                    report.submissions_changed += 1;
                } else {
                    report.submissions_skipped_unchanged += 1;
                }
                if assignment.needs_assignment {
                    report.needs_assignment.push(JotformNeedsAssignment {
                        source_id,
                        form_id: submission.form_id.clone(),
                        submission_id: submission.id.clone(),
                        submitter,
                        reason: assignment.reason,
                    });
                }
            }

            offset += PAGE_LIMIT;
            store.set_cursor(&format!("form:{form_id}:offset"), &offset.to_string())?;
            if page_len < PAGE_LIMIT {
                break;
            }
        }
        store.set_cursor(&format!("form:{form_id}:offset"), "")?;
    }

    report.seen_source_ids = seen.into_iter().collect();
    Ok(report)
}

pub fn plan_submission_index(store: &JotformStore) -> anyhow::Result<Vec<JotformIndexItem>> {
    let rows = store.list_submissions_to_index()?;
    let mut out = Vec::with_capacity(rows.len());
    for row in rows {
        let mut submission: JotformSubmission = serde_json::from_str(&row.json)?;
        if submission.form_id.trim().is_empty() {
            submission.form_id = row.form_id.clone();
        }
        if submission.id.trim().is_empty() {
            submission.id = row.submission_id.clone();
        }
        let (source_id, text) = render_submission(&row.form_title, &submission);
        out.push(JotformIndexItem {
            source_id,
            text,
            matter_id: row.matter_id,
            content_hash: row.content_hash,
        });
    }
    Ok(out)
}

pub async fn apply_index_with_key(
    store: &JotformStore,
    workspace: &Path,
    items: &[JotformIndexItem],
    cancel: &AtomicBool,
    rag_key: &[u8; 32],
    progress: &AtomicU32,
) -> anyhow::Result<(u32, bool)> {
    let mut records = 0u32;
    for item in items {
        if cancel.load(Ordering::SeqCst) {
            return Ok((records, true));
        }
        let written = crate::commands::connector::index_external_text_with_key_internal(
            workspace,
            &item.source_id,
            &item.text,
            &item.matter_id,
            "jotform",
            rag_key,
        )
        .await?;
        if cancel.load(Ordering::SeqCst) {
            return Ok((records, true));
        }
        store.mark_indexed(&item.source_id, &item.content_hash, &item.matter_id)?;
        records += written;
        progress.fetch_add(1, Ordering::SeqCst);
    }
    Ok((records, false))
}

pub async fn backfill(
    source: &dyn JotformSource,
    store: &JotformStore,
    workspace: &Path,
    matter_map: &[JotformMatterMapEntry],
    cancel: &AtomicBool,
    rag_key: &[u8; 32],
    progress: &AtomicU32,
) -> anyhow::Result<JotformSyncReport> {
    let ingest = ingest(source, store, matter_map, cancel).await?;
    let items = if ingest.cancelled {
        Vec::new()
    } else {
        plan_submission_index(store)?
    };
    let (records, index_cancelled) =
        apply_index_with_key(store, workspace, &items, cancel, rag_key, progress).await?;

    let cancelled = ingest.cancelled || index_cancelled;
    // Prune submissions that vanished from Jotform. Jotform re-scans every form
    // from offset 0 each sync, so a non-cancelled run saw every current
    // submission; a cancelled/errored run never reaches here, so a partial sync
    // can't mass-delete.
    let mut pruned = 0u32;
    if !cancelled {
        let seen: std::collections::HashSet<String> =
            ingest.seen_source_ids.iter().cloned().collect();
        let conn = crate::commands::rag::store::open_connection(workspace).await?;
        let table = crate::commands::rag::store::open_or_create_table(&conn).await?;
        for source_id in store.list_active_source_ids()? {
            if !seen.contains(&source_id) {
                store.mark_deleted(&source_id)?;
                crate::commands::rag::store::delete_path(&table, &source_id, rag_key).await?;
                pruned += 1;
            }
        }
    }

    Ok(JotformSyncReport {
        submissions_indexed: progress.load(Ordering::SeqCst),
        records_indexed: records,
        pruned,
        cancelled,
        ingest,
    })
}

pub fn resolve_submission_matter(
    submission: &JotformSubmission,
    matter_map: &[JotformMatterMapEntry],
) -> Assignment {
    let key_map = build_key_map(matter_map);
    let mut matches = BTreeSet::new();
    let identity = submitter_identity(submission);

    collect_exact(&key_map, &mut matches, &identity.email);
    collect_exact(&key_map, &mut matches, &identity.name);
    if matches.is_empty() {
        collect_fuzzy(&key_map, &mut matches, &identity.name);
    }
    if matches.is_empty() {
        for answer in submission.answers.values() {
            collect_fuzzy(&key_map, &mut matches, &answer_value(answer));
        }
    }

    if matches.len() == 1 {
        return Assignment {
            matter_id: matches.into_iter().next().unwrap(),
            needs_assignment: false,
            reason: String::new(),
        };
    }
    Assignment {
        matter_id: UNASSIGNED_MATTER.to_string(),
        needs_assignment: true,
        reason: if matches.is_empty() {
            "no matter matched submitter name or email".to_string()
        } else {
            "multiple matters matched this submission".to_string()
        },
    }
}

pub fn submitter_identity(submission: &JotformSubmission) -> SubmitterIdentity {
    let mut name = String::new();
    let mut email = String::new();

    for answer in submission.answers.values() {
        let answer_type = answer.r#type.to_ascii_lowercase();
        let label = format!("{} {}", answer.text, answer.name).to_ascii_lowercase();
        let value = answer_value(answer);
        if name.is_empty()
            && (answer_type.contains("fullname")
                || answer_type.contains("full_name")
                || label.contains("full name")
                || label == "name")
        {
            name = value.clone();
        }
        if email.is_empty() && (answer_type.contains("email") || label.contains("email")) {
            email = value;
        }
    }

    if name.is_empty() || email.is_empty() {
        for answer in submission.answers.values() {
            let value = answer_value(answer);
            if email.is_empty() && value.contains('@') {
                email = value;
            }
        }
    }

    SubmitterIdentity {
        name: normalize_display_name(&name),
        email: email.trim().to_ascii_lowercase(),
    }
}

fn display_submitter(identity: &SubmitterIdentity) -> String {
    match (identity.name.trim(), identity.email.trim()) {
        ("", "") => String::new(),
        ("", email) => email.to_string(),
        (name, "") => name.to_string(),
        (name, email) => format!("{name} <{email}>"),
    }
}

fn build_key_map(matter_map: &[JotformMatterMapEntry]) -> HashMap<String, Vec<String>> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for entry in matter_map {
        let key = normalize_key(&entry.jotform_key);
        if key.is_empty() || entry.matter_id.trim().is_empty() {
            continue;
        }
        map.entry(key).or_default().push(entry.matter_id.clone());
    }
    map
}

fn collect_exact(
    key_map: &HashMap<String, Vec<String>>,
    matches: &mut BTreeSet<String>,
    candidate: &str,
) {
    let key = normalize_key(candidate);
    if let Some(matter_ids) = key_map.get(&key) {
        matches.extend(matter_ids.iter().cloned());
    }
}

fn collect_fuzzy(
    key_map: &HashMap<String, Vec<String>>,
    matches: &mut BTreeSet<String>,
    candidate: &str,
) {
    let haystack = normalize_key(candidate);
    if haystack.is_empty() {
        return;
    }
    for (key, matter_ids) in key_map {
        if key.len() >= 4 && (haystack.contains(key) || key.contains(&haystack)) {
            matches.extend(matter_ids.iter().cloned());
        }
    }
}

pub fn normalize_key(value: &str) -> String {
    value
        .to_ascii_lowercase()
        .replace(['<', '>', '"', '\'', ',', ';'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn normalize_display_name(value: &str) -> String {
    value
        .replace("first:", "")
        .replace("middle:", "")
        .replace("last:", "")
        .replace(',', " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::jotform::model::{JotformForm, JotformSubmission};
    use async_trait::async_trait;
    use std::collections::HashMap;

    fn submission() -> JotformSubmission {
        serde_json::from_str(
            r#"{
              "id": "sub-123",
              "formID": "form-456",
              "answers": {
                "1": { "text": "Full Name", "type": "control_fullname", "answer": { "first": "Avery", "last": "Stone" } },
                "2": { "text": "Email", "type": "control_email", "answer": "avery@example.com" },
                "3": { "text": "Notes", "type": "control_textarea", "answer": "Has a Roth IRA rollover question." }
              }
            }"#,
        )
        .unwrap()
    }

    #[test]
    fn stable_source_id_uses_form_and_submission_ids() {
        assert_eq!(
            submission_source_id("form-456", "sub-123"),
            "jotform:form-456:sub-123"
        );
    }

    #[test]
    fn extracts_submitter_name_and_email() {
        let identity = submitter_identity(&submission());
        assert_eq!(identity.name, "Avery Stone");
        assert_eq!(identity.email, "avery@example.com");
    }

    #[test]
    fn resolves_submission_by_exact_email() {
        let map = vec![JotformMatterMapEntry {
            jotform_key: "avery@example.com".into(),
            matter_id: "matter-a".into(),
        }];
        let assignment = resolve_submission_matter(&submission(), &map);
        assert_eq!(assignment.matter_id, "matter-a");
        assert!(!assignment.needs_assignment);
    }

    #[test]
    fn resolves_submission_by_name() {
        let map = vec![JotformMatterMapEntry {
            jotform_key: "avery stone".into(),
            matter_id: "matter-a".into(),
        }];
        let assignment = resolve_submission_matter(&submission(), &map);
        assert_eq!(assignment.matter_id, "matter-a");
        assert!(!assignment.needs_assignment);
    }

    #[test]
    fn ambiguous_submission_match_needs_assignment() {
        let map = vec![
            JotformMatterMapEntry {
                jotform_key: "avery@example.com".into(),
                matter_id: "matter-a".into(),
            },
            JotformMatterMapEntry {
                jotform_key: "avery stone".into(),
                matter_id: "matter-b".into(),
            },
        ];
        let assignment = resolve_submission_matter(&submission(), &map);
        assert_eq!(assignment.matter_id, UNASSIGNED_MATTER);
        assert!(assignment.needs_assignment);
        assert_eq!(assignment.reason, "multiple matters matched this submission");
    }

    fn form(id: &str) -> JotformForm {
        JotformForm {
            form_id: id.into(),
            title: format!("Form {id}"),
            ..Default::default()
        }
    }

    fn sub(form_id: &str, id: &str, name: &str, email: &str) -> JotformSubmission {
        serde_json::from_str(&format!(
            r#"{{
              "id": "{id}", "formID": "{form_id}",
              "answers": {{
                "1": {{ "text": "Full Name", "type": "control_fullname", "answer": {{ "first": "{name}", "last": "Client" }} }},
                "2": {{ "text": "Email", "type": "control_email", "answer": "{email}" }},
                "3": {{ "text": "Notes", "type": "control_textarea", "answer": "Roth IRA rollover question for {name}." }}
              }}
            }}"#
        ))
        .unwrap()
    }

    struct FakeJotformSource {
        forms: Vec<JotformForm>,
        subs: HashMap<String, Vec<JotformSubmission>>,
    }

    #[async_trait]
    impl JotformSource for FakeJotformSource {
        async fn list_forms(&self) -> anyhow::Result<Vec<JotformForm>> {
            Ok(self.forms.clone())
        }
        async fn list_form_submissions(
            &self,
            form_id: &str,
            offset: u32,
        ) -> anyhow::Result<Vec<JotformSubmission>> {
            if offset > 0 {
                return Ok(vec![]); // single page
            }
            Ok(self.subs.get(form_id).cloned().unwrap_or_default())
        }
    }

    fn model_is_provisioned() -> bool {
        crate::commands::rag::model_download::model_files_cached(
            &crate::commands::rag::embedder::resolve_cache_dir(),
        )
    }

    async fn jotform_chunk_exists(workspace: &std::path::Path, matter_id: &str) -> bool {
        let conn = crate::commands::rag::store::open_connection(workspace)
            .await
            .unwrap();
        let table = crate::commands::rag::store::open_or_create_table(&conn)
            .await
            .unwrap();
        let hits = crate::commands::rag::store::nearest(
            &table,
            &vec![0.1f32; crate::commands::rag::embedder::EMBEDDING_DIM],
            10,
            Some(matter_id),
            false,
            &[],
        )
        .await
        .unwrap();
        hits.iter()
            .any(|h| h.source_type.as_deref() == Some("jotform"))
    }

    #[tokio::test]
    async fn backfill_prunes_vanished_submissions() {
        // A submission that disappears from Jotform must have its row + chunks
        // pruned after a successful full sync.
        if !model_is_provisioned() {
            eprintln!("SKIP jotform prune test: e5-small model cache not provisioned");
            return;
        }
        let dir = tempfile::TempDir::new().unwrap();
        let store = JotformStore::open_with_key(dir.path(), &[0x41; 32]).unwrap();
        let rag_key = [0x42; 32];
        let map = vec![
            JotformMatterMapEntry {
                jotform_key: "alice@x.com".into(),
                matter_id: "matter-alice".into(),
            },
            JotformMatterMapEntry {
                jotform_key: "bob@x.com".into(),
                matter_id: "matter-bob".into(),
            },
        ];

        // First sync: two submissions indexed under their matters.
        let source1 = FakeJotformSource {
            forms: vec![form("f1")],
            subs: HashMap::from([(
                "f1".to_string(),
                vec![
                    sub("f1", "s1", "Alice", "alice@x.com"),
                    sub("f1", "s2", "Bob", "bob@x.com"),
                ],
            )]),
        };
        backfill(
            &source1,
            &store,
            dir.path(),
            &map,
            &AtomicBool::new(false),
            &rag_key,
            &AtomicU32::new(0),
        )
        .await
        .unwrap();
        assert!(jotform_chunk_exists(dir.path(), "matter-alice").await);
        assert!(jotform_chunk_exists(dir.path(), "matter-bob").await);

        // Second sync: submission s2 (Bob) has vanished from Jotform.
        let source2 = FakeJotformSource {
            forms: vec![form("f1")],
            subs: HashMap::from([(
                "f1".to_string(),
                vec![sub("f1", "s1", "Alice", "alice@x.com")],
            )]),
        };
        let report = backfill(
            &source2,
            &store,
            dir.path(),
            &map,
            &AtomicBool::new(false),
            &rag_key,
            &AtomicU32::new(0),
        )
        .await
        .unwrap();
        assert_eq!(report.pruned, 1);
        assert!(jotform_chunk_exists(dir.path(), "matter-alice").await);
        assert!(!jotform_chunk_exists(dir.path(), "matter-bob").await);
    }
}
