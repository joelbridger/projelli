use async_trait::async_trait;

use crate::commands::mail::graph::DeltaGone;
use crate::commands::onedrive::client::OneDriveClient;
use crate::commands::onedrive::model::{DeltaPage, Drive, DriveItem};

#[async_trait]
pub trait DocumentSource: Send + Sync {
    fn root_key(&self) -> String;
    async fn list_drives(&self) -> anyhow::Result<Vec<Drive>>;
    async fn list_root_children(&self, drive_id: Option<&str>) -> anyhow::Result<Vec<DriveItem>>;
    async fn list_children(&self, drive_id: &str, item_id: &str) -> anyhow::Result<Vec<DriveItem>>;
    async fn delta_root(&self, cursor: Option<&str>) -> anyhow::Result<DeltaPage>;
    async fn download_content(&self, drive_id: &str, item_id: &str) -> anyhow::Result<Vec<u8>>;
}

pub struct GraphDocumentSource {
    client: OneDriveClient,
    drive_id: Option<String>,
    omit_select: bool,
}

impl GraphDocumentSource {
    pub fn new(token: String) -> Self {
        Self::new_for_default_drive(token, false)
    }

    pub fn new_for_default_drive(token: String, omit_select: bool) -> Self {
        Self {
            client: OneDriveClient::new(token),
            drive_id: None,
            omit_select,
        }
    }

    #[allow(dead_code)]
    pub fn new_for_drive(token: String, drive_id: String, omit_select: bool) -> Self {
        Self {
            client: OneDriveClient::new(token),
            drive_id: Some(drive_id),
            omit_select,
        }
    }
}

#[async_trait]
impl DocumentSource for GraphDocumentSource {
    fn root_key(&self) -> String {
        self.drive_id
            .as_ref()
            .map(|d| format!("m365/default/{d}"))
            .unwrap_or_else(|| "m365/default/me".to_string())
    }

    async fn list_drives(&self) -> anyhow::Result<Vec<Drive>> {
        self.client.list_drives().await
    }

    async fn list_root_children(&self, drive_id: Option<&str>) -> anyhow::Result<Vec<DriveItem>> {
        self.client
            .list_root_children(drive_id.or(self.drive_id.as_deref()), self.omit_select)
            .await
    }

    async fn list_children(&self, drive_id: &str, item_id: &str) -> anyhow::Result<Vec<DriveItem>> {
        self.client
            .list_children(drive_id, item_id, self.omit_select)
            .await
    }

    async fn delta_root(&self, cursor: Option<&str>) -> anyhow::Result<DeltaPage> {
        self.client
            .delta_root(self.drive_id.as_deref(), cursor, self.omit_select)
            .await
    }

    async fn download_content(&self, drive_id: &str, item_id: &str) -> anyhow::Result<Vec<u8>> {
        self.client.download_content(drive_id, item_id).await
    }
}

pub fn is_delta_gone(err: &anyhow::Error) -> bool {
    err.downcast_ref::<DeltaGone>().is_some()
}
