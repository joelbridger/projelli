//! Shared native connector guard.
//!
//! This is deliberately a small consumer of `NetworkPolicy`, not a second
//! policy.  Connector clients use it immediately before each transport future
//! so a mode change cancels work already waiting on a remote service.

use crate::network_policy::{AuthorizedGeneration, Destination, EgressOperation, NetworkPolicy};
use reqwest::{header::LOCATION, Response, Url};
use std::future::Future;

/// Keep redirect handling outside reqwest's automatic redirect machinery so
/// every destination receives a fresh policy authorization before its socket
/// can open. Callers must build their client with `Policy::none()`.
pub async fn send_with_authorized_redirects<F, Fut>(
    policy: &NetworkPolicy,
    operation: &EgressOperation,
    initial_url: &str,
    build_request: F,
) -> anyhow::Result<Response>
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = anyhow::Result<Response>>,
{
    const MAX_REDIRECT_HOPS: usize = 5;
    let mut next_url = Url::parse(initial_url)?;

    for redirect_hops in 0..=MAX_REDIRECT_HOPS {
        let url = next_url.as_str().to_string();
        let authorized = authorize_url(policy, operation, &url)?;
        let response = await_authorized(policy, &authorized, build_request(url)).await?;

        if !response.status().is_redirection() {
            return Ok(response);
        }
        if redirect_hops == MAX_REDIRECT_HOPS {
            anyhow::bail!("too many redirects (maximum {MAX_REDIRECT_HOPS})");
        }
        // Ensure a policy flip that raced the redirect response wins before we
        // inspect or follow its destination. The next loop iteration parses
        // and authorizes the Location before sending anything.
        policy.assert_authorized_generation(&authorized)?;
        let location = response
            .headers()
            .get(LOCATION)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| anyhow::anyhow!("redirect response had no usable Location header"))?;
        next_url = next_url.join(location)?;
    }

    unreachable!("redirect loop returns at its bound")
}

pub fn authorize_url(
    policy: &NetworkPolicy,
    operation: &EgressOperation,
    url: &str,
) -> anyhow::Result<AuthorizedGeneration> {
    let parsed = Url::parse(url)?;
    let destination = match operation.destination_rule {
        crate::network_policy::DestinationRule::UserConfiguredHost => {
            let host = parsed
                .host_str()
                .ok_or_else(|| anyhow::anyhow!("URL has no host"))?
                .to_string();
            Destination::parse_for_configured_host(parsed, &host)?
        }
        _ => Destination::parse(parsed)?,
    };
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

/// Authorize a URL against a persisted user-configured origin.  This is used
/// for secret-bearing URLs such as ICS feeds: host-only matching would permit
/// a scheme or port change to reuse the configured authority.
pub fn authorize_configured_origin(
    policy: &NetworkPolicy,
    operation: &EgressOperation,
    url: &str,
    configured_url: &str,
) -> anyhow::Result<AuthorizedGeneration> {
    let requested = Url::parse(url)?;
    let configured = Url::parse(configured_url)?;
    if requested.scheme() != configured.scheme()
        || requested.host_str().map(str::to_ascii_lowercase)
            != configured.host_str().map(str::to_ascii_lowercase)
        || requested.port_or_known_default() != configured.port_or_known_default()
    {
        anyhow::bail!("configured destination origin does not match request origin");
    }
    let host = configured
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("configured URL has no host"))?;
    let destination = Destination::parse_for_configured_host(requested, host)?;
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
    await_authorized_after_check(policy, authorized, || {}, request).await
}

