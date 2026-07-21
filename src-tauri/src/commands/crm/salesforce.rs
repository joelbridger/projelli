//! Read-only Salesforce Financial Services Cloud CRM client.
//!
//! Data access is intentionally limited to REST `GET /query` SOQL calls. OAuth
//! token exchange and refresh use `POST /services/oauth2/token`, but CRM data
//! sync exposes no write method and never calls Salesforce create/update/delete
//! APIs.

use std::collections::{HashMap, HashSet};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use anyhow::Context;
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::commands::crm::model::{
    CrmContact, CrmEmailAddress, CrmHouseholdMember, CrmHouseholdRef, CrmPhoneNumber,
    CrmRecordProvider, CrmStreetAddress,
};
use crate::commands::crm::source::CrmSource;

pub const SALESFORCE_TOKEN_ENDPOINT: &str = "https://login.salesforce.com/services/oauth2/token";
const SALESFORCE_AUTH_ENDPOINT: &str = "https://login.salesforce.com/services/oauth2/authorize";
const API_VERSION: &str = "v60.0";
// `pub(crate)` only so src/scope_freeze.rs can pin it. Not part of any public API.
pub(crate) const SALESFORCE_SCOPE: &str = "api refresh_token";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SalesforceTokenSet {
    pub access_token: String,
    pub refresh_token: String,
    pub instance_url: String,
    pub expires_at_unix: u64,
    #[serde(default)]
    pub id_url: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SalesforceAccountInfo {
    pub name: String,
    pub email: String,
}

/// Salesforce REST instance URLs are server-issued origins, never arbitrary
/// connector addresses. Accept only Salesforce-controlled HTTPS subdomains so
/// a poisoned token record cannot redirect a bearer token to another server.
fn validate_salesforce_instance_url(value: &str) -> anyhow::Result<(String, String)> {
    let parsed = reqwest::Url::parse(value).context("parse Salesforce instance URL")?;
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.port().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
        || parsed.path() != "/"
    {
        anyhow::bail!("Salesforce instance address must be a plain HTTPS Salesforce origin");
    }
    let host = parsed
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("Salesforce instance URL has no host"))?
        .to_ascii_lowercase();
    if !host.ends_with(".salesforce.com") {
        anyhow::bail!("Salesforce instance address is outside Salesforce");
    }
    Ok((format!("https://{host}"), host))
}

fn identity_route(
    id_url: &str,
    instance_url: &str,
) -> anyhow::Result<(&'static crate::network_policy::EgressOperation, Option<String>)> {
    let identity = reqwest::Url::parse(id_url).context("parse Salesforce identity URL")?;
    let (_, instance_host) = validate_salesforce_instance_url(instance_url)?;
    if identity.scheme() != "https"
        || !identity.username().is_empty()
        || identity.password().is_some()
        || identity.port().is_some()
    {
        anyhow::bail!("Salesforce identity address must use standard HTTPS");
    }
    let identity_host = identity
        .host_str()
        .ok_or_else(|| anyhow::anyhow!("Salesforce identity URL has no host"))?
        .to_ascii_lowercase();
    if identity_host == instance_host {
        return Ok((
            &crate::network_policy::SALESFORCE_IDENTITY,
            Some(instance_host),
        ));
    }
    if matches!(
        identity_host.as_str(),
        "login.salesforce.com" | "test.salesforce.com"
    ) {
        return Ok((&crate::network_policy::SALESFORCE_LOGIN_IDENTITY, None));
    }
    anyhow::bail!("Salesforce returned an identity address outside its approved hosts")
}

pub fn salesforce_client_id() -> Option<String> {
    std::env::var("LANTERN_SALESFORCE_CLIENT_ID")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .or_else(|| {
            option_env!("LANTERN_SALESFORCE_CLIENT_ID")
                .filter(|v| !v.trim().is_empty())
                .map(str::to_string)
        })
}

pub fn build_salesforce_auth_url(
    client_id: &str,
    redirect_uri: &str,
    code_challenge: &str,
    state: &str,
) -> String {
    use crate::commands::mail::gmail::oauth::urlencoding_encode;
    format!(
        "{auth}?response_type=code&client_id={client_id}&redirect_uri={redirect_uri}\
         &scope={scope}&code_challenge={challenge}&code_challenge_method=S256&state={state}&prompt=login",
        auth = SALESFORCE_AUTH_ENDPOINT,
        client_id = urlencoding_encode(client_id),
        redirect_uri = urlencoding_encode(redirect_uri),
        scope = urlencoding_encode(SALESFORCE_SCOPE),
        challenge = urlencoding_encode(code_challenge),
        state = urlencoding_encode(state),
    )
}

