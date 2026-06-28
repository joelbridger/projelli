//! Jotform API models.
//!
//! Jotform submission answers are user-defined and can be sparse, nested, or
//! null. These models preserve the raw value while exposing tolerant helpers for
//! matching and text rendering.

use std::collections::BTreeMap;

fn null_to_default<'de, D, T>(d: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de> + Default,
{
    Ok(<Option<T> as serde::Deserialize<'de>>::deserialize(d)?.unwrap_or_default())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct JotformUserResponse {
    pub response_code: Option<u16>,
    pub content: JotformUser,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct JotformUser {
    #[serde(default, deserialize_with = "null_to_default")]
    pub username: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub email: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct JotformFormsResponse {
    pub content: Vec<JotformForm>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct JotformForm {
    #[serde(default, alias = "id", alias = "formId", deserialize_with = "null_to_default")]
    pub form_id: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub title: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub status: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub created_at: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub updated_at: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct JotformSubmissionsResponse {
    pub content: Vec<JotformSubmission>,
    pub limit_left: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct JotformSubmission {
    #[serde(default, alias = "submissionID", alias = "submissionId", deserialize_with = "null_to_default")]
    pub id: String,
    #[serde(default, alias = "formID", alias = "formId", deserialize_with = "null_to_default")]
    pub form_id: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub created_at: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub updated_at: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub ip: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub status: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub answers: BTreeMap<String, JotformAnswer>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct JotformAnswer {
    #[serde(default, deserialize_with = "null_to_default")]
    pub name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub text: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub r#type: String,
    #[serde(default)]
    pub answer: serde_json::Value,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JotformMatterMapEntry {
    pub jotform_key: String,
    pub matter_id: String,
}

#[derive(Debug, Clone, serde::Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JotformNeedsAssignment {
    pub source_id: String,
    pub form_id: String,
    pub submission_id: String,
    pub submitter: String,
    pub reason: String,
}
