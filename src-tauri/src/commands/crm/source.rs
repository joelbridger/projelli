//! `CrmSource` trait — the testable seam between the sync engine and the
//! real provider HTTP client (or a `FakeCrmSource` in tests).
//!
//! Backfill fetches full lists only; delta / deletion support is deferred.
//! TODO(1B.3c): add updated_since delta + deleted_contact_ids to the trait.

use async_trait::async_trait;

use crate::commands::crm::client::WealthboxClient;
use crate::commands::crm::model::{CrmContact, CrmEvent, CrmNote, CrmTask};

// ---------------------------------------------------------------------------
// The trait
// ---------------------------------------------------------------------------

/// Abstraction over a normalized CRM data source.  The sync engine depends only on
/// this trait — swapping in a `FakeCrmSource` in tests keeps all engine logic
/// fully offline (no network, no keychain, no rate gate).
#[async_trait]
pub trait CrmSource: Send + Sync {
    /// Return ALL contacts regardless of type (person, household, organization,
    /// trust).  Used by the backfill engine to build the contact→household map.
    async fn list_all_contacts(&self) -> anyhow::Result<Vec<CrmContact>>;

    /// Return all notes.  The Wealthbox API returns these under the JSON key
    /// `"status_updates"` — the client handles that quirk internally.
    async fn list_notes(&self) -> anyhow::Result<Vec<CrmNote>>;

    /// Return all tasks.
    async fn list_tasks(&self) -> anyhow::Result<Vec<CrmTask>>;

    /// Return all calendar events.
    async fn list_events(&self) -> anyhow::Result<Vec<CrmEvent>>;

    /// Return household-shaped CRM contacts for the matter-mapping UI.
    ///
    /// New providers normalize their own API into these shared `Crm*` records
    /// and the same household-shaped expectations used by the engine. Providers
    /// with an efficient household endpoint can override this default.
    async fn list_households(&self) -> anyhow::Result<Vec<CrmContact>> {
        Ok(self
            .list_all_contacts()
            .await?
            .into_iter()
            .filter(|c| c.r#type.eq_ignore_ascii_case("household"))
            .collect())
    }
}

// ---------------------------------------------------------------------------
// Production implementation (real Wealthbox HTTP client)
// ---------------------------------------------------------------------------

/// Wire the live `WealthboxClient` to `CrmSource`.  Backfill passes `None`
/// for every `updated_since` argument to get a full snapshot.
#[allow(dead_code)]
#[async_trait]
impl CrmSource for WealthboxClient {
    async fn list_all_contacts(&self) -> anyhow::Result<Vec<CrmContact>> {
        // No type filter → every contact type is returned.
        WealthboxClient::list_contacts(self, None, None).await
    }

    async fn list_notes(&self) -> anyhow::Result<Vec<CrmNote>> {
        WealthboxClient::list_notes(self, None).await
    }

    async fn list_tasks(&self) -> anyhow::Result<Vec<CrmTask>> {
        WealthboxClient::list_tasks(self, None).await
    }

    async fn list_events(&self) -> anyhow::Result<Vec<CrmEvent>> {
        WealthboxClient::list_events(self, None).await
    }

    async fn list_households(&self) -> anyhow::Result<Vec<CrmContact>> {
        WealthboxClient::list_households(self).await
    }
}