pub async fn exchange_salesforce_code(
    client_id: &str,
    code: &str,
    code_verifier: &str,
    redirect_uri: &str,
    token_endpoint: &str,
    network_policy: &crate::network_policy::NetworkPolicy,
) -> anyhow::Result<SalesforceTokenSet> {
    let http = crate::commands::connector_network::guarded_http_client(
        Duration::from_secs(30),
        Duration::from_secs(15),
    );
    let request = http
        .post(token_endpoint)
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", client_id),
            ("code", code),
            ("code_verifier", code_verifier),
            ("redirect_uri", redirect_uri),
        ]);
    let resp = crate::commands::connector_network::send_guarded(
        network_policy,
        &crate::network_policy::SALESFORCE_OAUTH,
        token_endpoint,
        None,
        request,
    )
    .await
    .map_err(|error| crate::commands::connector_network::transport_error(error, "Salesforce OAuth token exchange"))?;
    let status = resp.status().as_u16();
    let body: serde_json::Value = resp.json().await.context("parse Salesforce token JSON")?;
    parse_salesforce_token_response(status, &body, None)
}

fn parse_salesforce_token_response(
    status: u16,
    body: &serde_json::Value,
    existing_refresh: Option<&str>,
) -> anyhow::Result<SalesforceTokenSet> {
    if status != 200 {
        let err = body
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown_error");
        anyhow::bail!("Salesforce token request failed (HTTP {status}): {err}");
    }
    let access = body
        .get("access_token")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if access.is_empty() {
        anyhow::bail!("Salesforce token response had no access_token");
    }
    let refresh = body
        .get("refresh_token")
        .and_then(|v| v.as_str())
        .or(existing_refresh)
        .unwrap_or("");
    if refresh.is_empty() {
        anyhow::bail!("Salesforce token response had no refresh_token");
    }
    let instance_url = body
        .get("instance_url")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if instance_url.is_empty() {
        anyhow::bail!("Salesforce token response had no instance_url");
    }
    let (instance_url, _) = validate_salesforce_instance_url(instance_url)?;
    let expires_in = body
        .get("expires_in")
        .and_then(|v| v.as_u64())
        .unwrap_or(7200);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    Ok(SalesforceTokenSet {
        access_token: access.to_string(),
        refresh_token: refresh.to_string(),
        instance_url,
        expires_at_unix: now + expires_in.saturating_sub(60),
        id_url: body
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
    })
}

pub struct SalesforceClient {
    client_id: String,
    tokens: tokio::sync::Mutex<SalesforceTokenSet>,
    http: crate::commands::connector_network::GuardedHttpClient,
    token_endpoint: String,
    network_policy: crate::network_policy::NetworkPolicy,
}

impl SalesforceClient {
    pub fn new(
        stored_json: String,
        network_policy: crate::network_policy::NetworkPolicy,
    ) -> anyhow::Result<Self> {
        let client_id = salesforce_client_id()
            .ok_or_else(|| anyhow::anyhow!("LANTERN_SALESFORCE_CLIENT_ID is not configured"))?;
        Self::new_with_token_endpoint(
            stored_json,
            client_id,
            SALESFORCE_TOKEN_ENDPOINT.to_string(),
            network_policy,
        )
    }

    pub fn new_with_token_endpoint(
        stored_json: String,
        client_id: String,
        token_endpoint: String,
        network_policy: crate::network_policy::NetworkPolicy,
    ) -> anyhow::Result<Self> {
        let mut tokens: SalesforceTokenSet =
            serde_json::from_str(&stored_json).context("parse stored Salesforce token set")?;
        let (instance_url, _) = validate_salesforce_instance_url(&tokens.instance_url)?;
        tokens.instance_url = instance_url;
        let http = crate::commands::connector_network::guarded_http_client(
            Duration::from_secs(60),
            Duration::from_secs(15),
        );
        Ok(Self {
            client_id,
            tokens: tokio::sync::Mutex::new(tokens),
            http,
            token_endpoint,
            network_policy,
        })
    }

    async fn access_token(&self) -> anyhow::Result<(String, String)> {
        let mut guard = self.tokens.lock().await;
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        if guard.expires_at_unix <= now {
            let refreshed = self.refresh_locked(&guard.refresh_token).await?;
            *guard = refreshed;
        }
        Ok((guard.access_token.clone(), guard.instance_url.clone()))
    }

