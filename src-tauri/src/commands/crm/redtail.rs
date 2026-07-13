//! Read-only Redtail CRM client.
//!
//! Redtail authentication is not OAuth. Advisor Prep Hero receives the advisor's
//! Redtail username + password once, exchanges them for a Redtail UserKey, and
//! stores only that UserKey in the provider-scoped CRM keychain slot. Every CRM
//! data call below is a GET request.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use anyhow::Context;
use async_trait::async_trait;
use base64::Engine;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::commands::crm::model::{
    CrmContact, CrmEmailAddress, CrmEvent, CrmHouseholdMember, CrmHouseholdRef, CrmLink, CrmNote,
    CrmPhoneNumber, CrmRecordProvider, CrmStreetAddress,
};
use crate::commands::crm::source::CrmSource;

const REDTAIL_BASE_URL: &str = "https://api2.redtailtechnology.com/crm/v1/rest";
const REDTAIL_PAGE_SIZE: usize = 200;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RedtailAuthInfo {
    pub user_key: String,
    pub name: String,
    pub email: String,
    pub tier: String,
}

#[derive(Debug, Clone, Default)]
struct RedtailFamily {
    id: i64,
    name: String,
    members: Vec<RedtailFamilyMember>,
}

#[derive(Debug, Clone, Default)]
struct RedtailFamilyMember {
    contact_id: i64,
    relationship_name: String,
    hoh: bool,
}

#[derive(Debug, Default)]
struct RedtailCache {
    raw_contacts: Option<Vec<Value>>,
    normalized_contacts: Option<Vec<CrmContact>>,
}

pub struct RedtailClient {
    api_key: String,
    user_key: String,
    base: String,
    http: crate::commands::connector_network::GuardedHttpClient,
    cache: tokio::sync::Mutex<RedtailCache>,
    network_policy: crate::network_policy::NetworkPolicy,
    network_operation: crate::network_policy::EgressOperation,
}

impl RedtailClient {
    pub fn new(
        user_key: String,
        network_policy: crate::network_policy::NetworkPolicy,
    ) -> anyhow::Result<Self> {
        let api_key = redtail_api_key()?;
        Ok(Self::new_guarded(
            api_key,
            user_key,
            REDTAIL_BASE_URL.to_string(),
            network_policy,
            crate::network_policy::REDTAIL_SYNC,
        ))
    }

    #[cfg(test)]
    pub fn new_with_base(api_key: String, user_key: String, base: String) -> Self {
        let policy = crate::network_policy::NetworkPolicy::load_from_directory(
            &tempfile::tempdir().expect("test policy directory").keep(),
        );
        Self::new_guarded(
            api_key,
            user_key,
            base,
            policy,
            crate::network_policy::CRM_MIGRATION_IMPORT,
        )
    }

    #[cfg(test)]
    pub(crate) fn new_with_base_and_policy(
        api_key: String,
        user_key: String,
        base: String,
        policy: crate::network_policy::NetworkPolicy,
    ) -> Self {
        Self::new_guarded(
            api_key,
            user_key,
            base,
            policy,
            crate::network_policy::REDTAIL_SYNC,
        )
    }

    fn new_guarded(
        api_key: String,
        user_key: String,
        base: String,
        network_policy: crate::network_policy::NetworkPolicy,
        network_operation: crate::network_policy::EgressOperation,
    ) -> Self {
        let http = crate::commands::connector_network::guarded_http_client(
            Duration::from_secs(60),
            Duration::from_secs(15),
        );
        Self {
            api_key,
            user_key,
            base: base.trim_end_matches('/').to_string(),
            http,
            cache: tokio::sync::Mutex::new(RedtailCache::default()),
            network_policy,
            network_operation,
        }
    }

    pub async fn authenticate(
        username: &str,
        password: &str,
        network_policy: &crate::network_policy::NetworkPolicy,
    ) -> anyhow::Result<RedtailAuthInfo> {
        let api_key = redtail_api_key()?;
        Self::authenticate_guarded(
            &api_key,
            username,
            password,
            REDTAIL_BASE_URL,
            network_policy,
            crate::network_policy::REDTAIL_OAUTH,
            None,
        )
        .await
    }

    #[cfg(test)]
    pub async fn authenticate_with_base(
        api_key: &str,
        username: &str,
        password: &str,
        base: &str,
    ) -> anyhow::Result<RedtailAuthInfo> {
        let policy = crate::network_policy::NetworkPolicy::load_from_directory(
            &tempfile::tempdir().expect("test policy directory").keep(),
        );
        let host = reqwest::Url::parse(base)
            .ok()
            .and_then(|parsed| parsed.host_str().map(str::to_string));
        Self::authenticate_guarded(
            api_key,
            username,
            password,
            base,
            &policy,
            crate::network_policy::CRM_MIGRATION_IMPORT,
            host.as_deref(),
        )
        .await
    }

