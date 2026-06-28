use async_trait::async_trait;

use crate::commands::sharefile::client::SharefileClient;
use crate::commands::sharefile::model::SharefileItem;

#[async_trait]
pub trait DocumentSource: Send + Sync {
    async fn list_root_children(&self) -> anyhow::Result<Vec<SharefileItem>>;
    async fn list_children(&self, item_id: &str) -> anyhow::Result<Vec<SharefileItem>>;
    async fn download_content(&self, item_id: &str) -> anyhow::Result<Vec<u8>>;
}

pub struct SharefileDocumentSource {
    client: SharefileClient,
}

impl SharefileDocumentSource {
    pub fn new(client: SharefileClient) -> Self {
        Self { client }
    }
}

#[async_trait]
impl DocumentSource for SharefileDocumentSource {
    async fn list_root_children(&self) -> anyhow::Result<Vec<SharefileItem>> {
        self.client.list_root_children().await
    }

    async fn list_children(&self, item_id: &str) -> anyhow::Result<Vec<SharefileItem>> {
        self.client.list_children(item_id).await
    }

    async fn download_content(&self, item_id: &str) -> anyhow::Result<Vec<u8>> {
        self.client.download_content(item_id).await
    }
}
