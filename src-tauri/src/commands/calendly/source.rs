//! Testable seam for Calendly sync sources.

use async_trait::async_trait;

use crate::commands::calendly::client::CalendlyClient;
use crate::commands::calendly::model::{
    CalendlyEventWithInvitees, CalendlyEventsResponse, CalendlyInvitee, CalendlyScheduledEvent,
};

#[async_trait]
pub trait CalendlySource: Send + Sync {
    async fn list_scheduled_events(
        &self,
        page_token: Option<&str>,
    ) -> anyhow::Result<CalendlyEventsResponse>;

    async fn get_scheduled_event(&self, uuid: &str) -> anyhow::Result<CalendlyScheduledEvent>;

    async fn list_event_invitees(&self, uuid: &str) -> anyhow::Result<Vec<CalendlyInvitee>>;
}

#[async_trait]
impl CalendlySource for CalendlyClient {
    async fn list_scheduled_events(
        &self,
        page_token: Option<&str>,
    ) -> anyhow::Result<CalendlyEventsResponse> {
        CalendlyClient::list_scheduled_events(self, page_token).await
    }

    async fn get_scheduled_event(&self, uuid: &str) -> anyhow::Result<CalendlyScheduledEvent> {
        CalendlyClient::get_scheduled_event(self, uuid).await
    }

    async fn list_event_invitees(&self, uuid: &str) -> anyhow::Result<Vec<CalendlyInvitee>> {
        CalendlyClient::list_event_invitees(self, uuid).await
    }
}

pub async fn fetch_event_bundle(
    source: &dyn CalendlySource,
    event: &CalendlyScheduledEvent,
) -> anyhow::Result<CalendlyEventWithInvitees> {
    let uuid = event.uuid();
    let detail = source.get_scheduled_event(&uuid).await?;
    let invitees = source.list_event_invitees(&uuid).await?;
    Ok(CalendlyEventWithInvitees {
        event: detail,
        invitees,
    })
}
