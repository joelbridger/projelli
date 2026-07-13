//! The only native HTTP doorway CRM connectors may use.
//!
//! A request is authorized against the app-wide egress registry immediately
//! before reqwest is polled. A lockdown change cancels work already waiting,
//! and retries/pagination must come back through this function for each request.

use crate::network_policy::{
    AuthorizedGeneration, Destination, DestinationRule, EgressOperation, NetworkPolicy,
};
use reqwest::{header::HeaderMap, redirect::Policy, RequestBuilder, StatusCode, Url};
use serde::de::DeserializeOwned;
use serde::Serialize;
use std::fmt::Display;
use std::time::Duration;

/// Opaque CRM HTTP handle. CRM modules can prepare requests, but they never
/// receive reqwest's raw client or request types, so they cannot call the
/// transport without returning through `send_guarded` below.
pub struct GuardedHttpClient {
    inner: reqwest::Client,
}

pub struct GuardedRequestBuilder {
    inner: RequestBuilder,
}

impl GuardedHttpClient {
    pub fn get(&self, url: &str) -> GuardedRequestBuilder {
        GuardedRequestBuilder {
            inner: self.inner.get(url),
        }
    }

    pub fn post(&self, url: &str) -> GuardedRequestBuilder {
        GuardedRequestBuilder {
            inner: self.inner.post(url),
        }
    }

    pub fn put(&self, url: &str) -> GuardedRequestBuilder {
        GuardedRequestBuilder {
            inner: self.inner.put(url),
        }
    }
}

impl GuardedRequestBuilder {
    pub fn header(self, name: impl AsRef<str>, value: impl AsRef<str>) -> Self {
        let name = reqwest::header::HeaderName::from_bytes(name.as_ref().as_bytes())
            .expect("CRM request uses a valid internal header name");
        Self {
            inner: self.inner.header(name, value.as_ref()),
        }
    }

    pub fn query<T: Serialize + ?Sized>(self, query: &T) -> Self {
        Self {
            inner: self.inner.query(query),
        }
    }

    pub fn json<T: Serialize + ?Sized>(self, body: &T) -> Self {
        Self {
            inner: self.inner.json(body),
        }
    }

    pub fn form<T: Serialize + ?Sized>(self, body: &T) -> Self {
        Self {
            inner: self.inner.form(body),
        }
    }

    pub fn bearer_auth<T: Display>(self, token: T) -> Self {
        Self {
            inner: self.inner.bearer_auth(token),
        }
    }
}

/// A CRM response whose complete body was received while its policy grant was
/// still valid. Keeping this type local to the guarded doorway prevents a
/// caller from reading a response body after cancellation monitoring ended.
pub struct GuardedResponse {
    status: StatusCode,
    headers: HeaderMap,
    body: Vec<u8>,
    policy: NetworkPolicy,
    authorized: AuthorizedGeneration,
}

impl std::fmt::Debug for GuardedResponse {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("GuardedResponse")
            .field("status", &self.status)
            .field("headers", &self.headers)
            .field("body_bytes", &self.body.len())
            .finish()
    }
}

impl GuardedResponse {
    pub fn status(&self) -> StatusCode {
        self.status
    }

    pub fn headers(&self) -> &HeaderMap {
        &self.headers
    }

    pub async fn bytes(self) -> anyhow::Result<Vec<u8>> {
        Ok(self.body)
    }

    pub async fn text(self) -> anyhow::Result<String> {
        Ok(String::from_utf8(self.body)?)
    }

    pub async fn json<T: DeserializeOwned>(self) -> anyhow::Result<T> {
        Ok(serde_json::from_slice(&self.body)?)
    }

    /// Wait for a server-requested retry without losing cancellation. A
    /// lockdown flip ends the logical retry immediately instead of leaving it
    /// asleep for the full Retry-After value.
    pub async fn wait_before_retry(self, delay: Duration) -> anyhow::Result<()> {
        let mut cancellation = self
            .policy
            .register_cancellation_for(self.authorized.value());
        if cancellation.is_cancelled() {
            return Err(self
                .policy
                .assert_authorized_generation(&self.authorized)
                .unwrap_err()
                .into());
        }
        tokio::select! {
            _ = cancellation.cancelled() => Err(self
                .policy
                .assert_authorized_generation(&self.authorized)
                .unwrap_err()
                .into()),
            _ = tokio::time::sleep(delay) => {
                self.policy.assert_authorized_generation(&self.authorized)?;
                Ok(())
            }
        }
    }
}

