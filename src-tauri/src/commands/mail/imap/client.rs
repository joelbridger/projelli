//! Thin IMAP connection wrapper.
//!
//! Provides async helpers to open a TLS IMAP session (imaps, port 993),
//! list folders, select a mailbox, and UID-fetch a range of messages.
//!
//! Every network operation is bounded by a timeout so a stalled server (slow
//! TLS handshake, no LOGIN response, mid-fetch hang) can never block the sync
//! task indefinitely (which would hold the `is_syncing` guard until an app
//! restart). Mirrors the timeouts the Graph HTTP client already sets.
//!
//! These functions touch the network and are intentionally NOT unit-tested.
//! Live coverage is exercised by the manual #[ignore]d smoke test described
//! in `imap/mod.rs`.

use anyhow::Context as _;
use async_imap::types::Name;
use futures_util::TryStreamExt;
use native_tls::TlsConnector;
use tokio::net::TcpStream;
use tokio::time::{timeout, Duration};
use tokio_native_tls::TlsStream;

/// Bound for establishing the connection (TCP + TLS + greeting + LOGIN).
const CONNECT_TIMEOUT: Duration = Duration::from_secs(30);
/// Bound for a lightweight command (SELECT, LIST).
const CMD_TIMEOUT: Duration = Duration::from_secs(30);
/// Bound for a UID FETCH batch (can transfer up to a few hundred messages).
const FETCH_TIMEOUT: Duration = Duration::from_secs(120);

/// An authenticated IMAP session over TLS.
pub type ImapSession = async_imap::Session<TlsStream<TcpStream>>;

/// Open a TLS IMAP connection (imaps) and log in with the supplied credentials.
///
/// On success returns an authenticated [`ImapSession`] ready for IMAP commands.
/// The whole connect + handshake + login sequence is bounded by [`CONNECT_TIMEOUT`].
pub async fn connect(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
) -> anyhow::Result<ImapSession> {
    timeout(CONNECT_TIMEOUT, connect_inner(host, port, username, password))
        .await
        .map_err(|_| anyhow::anyhow!("IMAP connect to {host}:{port} timed out"))?
}

async fn connect_inner(
    host: &str,
    port: u16,
    username: &str,
    password: &str,
) -> anyhow::Result<ImapSession> {
    // Establish TCP then wrap in TLS.
    let tcp = TcpStream::connect((host, port))
        .await
        .with_context(|| format!("IMAP TCP connect to {host}:{port}"))?;

    let tls = TlsConnector::builder()
        .build()
        .context("build TLS connector")?;
    let tls = tokio_native_tls::TlsConnector::from(tls);
    let tls_stream = tls
        .connect(host, tcp)
        .await
        .with_context(|| format!("IMAP TLS handshake with {host}"))?;

    // Build an async-imap client over the TLS stream.
    let mut client = async_imap::Client::new(tls_stream);

    // Read the server greeting before issuing LOGIN.
    client
        .read_response()
        .await
        .context("read IMAP greeting")?
        .ok_or_else(|| anyhow::anyhow!("IMAP server closed connection before greeting"))?;

    // Authenticate (login returns the error alongside the client so the caller
    // can retry; we just surface the error here). The error enum never contains
    // the password.
    let session = client
        .login(username, password)
        .await
        .map_err(|(e, _client)| anyhow::anyhow!("IMAP LOGIN failed: {e}"))?;

    Ok(session)
}

/// UIDVALIDITY and UIDNEXT as returned by SELECT.
#[derive(Debug, Clone, Copy)]
pub struct MailboxInfo {
    pub uid_validity: u32,
    /// Next UID that will be assigned.  A new message arrives iff UID < uid_next.
    pub uid_next: u32,
}

/// Select `mailbox_name` and return its UIDVALIDITY + UIDNEXT.
///
/// Returns an error if the server does not report both values (required by
/// RFC 3501 §2.3.1).
pub async fn select_mailbox(
    session: &mut ImapSession,
    mailbox_name: &str,
) -> anyhow::Result<MailboxInfo> {
    let mbox = timeout(CMD_TIMEOUT, session.select(mailbox_name))
        .await
        .map_err(|_| anyhow::anyhow!("IMAP SELECT {mailbox_name} timed out"))?
        .with_context(|| format!("IMAP SELECT {mailbox_name}"))?;

    let uid_validity = mbox
        .uid_validity
        .ok_or_else(|| anyhow::anyhow!("server did not report UIDVALIDITY for {mailbox_name}"))?;
    let uid_next = mbox
        .uid_next
        .ok_or_else(|| anyhow::anyhow!("server did not report UIDNEXT for {mailbox_name}"))?;

    Ok(MailboxInfo {
        uid_validity,
        uid_next,
    })
}

/// LIST all mailboxes and return their names.
pub async fn list_mailboxes(session: &mut ImapSession) -> anyhow::Result<Vec<String>> {
    let collect = async {
        let names_stream = session.list(Some(""), Some("*")).await.context("IMAP LIST")?;
        let names: Vec<Name> = names_stream
            .try_collect()
            .await
            .context("collect IMAP LIST response")?;
        Ok::<Vec<Name>, anyhow::Error>(names)
    };
    let names = timeout(CMD_TIMEOUT, collect)
        .await
        .map_err(|_| anyhow::anyhow!("IMAP LIST timed out"))??;

    Ok(names.iter().map(|n| n.name().to_string()).collect())
}

/// UID-FETCH a contiguous inclusive range `[first_uid, last_uid]` using
/// `BODY.PEEK[]` (never sets the `\Seen` flag).
///
/// Returns `(uid, raw_rfc822_bytes)` pairs for messages that have a body.
/// Messages with no body in the response are silently skipped.
pub async fn uid_fetch_range(
    session: &mut ImapSession,
    first_uid: u32,
    last_uid: u32,
) -> anyhow::Result<Vec<(u32, Vec<u8>)>> {
    let uid_set = format!("{first_uid}:{last_uid}");

    // BODY.PEEK[] fetches the complete RFC822 message without marking \Seen.
    let collect = async {
        let fetch_stream = session
            .uid_fetch(&uid_set, "BODY.PEEK[]")
            .await
            .with_context(|| format!("UID FETCH {uid_set}"))?;
        let fetches: Vec<_> = fetch_stream
            .try_collect()
            .await
            .with_context(|| format!("collect UID FETCH {uid_set}"))?;
        Ok::<Vec<_>, anyhow::Error>(fetches)
    };
    let fetches = timeout(FETCH_TIMEOUT, collect)
        .await
        .map_err(|_| anyhow::anyhow!("UID FETCH {uid_set} timed out"))??;

    let mut results = Vec::with_capacity(fetches.len());
    for fetch in &fetches {
        let uid = match fetch.uid {
            Some(u) => u,
            None => continue, // no UID in response; skip
        };
        let raw = match fetch.body() {
            Some(b) => b.to_vec(),
            None => continue, // server returned no body section; skip
        };
        results.push((uid, raw));
    }

    Ok(results)
}

/// `UID SEARCH ALL` — returns every UID currently present in the selected
/// mailbox. Used to diff against locally-known ids and detect server-side
/// deletions/expunges (IMAP has no delta/history token, unlike Graph/Gmail).
pub async fn uid_search_all(session: &mut ImapSession) -> anyhow::Result<Vec<u32>> {
    let uids = timeout(CMD_TIMEOUT, session.uid_search("ALL"))
        .await
        .map_err(|_| anyhow::anyhow!("IMAP UID SEARCH ALL timed out"))?
        .context("IMAP UID SEARCH ALL")?;
    Ok(uids.into_iter().collect())
}
