use std::sync::Arc;

use async_trait::async_trait;

use crate::commands::writeback::engine::{
    default_mock_client, ExternalWriteError, ExternalWriteHttpClient, ExternalWriteSocket,
};
use crate::commands::writeback::model::{
    ExternalCurrentValue, ExternalRemoteResult, ExternalVerifyResult, ExternalWriteOperation,
    ExternalWriteRequest,
};

pub struct RightCapitalSocket {
    client: Arc<dyn ExternalWriteHttpClient>,
}

impl RightCapitalSocket {
    pub fn new(client: Arc<dyn ExternalWriteHttpClient>) -> Self {
        Self { client }
    }

    pub fn mock() -> Self {
        Self::new(default_mock_client())
    }
}

#[async_trait]
impl ExternalWriteSocket for RightCapitalSocket {
    fn target_id(&self) -> &'static str {
        "rightcapital"
    }

    fn supports(&self, operation: &ExternalWriteOperation) -> bool {
        matches!(operation, ExternalWriteOperation::Rightcapital(_))
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
        ExternalWriteOperation, ExternalWriteTarget, IncomeFrequency, MoneyAmount,
        RightCapitalIncomeType, RightCapitalOperation,
    };

    fn req() -> ExternalWriteRequest {
        ExternalWriteRequest {
            target: ExternalWriteTarget::Rightcapital,
            operation: ExternalWriteOperation::Rightcapital(RightCapitalOperation::UpsertIncome {
                client_id: "rc-client-1".into(),
                income_id: None,
                income_type: RightCapitalIncomeType::Salary,
                owner: Some("Robert".into()),
                amount: MoneyAmount {
                    amount: 185000.0,
                    currency: "USD".into(),
                },
                frequency: IncomeFrequency::Annual,
                start_date: None,
                end_date: None,
                notes: "From meeting".into(),
            }),
            matter_id: "m1".into(),
            subject_key: "rc-household-1".into(),
            source_ref: "meeting:1".into(),
            requested_at: "2026-07-10T12:00:00Z".into(),
            before_hash: None,
            after_hash: hash_json_value(&serde_json::json!({"amount": 185000})),
        }
    }

    #[tokio::test]
    async fn rightcapital_socket_uses_injected_mock_client() {
        let socket = RightCapitalSocket::mock();
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