    #[cfg(test)]
    pub(crate) async fn authenticate_with_base_and_policy(
        api_key: &str,
        username: &str,
        password: &str,
        base: &str,
        policy: &crate::network_policy::NetworkPolicy,
    ) -> anyhow::Result<RedtailAuthInfo> {
        Self::authenticate_guarded(
            api_key,
            username,
            password,
            base,
            policy,
            crate::network_policy::REDTAIL_OAUTH,
            None,
        )
        .await
    }

    async fn authenticate_guarded(
        api_key: &str,
        username: &str,
        password: &str,
        base: &str,
        network_policy: &crate::network_policy::NetworkPolicy,
        network_operation: crate::network_policy::EgressOperation,
        configured_host: Option<&str>,
    ) -> anyhow::Result<RedtailAuthInfo> {
        if username.trim().is_empty() || password.is_empty() {
            anyhow::bail!("Redtail username and password are required");
        }
        let http = crate::commands::connector_network::guarded_http_client(
            Duration::from_secs(30),
            Duration::from_secs(15),
        );
        let url = format!("{}/authentication", base.trim_end_matches('/'));
        let auth = build_basic_auth_header(api_key, username.trim(), password);
        let request = http
            .get(&url)
            .header("Authorization", auth)
            .header(
                "fields",
                "database_id,user_id,user_key,first_name,last_name,username,email,tier",
            );
        let url = format!("{}/authentication", base.trim_end_matches('/'));
        let resp = crate::commands::connector_network::send_guarded(
            network_policy,
            &network_operation,
            &url,
            configured_host,
            request,
        )
        .await
        .map_err(|error| crate::commands::connector_network::transport_error(error, "Redtail authentication request"))?;
        let status = resp.status();
        let body = resp.text().await.context("read Redtail auth response")?;
        if !status.is_success() {
            anyhow::bail!("Redtail authentication failed (HTTP {status})");
        }
        let json: Value = serde_json::from_str(&body).context("parse Redtail auth JSON")?;
        parse_auth_info(&json)
    }

    pub async fn validate_user_key(&self) -> anyhow::Result<RedtailAuthInfo> {
        let body = self
            .get_json(
                "/contacts",
                &[("page", "1".to_string())],
                &[("pagesize", "1")],
            )
            .await?;
        let _ = array_at_any(&body, &["contacts"]);
        Ok(RedtailAuthInfo {
            user_key: self.user_key.clone(),
            name: "Redtail".to_string(),
            email: String::new(),
            tier: String::new(),
        })
    }

    pub async fn list_contacts(&self) -> anyhow::Result<Vec<Value>> {
        self.list_all_pages(
            "/contacts",
            "contacts",
            &[(
                "include",
                "addresses,phones,emails,urls,family,family.members,tag_memberships",
            )],
        )
        .await
    }

    #[allow(dead_code)]
    pub async fn get_contact(&self, contact_id: i64) -> anyhow::Result<Value> {
        self.get_json(
            &format!("/contacts/{contact_id}"),
            &[],
            &[(
                "include",
                "addresses,phones,emails,urls,family,family.members",
            )],
        )
        .await
    }

    async fn contact_family(&self, contact_id: i64) -> anyhow::Result<Option<RedtailFamily>> {
        let Some(body) = self
            .get_json_optional(&format!("/contacts/{contact_id}/family"), &[], &[])
            .await?
        else {
            return Ok(None);
        };
        Ok(parse_family_from_body(&body))
    }

    #[allow(dead_code)]
    pub async fn contact_family_contacts(&self, contact_id: i64) -> anyhow::Result<Vec<Value>> {
        let Some(body) = self
            .get_json_optional(&format!("/contacts/{contact_id}/family/contacts"), &[], &[])
            .await?
        else {
            return Ok(Vec::new());
        };
        Ok(array_at_any(&body, &["contacts", "family_contacts"]).unwrap_or_default())
    }

    async fn list_contact_notes(&self, contact_id: i64) -> anyhow::Result<Vec<Value>> {
        self.list_all_pages(&format!("/contacts/{contact_id}/notes/"), "notes", &[])
            .await
    }

    #[allow(dead_code)]
    pub async fn get_note(&self, note_id: i64) -> anyhow::Result<Value> {
        self.get_json(&format!("/notes/{note_id}"), &[], &[]).await
    }

    async fn list_contact_activities(&self, contact_id: i64) -> anyhow::Result<Vec<Value>> {
        self.list_all_pages(
            &format!("/contacts/{contact_id}/activities"),
            "activities",
            &[],
        )
        .await
    }

    async fn raw_contacts_cached(&self) -> anyhow::Result<Vec<Value>> {
        if let Some(cached) = self.cache.lock().await.raw_contacts.clone() {
            return Ok(cached);
        }
        let contacts = self.list_contacts().await?;
        self.cache.lock().await.raw_contacts = Some(contacts.clone());
        Ok(contacts)
    }