/// Add a technical label to ordinary failures, but never cover the clear
/// privacy message with that label. Tauri normally displays only the outermost
/// error string, so wrapping a lockdown error would make the screen dishonest.
pub fn transport_error(error: anyhow::Error, context: &'static str) -> anyhow::Error {
    if let Some(policy_error) = error.downcast_ref::<crate::network_policy::NetworkPolicyError>() {
        anyhow::anyhow!(policy_error.to_string())
    } else {
        error.context(context)
    }
}

/// Every CRM client must build through this function. The returned handle is
/// deliberately opaque: only this module can reach its raw reqwest client.
/// Automatic redirects are disabled because every destination needs its own
/// registry decision.
pub fn guarded_http_client(timeout: Duration, connect_timeout: Duration) -> GuardedHttpClient {
    let inner = reqwest::Client::builder()
        .redirect(Policy::none())
        .timeout(timeout)
        .connect_timeout(connect_timeout)
        .build()
        .expect("build guarded CRM HTTP client");
    GuardedHttpClient { inner }
}

fn authorize_url(
    policy: &NetworkPolicy,
    operation: &EgressOperation,
    request_url: &str,
    configured_host: Option<&str>,
) -> anyhow::Result<AuthorizedGeneration> {
    let parsed = Url::parse(request_url)?;
    let destination = match operation.destination_rule {
        DestinationRule::UserConfiguredHost => {
            let host = configured_host.ok_or_else(|| {
                anyhow::anyhow!(
                    "{} requires a configured destination",
                    operation.receipt_label
                )
            })?;
            Destination::parse_for_configured_host(parsed, host)?
        }
        _ => Destination::parse(parsed)?,
    };
    Ok(policy.authorize(operation, &destination)?)
}

/// Guard a network action that must be handed to another process, such as an
/// OAuth sign-in page opened in the system browser.  The handoff closure cannot
/// run until the same native policy and registry used by CRM HTTP requests have
/// approved it.
pub fn handoff_guarded(
    policy: &NetworkPolicy,
    operation: &EgressOperation,
    request_url: &str,
    configured_host: Option<&str>,
    handoff: impl FnOnce(),
) -> anyhow::Result<()> {
    let authorized = authorize_url(policy, operation, request_url, configured_host)?;
    if let Err(error) = policy.assert_authorized_generation(&authorized) {
        policy.record_egress_result(
            &authorized,
            "cancelled",
            Some("POLICY_CHANGED_OR_UNAVAILABLE"),
        );
        return Err(error.into());
    }

    handoff();

    if let Err(error) = policy.assert_authorized_generation(&authorized) {
        policy.record_egress_result(
            &authorized,
            "cancelled",
            Some("POLICY_CHANGED_OR_UNAVAILABLE"),
        );
        return Err(error.into());
    }
    policy.record_egress_result(&authorized, "completed", None);
    Ok(())
}