async fn await_authorized_after_check<T>(
    policy: &NetworkPolicy,
    authorized: &AuthorizedGeneration,
    after_initial_check: impl FnOnce(),
    request: impl Future<Output = anyhow::Result<T>>,
) -> anyhow::Result<T> {
    if let Err(error) = policy.assert_authorized_generation(authorized) {
        policy.record_egress_result(
            authorized,
            "cancelled",
            Some("POLICY_CHANGED_OR_UNAVAILABLE"),
        );
        return Err(error.into());
    }
    // Keep the capability's generation as the cancellation baseline.  If
    // Offline Mode changes in the tiny gap above, this receiver is already
    // cancelled when select! starts and the transport is never polled.
    after_initial_check();
    let mut cancellation = policy.register_cancellation_for(authorized.value());
    if cancellation.is_cancelled() {
        policy.record_egress_result(
            authorized,
            "cancelled",
            Some("POLICY_CHANGED_OR_UNAVAILABLE"),
        );
        return Err(anyhow::Error::from(
            crate::network_policy::NetworkPolicyError::Uninitialized,
        ));
    }
    tokio::select! {
        _ = cancellation.cancelled() => {
            policy.record_egress_result(authorized, "cancelled", Some("POLICY_CHANGED_OR_UNAVAILABLE"));
            Err(anyhow::Error::from(crate::network_policy::NetworkPolicyError::Uninitialized))
        },
        result = request => {
            match result {
                Err(error) => {
                    policy.record_egress_result(authorized, "failed", Some("NETWORK_REQUEST_FAILED"));
                    Err(error)
                }
                Ok(result) => match policy.assert_authorized_generation(authorized) {
                    Ok(()) => {
                        policy.record_egress_result(authorized, "completed", None);
                        Ok(result)
                    }
                    Err(error) => {
                        policy.record_egress_result(authorized, "cancelled", Some("POLICY_CHANGED_OR_UNAVAILABLE"));
                        Err(error.into())
                    }
                }
            }
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

    #[tokio::test]
    async fn flip_between_initial_check_and_registration_never_polls_transport() {
        let policy = policy();
        let grant = authorize_url(
            &policy,
            &ONEDRIVE_SYNC,
            "https://graph.microsoft.com/v1.0/me/drive",
        )
        .unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        let flip_policy = policy.clone();
        let transport_calls = calls.clone();
        let result = await_authorized_after_check(
            &policy,
            &grant,
            move || flip_policy.set_offline_mode(true).unwrap(),
            async move {
                transport_calls.fetch_add(1, Ordering::SeqCst);
                Ok(())
            },
        )
        .await;
        assert!(result.is_err());
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn real_mail_providers_do_not_reach_their_transport_when_offline() {
        use crate::commands::mail::provider::MailProvider;
        use wiremock::MockServer;

        let server = MockServer::start().await;
        let server_url = server.uri().replace("127.0.0.1", "localhost");
        let policy = policy();
        policy.set_offline_mode(true).unwrap();

        let graph = crate::commands::mail::graph::GraphProvider::new_with_base(
            "token".into(),
            server_url.clone(),
        )
        .with_network_policy(policy.clone(), OUTLOOK_MAIL_SYNC);
        assert!(graph.list_folders().await.is_err());
        let gmail = crate::commands::mail::gmail::GmailProvider::new_with_base(
            "token".into(),
            "me@example.test".into(),
            server_url,
        )
        .with_network_policy(policy, GMAIL_SYNC);
        assert!(gmail
            .fetch_changes(
                &crate::commands::mail::provider::RemoteFolder {
                    id: "INBOX".into(),
                    display_name: "Inbox".into()
                },
                &crate::commands::mail::provider::Cursor::Backfill,
            )
            .await
            .is_err());
        assert!(server.received_requests().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn real_onedrive_calendar_and_ics_clients_do_not_reach_transport_when_offline() {
        use crate::commands::calendar::graph_source::CalendarSource;
        use wiremock::MockServer;

        let server = MockServer::start().await;
        let server_url = server.uri().replace("127.0.0.1", "localhost");
        let policy = policy();
        policy.set_offline_mode(true).unwrap();
        let onedrive = crate::commands::onedrive::client::OneDriveClient::new_with_base(
            "token".into(),
            server_url.clone(),
        )
        .with_network_policy(policy.clone(), ONEDRIVE_SYNC);
        assert!(onedrive.list_drives().await.is_err());
        let calendar = crate::commands::calendar::graph_source::GraphCalendarSource::new_with_base(
            server_url.clone(),
            || async { Ok("token".to_string()) },
            policy.clone(),
        );
        assert!(calendar
            .fetch_events("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z")
            .await
            .is_err());
        assert!(crate::commands::calendar::ics_source::fetch_ics_text(
            &policy,
            &server_url,
            &format!("{server_url}/feed.ics"),
        )
        .await
        .is_err());
        assert!(server.received_requests().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn real_imap_and_smtp_sessions_do_not_open_when_offline() {
        use crate::commands::mail::imap::send::smtp_send;
        use crate::commands::mail::provider::MailProvider;
        use wiremock::MockServer;

        let server = MockServer::start().await;
        let policy = policy();
        policy.set_offline_mode(true).unwrap();
        let imap = crate::commands::mail::imap::ImapProvider {
            host: "localhost".into(),
            port: server.address().port(),
            username: "user".into(),
            password: "password".into(),
            account: "user".into(),
            policy: policy.clone(),
        };
        assert!(imap.list_folders().await.is_err());
        assert!(smtp_send(
            &policy,
            "localhost",
            server.address().port(),
            "sender@example.test",
            "password",
            "sender@example.test",
            &["recipient@example.test".into()],
            &[],
            &[],
            "subject",
            "body",
            None,
            None,
            &[],
        )
        .await
        .is_err());
        assert!(server.received_requests().await.unwrap().is_empty());
    }

    #[test]
    fn configured_origin_requires_matching_scheme_host_and_port() {
        let policy = policy();
        assert!(authorize_configured_origin(
            &policy,
            &ICS_CALENDAR_SYNC,
            "https://calendar.example.test:8443/feed.ics",
            "https://calendar.example.test/feed.ics",
        )
        .is_err());
        assert!(authorize_configured_origin(
            &policy,
            &ICS_CALENDAR_SYNC,
            "http://calendar.example.test/feed.ics",
            "https://calendar.example.test/feed.ics",
        )
        .is_err());
    }

    #[tokio::test]
    async fn guarded_redirect_rejects_an_unapproved_second_hop_before_transport() {
        use wiremock::{matchers::{method, path}, Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let initial = format!("{}/first", server.uri());
        let forbidden_second_hop = format!("http://localhost:{}/second", server.address().port());
        Mock::given(method("GET"))
            .and(path("/first"))
            .respond_with(ResponseTemplate::new(302).insert_header("Location", forbidden_second_hop))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/second"))
            .respond_with(ResponseTemplate::new(200))
            .mount(&server)
            .await;

        let policy = policy();
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let result = send_with_authorized_redirects(
            &policy,
            &crate::network_policy::LOCAL_LLAMA,
            &initial,
            |url| {
                let http = http.clone();
                async move { Ok(http.get(url).send().await?) }
            },
        )
        .await;

        assert!(result.is_err());
        let requests = server.received_requests().await.unwrap();
        assert_eq!(requests.len(), 1, "the forbidden redirect must never be followed");
    }
}
