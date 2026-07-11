use async_trait::async_trait;

use crate::commands::boxc::client::BoxClient;
use crate::commands::boxc::model::{BoxFile, BoxFolder, BoxItem};

#[async_trait]
pub trait BoxSource: Send + Sync {
    async fn get_folder(&self, folder_id: &str) -> anyhow::Result<BoxFolder>;
    async fn get_file(&self, file_id: &str) -> anyhow::Result<BoxFile>;
    async fn list_folder_items(&self, folder_id: &str) -> anyhow::Result<Vec<BoxItem>>;
    async fn download_content(&self, file_id: &str) -> anyhow::Result<Vec<u8>>;
}

pub struct ApiBoxSource {
    client: BoxClient,
}

impl ApiBoxSource {
    pub fn new(token: String, policy: crate::network_policy::NetworkPolicy) -> Self {
        Self {
            client: BoxClient::new(token)
                .with_network_policy(policy, crate::network_policy::BOX_SYNC),
        }
    }
}

#[async_trait]
impl BoxSource for ApiBoxSource {
    async fn get_folder(&self, folder_id: &str) -> anyhow::Result<BoxFolder> {
        self.client.get_folder(folder_id).await
    }

    async fn get_file(&self, file_id: &str) -> anyhow::Result<BoxFile> {
        self.client.get_file(file_id).await
    }

    async fn list_folder_items(&self, folder_id: &str) -> anyhow::Result<Vec<BoxItem>> {
        self.client.list_folder_items(folder_id).await
    }

    async fn download_content(&self, file_id: &str) -> anyhow::Result<Vec<u8>> {
        self.client.download_content(file_id).await
    }
}