/// Send one request through the native Network Lockdown boundary.
///
/// The request future is lazy: no socket opens until `request.send()` is polled
/// inside the select below. That means a policy flip in the small gap between
/// authorization and polling still wins and the request never starts.
pub async fn send_guarded(
    policy: &NetworkPolicy,
    operation: &EgressOperation,
    request_url: &str,
    configured_host: Option<&str>,
    request: GuardedRequestBuilder,
) -> anyhow::Result<GuardedResponse> {
    let authorized = authorize_url(policy, operation, request_url, configured_host)?;
    if let Err(error) = policy.assert_authorized_generation(&authorized) {
        policy.record_egress_result(
            &authorized,
            "cancelled",
            Some("POLICY_CHANGED_OR_UNAVAILABLE"),
        );
        return Err(error.into());
    }

    let mut cancellation = policy.register_cancellation_for(authorized.value());
    if cancellation.is_cancelled() || policy.assert_authorized_generation(&authorized).is_err() {
        policy.record_egress_result(
            &authorized,
            "cancelled",
            Some("POLICY_CHANGED_OR_UNAVAILABLE"),
        );
        return Err(policy
            .assert_authorized_generation(&authorized)
            .unwrap_err()
            .into());
    }

    tokio::select! {
        _ = cancellation.cancelled() => {
            policy.record_egress_result(
                &authorized,
                "cancelled",
                Some("POLICY_CHANGED_OR_UNAVAILABLE"),
            );
            Err(policy
                .assert_authorized_generation(&authorized)
                .unwrap_err()
                .into())
        }
        response = request.inner.send() => {
            let response = match response {
                Ok(response) => response,
                Err(error) => {
                    policy.record_egress_result(
                        &authorized,
                        "failed",
                        Some("NETWORK_REQUEST_FAILED"),
                    );
                    return Err(error.into());
                }
            };
            if response.status().is_redirection() {
                policy.record_egress_result(
                    &authorized,
                    "failed",
                    Some("REDIRECT_REQUIRES_AUTHORIZATION"),
                );
                anyhow::bail!(
                    "{} returned a redirect that was blocked before contacting another host",
                    operation.receipt_label
                );
            }
            let status = response.status();
            let headers = response.headers().clone();
            let body = tokio::select! {
                _ = cancellation.cancelled() => {
                    policy.record_egress_result(
                        &authorized,
                        "cancelled",
                        Some("POLICY_CHANGED_OR_UNAVAILABLE"),
                    );
                    return Err(policy
                        .assert_authorized_generation(&authorized)
                        .unwrap_err()
                        .into());
                }
                body = response.bytes() => {
                    match body {
                        Ok(body) => body.to_vec(),
                        Err(error) => {
                            policy.record_egress_result(
                                &authorized,
                                "failed",
                                Some("NETWORK_RESPONSE_FAILED"),
                            );
                            return Err(error.into());
                        }
                    }
                }
            };
            if let Err(error) = policy.assert_authorized_generation(&authorized) {
                policy.record_egress_result(
                    &authorized,
                    "cancelled",
                    Some("POLICY_CHANGED_OR_UNAVAILABLE"),
                );
                return Err(error.into());
            }
            policy.record_egress_result(&authorized, "completed", None);
            Ok(GuardedResponse {
                status,
                headers,
                body,
                policy: policy.clone(),
                authorized,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::network_policy::{EgressCategory, EgressDataClasses};
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    const LOOPBACK_TEST: EgressOperation = EgressOperation {
        // Reuse a registered local-only id so the registry still validates it.
        id: "local-llama",
        category: EgressCategory::LocalAi,
        destination_rule: DestinationRule::LiteralLoopbackOnly,
        data_classes: EgressDataClasses {
            content: false,
            metadata: false,
            credential: false,
        },
        receipt_label: "test request",
    };

    fn policy() -> NetworkPolicy {
        NetworkPolicy::load_from_directory(&tempfile::tempdir().unwrap().keep())
    }

    #[tokio::test]
    async fn lockdown_refuses_before_the_socket_opens() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let accepted = Arc::new(AtomicUsize::new(0));
        let accepted_by_server = accepted.clone();
        let server = tokio::spawn(async move {
            if tokio::time::timeout(std::time::Duration::from_millis(150), listener.accept())
                .await
                .is_ok()
            {
                accepted_by_server.fetch_add(1, Ordering::SeqCst);
            }
        });
        let policy = policy();
        policy.set_offline_mode(true).unwrap();
        // Use a remote CRM operation. Lockdown blocks before destination rules
        // matter, which is exactly the order the privacy guarantee needs.
        let url = format!("http://{address}/me");
        let client = guarded_http_client(
            std::time::Duration::from_secs(5),
            std::time::Duration::from_secs(2),
        );
        let result = send_guarded(
            &policy,
            &crate::network_policy::WEALTHBOX_SYNC,
            &url,
            None,
            client.get(&url),
        )
        .await;
        assert!(result.is_err());
        server.await.unwrap();
        assert_eq!(accepted.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn unlocked_request_uses_the_guarded_doorway() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut bytes = [0_u8; 1024];
            let _ = stream.read(&mut bytes).await.unwrap();
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
                .await
                .unwrap();
        });
        let policy = policy();
        let url = format!("http://{address}/health");
        let host = address.ip().to_string();
        let client = guarded_http_client(
            std::time::Duration::from_secs(5),
            std::time::Duration::from_secs(2),
        );
        let response = send_guarded(&policy, &LOOPBACK_TEST, &url, Some(&host), client.get(&url))
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        server.await.unwrap();
    }

    #[tokio::test]
    async fn turning_on_lockdown_cancels_an_active_connector_request() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let url = format!("http://{address}/slow");
        let host = address.ip().to_string();
        let policy = policy();
        let request_policy = policy.clone();
        let request_url = url.clone();
        let request_host = host.clone();
        let request = tokio::spawn(async move {
            let client = guarded_http_client(
                std::time::Duration::from_secs(5),
                std::time::Duration::from_secs(2),
            );
            send_guarded(
                &request_policy,
                &crate::network_policy::CRM_MIGRATION_IMPORT,
                &request_url,
                Some(&request_host),
                client.get(&request_url),
            )
            .await
        });

        // Accept the first connection but never answer it. The policy flip
        // must end the request without waiting for the remote side.
        let (_stream, _) =
            tokio::time::timeout(std::time::Duration::from_secs(2), listener.accept())
                .await
                .expect("guarded request should start while unlocked")
                .unwrap();
        policy.set_offline_mode(true).unwrap();
        let error = tokio::time::timeout(std::time::Duration::from_secs(2), request)
            .await
            .expect("lockdown should cancel the active request")
            .unwrap()
            .unwrap_err();
        assert!(error.to_string().contains("Network lockdown is on"));
    }

    #[tokio::test]
    async fn turning_on_lockdown_cancels_a_response_body_in_progress() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let url = format!("http://{address}/slow-body");
        let host = address.ip().to_string();
        let (headers_sent, headers_seen) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request).await.unwrap();
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\nfirst-byte")
                .await
                .unwrap();
            let _ = headers_sent.send(());
            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
        });

        let policy = policy();
        let request_policy = policy.clone();
        let request_url = url.clone();
        let request_host = host.clone();
        let request = tokio::spawn(async move {
            let client = guarded_http_client(
                std::time::Duration::from_secs(5),
                std::time::Duration::from_secs(2),
            );
            send_guarded(
                &request_policy,
                &crate::network_policy::CRM_MIGRATION_IMPORT,
                &request_url,
                Some(&request_host),
                client.get(&request_url),
            )
            .await
        });

        headers_seen.await.unwrap();
        policy.set_offline_mode(true).unwrap();
        let error = tokio::time::timeout(std::time::Duration::from_secs(2), request)
            .await
            .expect("lockdown should stop a response body in progress")
            .unwrap()
            .unwrap_err();
        assert!(error.to_string().contains("Network lockdown is on"));
        server.abort();
    }

    #[tokio::test]
    async fn turning_on_lockdown_cancels_a_retry_after_wait() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let url = format!("http://{address}/retry");
        let host = address.ip().to_string();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request).await.unwrap();
            stream
                .write_all(
                    b"HTTP/1.1 429 Too Many Requests\r\nRetry-After: 120\r\nContent-Length: 0\r\n\r\n",
                )
                .await
                .unwrap();
        });
        let policy = policy();
        let client = guarded_http_client(
            std::time::Duration::from_secs(5),
            std::time::Duration::from_secs(2),
        );
        let response = send_guarded(
            &policy,
            &crate::network_policy::CRM_MIGRATION_IMPORT,
            &url,
            Some(&host),
            client.get(&url),
        )
        .await
        .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::TOO_MANY_REQUESTS);

        let retry = tokio::spawn(response.wait_before_retry(std::time::Duration::from_secs(120)));
        tokio::task::yield_now().await;
        policy.set_offline_mode(true).unwrap();
        let error = tokio::time::timeout(std::time::Duration::from_secs(2), retry)
            .await
            .expect("lockdown should stop Retry-After immediately")
            .unwrap()
            .unwrap_err();
        assert!(error.to_string().contains("Network lockdown is on"));
        server.await.unwrap();
    }

    #[test]
    fn lockdown_refuses_an_external_browser_handoff() {
        let policy = policy();
        policy.set_offline_mode(true).unwrap();
        let handed_off = AtomicUsize::new(0);

        let error = handoff_guarded(
            &policy,
            &crate::network_policy::SALESFORCE_OAUTH,
            "https://login.salesforce.com/services/oauth2/authorize",
            None,
            || {
                handed_off.fetch_add(1, Ordering::SeqCst);
            },
        )
        .unwrap_err();

        assert!(error.to_string().contains("Network lockdown is on"));
        assert_eq!(handed_off.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn unlocked_external_browser_handoff_still_runs() {
        let policy = policy();
        let handed_off = AtomicUsize::new(0);

        handoff_guarded(
            &policy,
            &crate::network_policy::SALESFORCE_OAUTH,
            "https://login.salesforce.com/services/oauth2/authorize",
            None,
            || {
                handed_off.fetch_add(1, Ordering::SeqCst);
            },
        )
        .unwrap();

        assert_eq!(handed_off.load(Ordering::SeqCst), 1);
    }
}
