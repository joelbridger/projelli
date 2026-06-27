//! `EsignSource` trait — test seam for DocuSign sync.

use async_trait::async_trait;

use crate::commands::docusign::client::DocusignClient;
use crate::commands::docusign::model::{
    DocusignAuditEvent, DocusignDocument, DocusignEnvelope, DocusignEnvelopePage,
    DocusignRecipients,
};

#[async_trait]
pub trait EsignSource: Send + Sync {
    async fn list_envelopes(
        &self,
        from_date: &str,
        to_date: Option<&str>,
        start_position: Option<&str>,
    ) -> anyhow::Result<DocusignEnvelopePage>;

    async fn get_envelope(&self, envelope_id: &str) -> anyhow::Result<DocusignEnvelope>;

    async fn list_recipients(&self, envelope_id: &str) -> anyhow::Result<DocusignRecipients>;

    async fn list_documents(&self, envelope_id: &str) -> anyhow::Result<Vec<DocusignDocument>>;

    async fn download_document(
        &self,
        envelope_id: &str,
        document_id: &str,
    ) -> anyhow::Result<Vec<u8>>;

    async fn get_audit_events(
        &self,
        envelope_id: &str,
    ) -> anyhow::Result<Vec<DocusignAuditEvent>>;
}

#[async_trait]
impl EsignSource for DocusignClient {
    async fn list_envelopes(
        &self,
        from_date: &str,
        to_date: Option<&str>,
        start_position: Option<&str>,
    ) -> anyhow::Result<DocusignEnvelopePage> {
        DocusignClient::list_envelopes(self, from_date, to_date, start_position).await
    }

    async fn get_envelope(&self, envelope_id: &str) -> anyhow::Result<DocusignEnvelope> {
        DocusignClient::get_envelope(self, envelope_id).await
    }

    async fn list_recipients(&self, envelope_id: &str) -> anyhow::Result<DocusignRecipients> {
        DocusignClient::list_recipients(self, envelope_id).await
    }

    async fn list_documents(&self, envelope_id: &str) -> anyhow::Result<Vec<DocusignDocument>> {
        DocusignClient::list_documents(self, envelope_id).await
    }

    async fn download_document(
        &self,
        envelope_id: &str,
        document_id: &str,
    ) -> anyhow::Result<Vec<u8>> {
        DocusignClient::download_document(self, envelope_id, document_id).await
    }

    async fn get_audit_events(
        &self,
        envelope_id: &str,
    ) -> anyhow::Result<Vec<DocusignAuditEvent>> {
        DocusignClient::get_audit_events(self, envelope_id).await
    }
}