    async fn normalized_contacts(&self) -> anyhow::Result<Vec<CrmContact>> {
        if let Some(cached) = self.cache.lock().await.normalized_contacts.clone() {
            return Ok(cached);
        }

        let raw_contacts = self.raw_contacts_cached().await?;
        let contacts_by_id: HashMap<i64, Value> = raw_contacts
            .iter()
            .filter_map(|v| number_field(v, "id").map(|id| (id, v.clone())))
            .collect();

        let mut families_by_id: HashMap<i64, RedtailFamily> = HashMap::new();
        for id in contacts_by_id.keys() {
            if let Some(family) = self.contact_family(*id).await? {
                families_by_id.entry(family.id).or_insert(family);
            }
        }

        let mut contact_to_family: HashMap<i64, RedtailFamily> = HashMap::new();
        for family in families_by_id.values() {
            for member in &family.members {
                contact_to_family.insert(member.contact_id, family.clone());
            }
        }

        let mut out = Vec::new();
        for family in families_by_id.values() {
            out.push(family_to_household(family, &contacts_by_id));
        }
        for raw in &raw_contacts {
            if let Some(contact) = contact_to_crm(
                raw,
                contact_to_family.get(&number_field(raw, "id").unwrap_or_default()),
                &contacts_by_id,
            ) {
                out.push(contact);
            }
        }

        self.cache.lock().await.normalized_contacts = Some(out.clone());
        Ok(out)
    }

    async fn contact_ids(&self) -> anyhow::Result<Vec<i64>> {
        Ok(self
            .raw_contacts_cached()
            .await?
            .iter()
            .filter_map(|v| number_field(v, "id"))
            .collect())
    }

    async fn list_all_pages(
        &self,
        path: &str,
        array_key: &str,
        extra_headers: &[(&str, &str)],
    ) -> anyhow::Result<Vec<Value>> {
        let mut out = Vec::new();
        let mut page = 1usize;
        loop {
            let page_size = REDTAIL_PAGE_SIZE.to_string();
            let mut headers = extra_headers.to_vec();
            headers.push(("pagesize", page_size.as_str()));
            let body = self
                .get_json(path, &[("page", page.to_string())], &headers)
                .await?;
            let rows = array_at_any(&body, &[array_key]).unwrap_or_default();
            let count = rows.len();
            out.extend(rows);
            let total_pages = body
                .get("meta")
                .and_then(|m| number_field(m, "total_pages"))
                .unwrap_or(page as i64) as usize;
            if count < REDTAIL_PAGE_SIZE || page >= total_pages {
                break;
            }
            page += 1;
        }
        Ok(out)
    }

    async fn get_json(
        &self,
        path: &str,
        query: &[(&str, String)],
        extra_headers: &[(&str, &str)],
    ) -> anyhow::Result<Value> {
        self.get_json_status(path, query, extra_headers)
            .await
            .and_then(|(status, body)| {
                if !status.is_success() {
                    anyhow::bail!("Redtail request failed (HTTP {status})");
                }
                Ok(body)
            })
    }

    async fn get_json_optional(
        &self,
        path: &str,
        query: &[(&str, String)],
        extra_headers: &[(&str, &str)],
    ) -> anyhow::Result<Option<Value>> {
        let (status, body) = self.get_json_status(path, query, extra_headers).await?;
        if status.as_u16() == 404 {
            return Ok(None);
        }
        if !status.is_success() {
            anyhow::bail!("Redtail request failed (HTTP {status})");
        }
        Ok(Some(body))
    }

    async fn get_json_status(
        &self,
        path: &str,
        query: &[(&str, String)],
        extra_headers: &[(&str, &str)],
    ) -> anyhow::Result<(reqwest::StatusCode, Value)> {
        let url = if path.starts_with("http") {
            path.to_string()
        } else {
            format!("{}{}", self.base, path)
        };
        let mut req = self.http.get(&url).header(
            "Authorization",
            build_userkey_auth_header(&self.api_key, &self.user_key),
        );
        for (key, value) in extra_headers {
            req = req.header(*key, *value);
        }
        for (key, value) in query {
            req = req.query(&[(*key, value.as_str())]);
        }
        let configured_host = reqwest::Url::parse(&self.base)
            .ok()
            .and_then(|parsed| parsed.host_str().map(str::to_string))
            .ok_or_else(|| anyhow::anyhow!("Redtail API base has no host"))?;
        let resp = crate::commands::connector_network::send_guarded(
            &self.network_policy,
            &self.network_operation,
            &url,
            Some(&configured_host),
            req,
        )
        .await
        .map_err(|error| crate::commands::connector_network::transport_error(error, "Redtail HTTP GET"))?;
        let status = resp.status();
        let text = resp.text().await.context("read Redtail response body")?;
        if text.trim().is_empty() {
            return Ok((status, Value::Null));
        }
        let body = serde_json::from_str(&text).context("parse Redtail JSON response")?;
        Ok((status, body))
    }
}

