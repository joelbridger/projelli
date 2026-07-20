use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use sha2::{Digest, Sha256};

use crate::commands::writeback::model::{
    ExternalCurrentValue, ExternalRemoteResult, ExternalVerifyResult, ExternalWriteKind,
    ExternalWriteOperation, ExternalWriteReceipt, ExternalWriteRequest,
};
use crate::commands::writeback::store::ExternalWriteStore;

#[derive(Debug, thiserror::Error)]
pub enum ExternalWriteError {
    #[error("writes are not yet supported for {0}")]
    NotSupported(String),
    #[error("the write target and operation do not match")]
    TargetMismatch,
    #[error("invalid external write request: {0}")]
    InvalidInput(&'static str),
    #[error("could not record this write before sending it - try again")]
    LedgerUnavailable,
    #[error("Delivery unconfirmed. The app will check before retrying.")]
    VerifyPending,
    #[error("this exact write is already being sent - wait a moment before retrying")]
    InProgress,
    #[error("external value changed since proposal - current hash: {current_hash}")]
    StaleExternalValue { current_hash: String },
    #[error("the external system accepted this write, but readback did not confirm it")]
    WriteNotApplied,
    #[error("external write store failed: {0}")]
    Store(String),
}

#[async_trait]
pub trait ExternalWriteSocket: Send + Sync {
    fn target_id(&self) -> &'static str;
    fn supports(&self, operation: &ExternalWriteOperation) -> bool;
    async fn read_current(
        &self,
        req: &ExternalWriteRequest,
    ) -> Result<ExternalCurrentValue, ExternalWriteError>;
    async fn apply(
        &self,
        req: &ExternalWriteRequest,
    ) -> Result<ExternalRemoteResult, ExternalWriteError>;
    async fn verify(
        &self,
        req: &ExternalWriteRequest,
        remote: Option<&ExternalRemoteResult>,
    ) -> Result<ExternalVerifyResult, ExternalWriteError>;
}

#[async_trait]
pub trait ExternalWriteHttpClient: Send + Sync {
    async fn read_current(
        &self,
        target: &'static str,
        req: &ExternalWriteRequest,
    ) -> Result<ExternalCurrentValue, ExternalWriteError>;
    async fn apply(
        &self,
        target: &'static str,
        req: &ExternalWriteRequest,
    ) -> Result<ExternalRemoteResult, ExternalWriteError>;
    async fn verify(
        &self,
        target: &'static str,
        req: &ExternalWriteRequest,
        remote: Option<&ExternalRemoteResult>,
    ) -> Result<ExternalVerifyResult, ExternalWriteError>;
}

#[derive(Default)]
pub struct ExternalWriteInFlightGuard(Mutex<HashSet<String>>);

impl ExternalWriteInFlightGuard {
    pub fn new() -> Self {
        Self::default()
    }

    fn claim(&self, key: &str) -> bool {
        self.0.lock().unwrap().insert(key.to_string())
    }

    fn release(&self, key: &str) {
        self.0.lock().unwrap().remove(key);
    }
}

struct InFlightClaim<'a> {
    guard: &'a ExternalWriteInFlightGuard,
    key: String,
}

impl Drop for InFlightClaim<'_> {
    fn drop(&mut self) {
        self.guard.release(&self.key);
    }
}

