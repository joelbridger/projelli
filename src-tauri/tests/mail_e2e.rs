// LIVE end-to-end test of the real Keepance mail pipeline against a real
// Microsoft 365 mailbox. #[ignore]d so it never runs in normal CI — run
// explicitly with:
//   cargo test --test mail_e2e -- --ignored --nocapture
//
// It prints a device code, polls Microsoft until you authorize that code in a
// browser (microsoft.com/devicelogin), then pulls the FIRST page of the Inbox
// via the real GraphClient + apply_page, writing real Markdown files to a temp
// workspace. Bounded to one page so it can't pull an entire mailbox.

use keepance_lib::commands::mail::graph::GraphClient;
use keepance_lib::commands::mail::oauth::{OAuth, TokenOutcome};
use keepance_lib::commands::mail::store::{MailStore, SqliteMailStore};
use keepance_lib::commands::mail::sync::apply_page;

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

    // Real store + real file writes into a temp workspace.
    let ws = std::path::PathBuf::from("/tmp/keepance-mail-e2e");
    let _ = std::fs::remove_dir_all(&ws);
    std::fs::create_dir_all(&ws).unwrap();
    let store = SqliteMailStore::open(&ws).expect("open store");
    let stats = apply_page(&store, &ws, "inbox", &page).expect("apply page");

    println!("===E2E=== WROTE {} file(s), removed {}", stats.written, stats.removed);
    println!("===E2E=== store now tracks {} message(s)", store.count().unwrap());
    println!("===E2E=== files under: {}/Mail/inbox/", ws.display());

    // Show one real file as proof the pipeline produced usable Markdown.
    if let Ok(rd) = std::fs::read_dir(ws.join("Mail").join("inbox")) {
        if let Some(Ok(first)) = rd.into_iter().next() {
            let body = std::fs::read_to_string(first.path()).unwrap_or_default();
            let preview: String = body.lines().take(12).collect::<Vec<_>>().join("\n");
            println!("===E2E=== SAMPLE FILE ({}):\n{}\n===E2E=== (truncated)", first.file_name().to_string_lossy(), preview);
        }
    }

    assert!(stats.written > 0 || n == 0, "expected to write files when messages were returned");
    println!("===E2E=== PASS");
}
