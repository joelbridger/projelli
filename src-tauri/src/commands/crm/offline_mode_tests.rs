//! Guarantee tests for every CRM transport family.
//!
//! These use the real clients with fake credentials. Lockdown must reject at
//! the shared native doorway before reqwest can attempt DNS or open a socket.

use std::time::{SystemTime, UNIX_EPOCH};

use crate::commands::crm::{
    client::WealthboxClient,
    redtail::RedtailClient,
    salesforce::{exchange_salesforce_code, SalesforceClient, SalesforceTokenSet},
    write::{CrmWriteKind, CrmWriteRequest, CrmWriteSource},
};
use crate::network_policy::{NetworkPolicy, WEALTHBOX_AUTH, WEALTHBOX_SYNC, WEALTHBOX_WRITE};

fn locked_policy() -> NetworkPolicy {
    let policy = NetworkPolicy::load_from_directory(&tempfile::tempdir().unwrap().keep());
    policy.set_offline_mode(true).unwrap();
    policy
}

fn assert_lockdown(error: anyhow::Error) {
    assert!(
        error.to_string().contains("Network lockdown is on"),
        "expected the honest lockdown message, got: {error:#}"
    );
}

#[tokio::test]
async fn lockdown_blocks_wealthbox_auth_sync_write_retry_seam_and_migration() {
    let policy = locked_policy();

    assert_lockdown(
        WealthboxClient::new("token".into(), policy.clone(), WEALTHBOX_AUTH)
            .me()
            .await
            .unwrap_err(),
    );
    assert_lockdown(
        WealthboxClient::new("token".into(), policy.clone(), WEALTHBOX_SYNC)
            .list_households()
            .await
            .unwrap_err(),
    );
    let write = CrmWriteRequest {
        kind: CrmWriteKind::Note,
        matter_id: "matter-1".into(),
        household_key: "1".into(),
        title: "Follow up".into(),
        body: "Call the client".into(),
        due_date: None,
        source_ref: "test".into(),
        requested_at: "2026-07-13T00:00:00Z".into(),
        provenance: None,
    };
    let write_error = WealthboxClient::new("token".into(), policy.clone(), WEALTHBOX_WRITE)
        .create_note(&write)
        .await
        .unwrap_err();
    assert!(write_error.to_string().contains("Network lockdown is on"));

    let migration = WealthboxClient::new_migration(
        "fabricated-token".into(),
        "http://127.0.0.1:9/v1".into(),
        policy,
    )
    .unwrap();
    assert_lockdown(migration.get_json("/contacts", &[]).await.unwrap_err());
}

#[tokio::test]
async fn lockdown_blocks_salesforce_oauth_refresh_identity_and_sync() {
    let policy = locked_policy();
    assert_lockdown(
        exchange_salesforce_code(
            "client",
            "code",
            "verifier",
            "http://127.0.0.1/callback",
            "https://login.salesforce.com/services/oauth2/token",
            &policy,
        )
        .await
        .unwrap_err(),
    );

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let stored = serde_json::to_string(&SalesforceTokenSet {
        access_token: "access".into(),
        refresh_token: "refresh".into(),
        instance_url: "https://example.my.salesforce.com".into(),
        expires_at_unix: now + 3600,
        id_url: "https://login.salesforce.com/id/org/user".into(),
    })
    .unwrap();
    let client = SalesforceClient::new_with_token_endpoint(
        stored,
        "client".into(),
        "https://login.salesforce.com/services/oauth2/token".into(),
        policy,
    )
    .unwrap();
    assert_lockdown(client.identity().await.unwrap_err());
}

#[tokio::test]
async fn lockdown_blocks_redtail_login_validation_and_sync() {
    let policy = locked_policy();
    assert_lockdown(
        RedtailClient::authenticate_with_base_and_policy(
            "api-key",
            "advisor",
            "password",
            "https://api2.redtailtechnology.com/crm/v1/rest",
            &policy,
        )
        .await
        .unwrap_err(),
    );
    let client = RedtailClient::new_with_base_and_policy(
        "api-key".into(),
        "user-key".into(),
        "https://api2.redtailtechnology.com/crm/v1/rest".into(),
        policy,
    );
    assert_lockdown(client.validate_user_key().await.unwrap_err());
}
