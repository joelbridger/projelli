// LIVE end-to-end test of the real Lantern mail pipeline against a real
// Microsoft 365 mailbox. #[ignore]d so it never runs in normal CI — run
// explicitly with:
//   cargo test --test mail_e2e -- --ignored --nocapture
//
// It prints a device code, polls Microsoft until you authorize that code in a
// browser (microsoft.com/devicelogin), then pulls the FIRST page of the Inbox
// via the real GraphClient and runs the real messages through the production
// parse + render pipeline (MailMessage::from_graph -> to_markdown). Bounded to
// one page so it can't pull an entire mailbox. The local ENCRYPTED write step
// (apply_page_enc / EncryptedMailStore) is covered by unit tests; this live
// smoke validates the OAuth + Graph + parse path that can only be exercised
// against a real mailbox.

use lantern_lib::commands::mail::graph::GraphClient;
use lantern_lib::commands::mail::model::MailMessage;
use lantern_lib::commands::mail::normalize::to_markdown;
use lantern_lib::commands::mail::oauth::{OAuth, TokenOutcome};

const CLIENT_ID: &str = "845ddba0-70ab-4f90-88ba-e3522157e37a";

#[tokio::test]
#[ignore]
async fn live_inbox_first_page_import() {
    let auth = OAuth::new(CLIENT_ID.to_string());

    let dc = auth.request_device_code().await.expect("request device code");
    // Markers the controller greps for:
    println!("\n===E2E=== VERIFY_URL: {}", dc.verification_uri);
    println!("===E2E=== DEVICE_CODE: {}", dc.user_code);
    println!("===E2E=== (polling up to ~14 min for you to authorize)\n");

    // Poll until authorized or timeout.
    let mut access: Option<String> = None;
    for _ in 0..170 {
        match auth.poll_token(&dc.device_code).await.expect("poll") {
            TokenOutcome::Tokens { access: a, .. } => { access = Some(a); break; }
            TokenOutcome::Pending | TokenOutcome::SlowDown => {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
            }
            TokenOutcome::Failed(e) => panic!("auth failed: {e}"),
        }
    }
    let access = access.expect("===E2E=== TIMED OUT waiting for authorization");
    println!("===E2E=== AUTHORIZED ok (got access token, {} chars)", access.len());

    // Real Graph client; pull the first delta page of the Inbox (well-known folder).
    let client = GraphClient::new(access);
    let url = format!("{}/v1.0/me/mailFolders/inbox/messages/delta", client.base());
    let page = client.get_json(&url).await.expect("fetch inbox delta page 1");
    let n = page.get("value").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
    println!("===E2E=== inbox delta page 1 returned {n} message(s)");

    // Run the REAL messages through the production parse + render pipeline —
    // the same MailMessage::from_graph -> to_markdown path mail sync uses — so
    // this proves real provider data flows through our code end to end.
    let items = page.get("value").and_then(|v| v.as_array()).cloned().unwrap_or_default();
    let mut parsed = 0usize;
    let mut sample = String::new();
    for item in &items {
        if let Some(m) = MailMessage::from_graph(item) {
            let md = to_markdown(&m);
            if !md.trim().is_empty() {
                parsed += 1;
                if sample.is_empty() {
                    sample = md.lines().take(12).collect::<Vec<_>>().join("\n");
                }
            }
        }
    }
    println!("===E2E=== parsed {parsed} message(s) into Markdown");
    if !sample.is_empty() {
        println!("===E2E=== SAMPLE MESSAGE (Markdown):\n{sample}\n===E2E=== (truncated)");
    }

    assert!(parsed > 0 || n == 0, "expected to parse messages into Markdown when the inbox returned any");
    println!("===E2E=== PASS");
}