    async fn refresh_locked(&self, refresh_token: &str) -> anyhow::Result<SalesforceTokenSet> {
        let request = self
            .http
            .post(&self.token_endpoint)
            .form(&[
                ("grant_type", "refresh_token"),
                ("client_id", self.client_id.as_str()),
                ("refresh_token", refresh_token),
            ]);
        let resp = crate::commands::connector_network::send_guarded(
            &self.network_policy,
            &crate::network_policy::SALESFORCE_OAUTH,
            &self.token_endpoint,
            None,
            request,
        )
        .await
        .map_err(|error| crate::commands::connector_network::transport_error(error, "Salesforce OAuth refresh"))?;
        let status = resp.status().as_u16();
        let body: serde_json::Value = resp.json().await.context("parse Salesforce refresh JSON")?;
        let refreshed = parse_salesforce_token_response(status, &body, Some(refresh_token))?;
        if let Ok(json) = serde_json::to_string(&refreshed) {
            let _ = keyring::Entry::new(&crate::identity::crm_keychain_service("salesforce"), "api-token")
                .and_then(|entry| entry.set_password(&json));
        }
        Ok(refreshed)
    }

    pub async fn identity(&self) -> anyhow::Result<SalesforceAccountInfo> {
        let (access, _) = self.access_token().await?;
        let id_url = { self.tokens.lock().await.id_url.clone() };
        if id_url.trim().is_empty() {
            return Ok(SalesforceAccountInfo {
                name: "Salesforce".to_string(),
                email: String::new(),
            });
        }
        let instance_url = { self.tokens.lock().await.instance_url.clone() };
        let (identity_operation, configured_host) = identity_route(&id_url, &instance_url)?;
        let request = self.http.get(&id_url).bearer_auth(access);
        let resp = crate::commands::connector_network::send_guarded(
            &self.network_policy,
            identity_operation,
            &id_url,
            configured_host.as_deref(),
            request,
        )
        .await
        .map_err(|error| crate::commands::connector_network::transport_error(error, "Salesforce identity request"))?;
        let status = resp.status();
        let body: serde_json::Value = resp
            .json()
            .await
            .context("parse Salesforce identity JSON")?;
        if !status.is_success() {
            anyhow::bail!("Salesforce identity request failed (HTTP {status})");
        }
        Ok(SalesforceAccountInfo {
            name: body
                .get("organization_name")
                .or_else(|| body.get("display_name"))
                .and_then(|v| v.as_str())
                .unwrap_or("Salesforce")
                .to_string(),
            email: body
                .get("email")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string(),
        })
    }

    async fn get_json(
        &self,
        absolute_or_relative: &str,
        query: &[(&str, String)],
    ) -> anyhow::Result<serde_json::Value> {
        let (access, instance_url) = self.access_token().await?;
        let url = if absolute_or_relative.starts_with("http") {
            absolute_or_relative.to_string()
        } else if absolute_or_relative.starts_with('/') {
            format!("{instance_url}{absolute_or_relative}")
        } else {
            format!("{instance_url}/services/data/{API_VERSION}/{absolute_or_relative}")
        };
        let mut req = self.http.get(&url).bearer_auth(access);
        for (k, v) in query {
            req = req.query(&[(*k, v.as_str())]);
        }
        let configured_host = reqwest::Url::parse(&instance_url)
            .ok()
            .and_then(|parsed| parsed.host_str().map(str::to_string))
            .ok_or_else(|| anyhow::anyhow!("Salesforce instance URL has no host"))?;
        let resp = crate::commands::connector_network::send_guarded(
            &self.network_policy,
            &crate::network_policy::SALESFORCE_SYNC,
            &url,
            Some(&configured_host),
            req,
        )
        .await
        .map_err(|error| crate::commands::connector_network::transport_error(error, "Salesforce REST GET"))?;
        let status = resp.status();
        let body = resp.text().await.context("read Salesforce response body")?;
        if !status.is_success() {
            log::warn!(
                "Salesforce GET failed: HTTP {} at {}",
                status,
                absolute_or_relative
            );
            anyhow::bail!("Salesforce request failed (HTTP {})", status);
        }
        serde_json::from_str(&body).context("parse Salesforce JSON response")
    }

