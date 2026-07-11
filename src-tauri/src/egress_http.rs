//! `reqwest` adapter that refuses to make an unapproved request.
//!
//! Redirects are handled manually (`Policy::none`) so authorization is checked
//! again before every redirect request.  Retries are intentionally not hidden
//! in this wrapper; callers that add one must call a public request method for
//! every attempt, which performs the same preflight check.

use crate::network_policy::{
    AuthorizedGeneration, Destination, EgressOperation, NetworkPolicy, NetworkPolicyError,
    PolicyCancellation,
};
use reqwest::{redirect::Policy, Response, Url};

const MAX_REDIRECTS: usize = 10;

#[derive(Clone)]
pub struct EgressHttpClient {
    client: reqwest::Client,
    policy: NetworkPolicy,
}

#[derive(Debug, thiserror::Error)]
pub enum EgressHttpError {
    #[error(transparent)]
    Policy(#[from] NetworkPolicyError),
    #[error(transparent)]
    Http(#[from] reqwest::Error),
    #[error("redirect response had no usable Location header")]
    InvalidRedirect,
    #[error("too many redirects")]
    TooManyRedirects,
}

impl EgressHttpClient {
    pub fn new(policy: NetworkPolicy) -> Result<Self, EgressHttpError> {
        Ok(Self {
            client: reqwest::Client::builder()
                .redirect(Policy::none())
                .build()?,
            policy,
        })
    }

    /// Sends a GET only after the current policy generation authorizes it.
    /// Each redirect uses this same loop, so a change between the 302 response
    /// and its follow-up request stops before opening the next socket.
    pub async fn get(
        &self,
        operation: &EgressOperation,
        url: Url,
    ) -> Result<Response, EgressHttpError> {
        let mut next_url = url;
        for redirect_count in 0..=MAX_REDIRECTS {
            let destination = Destination::parse(next_url.clone())?;
            let authorized = self.policy.authorize(operation, &destination)?;
            let mut cancellation = self.policy.register_cancellation();
            let response = self
                .send_get(&next_url, &authorized, &mut cancellation)
                .await?;

            if !response.status().is_redirection() {
                self.policy.assert_authorized_generation(&authorized)?;
                return Ok(response);
            }
            if redirect_count == MAX_REDIRECTS {
                return Err(EgressHttpError::TooManyRedirects);
            }
            // The response itself can arrive while the mode changes.  Check
            // before inspecting its redirect destination and again at the top
            // of the next iteration before any new request begins.
            self.policy.assert_authorized_generation(&authorized)?;
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or(EgressHttpError::InvalidRedirect)?;
            next_url = next_url
                .join(location)
                .map_err(|_| EgressHttpError::InvalidRedirect)?;
        }
        unreachable!("redirect loop returns after the maximum")
    }

    async fn send_get(
        &self,
        url: &Url,
        authorized: &AuthorizedGeneration,
        cancellation: &mut PolicyCancellation,
    ) -> Result<Response, EgressHttpError> {
        self.policy.assert_authorized_generation(authorized)?;
        tokio::select! {
            _ = cancellation.cancelled() => Err(NetworkPolicyError::Uninitialized.into()),
            response = self.client.get(url.clone()).send() => {
                let response = response?;
                self.policy.assert_authorized_generation(authorized)?;
                Ok(response)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::network_policy::{
        DestinationRule, EgressCategory, EgressDataClasses, EgressOperation,
    };
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    use tokio::{
        io::{AsyncReadExt, AsyncWriteExt},
        net::TcpListener,
        sync::{mpsc, oneshot},
    };

    const LOCAL_TEST: EgressOperation = EgressOperation {
        id: "local-llama",
        category: EgressCategory::LocalAi,
        destination_rule: DestinationRule::LiteralLoopbackOnly,
        data_classes: EgressDataClasses {
            content: true,
            metadata: false,
            credential: false,
        },
        receipt_label: "Local AI",
    };

    fn policy() -> NetworkPolicy {
        NetworkPolicy::load_from_directory(&tempfile::tempdir().unwrap().keep())
    }

    async fn read_request(stream: &mut tokio::net::TcpStream) {
        let mut buffer = [0_u8; 4096];
        let _ = stream.read(&mut buffer).await.unwrap();
    }

    #[tokio::test]
    async fn request_succeeds_when_policy_allows_loopback() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            read_request(&mut stream).await;
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
                .await
                .unwrap();
        });
        let client = EgressHttpClient::new(policy()).unwrap();
        let response = client
            .get(
                &LOCAL_TEST,
                Url::parse(&format!("http://{address}/ok")).unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        server.await.unwrap();
    }

    #[tokio::test]
    async fn offline_refuses_before_any_socket_is_opened() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let accepted = Arc::new(AtomicUsize::new(0));
        let accepted_by_server = accepted.clone();
        let server = tokio::spawn(async move {
            if let Ok(Ok((_stream, _))) =
                tokio::time::timeout(std::time::Duration::from_millis(150), listener.accept()).await
            {
                accepted_by_server.fetch_add(1, Ordering::SeqCst);
            }
        });
        let policy = policy();
        policy.set_offline_mode(true).unwrap();
        let client = EgressHttpClient::new(policy).unwrap();
        let error = client
            .get(
                &LOCAL_TEST,
                // The listener is deliberately reachable through `localhost`.
                // Offline Mode must reject the hostname before DNS/socket use,
                // even though it would resolve to this loopback listener.
                Url::parse(&format!("http://localhost:{}/blocked", address.port())).unwrap(),
            )
            .await
            .unwrap_err();
        assert!(error.to_string().contains("Offline Mode is on"));
        server.await.unwrap();
        assert_eq!(accepted.load(Ordering::SeqCst), 0);
    }

    #[tokio::test]
    async fn redirect_is_not_followed_after_offline_mode_turns_on() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let (first_request, mut first_request_seen) = mpsc::channel(1);
        let (send_redirect, receive_redirect) = oneshot::channel::<()>();
        let second_request_count = Arc::new(AtomicUsize::new(0));
        let count_for_server = second_request_count.clone();
        let server = tokio::spawn(async move {
            let (mut first, _) = listener.accept().await.unwrap();
            read_request(&mut first).await;
            first_request.send(()).await.unwrap();
            receive_redirect.await.unwrap();
            first
                .write_all(b"HTTP/1.1 302 Found\r\nLocation: /second\r\nContent-Length: 0\r\n\r\n")
                .await
                .unwrap();
            if let Ok(Ok((mut second, _))) =
                tokio::time::timeout(std::time::Duration::from_millis(150), listener.accept()).await
            {
                count_for_server.fetch_add(1, Ordering::SeqCst);
                read_request(&mut second).await;
            }
        });
        let policy = policy();
        let client = EgressHttpClient::new(policy.clone()).unwrap();
        let request = tokio::spawn(async move {
            client
                .get(
                    &LOCAL_TEST,
                    Url::parse(&format!("http://{address}/first")).unwrap(),
                )
                .await
        });
        first_request_seen.recv().await.unwrap();
        policy.set_offline_mode(true).unwrap();
        send_redirect.send(()).unwrap();
        let error = request.await.unwrap().unwrap_err();
        assert!(error.to_string().contains("Network policy"));
        server.await.unwrap();
        assert_eq!(second_request_count.load(Ordering::SeqCst), 0);
    }
}
