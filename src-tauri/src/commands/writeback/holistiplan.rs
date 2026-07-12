use std::sync::Arc;

use async_trait::async_trait;

use crate::commands::writeback::engine::{
    default_mock_client, ExternalWriteError, ExternalWriteHttpClient, ExternalWriteSocket,
};
use crate::commands::writeback::model::{
    ExternalCurrentValue, ExternalRemoteResult, ExternalVerifyResult, ExternalWriteOperation,
    ExternalWriteRequest,
};

pub struct HolistiplanSocket {
    client: Arc<dyn ExternalWriteHttpClient>,
}

impl HolistiplanSocket {
    pub fn new(client: Arc<dyn ExternalWriteHttpClient>) -> Self {
        Self { client }
    }

    pub fn mock() -> Self {
        Self::new(default_mock_client())
    }
}

#[async_trait]
impl ExternalWriteSocket for HolistiplanSocket {
    fn target_id(&self) -> &'static str {
        "holistiplan"
    }

    fn supports(&self, operation: &ExternalWriteOperation) -> bool {
        matches!(operation, ExternalWriteOperation::Holistiplan(_))
    }

    async fn read_current(
        &self,
        req: &ExternalWriteRequest,
    ) -> Result<ExternalCurrentValue, ExternalWriteError> {
        self.client.read_current(self.target_id(), req).await
    }

    async fn apply(
        &self,
        req: &ExternalWriteRequest,
    ) -> Result<ExternalRemoteResult, ExternalWriteError> {
        self.client.apply(self.target_id(), req).await
    }

    async fn verify(
        &self,
        req: &ExternalWriteRequest,
        remote: Option<&ExternalRemoteResult>,
    ) -> Result<ExternalVerifyResult, ExternalWriteError> {
        self.client.verify(self.target_id(), req, remote).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::writeback::engine::hash_json_value;
    use crate::commands::writeback::model::{
        ExternalWriteOperation, ExternalWriteTarget, HolistiplanOperation,
    };

    fn req() -> ExternalWriteRequest {
        ExternalWriteRequest {
            target: ExternalWriteTarget::Holistiplan,
            operation: ExternalWriteOperation::Holistiplan(
                HolistiplanOperation::UploadTaxDocument {
                    document_ref: "Clients/Henderson/2025-return.pdf".into(),
                    tax_year: 2025,
                    document_kind: "tax_return".into(),
                },
            ),
            matter_id: "m1".into(),
            subject_key: "hp-household-1".into(),
            source_ref: "folder:tax".into(),
            requested_at: "2026-07-10T12:00:00Z".into(),
            before_hash: None,
            after_hash: hash_json_value(&serde_json::json!({"taxYear": 2025})),
        }
    }

    #[tokio::test]
    async fn holistiplan_socket_uses_injected_mock_client() {
        let socket = HolistiplanSocket::mock();
        let req = req();
        let applied = socket.apply(&req).await.unwrap();
        let verified = socket.verify(&req, Some(&applied)).await.unwrap();
        assert!(verified.applied);
        assert_eq!(
            verified.remote_id.as_deref(),
            Some(applied.remote_id.as_str())
        );
    }
}
