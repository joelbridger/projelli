//! Live smoke test against the real Wealthbox API.
//!
//! **Skipped by default** (`#[ignore]`).  To run against a real account:
//!
//! ```bash
//! WEALTHBOX_TEST_TOKEN=<token> \
//!   CARGO_TARGET_DIR=/home/jameson/lantern/src-tauri/target \
//!   cargo test --test wealthbox_live_smoke -- --ignored --nocapture
//! ```
//!
//! This test is intentionally **read-only** (GET requests only).  It prints
//! observations that help confirm empirically-unknown API behaviours (§3.6
//! of the design spec):
//!
//!   1. Total contact count + per-page loop behaviour (helps confirm max per_page).
//!   2. Whether `updated_since=<ISO-8601 UTC>` is accepted or rejected.
//!      If rejected, the format needs to be updated in `client.rs`.
//!
//! TODO(live-probe): confirm updated_since format + max per_page against a real token.

#[tokio::test]
#[ignore = "requires WEALTHBOX_TEST_TOKEN env var; run manually against a trial account"]
async fn wealthbox_live_smoke() {
    let token = std::env::var("WEALTHBOX_TEST_TOKEN")
        .expect("WEALTHBOX_TEST_TOKEN must be set to run the live smoke test");

    use lantern_lib::{
        commands::crm::client::WealthboxClient,
        network_policy::{NetworkPolicy, WEALTHBOX_AUTH, WEALTHBOX_SYNC},
    };

    // Even this manually-run probe must use the same guarded network doorway
    // as the app. Keep auth and sync as separate declared operations so the
    // privacy registry always knows what kind of data could leave the device.
    let policy_directory = tempfile::tempdir().expect("temporary network policy directory");
    let policy = NetworkPolicy::load_from_app_data_dir(policy_directory.path());
    policy
        .set_offline_mode(false)
        .expect("enable the explicitly requested live probe");
    let auth_client = WealthboxClient::new(token.clone(), policy.clone(), WEALTHBOX_AUTH);
    let sync_client = WealthboxClient::new(token, policy, WEALTHBOX_SYNC);

    // --- /me: validate token + workspace/plan metadata ---
    let me = auth_client
        .me()
        .await
        .expect("GET /me should succeed with a valid token");
    // Print only field-presence + counts — never the raw body (contains PII).
    let name_set = me.get("name").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
    let plan_set = me.get("plan").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false);
    let account_count = me.get("accounts").and_then(|v| v.as_array()).map(|a| a.len()).unwrap_or(0);
    println!(
        "[smoke] /me: name_set={name_set}, plan_set={plan_set}, accounts={account_count}"
    );

    // --- contacts: full page loop to observe count + paging ---
    let contacts = sync_client
        .list_contacts(None, None)
        .await
        .expect("list_contacts should succeed");
    println!(
        "[smoke] list_contacts: {} total contacts fetched across all pages",
        contacts.len()
    );

    // --- updated_since ISO-8601 probe ---
    // If accepted  → format is fine; record the count.
    // If rejected  → we need to switch to Wealthbox's native timestamp format
    //               (see design §3.4: "2015-05-24 10:00 AM -0400").
    let since_iso = "2020-01-01T00:00:00Z";
    match sync_client.list_contacts(Some(since_iso), None).await {
        Ok(cs) => println!(
            "[smoke] updated_since={} ACCEPTED — {} contacts returned",
            since_iso,
            cs.len()
        ),
        Err(e) => println!(
            "[smoke] updated_since={} REJECTED — {} \
             (update the format in client.rs + model.rs TODOs)",
            since_iso, e
        ),
    }
}
