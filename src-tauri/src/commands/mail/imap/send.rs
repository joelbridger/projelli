//! SMTP send for IMAP-connected accounts.
//!
//! IMAP stores are typically paired with a STARTTLS SMTP server on port 587
//! at the same hostname. We default to the stored IMAP host on port 587. The
//! user provides an app password or regular password (the same credential used
//! for IMAP login — for providers that use separate SMTP credentials the user
//! must configure the same password for both, which is the common case for
//! Gmail app-passwords, Fastmail, ProtonMail bridge, etc.).
//!
//! The SMTP host is derived from the IMAP host (same host, port 587). If the
//! IMAP host is an IMAP-specific subdomain (e.g. `imap.example.com`) this
//! derivation may be wrong (the SMTP host might be `smtp.example.com`). The
//! current implementation tries the same host and returns a clear error if it
//! fails — the user can diagnose from the error message.

use anyhow::Context as _;
use crate::commands::mail::AttachmentInput;
use lettre::{
    message::{Attachment, Mailboxes, MultiPart, SinglePart},
    message::header::ContentType as LettreContentType,
    transport::smtp::authentication::Credentials,
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
};
use std::str::FromStr;

/// Send an email over SMTP using STARTTLS (port 587).
///
/// `smtp_host` defaults to the IMAP host when None. `smtp_port` defaults to
/// 587. `username` and `password` are the SMTP credentials (same as the IMAP
/// credentials for most providers).
///
/// `in_reply_to` / `references` are RFC2822 threading headers; pass them when
/// replying.
///
/// Returns the empty string on success (SMTP has no server-assigned message id).
#[allow(clippy::too_many_arguments)]
pub async fn smtp_send(
    imap_host: &str,
    smtp_port: u16,
    username: &str,
    password: &str,
    from: &str,
    to: &[String],
    cc: &[String],
    bcc: &[String],
    subject: &str,
    body: &str,
    in_reply_to: Option<&str>,
    references: Option<&str>,
    attachments: &[AttachmentInput],
) -> anyhow::Result<String> {
    // Build the RFC822 message via lettre.
    let mut builder = Message::builder()
        .from(
            from.parse()
                .map_err(|e| anyhow::anyhow!("invalid From address {from:?}: {e}"))?,
        )
        .subject(subject);

    for addr in to {
        let mbs = Mailboxes::from_str(addr)
            .map_err(|e| anyhow::anyhow!("invalid To address {addr:?}: {e}"))?;
        for mb in mbs {
            builder = builder.to(mb);
        }
    }
    for addr in cc {
        let mbs = Mailboxes::from_str(addr)
            .map_err(|e| anyhow::anyhow!("invalid Cc address {addr:?}: {e}"))?;
        for mb in mbs {
            builder = builder.cc(mb);
        }
    }
    for addr in bcc {
        let mbs = Mailboxes::from_str(addr)
            .map_err(|e| anyhow::anyhow!("invalid Bcc address {addr:?}: {e}"))?;
        for mb in mbs {
            builder = builder.bcc(mb);
        }
    }

    if let Some(irt) = in_reply_to {
        builder = builder.in_reply_to(irt.to_string());
    }
    if let Some(refs) = references {
        builder = builder.references(refs.to_string());
    }

    let email = if attachments.is_empty() {
        builder
            .body(body.to_string())
            .context("build RFC822 message for SMTP")?
    } else {
        use base64::Engine;
        let mut mixed = MultiPart::mixed()
            .singlepart(SinglePart::plain(body.to_string()));
        for att in attachments {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(&att.content_base64)
                .map_err(|e| anyhow::anyhow!("decode attachment {:?}: {e}", att.name))?;
            let ct = LettreContentType::parse(&att.content_type)
                .unwrap_or_else(|_| LettreContentType::parse("application/octet-stream").unwrap());
            mixed = mixed.singlepart(Attachment::new(att.name.clone()).body(bytes, ct));
        }
        builder
            .multipart(mixed)
            .context("build RFC822 multipart message for SMTP")?
    };

    // Build the STARTTLS transport (port 587). Uses the IMAP host as the SMTP
    // host — this is correct for most providers (Gmail app-password, Fastmail,
    // iCloud, ProtonMail bridge). Providers with a distinct smtp.* subdomain
    // will get a connection error here; the error message includes the host so
    // the user can diagnose.
    let creds = Credentials::new(username.to_string(), password.to_string());
    let mailer: AsyncSmtpTransport<Tokio1Executor> =
        AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(imap_host)
            .with_context(|| format!("build SMTP transport for {imap_host}:{smtp_port}"))?
            .port(smtp_port)
            .credentials(creds)
            .build();

    mailer
        .send(email)
        .await
        .with_context(|| format!("SMTP send via {imap_host}:{smtp_port}"))?;

    Ok(String::new())
}

#[cfg(test)]
mod tests {
    /// Verify the RFC822 builder does not panic with typical inputs.
    /// We cannot test actual SMTP delivery without a real server (which the
    /// tests do not have access to), so we confirm the message compiles
    /// correctly by building it and checking key headers.
    #[test]
    fn builds_rfc822_with_threading_headers() {
        use lettre::{message::Mailboxes, Message};
        use std::str::FromStr;

        let email = Message::builder()
            .from("sender@example.com".parse().unwrap())
            .to(Mailboxes::from_str("recipient@example.com").unwrap().into_iter().next().unwrap())
            .subject("Test reply")
            .in_reply_to("<original@mail.example.com>".to_string())
            .references("<original@mail.example.com>".to_string())
            .body("Test body".to_string())
            .expect("build message");

        let formatted = email.formatted();
        let raw = String::from_utf8_lossy(&formatted);
        assert!(raw.contains("In-Reply-To:"), "missing In-Reply-To header: {raw}");
        assert!(raw.contains("References:"), "missing References header: {raw}");
        assert!(raw.contains("Subject: Test reply"), "missing Subject: {raw}");
    }
}
