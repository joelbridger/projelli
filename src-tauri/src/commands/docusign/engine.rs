//! DocuSign object-level sync engine.
//!
//! The engine is split like the CRM connector:
//! 1. fetch completed envelopes in date-window pages;
//! 2. store raw normalized records + hashes in an encrypted local DB;
//! 3. render changed records to text;
//! 4. index them as encrypted `esign` chunks via the shared connector bridge.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use sha2::{Digest, Sha256};

use crate::commands::docusign::model::{
    DocusignAuditEvent, DocusignEnvelope, DocusignNeedsAssignment,
    EsignMatterMapEntry,
};
use crate::commands::docusign::render::{
    envelope_source_id, event_source_id, render_document_metadata, render_envelope, render_event,
};
use crate::commands::docusign::source::EsignSource;
use crate::commands::docusign::store::DocusignStore;

const REPOLL_SECONDS: i64 = 15 * 60;

#[derive(Debug, Clone)]
pub struct DocusignIndexItem {
    pub source_id: String,
    pub text: String,
    pub matter_id: String,
}

#[derive(Debug, Default, Clone)]
pub struct DocusignIngestReport {
    pub envelopes_fetched: u32,
    pub envelopes_changed: u32,
    pub envelopes_skipped_unchanged: u32,
    pub audit_events: u32,
    pub needs_assignment: Vec<DocusignNeedsAssignment>,
}

#[derive(Debug, Default, Clone)]
pub struct DocusignSyncReport {
    pub ingest: DocusignIngestReport,
    pub records_indexed: u32,
    pub cancelled: bool,
}

pub fn content_hash(json: &str) -> String {
    hex::encode(Sha256::digest(json.as_bytes()))
}

pub async fn ingest_window(
    source: &dyn EsignSource,
    store: &DocusignStore,
    account_id: &str,
    from_date: &str,
    to_date: Option<&str>,
    matter_map: &[EsignMatterMapEntry],
    cancel: &AtomicBool,
) -> anyhow::Result<DocusignIngestReport> {
    let mut report = DocusignIngestReport::default();
    let cursor_key = cursor_key(from_date, to_date);
    let mut start_position = store
        .get_cursor(&cursor_key)?
        .filter(|cursor| !cursor.trim().is_empty());
    let now = chrono::Utc::now().timestamp();

    loop {
        if cancel.load(Ordering::SeqCst) {
            break;
        }
        let page = source
            .list_envelopes(from_date, to_date, start_position.as_deref())
            .await?;
        let next_start = page.next_start_position();
        for mut envelope in page.envelopes {
            if cancel.load(Ordering::SeqCst) {
                break;
            }
            report.envelopes_fetched += 1;
            hydrate_embedded_lists(source, &mut envelope, store, now).await?;
            let assignment = resolve_envelope_matter(&envelope, matter_map);
            let source_id = envelope_source_id(account_id, &envelope.envelope_id);
            let json = serde_json::to_string(&envelope)?;
            let hash = content_hash(&json);
            let changed = store.upsert_envelope(
                &source_id,
                &envelope.envelope_id,
                &assignment.matter_id,
                &envelope.email_subject,
                &envelope.completed_date_time,
                &hash,
                &json,
                assignment.needs_assignment,
                &assignment.reason,
            )?;
            if changed {
                report.envelopes_changed += 1;
            } else {
                report.envelopes_skipped_unchanged += 1;
            }
            if assignment.needs_assignment {
                report.needs_assignment.push(DocusignNeedsAssignment {
                    source_id: source_id.clone(),
                    envelope_id: envelope.envelope_id.clone(),
                    subject: envelope.email_subject.clone(),
                    reason: assignment.reason.clone(),
                });
            }

            if should_poll_audit(store, &envelope.envelope_id, now)? {
                let events = source.get_audit_events(&envelope.envelope_id).await?;
                store.set_last_polled(&envelope.envelope_id, now)?;
                for event in events {
                    let event_source = event_source_id(account_id, &envelope.envelope_id, &event);
                    let json = serde_json::to_string(&event)?;
                    let hash = content_hash(&json);
                    store.upsert_audit(
                        &event_source,
                        &envelope.envelope_id,
                        &assignment.matter_id,
                        &hash,
                        &json,
                    )?;
                    report.audit_events += 1;
                }
            }
        }

        if let Some(next) = next_start {
            store.set_cursor(&cursor_key, &next)?;
            start_position = Some(next);
        } else {
            store.set_cursor(&cursor_key, "")?;
            break;
        }
    }

    Ok(report)
}

