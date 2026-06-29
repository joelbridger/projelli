//! Provisional Zocks meeting/session models.
//!
//! Zocks does not currently publish confirmed self-serve API docs for this
//! connector. These structs are deliberately tolerant of missing/null fields
//! and a few common list-response shapes so mocked fixture tests can prove the
//! Keepance side without requiring a live Zocks account.

fn null_to_default<'de, D, T>(d: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de> + Default,
{
    Ok(<Option<T> as serde::Deserialize<'de>>::deserialize(d)?.unwrap_or_default())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct ZocksParticipant {
    #[serde(default, deserialize_with = "null_to_default")]
    pub name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub email: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub role: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct ZocksActionItem {
    #[serde(default, deserialize_with = "null_to_default")]
    pub text: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub owner: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub due_date: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub status: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct ZocksSession {
    #[serde(default, alias = "sessionId", deserialize_with = "null_to_default")]
    pub id: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub title: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub client_name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub client_email: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub started_at: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub ended_at: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub summary: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub notes: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub transcript: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub key_points: Vec<String>,
    #[serde(default, deserialize_with = "null_to_default")]
    pub action_items: Vec<ZocksActionItem>,
    #[serde(default, deserialize_with = "null_to_default")]
    pub participants: Vec<ZocksParticipant>,
    #[serde(default, deserialize_with = "null_to_default")]
    pub tags: Vec<String>,
    #[serde(default, deserialize_with = "null_to_default")]
    pub updated_at: String,
}

impl ZocksSession {
    pub fn stable_id(&self) -> String {
        self.id.trim().to_string()
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct ZocksSessionsPage {
    #[serde(default, alias = "data", alias = "sessions", deserialize_with = "null_to_default")]
    pub sessions: Vec<ZocksSession>,
    #[serde(default, alias = "nextCursor", deserialize_with = "null_to_default")]
    pub next_cursor: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ZocksMatterMapEntry {
    pub zocks_key: String,
    pub matter_id: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ZocksNeedsAssignment {
    pub source_id: String,
    pub session_id: String,
    pub title: String,
    pub reason: String,
}