pub fn hash_json_value(value: &serde_json::Value) -> String {
    let bytes = serde_json::to_vec(value).unwrap_or_default();
    let mut h = Sha256::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

pub fn validate_requested_at(value: &str) -> Result<(), ExternalWriteError> {
    if value.trim().is_empty() {
        return Err(ExternalWriteError::InvalidInput("requested_at is required"));
    }
    chrono::DateTime::parse_from_rfc3339(value.trim())
        .map(|_| ())
        .map_err(|_| ExternalWriteError::InvalidInput("requested_at must be RFC3339"))
}

pub fn dedup_key(req: &ExternalWriteRequest) -> String {
    let mut h = Sha256::new();
    let operation_json = serde_json::to_string(&req.operation).unwrap_or_default();
    for part in [
        req.target.as_str(),
        req.operation.operation_name(),
        &req.subject_key,
        &req.source_ref,
        req.requested_at.trim(),
        req.before_hash.as_deref().unwrap_or(""),
        &req.after_hash,
        &operation_json,
    ] {
        h.update(part.as_bytes());
        h.update([0u8]);
    }
    hex::encode(h.finalize())
}

fn content_key(req: &ExternalWriteRequest) -> String {
    let mut h = Sha256::new();
    let operation_json = serde_json::to_string(&req.operation).unwrap_or_default();
    for part in [
        req.target.as_str(),
        req.operation.operation_name(),
        &req.subject_key,
        req.before_hash.as_deref().unwrap_or(""),
        &req.after_hash,
        &operation_json,
    ] {
        h.update(part.as_bytes());
        h.update([0u8]);
    }
    hex::encode(h.finalize())
}

fn is_update_like(req: &ExternalWriteRequest) -> bool {
    req.operation.kind() == ExternalWriteKind::UpdateRecord || req.before_hash.is_some()
}

fn receipt_ref_for(req: &ExternalWriteRequest, key: &str) -> String {
    let short = key.get(0..16).unwrap_or(key);
    format!(
        "external-write:{}:{}:{}",
        req.matter_id,
        req.target.as_str(),
        short
    )
}

fn operation_target_matches(req: &ExternalWriteRequest) -> bool {
    req.operation.target() == req.target
}

pub async fn push_external_write(
    socket: &dyn ExternalWriteSocket,
    store: &ExternalWriteStore,
    guard: &ExternalWriteInFlightGuard,
    req: &ExternalWriteRequest,
) -> Result<ExternalWriteReceipt, ExternalWriteError> {
    validate_requested_at(&req.requested_at)?;
    if req.matter_id.trim().is_empty() {
        return Err(ExternalWriteError::InvalidInput("matter_id is required"));
    }
    if req.subject_key.trim().is_empty() {
        return Err(ExternalWriteError::InvalidInput("subject_key is required"));
    }
    if !operation_target_matches(req) || socket.target_id() != req.target.as_str() {
        return Err(ExternalWriteError::TargetMismatch);
    }
    if !socket.supports(&req.operation) {
        return Err(ExternalWriteError::NotSupported(
            req.operation.operation_name().into(),
        ));
    }

    let key = dedup_key(req);
    if !guard.claim(&key) {
        return Err(ExternalWriteError::InProgress);
    }
    let _claim = InFlightClaim {
        guard,
        key: key.clone(),
    };

    if let Some(row) = store
        .outbound_get(&key)
        .map_err(|e| ExternalWriteError::Store(e.to_string()))?
    {
        if row.status == "sent" {
            if let (Some(remote_id), Some(receipt_ref)) =
                (row.remote_id.as_ref(), row.receipt_ref.as_ref())
            {
                return Ok(ExternalWriteReceipt {
                    target: req.target.as_str().into(),
                    operation: req.operation.operation_name().into(),
                    remote_id: remote_id.clone(),
                    deduped: true,
                    receipt_ref: receipt_ref.clone(),
                });
            }
        }

        if row.status == "pending" || row.status == "pending_verify" {
            let remote = row
                .remote_id
                .as_ref()
                .map(|remote_id| ExternalRemoteResult {
                    remote_id: remote_id.clone(),
                    status_code: None,
                    response_hash: None,
                });
            match socket.verify(req, remote.as_ref()).await {
                Ok(verified) if verified.applied => {
                    let remote_id = verified
                        .remote_id
                        .or_else(|| row.remote_id.clone())
                        .unwrap_or_else(|| req.subject_key.clone());
                    let receipt_ref = verified
                        .receipt_ref
                        .or_else(|| row.receipt_ref.clone())
                        .unwrap_or_else(|| receipt_ref_for(req, &key));
                    upsert_ledger(
                        store,
                        req,
                        &key,
                        "sent",
                        Some(&remote_id),
                        Some(&receipt_ref),
                    )?;
                    return Ok(ExternalWriteReceipt {
                        target: req.target.as_str().into(),
                        operation: req.operation.operation_name().into(),
                        remote_id,
                        deduped: true,
                        receipt_ref,
                    });
                }
                Ok(_) => {
                    // Not found: the unclear attempt did not apply. Continue
                    // to a fresh send, but only after a new pending row below.
                }
                Err(_) => {
                    upsert_ledger(store, req, &key, "pending_verify", None, None)?;
                    return Err(ExternalWriteError::VerifyPending);
                }
            }
        }
    }

    if is_update_like(req) {
        let current = socket.read_current(req).await?;
        if current.hash == req.after_hash {
            let remote_id = current.remote_id.unwrap_or_else(|| req.subject_key.clone());
            let receipt_ref = receipt_ref_for(req, &key);
            upsert_ledger(
                store,
                req,
                &key,
                "sent",
                Some(&remote_id),
                Some(&receipt_ref),
            )?;
            return Ok(ExternalWriteReceipt {
                target: req.target.as_str().into(),
                operation: req.operation.operation_name().into(),
                remote_id,
                deduped: true,
                receipt_ref,
            });
        }
        let Some(before_hash) = &req.before_hash else {
            return Err(ExternalWriteError::InvalidInput(
                "update writes require before_hash",
            ));
        };
        if &current.hash != before_hash {
            upsert_ledger(store, req, &key, "stale", None, None)?;
            return Err(ExternalWriteError::StaleExternalValue {
                current_hash: current.hash,
            });
        }
    }

    upsert_ledger_before_send(store, req, &key)?;

    let apply = match socket.apply(req).await {
        Ok(remote) => remote,
        Err(ExternalWriteError::VerifyPending) => {
            upsert_ledger(store, req, &key, "pending_verify", None, None)?;
            return Err(ExternalWriteError::VerifyPending);
        }
        Err(e) => {
            upsert_ledger(store, req, &key, "failed", None, None)?;
            return Err(e);
        }
    };

    let verified = match socket.verify(req, Some(&apply)).await {
        Ok(verified) => verified,
        Err(_) => {
            upsert_ledger(
                store,
                req,
                &key,
                "pending_verify",
                Some(&apply.remote_id),
                None,
            )?;
            return Err(ExternalWriteError::VerifyPending);
        }
    };

    if !verified.applied {
        upsert_ledger(store, req, &key, "failed", None, None)?;
        return Err(ExternalWriteError::WriteNotApplied);
    }

    let remote_id = verified.remote_id.unwrap_or(apply.remote_id);
    let receipt_ref = verified
        .receipt_ref
        .unwrap_or_else(|| receipt_ref_for(req, &key));
    upsert_ledger(
        store,
        req,
        &key,
        "sent",
        Some(&remote_id),
        Some(&receipt_ref),
    )?;

    Ok(ExternalWriteReceipt {
        target: req.target.as_str().into(),
        operation: req.operation.operation_name().into(),
        remote_id,
        deduped: false,
        receipt_ref,
    })
}

fn upsert_ledger_before_send(
    store: &ExternalWriteStore,
    req: &ExternalWriteRequest,
    key: &str,
) -> Result<(), ExternalWriteError> {
    store
        .outbound_upsert(
            key,
            req.target.as_str(),
            req.operation.operation_name(),
            &req.subject_key,
            &req.matter_id,
            &req.source_ref,
            "pending",
            None,
            None,
            true,
            &content_key(req),
            req.before_hash.as_deref(),
            &req.after_hash,
        )
        .map_err(|_| ExternalWriteError::LedgerUnavailable)
}

fn upsert_ledger(
    store: &ExternalWriteStore,
    req: &ExternalWriteRequest,
    key: &str,
    status: &str,
    remote_id: Option<&str>,
    receipt_ref: Option<&str>,
) -> Result<(), ExternalWriteError> {
    store
        .outbound_upsert(
            key,
            req.target.as_str(),
            req.operation.operation_name(),
            &req.subject_key,
            &req.matter_id,
            &req.source_ref,
            status,
            remote_id,
            receipt_ref,
            false,
            &content_key(req),
            req.before_hash.as_deref(),
            &req.after_hash,
        )
        .map_err(|e| ExternalWriteError::Store(e.to_string()))
}

#[derive(Default)]
pub struct InMemoryExternalWriteClient {
    records: Mutex<HashMap<String, (String, String)>>,
}

impl InMemoryExternalWriteClient {
    pub fn new() -> Self {
        Self::default()
    }

    fn record_key(target: &str, req: &ExternalWriteRequest) -> String {
        format!(
            "{}:{}:{}",
            target,
            req.operation.operation_name(),
            req.subject_key
        )
    }
}

#[async_trait]
impl ExternalWriteHttpClient for InMemoryExternalWriteClient {
    async fn read_current(
        &self,
        target: &'static str,
        req: &ExternalWriteRequest,
    ) -> Result<ExternalCurrentValue, ExternalWriteError> {
        let key = Self::record_key(target, req);
        let records = self.records.lock().unwrap();
        if let Some((remote_id, hash)) = records.get(&key) {
            return Ok(ExternalCurrentValue {
                remote_id: Some(remote_id.clone()),
                hash: hash.clone(),
                summary: Some("mock current value".into()),
            });
        }
        Ok(ExternalCurrentValue {
            remote_id: None,
            hash: req
                .before_hash
                .clone()
                .unwrap_or_else(|| hash_json_value(&serde_json::json!({}))),
            summary: Some("mock empty value".into()),
        })
    }

    async fn apply(
        &self,
        target: &'static str,
        req: &ExternalWriteRequest,
    ) -> Result<ExternalRemoteResult, ExternalWriteError> {
        let key = Self::record_key(target, req);
        let remote_id = format!("{}-{}", target, &dedup_key(req)[0..12]);
        self.records
            .lock()
            .unwrap()
            .insert(key, (remote_id.clone(), req.after_hash.clone()));
        Ok(ExternalRemoteResult {
            remote_id,
            status_code: Some(200),
            response_hash: None,
        })
    }

    async fn verify(
        &self,
        target: &'static str,
        req: &ExternalWriteRequest,
        remote: Option<&ExternalRemoteResult>,
    ) -> Result<ExternalVerifyResult, ExternalWriteError> {
        let key = Self::record_key(target, req);
        let records = self.records.lock().unwrap();
        let Some((remote_id, hash)) = records.get(&key) else {
            return Ok(ExternalVerifyResult {
                applied: false,
                remote_id: remote.map(|r| r.remote_id.clone()),
                receipt_ref: None,
                current_hash: None,
            });
        };
        Ok(ExternalVerifyResult {
            applied: hash == &req.after_hash,
            remote_id: Some(remote_id.clone()),
            receipt_ref: Some(receipt_ref_for(req, &dedup_key(req))),
            current_hash: Some(hash.clone()),
        })
    }
}

pub fn default_mock_client() -> Arc<dyn ExternalWriteHttpClient> {
    Arc::new(InMemoryExternalWriteClient::new())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::writeback::model::{
        ExternalWriteOperation, ExternalWriteTarget, HolistiplanOperation, IncomeFrequency,
        MoneyAmount, RightCapitalIncomeType, RightCapitalOperation,
    };
    use crate::commands::writeback::store::ExternalWriteStore;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    fn test_store() -> (tempfile::TempDir, ExternalWriteStore) {
        let dir = tempfile::tempdir().unwrap();
        let store = ExternalWriteStore::open_with_key(dir.path(), &[9u8; 32]).unwrap();
        (dir, store)
    }

    fn create_req() -> ExternalWriteRequest {
        let final_value = serde_json::json!({
            "documentRef": "Clients/Henderson/2025-return.pdf",
            "taxYear": 2025
        });
        ExternalWriteRequest {
            target: ExternalWriteTarget::Holistiplan,
            operation: ExternalWriteOperation::Holistiplan(
                HolistiplanOperation::UploadTaxDocument {
                    document_ref: "Clients/Henderson/2025-return.pdf".into(),
                    tax_year: 2025,
                    document_kind: "tax_return".into(),
                },
            ),
            matter_id: "matter-1".into(),
            subject_key: "hp-household-1".into(),
            source_ref: "client-folder:tax-return".into(),
            requested_at: "2026-07-10T12:00:00Z".into(),
            before_hash: None,
            after_hash: hash_json_value(&final_value),
        }
    }

    fn update_req(before_hash: String, after_hash: String) -> ExternalWriteRequest {
        ExternalWriteRequest {
            target: ExternalWriteTarget::Rightcapital,
            operation: ExternalWriteOperation::Rightcapital(RightCapitalOperation::UpsertIncome {
                client_id: "rc-client-1".into(),
                income_id: Some("income-1".into()),
                income_type: RightCapitalIncomeType::Salary,
                owner: Some("Robert".into()),
                amount: MoneyAmount {
                    amount: 185000.0,
                    currency: "USD".into(),
                },
                frequency: IncomeFrequency::Annual,
                start_date: None,
                end_date: None,
                notes: "New salary from meeting.".into(),
            }),
            matter_id: "matter-1".into(),
            subject_key: "rc-household-1".into(),
            source_ref: "meeting:income".into(),
            requested_at: "2026-07-10T12:05:00Z".into(),
            before_hash: Some(before_hash),
            after_hash,
        }
    }

    struct ScriptedSocket {
        target: &'static str,
        current_hash: Mutex<String>,
        remote_id: Mutex<Option<String>>,
        apply_calls: AtomicUsize,
        verify_calls: AtomicUsize,
        pending_was_recorded_before_apply: AtomicBool,
        store: Arc<ExternalWriteStore>,
    }

    impl ScriptedSocket {
        fn new(target: &'static str, current_hash: String, store: Arc<ExternalWriteStore>) -> Self {
            Self {
                target,
                current_hash: Mutex::new(current_hash),
                remote_id: Mutex::new(None),
                apply_calls: AtomicUsize::new(0),
                verify_calls: AtomicUsize::new(0),
                pending_was_recorded_before_apply: AtomicBool::new(false),
                store,
            }
        }
    }

    #[async_trait]
    impl ExternalWriteSocket for ScriptedSocket {
        fn target_id(&self) -> &'static str {
            self.target
        }

        fn supports(&self, operation: &ExternalWriteOperation) -> bool {
            operation.target().as_str() == self.target
        }

        async fn read_current(
            &self,
            _req: &ExternalWriteRequest,
        ) -> Result<ExternalCurrentValue, ExternalWriteError> {
            Ok(ExternalCurrentValue {
                remote_id: self.remote_id.lock().unwrap().clone(),
                hash: self.current_hash.lock().unwrap().clone(),
                summary: Some("current".into()),
            })
        }

        async fn apply(
            &self,
            req: &ExternalWriteRequest,
        ) -> Result<ExternalRemoteResult, ExternalWriteError> {
            self.apply_calls.fetch_add(1, Ordering::SeqCst);
            let row = self.store.outbound_get(&dedup_key(req)).unwrap();
            self.pending_was_recorded_before_apply.store(
                row.as_ref().map(|r| r.status.as_str()) == Some("pending"),
                Ordering::SeqCst,
            );
            let result = "remote-1".to_string();
            *self.current_hash.lock().unwrap() = req.after_hash.clone();
            *self.remote_id.lock().unwrap() = Some(result.clone());
            Ok(ExternalRemoteResult {
                remote_id: result,
                status_code: Some(200),
                response_hash: None,
            })
        }

        async fn verify(
            &self,
            req: &ExternalWriteRequest,
            remote: Option<&ExternalRemoteResult>,
        ) -> Result<ExternalVerifyResult, ExternalWriteError> {
            self.verify_calls.fetch_add(1, Ordering::SeqCst);
            let hash = self.current_hash.lock().unwrap().clone();
            let remote_id = self
                .remote_id
                .lock()
                .unwrap()
                .clone()
                .or_else(|| remote.map(|r| r.remote_id.clone()));
            Ok(ExternalVerifyResult {
                applied: hash == req.after_hash,
                remote_id,
                receipt_ref: Some(receipt_ref_for(req, &dedup_key(req))),
                current_hash: Some(hash),
            })
        }
    }

    #[tokio::test]
    async fn create_like_write_records_pending_before_apply_then_receipt() {
        let (_dir, store_raw) = test_store();
        let store = Arc::new(store_raw);
        let guard = ExternalWriteInFlightGuard::new();
        let req = create_req();
        let socket = ScriptedSocket::new(
            "holistiplan",
            hash_json_value(&serde_json::json!({})),
            store.clone(),
        );

        let receipt = push_external_write(&socket, &store, &guard, &req)
            .await
            .unwrap();

        assert_eq!(receipt.target, "holistiplan");
        assert_eq!(receipt.operation, "holistiplan.upload_tax_document");
        assert_eq!(receipt.remote_id, "remote-1");
        assert!(!receipt.deduped);
        assert!(receipt.receipt_ref.contains(&req.matter_id));
        assert!(socket
            .pending_was_recorded_before_apply
            .load(Ordering::SeqCst));
        let row = store.outbound_get(&dedup_key(&req)).unwrap().unwrap();
        assert_eq!(row.status, "sent");
        assert_eq!(row.remote_id.as_deref(), Some("remote-1"));
    }

    #[tokio::test]
    async fn update_like_write_rereads_before_apply_and_after_success() {
        let (_dir, store_raw) = test_store();
        let store = Arc::new(store_raw);
        let guard = ExternalWriteInFlightGuard::new();
        let before = hash_json_value(&serde_json::json!({"amount": 125000}));
        let after = hash_json_value(&serde_json::json!({"amount": 185000}));
        let req = update_req(before.clone(), after);
        let socket = ScriptedSocket::new("rightcapital", before, store.clone());

        let receipt = push_external_write(&socket, &store, &guard, &req)
            .await
            .unwrap();

        assert_eq!(receipt.target, "rightcapital");
        assert_eq!(socket.apply_calls.load(Ordering::SeqCst), 1);
        assert_eq!(socket.verify_calls.load(Ordering::SeqCst), 1);
        let row = store.outbound_get(&dedup_key(&req)).unwrap().unwrap();
        assert_eq!(row.status, "sent");
    }

    #[tokio::test]
    async fn stale_remote_value_blocks_update_and_marks_stale() {
        let (_dir, store_raw) = test_store();
        let store = Arc::new(store_raw);
        let guard = ExternalWriteInFlightGuard::new();
        let before = hash_json_value(&serde_json::json!({"amount": 125000}));
        let drifted = hash_json_value(&serde_json::json!({"amount": 130000}));
        let after = hash_json_value(&serde_json::json!({"amount": 185000}));
        let req = update_req(before, after);
        let socket = ScriptedSocket::new("rightcapital", drifted.clone(), store.clone());

        let err = push_external_write(&socket, &store, &guard, &req)
            .await
            .unwrap_err();

        match err {
            ExternalWriteError::StaleExternalValue { current_hash } => {
                assert_eq!(current_hash, drifted);
            }
            other => panic!("expected stale error, got {other:?}"),
        }
        assert_eq!(socket.apply_calls.load(Ordering::SeqCst), 0);
        let row = store.outbound_get(&dedup_key(&req)).unwrap().unwrap();
        assert_eq!(row.status, "stale");
    }

    #[tokio::test]
    async fn duplicate_approve_dedups_without_duplicate_remote_write() {
        let (_dir, store_raw) = test_store();
        let store = Arc::new(store_raw);
        let guard = ExternalWriteInFlightGuard::new();
        let req = create_req();
        let socket = ScriptedSocket::new(
            "holistiplan",
            hash_json_value(&serde_json::json!({})),
            store.clone(),
        );

        let first = push_external_write(&socket, &store, &guard, &req)
            .await
            .unwrap();
        let second = push_external_write(&socket, &store, &guard, &req)
            .await
            .unwrap();

        assert!(!first.deduped);
        assert!(second.deduped);
        assert_eq!(socket.apply_calls.load(Ordering::SeqCst), 1);
        assert_eq!(first.remote_id, second.remote_id);
    }
}