async fn hydrate_embedded_lists(
    source: &dyn EsignSource,
    envelope: &mut DocusignEnvelope,
    store: &DocusignStore,
    now: i64,
) -> anyhow::Result<()> {
    if envelope.recipients.is_none() {
        envelope.recipients = Some(source.list_recipients(&envelope.envelope_id).await?);
    }
    if envelope.documents.is_empty() && should_poll_audit(store, &envelope.envelope_id, now)? {
        envelope.documents = source.list_documents(&envelope.envelope_id).await?;
    }
    Ok(())
}

fn should_poll_audit(store: &DocusignStore, envelope_id: &str, now: i64) -> anyhow::Result<bool> {
    Ok(match store.get_last_polled(envelope_id)? {
        Some(last) => now.saturating_sub(last) >= REPOLL_SECONDS,
        None => true,
    })
}

fn cursor_key(from_date: &str, to_date: Option<&str>) -> String {
    format!("completed:{}:{}", from_date, to_date.unwrap_or(""))
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct Assignment {
    matter_id: String,
    needs_assignment: bool,
    reason: String,
}

fn resolve_envelope_matter(
    envelope: &DocusignEnvelope,
    matter_map: &[EsignMatterMapEntry],
) -> Assignment {
    let key_map = build_key_map(matter_map);
    let mut matches: HashSet<String> = HashSet::new();

    if let Some(recipients) = &envelope.recipients {
        for recipient in recipients.all() {
            collect_exact(&key_map, &mut matches, &recipient.email);
        }
    }
    if matches.is_empty() {
        if let Some(sender) = &envelope.sender {
            collect_exact(&key_map, &mut matches, &sender.email);
        }
    }
    if matches.is_empty() {
        if let Some(recipients) = &envelope.recipients {
            for recipient in recipients.all() {
                collect_fuzzy(&key_map, &mut matches, &recipient.name);
            }
        }
        if let Some(sender) = &envelope.sender {
            collect_fuzzy(&key_map, &mut matches, &sender.user_name);
        }
    }
    if matches.is_empty() {
        collect_fuzzy(&key_map, &mut matches, &envelope.email_subject);
        if let Some(fields) = &envelope.custom_fields {
            for field in fields.all() {
                collect_fuzzy(&key_map, &mut matches, &field.value);
                collect_fuzzy(&key_map, &mut matches, &field.name);
            }
        }
    }

    if matches.len() == 1 {
        return Assignment {
            matter_id: matches.into_iter().next().unwrap(),
            needs_assignment: false,
            reason: String::new(),
        };
    }
    let reason = if matches.is_empty() {
        "no matter matched recipient, sender, name, subject, or custom fields"
    } else {
        "multiple matters matched this envelope"
    };
    Assignment {
        matter_id: crate::commands::rag::store::UNASSIGNED_MATTER.to_string(),
        needs_assignment: true,
        reason: reason.to_string(),
    }
}

fn build_key_map(matter_map: &[EsignMatterMapEntry]) -> HashMap<String, Vec<String>> {
    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for entry in matter_map {
        let key = normalize_key(&entry.esign_key);
        if key.is_empty() || entry.matter_id.trim().is_empty() {
            continue;
        }
        map.entry(key).or_default().push(entry.matter_id.clone());
    }
    map
}

fn collect_exact(
    key_map: &HashMap<String, Vec<String>>,
    matches: &mut HashSet<String>,
    candidate: &str,
) {
    let key = normalize_key(candidate);
    if let Some(matter_ids) = key_map.get(&key) {
        matches.extend(matter_ids.iter().cloned());
    }
}

fn collect_fuzzy(
    key_map: &HashMap<String, Vec<String>>,
    matches: &mut HashSet<String>,
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

fn normalize_key(value: &str) -> String {
    value
        .to_ascii_lowercase()
        .replace(['<', '>', '"', '\'', ',', ';'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn plan_unindexed(store: &DocusignStore, account_id: &str) -> anyhow::Result<Vec<DocusignIndexItem>> {
    let mut out = Vec::new();
    for row in store.list_unindexed_envelopes()? {
        let envelope: DocusignEnvelope = serde_json::from_str(&row.json)?;
        let (source_id, text) = render_envelope(account_id, &envelope);
        out.push(DocusignIndexItem {
            source_id,
            text,
            matter_id: row.matter_id.clone(),
        });
        for doc in &envelope.documents {
            let (source_id, text) =
                render_document_metadata(account_id, &envelope.envelope_id, doc);
            out.push(DocusignIndexItem {
                source_id,
                text,
                matter_id: row.matter_id.clone(),
            });
        }
    }
    for row in store.list_unindexed_audit()? {
        let event: DocusignAuditEvent = serde_json::from_str(&row.json)?;
        let (source_id, text) = render_event(account_id, &row.envelope_id, &event);
        out.push(DocusignIndexItem {
            source_id,
            text,
            matter_id: row.matter_id.clone(),
        });
    }
    Ok(out)
}

pub async fn apply_index_with_key(
    workspace: &Path,
    store: &DocusignStore,
    items: &[DocusignIndexItem],
    key: &[u8; 32],
) -> anyhow::Result<u32> {
    let mut count = 0;
    for item in items {
        count += crate::commands::connector::index_external_text_with_key_internal(
            workspace,
            &item.source_id,
            &item.text,
            &item.matter_id,
            "esign",
            key,
        )
        .await?;
        store.mark_indexed(&item.source_id)?;
    }
    Ok(count)
}

pub async fn sync_window_with_key(
    source: &dyn EsignSource,
    store: &DocusignStore,
    workspace: &Path,
    account_id: &str,
    from_date: &str,
    to_date: Option<&str>,
    matter_map: &[EsignMatterMapEntry],
    cancel: &AtomicBool,
    rag_key: &[u8; 32],
) -> anyhow::Result<DocusignSyncReport> {
    let ingest = ingest_window(
        source, store, account_id, from_date, to_date, matter_map, cancel,
    )
    .await?;
    if cancel.load(Ordering::SeqCst) {
        return Ok(DocusignSyncReport {
            ingest,
            cancelled: true,
            ..Default::default()
        });
    }
    let items = plan_unindexed(store, account_id)?;
    let records_indexed = apply_index_with_key(workspace, store, &items, rag_key).await?;
    Ok(DocusignSyncReport {
        ingest,
        records_indexed,
        cancelled: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::docusign::model::{
        DocusignAuditEvent, DocusignDocument, DocusignEnvelopePage, DocusignRecipient,
        DocusignRecipients, DocusignUser,
    };
    use crate::commands::docusign::store::DocusignStore;
    use async_trait::async_trait;
    use tempfile::TempDir;

    struct FakeEsignSource {
        pages: HashMap<Option<String>, DocusignEnvelopePage>,
        audit: Vec<DocusignAuditEvent>,
    }

    #[async_trait]
    impl EsignSource for FakeEsignSource {
        async fn list_envelopes(
            &self,
            _from_date: &str,
            _to_date: Option<&str>,
            start_position: Option<&str>,
        ) -> anyhow::Result<DocusignEnvelopePage> {
            Ok(self
                .pages
                .get(&start_position.map(str::to_string))
                .cloned()
                .unwrap_or_default())
        }

        async fn get_envelope(&self, envelope_id: &str) -> anyhow::Result<DocusignEnvelope> {
            for page in self.pages.values() {
                if let Some(found) = page.envelopes.iter().find(|e| e.envelope_id == envelope_id) {
                    return Ok(found.clone());
                }
            }
            anyhow::bail!("missing envelope")
        }

        async fn list_recipients(&self, _envelope_id: &str) -> anyhow::Result<DocusignRecipients> {
            Ok(DocusignRecipients::default())
        }

        async fn list_documents(&self, _envelope_id: &str) -> anyhow::Result<Vec<DocusignDocument>> {
            Ok(vec![])
        }

        async fn download_document(
            &self,
            _envelope_id: &str,
            _document_id: &str,
        ) -> anyhow::Result<Vec<u8>> {
            Ok(vec![])
        }

        async fn get_audit_events(
            &self,
            _envelope_id: &str,
        ) -> anyhow::Result<Vec<DocusignAuditEvent>> {
            Ok(self.audit.clone())
        }
    }

    fn envelope(id: &str, subject: &str, email: &str) -> DocusignEnvelope {
        DocusignEnvelope {
            envelope_id: id.to_string(),
            email_subject: subject.to_string(),
            status: "completed".into(),
            completed_date_time: "2026-06-01T00:00:00Z".into(),
            sender: Some(DocusignUser {
                user_name: "Advisor Sender".into(),
                email: "advisor@example.com".into(),
            }),
            recipients: Some(DocusignRecipients {
                signers: vec![DocusignRecipient {
                    recipient_id: "1".into(),
                    name: "Bob Smith".into(),
                    email: email.into(),
                    status: "completed".into(),
                    ..Default::default()
                }],
                ..Default::default()
            }),
            documents: vec![DocusignDocument {
                document_id: "1".into(),
                name: "Signed agreement.pdf".into(),
                r#type: "content".into(),
                ..Default::default()
            }],
            ..Default::default()
        }
    }

    fn fake_source() -> FakeEsignSource {
        let mut pages = HashMap::new();
        pages.insert(
            None,
            DocusignEnvelopePage {
                envelopes: vec![envelope("env-1", "Bob Smith advisory agreement", "bob@example.com")],
                next_uri: "/v2.1/accounts/a/envelopes?start_position=1000".into(),
                ..Default::default()
            },
        );
        pages.insert(
            Some("1000".into()),
            DocusignEnvelopePage {
                envelopes: vec![envelope("env-2", "Unknown agreement", "unknown@example.com")],
                ..Default::default()
            },
        );
        FakeEsignSource {
            pages,
            audit: vec![DocusignAuditEvent {
                event_id: "evt-1".into(),
                event_type: "RecipientSigned".into(),
                timestamp: "2026-06-01T00:10:00Z".into(),
                user_name: "Bob Smith".into(),
                email: "bob@example.com".into(),
                authentication_method: "email".into(),
                ..Default::default()
            }],
        }
    }

    fn store() -> (TempDir, DocusignStore) {
        let dir = TempDir::new().unwrap();
        let store = DocusignStore::open_with_key(dir.path(), &[0x55; 32]).unwrap();
        (dir, store)
    }

    #[tokio::test]
    async fn recipient_email_maps_to_matter_and_ambiguous_becomes_unassigned() {
        let (_dir, store) = store();
        let map = vec![
            EsignMatterMapEntry {
                esign_key: "bob@example.com".into(),
                matter_id: "matter-bob".into(),
            },
            EsignMatterMapEntry {
                esign_key: "Unknown".into(),
                matter_id: "matter-a".into(),
            },
            EsignMatterMapEntry {
                esign_key: "agreement".into(),
                matter_id: "matter-b".into(),
            },
        ];
        let report = ingest_window(
            &fake_source(),
            &store,
            "acct-1",
            "2026-01-01",
            None,
            &map,
            &AtomicBool::new(false),
        )
        .await
        .unwrap();

        let row = store.get_envelope("docusign:acct-1:env-1").unwrap().unwrap();
        assert_eq!(row.matter_id, "matter-bob");
        let unassigned = store.get_envelope("docusign:acct-1:env-2").unwrap().unwrap();
        assert_eq!(unassigned.matter_id, crate::commands::rag::store::UNASSIGNED_MATTER);
        assert!(unassigned.needs_assignment);
        assert_eq!(report.needs_assignment.len(), 1);
    }

    #[tokio::test]
    async fn hash_unchanged_envelopes_are_skipped_and_audit_events_plan() {
        let (_dir, store) = store();
        let map = vec![EsignMatterMapEntry {
            esign_key: "bob@example.com".into(),
            matter_id: "matter-bob".into(),
        }];
        let cancel = AtomicBool::new(false);
        let first = ingest_window(
            &fake_source(),
            &store,
            "acct-1",
            "2026-01-01",
            None,
            &map,
            &cancel,
        )
        .await
        .unwrap();
        assert_eq!(first.envelopes_changed, 2);
        let items = plan_unindexed(&store, "acct-1").unwrap();
        assert!(
            items.iter().any(|i| i.source_id == "docusign:acct-1:env-1:event:evt-1"),
            "audit events must become event records"
        );
        for item in &items {
            store.mark_indexed(&item.source_id).unwrap();
        }
        let second = ingest_window(
            &fake_source(),
            &store,
            "acct-1",
            "2026-01-01",
            None,
            &map,
            &cancel,
        )
        .await
        .unwrap();
        assert_eq!(second.envelopes_skipped_unchanged, 2);
        assert!(store.list_unindexed_envelopes().unwrap().is_empty());
    }

    #[tokio::test]
    async fn date_window_pagination_persists_cursor() {
        let (_dir, store) = store();
        ingest_window(
            &fake_source(),
            &store,
            "acct-1",
            "2026-01-01",
            Some("2026-02-01"),
            &[],
            &AtomicBool::new(false),
        )
        .await
        .unwrap();
        assert_eq!(
            store
                .get_cursor("completed:2026-01-01:2026-02-01")
                .unwrap()
                .as_deref(),
            Some("")
        );
        assert!(store.get_envelope("docusign:acct-1:env-2").unwrap().is_some());
    }
}