#[async_trait]
impl CrmSource for RedtailClient {
    fn provider_id(&self) -> &'static str {
        "redtail"
    }

    async fn list_all_contacts(&self) -> anyhow::Result<Vec<CrmContact>> {
        self.normalized_contacts().await
    }

    async fn list_notes(&self) -> anyhow::Result<Vec<CrmNote>> {
        let mut notes_by_id: HashMap<String, CrmNote> = HashMap::new();
        for contact_id in self.contact_ids().await? {
            for raw in self.list_contact_notes(contact_id).await? {
                if let Some(note) = note_to_crm(&raw, contact_id) {
                    match notes_by_id.entry(note.crm_key()) {
                        std::collections::hash_map::Entry::Occupied(mut entry) => {
                            merge_crm_links(&mut entry.get_mut().linked_to, note.linked_to);
                        }
                        std::collections::hash_map::Entry::Vacant(entry) => {
                            entry.insert(note);
                        }
                    }
                }
            }
        }
        Ok(notes_by_id.into_values().collect())
    }

    async fn list_tasks(&self) -> anyhow::Result<Vec<crate::commands::crm::model::CrmTask>> {
        Ok(Vec::new())
    }

    async fn list_events(&self) -> anyhow::Result<Vec<CrmEvent>> {
        let mut events_by_id: HashMap<String, CrmEvent> = HashMap::new();
        for contact_id in self.contact_ids().await? {
            for raw in self.list_contact_activities(contact_id).await? {
                if let Some(event) = activity_to_event(&raw, contact_id) {
                    match events_by_id.entry(event.crm_key()) {
                        std::collections::hash_map::Entry::Occupied(mut entry) => {
                            merge_crm_links(&mut entry.get_mut().linked_to, event.linked_to);
                        }
                        std::collections::hash_map::Entry::Vacant(entry) => {
                            entry.insert(event);
                        }
                    }
                }
            }
        }
        Ok(events_by_id.into_values().collect())
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

pub fn redtail_api_key() -> anyhow::Result<String> {
    let key = std::env::var("LANTERN_REDTAIL_API_KEY")
        .ok()
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| anyhow::anyhow!("LANTERN_REDTAIL_API_KEY is not configured"))?;
    Ok(key)
}

pub fn build_basic_auth_header(api_key: &str, username: &str, password: &str) -> String {
    let raw = format!("{}:{}:{}", api_key, username, password);
    format!(
        "Basic {}",
        base64::engine::general_purpose::STANDARD.encode(raw.as_bytes())
    )
}

pub fn build_userkey_auth_header(api_key: &str, user_key: &str) -> String {
    let raw = format!("{}:{}", api_key, user_key);
    format!(
        "Userkeyauth {}",
        base64::engine::general_purpose::STANDARD.encode(raw.as_bytes())
    )
}

