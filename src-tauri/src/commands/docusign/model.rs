//! Normalized DocuSign e-signature models.
//!
//! These structs are intentionally tolerant: DocuSign's API mixes camelCase
//! JSON names, optional arrays, and string timestamps. Missing/null values
//! become empty strings or empty arrays so a sparse envelope still syncs.

fn null_to_default<'de, D, T>(d: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de> + Default,
{
    Ok(<Option<T> as serde::Deserialize<'de>>::deserialize(d)?.unwrap_or_default())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocusignEnvironment {
    Demo,
    Production,
}

impl DocusignEnvironment {
    pub fn oauth_base(self) -> &'static str {
        match self {
            Self::Demo => "https://account-d.docusign.com",
            Self::Production => "https://account.docusign.com",
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default, rename_all = "snake_case")]
pub struct DocusignAccountInfo {
    pub account_id: String,
    pub base_uri: String,
    pub account_name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct DocusignConnection {
    pub refresh_token: String,
    pub account_id: String,
    pub base_uri: String,
    pub account_name: String,
    pub environment: String,
}

impl DocusignConnection {
    pub fn api_base(&self) -> String {
        format!("{}/restapi", self.base_uri.trim_end_matches('/'))
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct DocusignUser {
    #[serde(default, deserialize_with = "null_to_default")]
    pub user_name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub email: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct DocusignRecipient {
    #[serde(default, deserialize_with = "null_to_default")]
    pub recipient_id: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub recipient_id_guid: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub email: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub role_name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub status: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub routing_order: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub signed_date_time: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub delivered_date_time: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct DocusignRecipients {
    #[serde(default, deserialize_with = "null_to_default")]
    pub signers: Vec<DocusignRecipient>,
    #[serde(default, deserialize_with = "null_to_default")]
    pub carbon_copies: Vec<DocusignRecipient>,
    #[serde(default, deserialize_with = "null_to_default")]
    pub certified_deliveries: Vec<DocusignRecipient>,
}

impl DocusignRecipients {
    pub fn all(&self) -> Vec<&DocusignRecipient> {
        self.signers
            .iter()
            .chain(self.carbon_copies.iter())
            .chain(self.certified_deliveries.iter())
            .collect()
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct DocusignDocument {
    #[serde(default, deserialize_with = "null_to_default")]
    pub document_id: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub uri: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub r#type: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct DocusignCustomField {
    #[serde(default, deserialize_with = "null_to_default")]
    pub name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub value: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct DocusignCustomFields {
    #[serde(default, deserialize_with = "null_to_default")]
    pub text_custom_fields: Vec<DocusignCustomField>,
    #[serde(default, deserialize_with = "null_to_default")]
    pub list_custom_fields: Vec<DocusignCustomField>,
}

impl DocusignCustomFields {
    pub fn all(&self) -> Vec<&DocusignCustomField> {
        self.text_custom_fields
            .iter()
            .chain(self.list_custom_fields.iter())
            .collect()
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct DocusignEnvelope {
    #[serde(default, deserialize_with = "null_to_default")]
    pub envelope_id: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub email_subject: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub status: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub created_date_time: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub sent_date_time: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub completed_date_time: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub folder_name: String,
    pub sender: Option<DocusignUser>,
    pub recipients: Option<DocusignRecipients>,
    #[serde(
        default,
        alias = "envelopeDocuments",
        deserialize_with = "null_to_default"
    )]
    pub documents: Vec<DocusignDocument>,
    pub custom_fields: Option<DocusignCustomFields>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct DocusignEnvelopePage {
    #[serde(default, deserialize_with = "null_to_default")]
    pub envelopes: Vec<DocusignEnvelope>,
    #[serde(default, deserialize_with = "null_to_default")]
    pub result_set_size: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub start_position: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub end_position: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub next_uri: String,
}

impl DocusignEnvelopePage {
    pub fn next_start_position(&self) -> Option<String> {
        if self.next_uri.trim().is_empty() {
            return None;
        }
        self.next_uri
            .split('?')
            .nth(1)
            .unwrap_or(&self.next_uri)
            .split('&')
            .find_map(|pair| {
                let mut parts = pair.splitn(2, '=');
                match (parts.next(), parts.next()) {
                    (Some("start_position"), Some(v)) if !v.is_empty() => Some(v.to_string()),
                    _ => None,
                }
            })
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct DocusignAuditEvent {
    #[serde(default, deserialize_with = "null_to_default")]
    pub event_id: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub event_type: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub timestamp: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub user_name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub email: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub ip_address: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub authentication_method: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub message: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct DocusignAuditEventsResponse {
    #[serde(default, alias = "auditEvents", deserialize_with = "null_to_default")]
    pub audit_events: Vec<DocusignAuditEvent>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EsignMatterMapEntry {
    pub esign_key: String,
    pub matter_id: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DocusignNeedsAssignment {
    pub source_id: String,
    pub envelope_id: String,
    pub subject: String,
    pub reason: String,
}
