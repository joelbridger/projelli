//! Test seam for Jotform sync sources.

use async_trait::async_trait;

use crate::commands::jotform::client::JotformClient;
use crate::commands::jotform::model::{JotformForm, JotformSubmission};

#[async_trait]
pub trait JotformSource: Send + Sync {
    async fn list_forms(&self) -> anyhow::Result<Vec<JotformForm>>;

    async fn list_form_submissions(
        &self,
        form_id: &str,
        offset: u32,
    ) -> anyhow::Result<Vec<JotformSubmission>>;
}

#[async_trait]
impl JotformSource for JotformClient {
    async fn list_forms(&self) -> anyhow::Result<Vec<JotformForm>> {
        JotformClient::list_forms(self).await
    }

    async fn list_form_submissions(
        &self,
        form_id: &str,
        offset: u32,
    ) -> anyhow::Result<Vec<JotformSubmission>> {
        JotformClient::list_form_submissions(self, form_id, offset).await
    }
}