fn parse_auth_info(body: &Value) -> anyhow::Result<RedtailAuthInfo> {
    let user = body.get("authenticated_user").unwrap_or(body);
    let user_key = string_field(user, "user_key");
    if user_key.trim().is_empty() {
        anyhow::bail!("Redtail authentication response had no user_key");
    }
    let first = string_field(user, "first_name");
    let last = string_field(user, "last_name");
    let username = string_field(user, "username");
    let name = [first, last]
        .into_iter()
        .filter(|s| !s.trim().is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    Ok(RedtailAuthInfo {
        user_key,
        name: if name.trim().is_empty() {
            username
        } else {
            name
        },
        email: string_field(user, "email"),
        tier: string_field(user, "tier"),
    })
}

fn family_to_household(family: &RedtailFamily, contacts_by_id: &HashMap<i64, Value>) -> CrmContact {
    let mut members = Vec::new();
    for member in &family.members {
        if let Some(raw) = contacts_by_id.get(&member.contact_id) {
            members.push(CrmHouseholdMember {
                id: stable_numeric_id(&redtail_contact_key(member.contact_id)),
                external_id: redtail_contact_key(member.contact_id),
                source_provider: CrmRecordProvider::Redtail,
                first_name: string_field(raw, "first_name"),
                last_name: string_field(raw, "last_name"),
                title: if member.hoh {
                    "Head of household".to_string()
                } else if member.relationship_name.trim().is_empty() {
                    "Member".to_string()
                } else {
                    member.relationship_name.clone()
                },
                r#type: redtail_contact_type(raw),
            });
        }
    }

    CrmContact {
        id: stable_numeric_id(&redtail_family_key(family.id)),
        external_id: redtail_family_key(family.id),
        source_provider: CrmRecordProvider::Redtail,
        r#type: "household".to_string(),
        name: family.name.clone(),
        company_name: family.name.clone(),
        contact_type: "Family".to_string(),
        household: None,
        contact_roles: Vec::new(),
        tags: Vec::new(),
        ..Default::default()
    }
    .with_members(members)
}

trait WithMembers {
    fn with_members(self, members: Vec<CrmHouseholdMember>) -> Self;
}

impl WithMembers for CrmContact {
    fn with_members(mut self, members: Vec<CrmHouseholdMember>) -> Self {
        self.contact_roles = members
            .iter()
            .map(|m| {
                serde_json::json!({
                    "external_id": m.external_id,
                    "name": format!("{} {}", m.first_name, m.last_name).trim(),
                    "title": m.title,
                })
            })
            .collect();
        self
    }
}

fn contact_to_crm(
    raw: &Value,
    family: Option<&RedtailFamily>,
    contacts_by_id: &HashMap<i64, Value>,
) -> Option<CrmContact> {
    let id = number_field(raw, "id")?;
    let family_ref = family.map(|family| {
        let members = family
            .members
            .iter()
            .filter_map(|member| {
                contacts_by_id
                    .get(&member.contact_id)
                    .map(|raw_member| CrmHouseholdMember {
                        id: stable_numeric_id(&redtail_contact_key(member.contact_id)),
                        external_id: redtail_contact_key(member.contact_id),
                        source_provider: CrmRecordProvider::Redtail,
                        first_name: string_field(raw_member, "first_name"),
                        last_name: string_field(raw_member, "last_name"),
                        title: if member.hoh {
                            "Head of household".to_string()
                        } else if member.relationship_name.trim().is_empty() {
                            "Member".to_string()
                        } else {
                            member.relationship_name.clone()
                        },
                        r#type: redtail_contact_type(raw_member),
                    })
            })
            .collect();
        CrmHouseholdRef {
            id: stable_numeric_id(&redtail_family_key(family.id)),
            external_id: redtail_family_key(family.id),
            source_provider: CrmRecordProvider::Redtail,
            name: family.name.clone(),
            title: family
                .members
                .iter()
                .find(|m| m.contact_id == id)
                .map(|m| {
                    if m.hoh {
                        "Head of household".to_string()
                    } else if m.relationship_name.trim().is_empty() {
                        "Member".to_string()
                    } else {
                        m.relationship_name.clone()
                    }
                })
                .unwrap_or_else(|| "Member".to_string()),
            members,
        }
    });

    Some(CrmContact {
        id: stable_numeric_id(&redtail_contact_key(id)),
        external_id: redtail_contact_key(id),
        source_provider: CrmRecordProvider::Redtail,
        r#type: redtail_contact_type(raw),
        prefix: string_field(raw, "salutation"),
        first_name: string_field(raw, "first_name"),
        middle_name: string_field(raw, "middle_name"),
        last_name: string_field(raw, "last_name"),
        nickname: string_field(raw, "nickname"),
        suffix: string_field(raw, "suffix"),
        company_name: string_field(raw, "company_name"),
        job_title: string_field(raw, "job_title"),
        birth_date: option_string_field(raw, "dob"),
        date_of_death: option_string_field(raw, "death_date"),
        client_since: option_string_field(raw, "client_since"),
        marital_status: string_field(raw, "marital_status"),
        contact_type: string_field(raw, "category"),
        status: string_field(raw, "status"),
        background_information: decode_redtail_html(&string_field(raw, "referred_by")),
        street_addresses: parse_addresses(raw),
        email_addresses: parse_emails(raw),
        phone_numbers: parse_phones(raw),
        household: family_ref,
        ..Default::default()
    })
}

fn note_to_crm(raw: &Value, contact_id: i64) -> Option<CrmNote> {
    let id = number_field(raw, "id")?;
    let mut linked_to = linked_contacts(raw);
    if linked_to.is_empty() {
        linked_to.push(contact_link(contact_id, ""));
    }
    Some(CrmNote {
        id: stable_numeric_id(&redtail_note_key(id)),
        external_id: redtail_note_key(id),
        source_provider: CrmRecordProvider::Redtail,
        created_at: string_field(raw, "created_at"),
        updated_at: string_field(raw, "updated_at"),
        content: decode_redtail_html(&first_non_empty(raw, &["body", "content", "note"])),
        linked_to,
    })
}

fn activity_to_event(raw: &Value, contact_id: i64) -> Option<CrmEvent> {
    let id = number_field(raw, "id")?;
    let mut linked_to = linked_contacts(raw);
    if linked_to.is_empty() {
        linked_to.push(contact_link(contact_id, ""));
    }
    Some(CrmEvent {
        id: stable_numeric_id(&redtail_activity_key(id)),
        external_id: redtail_activity_key(id),
        source_provider: CrmRecordProvider::Redtail,
        title: first_non_empty(raw, &["title", "subject", "name"]),
        starts_at: first_non_empty(
            raw,
            &["starts_at", "start_time", "start_date", "activity_date"],
        ),
        ends_at: first_non_empty(raw, &["ends_at", "end_time", "end_date"]),
        all_day: bool_field(raw, "all_day"),
        location: string_field(raw, "location"),
        description: decode_redtail_html(&first_non_empty(raw, &["description", "body", "notes"])),
        linked_to,
    })
}

fn linked_contacts(raw: &Value) -> Vec<CrmLink> {
    let mut links = Vec::new();
    let arrays = ["linked_contacts", "contacts", "attendees"];
    let mut seen = HashSet::new();
    for key in arrays {
        let Some(items) = raw.get(key).and_then(|v| v.as_array()) else {
            continue;
        };
        for item in items {
            let id = number_field(item, "contact_id").or_else(|| number_field(item, "id"));
            if let Some(id) = id {
                if seen.insert(id) {
                    links.push(contact_link(
                        id,
                        &first_non_empty(item, &["full_name", "name"]),
                    ));
                }
            }
        }
    }
    links
}

fn merge_crm_links(existing: &mut Vec<CrmLink>, incoming: Vec<CrmLink>) {
    let mut seen: HashSet<String> = existing.iter().map(|link| link.crm_key()).collect();
    for link in incoming {
        if seen.insert(link.crm_key()) {
            existing.push(link);
        }
    }
}

fn contact_link(contact_id: i64, name: &str) -> CrmLink {
    CrmLink {
        id: stable_numeric_id(&redtail_contact_key(contact_id)),
        external_id: redtail_contact_key(contact_id),
        source_provider: CrmRecordProvider::Redtail,
        r#type: "contact".to_string(),
        name: name.to_string(),
    }
}

fn parse_family_from_body(body: &Value) -> Option<RedtailFamily> {
    let candidates = if let Some(arr) = body.get("contact_family").and_then(|v| v.as_array()) {
        arr.clone()
    } else if let Some(arr) = body.get("contact_families").and_then(|v| v.as_array()) {
        arr.clone()
    } else if let Some(obj) = body.get("families") {
        vec![obj.clone()]
    } else {
        Vec::new()
    };
    candidates.into_iter().find_map(|family| {
        let id = number_field(&family, "id")?;
        let members = family
            .get("members")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|m| {
                Some(RedtailFamilyMember {
                    contact_id: number_field(&m, "contact_id")?,
                    relationship_name: string_field(&m, "relationship_name"),
                    hoh: bool_field(&m, "hoh"),
                })
            })
            .collect();
        Some(RedtailFamily {
            id,
            name: string_field(&family, "name"),
            members,
        })
    })
}

