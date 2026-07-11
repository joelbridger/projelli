//! Shared native connector guard.
//!
//! This is deliberately a small consumer of `NetworkPolicy`, not a second
//! policy.  Connector clients use it immediately before each transport future
//! so a mode change cancels work already waiting on a remote service.

use crate::network_policy::{AuthorizedGeneration, Destination, EgressOperation, NetworkPolicy};
use reqwest::Url;
use std::future::Future;

pub fn authorize_url(
    policy: &NetworkPolicy,
    operation: &EgressOperation,
    url: &str,
) -> anyhow::Result<AuthorizedGeneration> {
    let destination = Destination::parse(Url::parse(url)?)?;
    Ok(policy.authorize(operation, &destination)?)
}

pub fn authorize_configured_host(
    policy: &NetworkPolicy,
    operation: &EgressOperation,
    url: &str,
    configured_host: &str,
) -> anyhow::Result<AuthorizedGeneration> {
    let destination = Destination::parse_for_configured_host(Url::parse(url)?, configured_host)?;
    Ok(policy.authorize(operation, &destination)?)
}

/// Race an already-authorized transport operation against the policy's change
/// broadcast.  We recheck the generation after the future completes so a
/// request that races the switch cannot be reported as an allowed result.
pub async fn await_authorized<T>(
    policy: &NetworkPolicy,
    authorized: &AuthorizedGeneration,
    request: impl Future<Output = anyhow::Result<T>>,
) -> anyhow::Result<T> {
    policy.assert_authorized_generation(authorized)?;
    let mut cancellation = policy.register_cancellation();
    tokio::select! {
        _ = cancellation.cancelled() => Err(anyhow::Error::from(crate::network_policy::NetworkPolicyError::Uninitialized)),
        result = request => {
            let result = result?;
            policy.assert_authorized_generation(authorized)?;
            Ok(result)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::network_policy::{
        EgressOperation, GMAIL_OAUTH, GMAIL_SYNC, GOOGLE_CALENDAR_OAUTH, GOOGLE_CALENDAR_SYNC,
        ICS_CALENDAR_SYNC, IMAP_SYNC, ONEDRIVE_OAUTH, ONEDRIVE_SYNC, OUTLOOK_CALENDAR_OAUTH,
        OUTLOOK_CALENDAR_SYNC, OUTLOOK_MAIL_OAUTH, OUTLOOK_MAIL_SYNC, SMTP_SEND,
    };
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    use tokio::sync::oneshot;

    fn policy() -> crate::network_policy::NetworkPolicy {
        crate::network_policy::NetworkPolicy::load_from_directory(
            &tempfile::tempdir().unwrap().keep(),
        )
    }

    async fn recording_transport(
        policy: &crate::network_policy::NetworkPolicy,
        operation: &EgressOperation,
        url: &str,
        configured_host: Option<&str>,
        calls: Arc<AtomicUsize>,
    ) -> anyhow::Result<()> {
        let grant = match configured_host {
            Some(host) => authorize_configured_host(policy, operation, url, host)?,
            None => authorize_url(policy, operation, url)?,
        };
        await_authorized(policy, &grant, async move {
            calls.fetch_add(1, Ordering::SeqCst);
            Ok(())
        })
        .await
    }

    #[tokio::test]
    async fn mail_offline_blocks_oauth_sync_send_and_user_configured_hosts_before_transport() {
        let policy = policy();
        policy.set_offline_mode(true).unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        for (operation, url, configured) in [
            (
                &OUTLOOK_MAIL_OAUTH,
                "https://login.microsoftonline.com/common/oauth2/v2.0/token",
                None,
            ),
            (
                &OUTLOOK_MAIL_SYNC,
                "https://graph.microsoft.com/v1.0/me/messages",
                None,
            ),
            (&GMAIL_OAUTH, "https://oauth2.googleapis.com/token", None),
            (
                &GMAIL_SYNC,
                "https://gmail.googleapis.com/gmail/v1/users/me/messages",
                None,
            ),
            (
                &IMAP_SYNC,
                "imaps://mail.example.test:993",
                Some("mail.example.test"),
            ),
            (
                &SMTP_SEND,
                "smtp://mail.example.test:587",
                Some("mail.example.test"),
            ),
        ] {
            assert!(
                recording_transport(&policy, operation, url, configured, calls.clone())
                    .await
                    .is_err()
            );
        }
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn onedrive_offline_blocks_oauth_and_sync_before_transport() {
        let policy = policy();
        policy.set_offline_mode(true).unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        for (operation, url) in [
            (
                &ONEDRIVE_OAUTH,
                "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            ),
            (
                &ONEDRIVE_SYNC,
                "https://graph.microsoft.com/v1.0/me/drive/root/children",
            ),
        ] {
            assert!(
                recording_transport(&policy, operation, url, None, calls.clone())
                    .await
                    .is_err()
            );
        }
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn calendar_offline_blocks_oauth_sync_and_ics_before_transport() {
        let policy = policy();
        policy.set_offline_mode(true).unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        for (operation, url, configured) in [
            (
                &OUTLOOK_CALENDAR_OAUTH,
                "https://login.microsoftonline.com/common/oauth2/v2.0/token",
                None,
            ),
            (
                &OUTLOOK_CALENDAR_SYNC,
                "https://graph.microsoft.com/v1.0/me/calendarView",
                None,
            ),
            (
                &GOOGLE_CALENDAR_OAUTH,
                "https://oauth2.googleapis.com/token",
                None,
            ),
            (
                &GOOGLE_CALENDAR_SYNC,
                "https://www.googleapis.com/calendar/v3/calendars/primary/events",
                None,
            ),
            (
                &ICS_CALENDAR_SYNC,
                "https://calendar.example.test/feed.ics",
                Some("calendar.example.test"),
            ),
        ] {
            assert!(
                recording_transport(&policy, operation, url, configured, calls.clone())
                    .await
                    .is_err()
            );
        }
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn active_connector_work_is_cancelled_when_offline_mode_turns_on() {
        let policy = policy();
        let grant = authorize_url(
            &policy,
            &ONEDRIVE_SYNC,
            "https://graph.microsoft.com/v1.0/me/drive",
        )
        .unwrap();
        let (started_tx, started_rx) = oneshot::channel();
        let work_policy = policy.clone();
        let work = tokio::spawn(async move {
            await_authorized(&work_policy, &grant, async move {
                let _ = started_tx.send(());
                std::future::pending::<anyhow::Result<()>>().await
            })
            .await
        });
        started_rx.await.unwrap();
        policy.set_offline_mode(true).unwrap();
        assert!(work.await.unwrap().is_err());
    }
}
