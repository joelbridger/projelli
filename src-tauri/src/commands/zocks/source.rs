//! Test seam for the provisional Zocks sync engine.

use async_trait::async_trait;

use crate::commands::zocks::client::ZocksClient;
use crate::commands::zocks::model::{ZocksSession, ZocksSessionsPage};

#[async_trait]
pub trait ZocksSource: Send + Sync {
    async fn list_sessions(&self, cursor: Option<&str>) -> anyhow::Result<ZocksSessionsPage>;
    async fn get_session(&self, session_id: &str) -> anyhow::Result<ZocksSession>;
}

#[async_trait]
impl ZocksSource for ZocksClient {
    async fn list_sessions(&self, cursor: Option<&str>) -> anyhow::Result<ZocksSessionsPage> {
        ZocksClient::list_sessions(self, cursor, Some(100)).await
    }

    async fn get_session(&self, session_id: &str) -> anyhow::Result<ZocksSession> {
        ZocksClient::get_session(self, session_id).await
    }
}