fn redtail_contact_type(raw: &Value) -> String {
    match string_field(raw, "type").to_ascii_lowercase().as_str() {
        "business" | "association" | "union" => "organization".to_string(),
        "trust" => "trust".to_string(),
        _ => "person".to_string(),
    }
}

fn parse_addresses(raw: &Value) -> Vec<CrmStreetAddress> {
    array_at_any(raw, &["addresses", "street_addresses"])
        .unwrap_or_default()
        .into_iter()
        .filter_map(|a| {
            let address = first_non_empty(&a, &["address", "street_address", "street"]);
            let city = string_field(&a, "city");
            let state = string_field(&a, "state");
            let zip = first_non_empty(&a, &["zip", "postal_code"]);
            if [
                address.as_str(),
                city.as_str(),
                state.as_str(),
                zip.as_str(),
            ]
            .iter()
            .all(|v| v.trim().is_empty())
            {
                return None;
            }
            Some(CrmStreetAddress {
                address,
                city,
                state,
                zip,
                kind: first_non_empty(&a, &["address_type", "kind", "type"]),
                principal: bool_field(&a, "primary") || bool_field(&a, "principal"),
            })
        })
        .collect()
}

fn parse_emails(raw: &Value) -> Vec<CrmEmailAddress> {
    array_at_any(raw, &["emails", "email_addresses"])
        .unwrap_or_default()
        .into_iter()
        .filter_map(|e| {
            let address = first_non_empty(&e, &["address", "email", "email_address"]);
            if address.trim().is_empty() {
                return None;
            }
            Some(CrmEmailAddress {
                address,
                kind: first_non_empty(&e, &["email_type", "kind", "type"]),
                principal: bool_field(&e, "primary") || bool_field(&e, "principal"),
            })
        })
        .collect()
}

fn parse_phones(raw: &Value) -> Vec<CrmPhoneNumber> {
    array_at_any(raw, &["phones", "phone_numbers"])
        .unwrap_or_default()
        .into_iter()
        .filter_map(|p| {
            let address = first_non_empty(&p, &["number", "phone_number", "address"]);
            if address.trim().is_empty() {
                return None;
            }
            Some(CrmPhoneNumber {
                address,
                kind: first_non_empty(&p, &["phone_type", "kind", "type"]),
                principal: bool_field(&p, "primary") || bool_field(&p, "principal"),
            })
        })
        .collect()
}

fn redtail_family_key(id: i64) -> String {
    format!("redtail:family:{id}")
}

fn redtail_contact_key(id: i64) -> String {
    format!("redtail:contact:{id}")
}

