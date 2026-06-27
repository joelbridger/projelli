//! Calendly API models.
//!
//! These structs intentionally accept missing and `null` fields. Calendly data
//! is user-entered, and older events can be sparse, so the connector should
//! skip empty fields instead of failing a whole sync.

pub const DEFAULT_COUNT: usize = 100;

fn null_to_default<'de, D, T>(d: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de> + Default,
{
    Ok(<Option<T> as serde::Deserialize<'de>>::deserialize(d)?.unwrap_or_default())
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct CalendlyUser {
    #[serde(default, deserialize_with = "null_to_default")]
    pub uri: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub email: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub current_organization: String,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct CalendlyUserResponse {
    pub resource: CalendlyUser,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct CalendlyPagination {
    pub count: Option<u32>,
    pub next_page: Option<String>,
    pub next_page_token: Option<String>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct CalendlyLocation {
    #[serde(rename = "type", default, deserialize_with = "null_to_default")]
    pub r#type: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub location: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub join_url: String,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct CalendlyScheduledEvent {
    #[serde(default, deserialize_with = "null_to_default")]
    pub uri: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub status: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub start_time: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub end_time: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub created_at: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub updated_at: String,
    pub location: Option<CalendlyLocation>,
    pub event_type: Option<String>,
}

impl CalendlyScheduledEvent {
    pub fn uuid(&self) -> String {
        uuid_from_uri(&self.uri)
    }
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct CalendlyEventsResponse {
    pub collection: Vec<CalendlyScheduledEvent>,
    pub pagination: CalendlyPagination,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct CalendlyEventResponse {
    pub resource: CalendlyScheduledEvent,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct CalendlyQuestionAnswer {
    #[serde(default, deserialize_with = "null_to_default")]
    pub question: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub answer: String,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct CalendlyInvitee {
    #[serde(default, deserialize_with = "null_to_default")]
    pub uri: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub email: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub status: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub created_at: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub updated_at: String,
    pub questions_and_answers: Vec<CalendlyQuestionAnswer>,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct CalendlyInviteesResponse {
    pub collection: Vec<CalendlyInvitee>,
    pub pagination: CalendlyPagination,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
pub struct CalendlyEventWithInvitees {
    pub event: CalendlyScheduledEvent,
    pub invitees: Vec<CalendlyInvitee>,
}

pub fn uuid_from_uri(uri: &str) -> String {
    uri.trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or(uri)
        .to_string()
}