    async fn query_all(&self, soql: &str) -> anyhow::Result<Vec<serde_json::Value>> {
        let mut out = Vec::new();
        let mut body = self
            .get_json("query", &[("q", soql.to_string())])
            .await
            .with_context(|| format!("Salesforce SOQL query failed: {}", soql_name(soql)))?;
        loop {
            out.extend(
                body.get("records")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default(),
            );
            if body.get("done").and_then(|v| v.as_bool()).unwrap_or(true) {
                break;
            }
            let next = body
                .get("nextRecordsUrl")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("Salesforce query page missing nextRecordsUrl"))?
                .to_string();
            body = self.get_json(&next, &[]).await?;
        }
        Ok(out)
    }

    async fn household_accounts(&self) -> anyhow::Result<Vec<SalesforceAccount>> {
        let soql = "SELECT Id, Name, Phone, BillingStreet, BillingCity, BillingState, BillingPostalCode, RecordType.DeveloperName FROM Account WHERE RecordType.DeveloperName IN ('IndustriesHousehold','Household')";
        self.query_all(soql)
            .await?
            .into_iter()
            .map(parse_account)
            .collect()
    }

    async fn account_contact_relations(
        &self,
    ) -> anyhow::Result<Vec<SalesforceAccountContactRelation>> {
        let fsc_soql = "SELECT Id, AccountId, ContactId, Roles, IsActive, FinServ__PrimaryGroup__c, FinServ__Primary__c, FinServ__IncludeInGroup__c FROM AccountContactRelation WHERE Account.RecordType.DeveloperName IN ('IndustriesHousehold','Household')";
        match self.query_all(fsc_soql).await {
            Ok(rows) => rows.into_iter().map(parse_acr).collect(),
            Err(e) => {
                log::warn!(
                    "Salesforce FSC ACR fields unavailable, retrying standard ACR shape: {e:#}"
                );
                let standard_soql = "SELECT Id, AccountId, ContactId, Roles, IsActive FROM AccountContactRelation WHERE Account.RecordType.DeveloperName IN ('IndustriesHousehold','Household')";
                self.query_all(standard_soql)
                    .await?
                    .into_iter()
                    .map(parse_acr)
                    .collect()
            }
        }
    }

    async fn contacts_for(
        &self,
        household_ids: &[String],
        contact_ids: &[String],
    ) -> anyhow::Result<Vec<SalesforceContact>> {
        let mut contacts = Vec::new();
        let mut seen = HashSet::new();
        for chunk in contact_ids.chunks(100) {
            if chunk.is_empty() {
                continue;
            }
            let soql = format!(
                "SELECT Id, AccountId, FirstName, MiddleName, LastName, Salutation, Suffix, Email, Phone, MobilePhone, HomePhone, Title, Birthdate, MailingStreet, MailingCity, MailingState, MailingPostalCode, Description, LastModifiedDate FROM Contact WHERE Id IN ({})",
                soql_id_list(chunk)
            );
            for row in self.query_all(&soql).await? {
                let c = parse_contact(row)?;
                if seen.insert(c.id.clone()) {
                    contacts.push(c);
                }
            }
        }
        for chunk in household_ids.chunks(100) {
            if chunk.is_empty() {
                continue;
            }
            let soql = format!(
                "SELECT Id, AccountId, FirstName, MiddleName, LastName, Salutation, Suffix, Email, Phone, MobilePhone, HomePhone, Title, Birthdate, MailingStreet, MailingCity, MailingState, MailingPostalCode, Description, LastModifiedDate FROM Contact WHERE AccountId IN ({})",
                soql_id_list(chunk)
            );
            for row in self.query_all(&soql).await? {
                let c = parse_contact(row)?;
                if seen.insert(c.id.clone()) {
                    contacts.push(c);
                }
            }
        }
        Ok(contacts)
    }

    async fn normalized_contacts(&self) -> anyhow::Result<Vec<CrmContact>> {
        let households = self.household_accounts().await?;
        let household_ids: Vec<String> = households.iter().map(|h| h.id.clone()).collect();
        let relations = self.account_contact_relations().await?;
        let relation_contact_ids: Vec<String> =
            relations.iter().map(|r| r.contact_id.clone()).collect();
        let contacts = self
            .contacts_for(&household_ids, &relation_contact_ids)
            .await?;
        Ok(normalize_salesforce_records(
            households, relations, contacts,
        ))
    }
}