fn redtail_note_key(id: i64) -> String {
    format!("redtail:note:{id}")
}

fn redtail_activity_key(id: i64) -> String {
    format!("redtail:activity:{id}")
}

fn stable_numeric_id(input: &str) -> i64 {
    let hash = Sha256::digest(input.as_bytes());
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&hash[..8]);
    (u64::from_be_bytes(bytes) & 0x7fff_ffff_ffff_ffff) as i64
}

fn array_at_any(body: &Value, keys: &[&str]) -> Option<Vec<Value>> {
    for key in keys {
        if let Some(arr) = body.get(*key).and_then(|v| v.as_array()) {
            return Some(arr.clone());
        }
    }
    body.as_array().cloned()
}

fn number_field(v: &Value, key: &str) -> Option<i64> {
    v.get(key).and_then(|x| {
        x.as_i64()
            .or_else(|| x.as_u64().and_then(|n| i64::try_from(n).ok()))
            .or_else(|| x.as_str()?.parse::<i64>().ok())
    })
}

fn bool_field(v: &Value, key: &str) -> bool {
    v.get(key).and_then(|x| x.as_bool()).unwrap_or(false)
}

fn string_field(v: &Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| {
            if x.is_null() {
                None
            } else if let Some(s) = x.as_str() {
                Some(s.to_string())
            } else {
                Some(x.to_string())
            }
        })
        .unwrap_or_default()
}

fn option_string_field(v: &Value, key: &str) -> Option<String> {
    let value = string_field(v, key);
    if value.trim().is_empty() {
        None
    } else {
        Some(value)
    }
}

fn first_non_empty(v: &Value, keys: &[&str]) -> String {
    for key in keys {
        let value = string_field(v, key);
        if !value.trim().is_empty() {
            return value;
        }
    }
    String::new()
}

