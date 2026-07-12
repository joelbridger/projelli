//! Typed, raw-response-preserving Wealthbox collection fetchers.
//!
//! The concrete connector must implement [`RawWealthboxTransport`] by exposing
//! the bytes received from the HTTP response *before* JSON parsing.  Rebuilding
//! bytes with `serde_json::to_vec` would not be verbatim capture and is therefore
//! intentionally not offered as an adapter here.

use anyhow::{bail, Context};
use async_trait::async_trait;
use serde_json::Value;

pub const IMPORTER_PAGE_SIZE: usize = 100;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawHttpResponse {
    pub request_path: String,
    pub response_bytes: Vec<u8>,
}

/// WealthboxClient implements this with its shared rate gate and PII-safe
/// status logging. Implementors must share that gate, never create a second
/// per-importer request limiter.
#[async_trait]
pub trait RawWealthboxTransport: Send + Sync {
    async fn get_raw(
        &self,
        path: &str,
        query: &[(String, String)],
    ) -> anyhow::Result<RawHttpResponse>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum SourceType {
    Contact,
    Note,
    Task,
    Event,
    Opportunity,
    Project,
    WorkflowTemplate,
    Workflow,
    WorkflowStep,
    CustomField,
    Tag,
    ContactRole,
    Activity,
    /// No API fetcher exists by design; this is fidelity/accounting only.
    Attachment,
    User,
    Team,
    CustomizableCategory,
    OpportunityStage,
}

impl SourceType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Contact => "contact",
            Self::Note => "note",
            Self::Task => "task",
            Self::Event => "event",
            Self::Opportunity => "opportunity",
            Self::Project => "project",
            Self::WorkflowTemplate => "workflow_template",
            Self::Workflow => "workflow",
            Self::WorkflowStep => "workflow_step",
            Self::CustomField => "custom_field",
            Self::Tag => "tag",
            Self::ContactRole => "contact_role",
            Self::Activity => "activity",
            Self::Attachment => "attachment",
            Self::User => "user",
            Self::Team => "team",
            Self::CustomizableCategory => "customizable_category",
            Self::OpportunityStage => "opportunity_stage",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct FetchedPage {
    pub source_type: SourceType,
    pub request_path: String,
    pub page: Option<usize>,
    pub activity_cursor: Option<String>,
    pub raw_response: RawHttpResponse,
    pub records: Vec<TypedSourceRecord>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TypedSourceRecord {
    pub source_type: SourceType,
    pub source_id: String,
    pub payload: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ActivityPage {
    pub fetched: FetchedPage,
    /// Opaque cursor supplied by Wealthbox. It is never interpreted or sorted.
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CollectionSpec {
    pub source_type: SourceType,
    pub path: &'static str,
    pub response_key: &'static str,
    pub supports_updated_since: bool,
}

const COLLECTIONS: &[CollectionSpec] = &[
    CollectionSpec {
        source_type: SourceType::Contact,
        path: "/contacts",
        response_key: "contacts",
        supports_updated_since: true,
    },
    // Wealthbox's notes endpoint returns status_updates, not notes.
    CollectionSpec {
        source_type: SourceType::Note,
        path: "/notes",
        response_key: "status_updates",
        supports_updated_since: true,
    },
    CollectionSpec {
        source_type: SourceType::Task,
        path: "/tasks",
        response_key: "tasks",
        supports_updated_since: true,
    },
    CollectionSpec {
        source_type: SourceType::Event,
        path: "/events",
        response_key: "events",
        supports_updated_since: true,
    },
    CollectionSpec {
        source_type: SourceType::Opportunity,
        path: "/opportunities",
        response_key: "opportunities",
        supports_updated_since: true,
    },
    CollectionSpec {
        source_type: SourceType::Project,
        path: "/projects",
        response_key: "projects",
        supports_updated_since: true,
    },
    CollectionSpec {
        source_type: SourceType::WorkflowTemplate,
        path: "/workflow_templates",
        response_key: "workflow_templates",
        supports_updated_since: true,
    },
    CollectionSpec {
        source_type: SourceType::Workflow,
        path: "/workflows",
        response_key: "workflows",
        supports_updated_since: false,
    },
    CollectionSpec {
        source_type: SourceType::WorkflowStep,
        path: "/workflow_steps",
        response_key: "workflow_steps",
        supports_updated_since: false,
    },
    CollectionSpec {
        source_type: SourceType::Tag,
        path: "/categories/tags",
        response_key: "tags",
        supports_updated_since: false,
    },
    CollectionSpec {
        source_type: SourceType::ContactRole,
        path: "/contact_roles",
        response_key: "contact_roles",
        supports_updated_since: false,
    },
    CollectionSpec {
        source_type: SourceType::User,
        path: "/users",
        response_key: "users",
        supports_updated_since: false,
    },
    CollectionSpec {
        source_type: SourceType::Team,
        path: "/teams",
        response_key: "teams",
        supports_updated_since: false,
    },
    CollectionSpec {
        source_type: SourceType::CustomizableCategory,
        path: "/customizable_categories",
        response_key: "customizable_categories",
        supports_updated_since: false,
    },
    CollectionSpec {
        source_type: SourceType::OpportunityStage,
        path: "/categories/opportunity_stage",
        response_key: "opportunity_stage",
        supports_updated_since: false,
    },
];

pub fn collection_spec(source_type: SourceType) -> Option<&'static CollectionSpec> {
    COLLECTIONS
        .iter()
        .find(|spec| spec.source_type == source_type)
}

fn parse_records(
    source_type: SourceType,
    key: &str,
    raw: &RawHttpResponse,
) -> anyhow::Result<Vec<TypedSourceRecord>> {
    let body: Value =
        serde_json::from_slice(&raw.response_bytes).context("parse captured Wealthbox JSON")?;
    let records = body
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| anyhow::anyhow!("Wealthbox response missing array `{key}`"))?;
    records
        .iter()
        .map(|payload| {
            let id = payload
                .get("id")
                .and_then(|value| match value {
                    Value::String(value) if !value.is_empty() => Some(value.clone()),
                    Value::Number(value) => Some(value.to_string()),
                    _ => None,
                })
                .ok_or_else(|| {
                    anyhow::anyhow!("{} record missing stable id", source_type.as_str())
                })?;
            Ok(TypedSourceRecord {
                source_type,
                source_id: id,
                payload: payload.clone(),
            })
        })
        .collect()
}

pub async fn fetch_page<T: RawWealthboxTransport>(
    transport: &T,
    source_type: SourceType,
    page: usize,
    updated_since: Option<&str>,
) -> anyhow::Result<FetchedPage> {
    let spec = collection_spec(source_type).ok_or_else(|| {
        anyhow::anyhow!("no numbered-page collection for {}", source_type.as_str())
    })?;
    if updated_since.is_some() && !spec.supports_updated_since {
        bail!("{} does not support updated_since", source_type.as_str());
    }
    let mut query = vec![
        ("page".to_string(), page.to_string()),
        ("per_page".to_string(), IMPORTER_PAGE_SIZE.to_string()),
    ];
    if let Some(cursor) = updated_since {
        query.push(("updated_since".to_string(), cursor.to_string()));
    }
    let raw_response = transport.get_raw(spec.path, &query).await?;
    let records = parse_records(source_type, spec.response_key, &raw_response)?;
    Ok(FetchedPage {
        source_type,
        request_path: spec.path.to_string(),
        page: Some(page),
        activity_cursor: None,
        raw_response,
        records,
    })
}

pub async fn fetch_custom_fields_page<T: RawWealthboxTransport>(
    transport: &T,
    document_type: &str,
    page: usize,
) -> anyhow::Result<FetchedPage> {
    let query = vec![
        ("document_type".to_string(), document_type.to_string()),
        ("page".to_string(), page.to_string()),
        ("per_page".to_string(), IMPORTER_PAGE_SIZE.to_string()),
    ];
    let raw_response = transport
        .get_raw("/categories/custom_fields", &query)
        .await?;
    let records = parse_records(SourceType::CustomField, "custom_fields", &raw_response)?;
    Ok(FetchedPage {
        source_type: SourceType::CustomField,
        request_path: "/categories/custom_fields".to_string(),
        page: Some(page),
        activity_cursor: None,
        raw_response,
        records,
    })
}

pub async fn fetch_activity_page<T: RawWealthboxTransport>(
    transport: &T,
    cursor: Option<&str>,
) -> anyhow::Result<ActivityPage> {
    let mut query = vec![("per_page".to_string(), IMPORTER_PAGE_SIZE.to_string())];
    if let Some(cursor) = cursor {
        query.push(("cursor".to_string(), cursor.to_string()));
    }
    let raw_response = transport.get_raw("/activity", &query).await?;
    let body: Value = serde_json::from_slice(&raw_response.response_bytes)
        .context("parse captured activity JSON")?;
    let next_cursor = body
        .get("meta")
        .and_then(|meta| meta.get("cursor"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let records = parse_records(SourceType::Activity, "stream_items", &raw_response)?;
    Ok(ActivityPage {
        fetched: FetchedPage {
            source_type: SourceType::Activity,
            request_path: "/activity".to_string(),
            page: None,
            activity_cursor: cursor.map(str::to_string),
            raw_response,
            records,
        },
        next_cursor,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::VecDeque;
    use tokio::sync::Mutex;

    struct FakeTransport(Mutex<VecDeque<RawHttpResponse>>);
    #[async_trait]
    impl RawWealthboxTransport for FakeTransport {
        async fn get_raw(
            &self,
            _path: &str,
            _query: &[(String, String)],
        ) -> anyhow::Result<RawHttpResponse> {
            self.0.lock().await.pop_front().context("fake response")
        }
    }

    #[tokio::test]
    async fn notes_use_status_updates_and_preserve_raw_bytes() {
        let bytes = br#"{"status_updates":[{"id":7,"body":"private"}]}"#.to_vec();
        let transport = FakeTransport(Mutex::new(VecDeque::from([RawHttpResponse {
            request_path: "/notes".into(),
            response_bytes: bytes.clone(),
        }])));
        let page = fetch_page(&transport, SourceType::Note, 1, None)
            .await
            .unwrap();
        assert_eq!(page.records[0].source_id, "7");
        assert_eq!(page.raw_response.response_bytes, bytes);
    }

    #[tokio::test]
    async fn activity_keeps_cursor_opaque() {
        let transport = FakeTransport(Mutex::new(VecDeque::from([RawHttpResponse {
            request_path: "/activity".into(),
            response_bytes: br#"{"meta":{"cursor":"opaque-next"},"stream_items":[{"id":"a"}]}"#
                .to_vec(),
        }])));
        let page = fetch_activity_page(&transport, Some("opaque-current"))
            .await
            .unwrap();
        assert_eq!(
            page.fetched.activity_cursor.as_deref(),
            Some("opaque-current")
        );
        assert_eq!(page.next_cursor.as_deref(), Some("opaque-next"));
    }
}