#[async_trait]
impl CrmSource for SalesforceClient {
    fn provider_id(&self) -> &'static str {
        "salesforce"
    }

    async fn list_all_contacts(&self) -> anyhow::Result<Vec<CrmContact>> {
        self.normalized_contacts().await
    }

    async fn list_notes(&self) -> anyhow::Result<Vec<crate::commands::crm::model::CrmNote>> {
        Ok(Vec::new())
    }

    async fn list_tasks(&self) -> anyhow::Result<Vec<crate::commands::crm::model::CrmTask>> {
        Ok(Vec::new())
    }

    async fn list_events(&self) -> anyhow::Result<Vec<crate::commands::crm::model::CrmEvent>> {
        Ok(Vec::new())
    }

    async fn list_households(&self) -> anyhow::Result<Vec<CrmContact>> {
        Ok(self
            .normalized_contacts()
            .await?
            .into_iter()
            .filter(|c| c.r#type == "household")
            .collect())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SalesforceAccount {
    pub id: String,
    pub name: String,
    pub phone: String,
    pub billing_street: String,
    pub billing_city: String,
    pub billing_state: String,
    pub billing_postal_code: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SalesforceAccountContactRelation {
    pub account_id: String,
    pub contact_id: String,
    pub roles: String,
    pub active: bool,
    pub primary_group: bool,
    pub primary_member: bool,
    pub include_in_group: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SalesforceContact {
    pub id: String,
    pub account_id: String,
    pub first_name: String,
    pub middle_name: String,
    pub last_name: String,
    pub salutation: String,
    pub suffix: String,
    pub email: String,
    pub phone: String,
    pub mobile_phone: String,
    pub home_phone: String,
    pub title: String,
    pub birthdate: Option<String>,
    pub mailing_street: String,
    pub mailing_city: String,
    pub mailing_state: String,
    pub mailing_postal_code: String,
    pub description: String,
    pub last_modified_date: String,
}

pub fn normalize_salesforce_records(
    accounts: Vec<SalesforceAccount>,
    relations: Vec<SalesforceAccountContactRelation>,
    contacts: Vec<SalesforceContact>,
) -> Vec<CrmContact> {
    let account_by_id: HashMap<String, SalesforceAccount> =
        accounts.into_iter().map(|a| (a.id.clone(), a)).collect();
    let mut relations_by_contact: HashMap<String, Vec<SalesforceAccountContactRelation>> =
        HashMap::new();
    for rel in relations
        .into_iter()
        .filter(|r| r.active && account_by_id.contains_key(&r.account_id))
    {
        relations_by_contact
            .entry(rel.contact_id.clone())
            .or_default()
            .push(rel);
    }

    let mut member_names_by_account: HashMap<String, Vec<CrmHouseholdMember>> = HashMap::new();
    for contact in &contacts {
        for rel in relation_targets(contact, &relations_by_contact, &account_by_id) {
            member_names_by_account
                .entry(rel.account_id.clone())
                .or_default()
                .push(CrmHouseholdMember {
                    id: stable_numeric_id(&format!("{}:{}", contact.id, rel.account_id)),
                    external_id: namespaced_contact_key(&contact.id, &rel.account_id),
                    source_provider: CrmRecordProvider::Salesforce,
                    first_name: contact.first_name.clone(),
                    last_name: contact.last_name.clone(),
                    title: rel.roles.clone(),
                    r#type: "person".to_string(),
                });
        }
    }

    let mut out = Vec::new();
    for account in account_by_id.values() {
        out.push(account_to_crm_household(account));
    }

    for contact in &contacts {
        for rel in relation_targets(contact, &relations_by_contact, &account_by_id) {
            let Some(account) = account_by_id.get(&rel.account_id) else {
                continue;
            };
            let mut crm = contact_to_crm_contact(contact, account, &rel);
            if let Some(members) = member_names_by_account.get(&rel.account_id) {
                if let Some(hh) = crm.household.as_mut() {
                    hh.members = members.clone();
                }
            }
            out.push(crm);
        }
    }
    out
}

fn relation_targets(
    contact: &SalesforceContact,
    relations_by_contact: &HashMap<String, Vec<SalesforceAccountContactRelation>>,
    account_by_id: &HashMap<String, SalesforceAccount>,
) -> Vec<SalesforceAccountContactRelation> {
    let rels = relations_by_contact
        .get(&contact.id)
        .cloned()
        .unwrap_or_default();
    if !rels.is_empty() {
        return rels;
    }
    if account_by_id.contains_key(&contact.account_id) {
        return vec![SalesforceAccountContactRelation {
            account_id: contact.account_id.clone(),
            contact_id: contact.id.clone(),
            roles: "Member".to_string(),
            active: true,
            primary_group: true,
            primary_member: false,
            include_in_group: true,
        }];
    }
    Vec::new()
}

fn account_to_crm_household(account: &SalesforceAccount) -> CrmContact {
    CrmContact {
        id: stable_numeric_id(&account.id),
        external_id: namespaced_account_key(&account.id),
        source_provider: CrmRecordProvider::Salesforce,
        r#type: "household".to_string(),
        name: account.name.clone(),
        company_name: account.name.clone(),
        contact_type: "Household".to_string(),
        phone_numbers: phone_numbers(&account.phone, "", ""),
        street_addresses: street_address(
            &account.billing_street,
            &account.billing_city,
            &account.billing_state,
            &account.billing_postal_code,
            "Billing",
        )
        .into_iter()
        .collect(),
        ..Default::default()
    }
}

fn contact_to_crm_contact(
    contact: &SalesforceContact,
    account: &SalesforceAccount,
    rel: &SalesforceAccountContactRelation,
) -> CrmContact {
    CrmContact {
        id: stable_numeric_id(&format!("{}:{}", contact.id, account.id)),
        external_id: namespaced_contact_key(&contact.id, &account.id),
        source_provider: CrmRecordProvider::Salesforce,
        r#type: "person".to_string(),
        prefix: contact.salutation.clone(),
        first_name: contact.first_name.clone(),
        middle_name: contact.middle_name.clone(),
        last_name: contact.last_name.clone(),
        suffix: contact.suffix.clone(),
        job_title: contact.title.clone(),
        birth_date: contact.birthdate.clone(),
        background_information: contact.description.clone(),
        email_addresses: if contact.email.trim().is_empty() {
            Vec::new()
        } else {
            vec![CrmEmailAddress {
                address: contact.email.clone(),
                kind: "Email".to_string(),
                principal: true,
            }]
        },
        phone_numbers: phone_numbers(&contact.mobile_phone, &contact.phone, &contact.home_phone),
        street_addresses: street_address(
            &contact.mailing_street,
            &contact.mailing_city,
            &contact.mailing_state,
            &contact.mailing_postal_code,
            "Mailing",
        )
        .into_iter()
        .collect(),
        household: Some(CrmHouseholdRef {
            id: stable_numeric_id(&account.id),
            external_id: namespaced_account_key(&account.id),
            source_provider: CrmRecordProvider::Salesforce,
            name: account.name.clone(),
            title: if rel.roles.trim().is_empty() {
                "Member".to_string()
            } else {
                rel.roles.clone()
            },
            members: Vec::new(),
        }),
        ..Default::default()
    }
}

fn phone_numbers(mobile: &str, business: &str, home: &str) -> Vec<CrmPhoneNumber> {
    let mut phones = Vec::new();
    if !mobile.trim().is_empty() {
        phones.push(CrmPhoneNumber {
            address: mobile.to_string(),
            kind: "Mobile".to_string(),
            principal: true,
        });
    }
    if !business.trim().is_empty() {
        phones.push(CrmPhoneNumber {
            address: business.to_string(),
            kind: "Business".to_string(),
            principal: phones.is_empty(),
        });
    }
    if !home.trim().is_empty() {
        phones.push(CrmPhoneNumber {
            address: home.to_string(),
            kind: "Home".to_string(),
            principal: phones.is_empty(),
        });
    }
    phones
}

fn street_address(
    street: &str,
    city: &str,
    state: &str,
    postal: &str,
    kind: &str,
) -> Option<CrmStreetAddress> {
    if [street, city, state, postal]
        .iter()
        .all(|v| v.trim().is_empty())
    {
        return None;
    }
    Some(CrmStreetAddress {
        address: street.to_string(),
        city: city.to_string(),
        state: state.to_string(),
        zip: postal.to_string(),
        kind: kind.to_string(),
        principal: true,
    })
}

fn namespaced_account_key(id: &str) -> String {
    format!("sfdc:{}", id.trim())
}

fn namespaced_contact_key(contact_id: &str, account_id: &str) -> String {
    format!("sfdc:{}:acct:{}", contact_id.trim(), account_id.trim())
}

fn stable_numeric_id(input: &str) -> i64 {
    let hash = Sha256::digest(input.as_bytes());
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&hash[..8]);
    (u64::from_be_bytes(bytes) & 0x7fff_ffff_ffff_ffff) as i64
}

fn soql_id_list(ids: &[String]) -> String {
    ids.iter()
        .map(|id| format!("'{}'", id.replace('\'', "\\'")))
        .collect::<Vec<_>>()
        .join(",")
}

fn soql_name(soql: &str) -> &str {
    if soql.contains("AccountContactRelation") {
        "AccountContactRelation"
    } else if soql.contains("FROM Contact") {
        "Contact"
    } else if soql.contains("FROM Account") {
        "Account"
    } else {
        "query"
    }
}

fn str_field(v: &serde_json::Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string()
}

fn bool_field(v: &serde_json::Value, key: &str, default: bool) -> bool {
    v.get(key).and_then(|x| x.as_bool()).unwrap_or(default)
}

fn parse_account(v: serde_json::Value) -> anyhow::Result<SalesforceAccount> {
    let id = str_field(&v, "Id");
    if id.is_empty() {
        anyhow::bail!("Salesforce Account row missing Id");
    }
    Ok(SalesforceAccount {
        id,
        name: str_field(&v, "Name"),
        phone: str_field(&v, "Phone"),
        billing_street: str_field(&v, "BillingStreet"),
        billing_city: str_field(&v, "BillingCity"),
        billing_state: str_field(&v, "BillingState"),
        billing_postal_code: str_field(&v, "BillingPostalCode"),
    })
}

fn parse_acr(v: serde_json::Value) -> anyhow::Result<SalesforceAccountContactRelation> {
    let account_id = str_field(&v, "AccountId");
    let contact_id = str_field(&v, "ContactId");
    if account_id.is_empty() || contact_id.is_empty() {
        anyhow::bail!("Salesforce AccountContactRelation row missing AccountId or ContactId");
    }
    Ok(SalesforceAccountContactRelation {
        account_id,
        contact_id,
        roles: str_field(&v, "Roles"),
        active: bool_field(&v, "IsActive", true),
        primary_group: bool_field(&v, "FinServ__PrimaryGroup__c", false),
        primary_member: bool_field(&v, "FinServ__Primary__c", false),
        include_in_group: bool_field(&v, "FinServ__IncludeInGroup__c", true),
    })
}

fn parse_contact(v: serde_json::Value) -> anyhow::Result<SalesforceContact> {
    let id = str_field(&v, "Id");
    if id.is_empty() {
        anyhow::bail!("Salesforce Contact row missing Id");
    }
    Ok(SalesforceContact {
        id,
        account_id: str_field(&v, "AccountId"),
        first_name: str_field(&v, "FirstName"),
        middle_name: str_field(&v, "MiddleName"),
        last_name: str_field(&v, "LastName"),
        salutation: str_field(&v, "Salutation"),
        suffix: str_field(&v, "Suffix"),
        email: str_field(&v, "Email"),
        phone: str_field(&v, "Phone"),
        mobile_phone: str_field(&v, "MobilePhone"),
        home_phone: str_field(&v, "HomePhone"),
        title: str_field(&v, "Title"),
        birthdate: v
            .get("Birthdate")
            .and_then(|x| x.as_str())
            .map(str::to_string),
        mailing_street: str_field(&v, "MailingStreet"),
        mailing_city: str_field(&v, "MailingCity"),
        mailing_state: str_field(&v, "MailingState"),
        mailing_postal_code: str_field(&v, "MailingPostalCode"),
        description: str_field(&v, "Description"),
        last_modified_date: str_field(&v, "LastModifiedDate"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn salesforce_auth_url_uses_pkce_and_read_refresh_scopes() {
        // BOUND: these are `contains` checks — PRESENCE only. They can notice a
        // scope going MISSING; they are structurally blind to one being ADDED
        // (measured: a planted widening left the whole suite green). Exactness
        // lives in src/scope_freeze.rs, which pins this constant token-for-token.
        let url = build_salesforce_auth_url("cid", "http://localhost:8123", "challenge", "state");
        assert!(url.starts_with(SALESFORCE_AUTH_ENDPOINT));
        assert!(url.contains("client_id=cid"));
        assert!(url.contains("code_challenge=challenge"));
        assert!(url.contains("code_challenge_method=S256"));
        assert!(url.contains("api%20refresh_token"));
        assert!(!url.contains("client_secret"));
    }

    #[test]
    fn token_parser_requires_instance_url_and_refresh_token() {
        let ok = serde_json::json!({
            "access_token": "AT",
            "refresh_token": "RT",
            "instance_url": "https://example.my.salesforce.com/",
            "expires_in": 7200,
            "id": "https://login.salesforce.com/id/org/user"
        });
        let parsed = parse_salesforce_token_response(200, &ok, None).expect("parse token");
        assert_eq!(parsed.instance_url, "https://example.my.salesforce.com");
        assert_eq!(parsed.refresh_token, "RT");

        let missing_instance = serde_json::json!({"access_token": "AT", "refresh_token": "RT"});
        assert!(parse_salesforce_token_response(200, &missing_instance, None).is_err());

        let poisoned_instance = serde_json::json!({
            "access_token": "AT",
            "refresh_token": "RT",
            "instance_url": "https://attacker.example"
        });
        assert!(
            parse_salesforce_token_response(200, &poisoned_instance, None).is_err(),
            "a token response must never choose an arbitrary bearer-token destination"
        );
    }

    #[test]
    fn standard_salesforce_identity_url_uses_the_login_host_registry_entry() {
        let (operation, configured_host) = identity_route(
            "https://login.salesforce.com/id/org/user",
            "https://example.my.salesforce.com",
        )
        .unwrap();
        assert_eq!(operation.id, "crm-auth-salesforce-identity");
        assert_eq!(configured_host, None);
    }

    #[test]
    fn organization_identity_url_uses_the_connected_instance_only() {
        let (operation, configured_host) = identity_route(
            "https://example.my.salesforce.com/id/org/user",
            "https://example.my.salesforce.com",
        )
        .unwrap();
        assert_eq!(operation.id, "crm-auth-salesforce-instance");
        assert_eq!(configured_host.as_deref(), Some("example.my.salesforce.com"));
    }

    #[test]
    fn unrelated_or_insecure_salesforce_identity_url_is_rejected() {
        assert!(identity_route(
            "https://attacker.example/id/org/user",
            "https://example.my.salesforce.com",
        )
        .is_err());
        assert!(identity_route(
            "http://login.salesforce.com/id/org/user",
            "https://example.my.salesforce.com",
        )
        .is_err());
        assert!(identity_route(
            "https://attacker.example/id/org/user",
            "https://attacker.example",
        )
        .is_err());
    }

    #[test]
    fn normalizes_households_contacts_and_provider_namespaced_ids() {
        let account = SalesforceAccount {
            id: "001HH0000000001AAA".to_string(),
            name: "Anderson Household".to_string(),
            phone: "555-111-2222".to_string(),
            billing_street: "10 Main".to_string(),
            billing_city: "Denver".to_string(),
            billing_state: "CO".to_string(),
            billing_postal_code: "80202".to_string(),
        };
        let rel = SalesforceAccountContactRelation {
            account_id: account.id.clone(),
            contact_id: "003CC0000000002AAA".to_string(),
            roles: "Client;Head".to_string(),
            active: true,
            primary_group: true,
            primary_member: true,
            include_in_group: true,
        };
        let contact = SalesforceContact {
            id: rel.contact_id.clone(),
            account_id: "001IND000000003AAA".to_string(),
            first_name: "Robert".to_string(),
            middle_name: String::new(),
            last_name: "Anderson".to_string(),
            salutation: String::new(),
            suffix: String::new(),
            email: "robert@example.com".to_string(),
            phone: "555-333-4444".to_string(),
            mobile_phone: String::new(),
            home_phone: String::new(),
            title: "CEO".to_string(),
            birthdate: Some("1965-04-12".to_string()),
            mailing_street: String::new(),
            mailing_city: "Denver".to_string(),
            mailing_state: "CO".to_string(),
            mailing_postal_code: String::new(),
            description: "Prefers concise updates.".to_string(),
            last_modified_date: "2026-06-27T00:00:00.000+0000".to_string(),
        };

        let normalized = normalize_salesforce_records(vec![account], vec![rel], vec![contact]);

        assert_eq!(normalized.len(), 2);
        let household = normalized.iter().find(|c| c.r#type == "household").unwrap();
        assert_eq!(household.crm_key(), "sfdc:001HH0000000001AAA");
        assert_eq!(
            household.household_key().as_deref(),
            Some("sfdc:001HH0000000001AAA")
        );

        let member = normalized.iter().find(|c| c.r#type == "person").unwrap();
        assert_eq!(
            member.crm_key(),
            "sfdc:003CC0000000002AAA:acct:001HH0000000001AAA"
        );
        assert_eq!(
            member.household_key().as_deref(),
            Some("sfdc:001HH0000000001AAA")
        );
        assert!(member
            .household
            .as_ref()
            .unwrap()
            .members
            .iter()
            .any(|m| m.external_id == "sfdc:003CC0000000002AAA:acct:001HH0000000001AAA"));
    }
}