fn decode_redtail_html(input: &str) -> String {
    input
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&quot;", "\"")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{header, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    #[test]
    fn builds_basic_and_userkey_auth_headers() {
        assert_eq!(
            build_basic_auth_header("api", "advisor", "secret"),
            "Basic YXBpOmFkdmlzb3I6c2VjcmV0"
        );
        assert_eq!(
            build_userkey_auth_header("api", "USERKEY"),
            "Userkeyauth YXBpOlVTRVJLRVk="
        );
    }

    #[tokio::test]
    async fn authentication_exchanges_password_for_userkey_only() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/authentication"))
            .and(header(
                "Authorization",
                build_basic_auth_header("api-key", "advisor", "secret"),
            ))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "authenticated_user": {
                    "user_key": "USERKEY-123",
                    "first_name": "Ada",
                    "last_name": "Advisor",
                    "email": "ada@example.com",
                    "tier": "crm"
                }
            })))
            .mount(&server)
            .await;

        let info =
            RedtailClient::authenticate_with_base("api-key", "advisor", "secret", &server.uri())
                .await
                .expect("authenticate");

        assert_eq!(info.user_key, "USERKEY-123");
        assert_eq!(info.name, "Ada Advisor");
        assert_eq!(info.email, "ada@example.com");
    }

    #[tokio::test]
    async fn redtail_userkey_auth_reads_contacts_with_namespaced_ids() {
        let server = MockServer::start().await;
        let userkey_header = build_userkey_auth_header("api-key", "USERKEY-123");

        Mock::given(method("GET"))
            .and(path("/contacts"))
            .and(header("Authorization", userkey_header.as_str()))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "contacts": [
                    {
                        "id": 66,
                        "type": "Individual",
                        "first_name": "Robert",
                        "last_name": "Anderson",
                        "dob": "1965-04-12",
                        "category": "Client",
                        "status": "Active Client",
                        "emails": [{ "email_address": "robert@example.com", "email_type": "Personal", "primary": true }],
                        "phones": [{ "number": "555-100-2000", "phone_type": "Mobile", "primary": true }]
                    },
                    {
                        "id": 67,
                        "type": "Individual",
                        "first_name": "Linda",
                        "last_name": "Anderson"
                    }
                ],
                "meta": { "total_pages": 1 }
            })))
            .mount(&server)
            .await;
        for contact_id in [66, 67] {
            Mock::given(method("GET"))
                .and(path(format!("/contacts/{contact_id}/family")))
                .and(header("Authorization", userkey_header.as_str()))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "contact_family": [{
                        "id": 7,
                        "name": "The Anderson Family",
                        "members": [
                            { "contact_id": 66, "relationship_name": null, "hoh": true },
                            { "contact_id": 67, "relationship_name": "Spouse", "hoh": false }
                        ]
                    }]
                })))
                .mount(&server)
                .await;
        }

        let client = RedtailClient::new_with_base(
            "api-key".to_string(),
            "USERKEY-123".to_string(),
            server.uri(),
        );
        let contacts = client.list_all_contacts().await.expect("contacts");

        let household = contacts.iter().find(|c| c.r#type == "household").unwrap();
        assert_eq!(household.crm_key(), "redtail:family:7");

        let robert = contacts
            .iter()
            .find(|c| c.first_name == "Robert")
            .expect("robert");
        assert_eq!(robert.crm_key(), "redtail:contact:66");
        assert_eq!(robert.household_key().as_deref(), Some("redtail:family:7"));
        assert_eq!(robert.email_addresses[0].address, "robert@example.com");
    }

    #[tokio::test]
    async fn normalizes_notes_and_activities_under_redtail_contact_links() {
        let server = MockServer::start().await;
        let userkey_header = build_userkey_auth_header("api-key", "USERKEY-123");

        Mock::given(method("GET"))
            .and(path("/contacts"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "contacts": [{ "id": 66, "type": "Individual", "first_name": "Robert", "last_name": "Anderson" }],
                "meta": { "total_pages": 1 }
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/contacts/66/family"))
            .respond_with(ResponseTemplate::new(404))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/contacts/66/notes/"))
            .and(header("Authorization", userkey_header.as_str()))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "notes": [{
                    "id": 2,
                    "body": "Reviewed Q1 allocation&#39;s risk.",
                    "created_at": "2019-10-26T01:08:30.000Z",
                    "updated_at": "2019-10-26T01:08:30.000Z"
                }],
                "meta": { "total_pages": 1 }
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/contacts/66/activities"))
            .and(header("Authorization", userkey_header.as_str()))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "activities": [{
                    "id": 10,
                    "title": "Annual Review",
                    "starts_at": "2026-07-15T10:00:00Z",
                    "description": "Tax-loss harvest discussion."
                }],
                "meta": { "total_pages": 1 }
            })))
            .mount(&server)
            .await;

        let client = RedtailClient::new_with_base(
            "api-key".to_string(),
            "USERKEY-123".to_string(),
            server.uri(),
        );

        let notes = client.list_notes().await.expect("notes");
        assert_eq!(notes[0].crm_key(), "redtail:note:2");
        assert_eq!(notes[0].linked_to[0].crm_key(), "redtail:contact:66");
        assert!(notes[0].content.contains("allocation's risk"));

        let events = client.list_events().await.expect("events");
        assert_eq!(events[0].crm_key(), "redtail:activity:10");
        assert_eq!(events[0].linked_to[0].crm_key(), "redtail:contact:66");
    }

    #[tokio::test]
    async fn shared_notes_and_activities_merge_all_redtail_contact_links() {
        let server = MockServer::start().await;
        let userkey_header = build_userkey_auth_header("api-key", "USERKEY-123");

        Mock::given(method("GET"))
            .and(path("/contacts"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "contacts": [
                    { "id": 66, "type": "Individual", "first_name": "Robert", "last_name": "Anderson" },
                    { "id": 77, "type": "Individual", "first_name": "Marisol", "last_name": "Bennett" }
                ],
                "meta": { "total_pages": 1 }
            })))
            .mount(&server)
            .await;

        for contact_id in [66, 77] {
            Mock::given(method("GET"))
                .and(path(format!("/contacts/{contact_id}/notes/")))
                .and(header("Authorization", userkey_header.as_str()))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "notes": [{
                        "id": 2,
                        "body": "Shared planning note.",
                        "created_at": "2026-06-01T12:00:00Z",
                        "updated_at": "2026-06-01T12:00:00Z"
                    }],
                    "meta": { "total_pages": 1 }
                })))
                .mount(&server)
                .await;

            Mock::given(method("GET"))
                .and(path(format!("/contacts/{contact_id}/activities")))
                .and(header("Authorization", userkey_header.as_str()))
                .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                    "activities": [{
                        "id": 10,
                        "title": "Shared review",
                        "starts_at": "2026-07-15T10:00:00Z",
                        "description": "Shared household review."
                    }],
                    "meta": { "total_pages": 1 }
                })))
                .mount(&server)
                .await;
        }

        let client = RedtailClient::new_with_base(
            "api-key".to_string(),
            "USERKEY-123".to_string(),
            server.uri(),
        );

        let notes = client.list_notes().await.expect("notes");
        assert_eq!(notes.len(), 1, "same Redtail note id should dedupe");
        let note_links: HashSet<String> = notes[0].linked_to.iter().map(|l| l.crm_key()).collect();
        assert_eq!(
            note_links,
            HashSet::from([
                "redtail:contact:66".to_string(),
                "redtail:contact:77".to_string()
            ])
        );

        let events = client.list_events().await.expect("events");
        assert_eq!(events.len(), 1, "same Redtail activity id should dedupe");
        let event_links: HashSet<String> =
            events[0].linked_to.iter().map(|l| l.crm_key()).collect();
        assert_eq!(
            event_links,
            HashSet::from([
                "redtail:contact:66".to_string(),
                "redtail:contact:77".to_string()
            ])
        );
    }
}
