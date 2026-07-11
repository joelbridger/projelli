//! Offline Mode coverage for the real CRM and advisor connector clients.
//!
//! These tests deliberately construct the production clients rather than a
//! transport fake. With the policy already offline, every call must fail at
//! authorization, before reqwest is allowed to poll its request future.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::commands::addepar::{client::AddeparClient, model::AddeparConfig};
use crate::commands::boxc::client::BoxClient;
use crate::commands::calendly::client::CalendlyClient;
use crate::commands::crm::{
    client::WealthboxClient,
    redtail::RedtailClient,
    salesforce::{exchange_salesforce_code, SalesforceClient, SalesforceTokenSet},
    write::{CrmWriteKind, CrmWriteRequest, CrmWriteSource},
};
use crate::commands::docusign::{
    client::DocusignClient, model::DocusignEnvironment, oauth::DocusignOAuth,
};
use crate::commands::jotform::client::JotformClient;
use crate::commands::sharefile::client::SharefileClient;
use crate::commands::zocks::client::ZocksClient;
use crate::network_policy::{
    NetworkPolicy, ADDEPAR_SYNC, BOX_SYNC, CALENDLY_SYNC, DOCUSIGN_SYNC, JOTFORM_SYNC,
    SHAREFILE_SYNC, WEALTHBOX_SYNC, WEALTHBOX_WRITE, ZOCKS_SYNC,
};

fn offline_policy() -> NetworkPolicy {
    let policy = NetworkPolicy::load_from_directory(&tempfile::tempdir().unwrap().keep());
    policy.set_offline_mode(true).unwrap();
    policy
}

#[tokio::test]
async fn offline_mode_blocks_all_crm_and_advisor_connector_transports_before_reqwest() {
    let policy = offline_policy();

    // Wealthbox: API-key check and the actual POST write-back path.
    assert!(WealthboxClient::new("wealthbox-key".into())
        .with_network_policy(policy.clone(), WEALTHBOX_SYNC)
        .me()
        .await
        .is_err());
    let write = CrmWriteRequest {
        kind: CrmWriteKind::Note,
        matter_id: "matter-1".into(),
        household_key: "1".into(),
        title: "Follow up".into(),
        body: "Call client".into(),
        due_date: None,
        source_ref: "test".into(),
        requested_at: "2026-07-11T00:00:00Z".into(),
        provenance: None,
    };
    assert!(WealthboxClient::new("wealthbox-key".into())
        .with_network_policy(policy.clone(), WEALTHBOX_WRITE)
        .create_note(&write)
        .await
        .is_err());

    // API-key checks, list/import calls, and their pagination loops all use
    // these clients' guarded request helpers.
    assert!(CalendlyClient::new("token".into(), String::new())
        .with_network_policy(policy.clone(), CALENDLY_SYNC)
        .current_user()
        .await
        .is_err());
    assert!(AddeparClient::new(AddeparConfig {
        api_key: "key".into(),
        api_secret: "secret".into(),
        subdomain: "example".into(),
        firm_id: "firm".into(),
    })
    .with_network_policy(policy.clone(), ADDEPAR_SYNC)
    .validate()
    .await
    .is_err());
    assert!(BoxClient::new("token".into())
        .with_network_policy(policy.clone(), BOX_SYNC)
        .current_user()
        .await
        .is_err());
    assert!(JotformClient::new("jotform-key".into())
        .with_network_policy(policy.clone(), JOTFORM_SYNC)
        .current_user()
        .await
        .is_err());
    assert!(
        SharefileClient::new("token".into(), "example.sharefile.com".into())
            .unwrap()
            .with_network_policy(policy.clone(), SHAREFILE_SYNC)
            .validate_token()
            .await
            .is_err()
    );
    assert!(ZocksClient::new("zocks-key".into())
        .with_network_policy(policy.clone(), ZOCKS_SYNC)
        .validate_connection()
        .await
        .is_err());

    // DocuSign has both OAuth and import traffic.
    assert!(
        DocusignOAuth::new("client".into(), DocusignEnvironment::Demo)
            .with_network_policy(policy.clone())
            .exchange_code("code", "verifier", "http://localhost/callback")
            .await
            .is_err()
    );
    assert!(DocusignClient::new(
        "token".into(),
        "account".into(),
        "https://demo.docusign.net".into(),
    )
    .with_network_policy(policy.clone(), DOCUSIGN_SYNC)
    .list_envelopes("2026-01-01T00:00:00Z", None, None)
    .await
    .is_err());

    // Salesforce has both OAuth and configured-instance sync traffic.
    assert!(exchange_salesforce_code(
        "client",
        "code",
        "verifier",
        "http://localhost/callback",
        "https://login.salesforce.com/services/oauth2/token",
        &policy,
    )
    .await
    .is_err());
    let future = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs()
        + Duration::from_secs(3600).as_secs();
    let salesforce_token = serde_json::to_string(&SalesforceTokenSet {
        access_token: "access".into(),
        refresh_token: "refresh".into(),
        instance_url: "https://example.my.salesforce.com".into(),
        expires_at_unix: future,
        id_url: "https://example.my.salesforce.com/id".into(),
    })
    .unwrap();
    assert!(SalesforceClient::new_with_token_endpoint(
        salesforce_token,
        "client".into(),
        "https://login.salesforce.com/services/oauth2/token".into(),
    )
    .unwrap()
    .with_network_policy(policy.clone())
    .identity()
    .await
    .is_err());

    // Redtail has password-to-UserKey sign-in and subsequent sync calls.
    assert!(RedtailClient::authenticate_with_base_and_policy(
        "key",
        "advisor",
        "password",
        "https://api.redtailtechnology.com/crm/v1/rest",
        Some(&policy),
    )
    .await
    .is_err());
    assert!(RedtailClient::new_with_base(
        "key".into(),
        "user-key".into(),
        "https://api.redtailtechnology.com/crm/v1/rest".into(),
    )
    .with_network_policy(policy)
    .validate_user_key()
    .await
    .is_err());
}

#[tokio::test]
async fn turning_on_offline_mode_cancels_an_active_sharefile_sync_request() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let policy = NetworkPolicy::load_from_directory(&tempfile::tempdir().unwrap().keep());
    let client =
        SharefileClient::new_with_base("token".into(), format!("http://localhost:{port}/sf/v3"))
            .unwrap()
            .with_network_policy(policy.clone(), SHAREFILE_SYNC);

    let request = tokio::spawn(async move { client.validate_token().await });
    let _connection = tokio::time::timeout(Duration::from_secs(2), listener.accept())
        .await
        .expect("the real client should have started its guarded request")
        .unwrap();
    policy.set_offline_mode(true).unwrap();
    assert!(request.await.unwrap().is_err());
}
