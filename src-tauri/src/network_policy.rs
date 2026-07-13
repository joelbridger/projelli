//! The native, fail-closed boundary for every off-device Lantern connection.
//!
//! This module deliberately has no knowledge of individual commands.  Callers
//! declare a registry operation and destination, then receive a generation
//! handle which becomes invalid the moment the policy changes.

use chrono::{DateTime, Utc};
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::{
    fmt,
    fs::{self, File, OpenOptions},
    io::Write,
    net::IpAddr,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicU8, Ordering},
        Arc, Mutex,
    },
};
use tokio::sync::watch;

const POLICY_FILE_NAME: &str = "network-policy.json";
const POLICY_VERSION: u32 = 1;
const STATE_UNINITIALIZED: u8 = 0;
const STATE_ONLINE: u8 = 1;
const STATE_OFFLINE: u8 = 2;

/// A stable, safe-to-display summary for renderer hydration.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyStatusDto {
    pub offline_mode: bool,
    pub generation: u64,
    /// False means the file could not be safely loaded.  The policy remains
    /// closed to off-device traffic in that state.
    pub hydrated: bool,
    /// A safe local diagnostic only; it never contains request data.
    pub load_error: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EgressCategory {
    LocalAi,
    CloudAi,
    Licensing,
    Connector,
    ProductMaintenance,
    Navigation,
    ExternalClientExport,
}

/// The kinds of data an operation may transfer.  Receipt writing arrives in a
/// later lane; keeping this declaration beside policy prevents an operation
/// from being added without stating its egress shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EgressDataClasses {
    pub content: bool,
    pub metadata: bool,
    pub credential: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DestinationRule {
    /// Only literal `127.0.0.1` or `::1` URLs.  `localhost` is intentionally
    /// not accepted because it is a hostname, not a verified local address.
    LiteralLoopbackOnly,
    ExactHosts(&'static [&'static str]),
    /// The host was supplied by the person configuring this connector.  It is
    /// never a blanket exception: callers must parse the destination with the
    /// exact host stored for that connector, and `Destination` rejects a
    /// mismatch before authorization.  This is needed for IMAP/SMTP and ICS,
    /// whose legitimate server is not knowable at compile time.
    UserConfiguredHost,
}

/// A checked registry record.  Future network sinks must use one of these
/// records rather than inventing a free-form action at the call site.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EgressOperation {
    pub id: &'static str,
    pub category: EgressCategory,
    pub destination_rule: DestinationRule,
    pub data_classes: EgressDataClasses,
    pub receipt_label: &'static str,
}

pub const LOCAL_LLAMA: EgressOperation = EgressOperation {
    id: "local-llama",
    category: EgressCategory::LocalAi,
    destination_rule: DestinationRule::LiteralLoopbackOnly,
    data_classes: EgressDataClasses {
        content: true,
        metadata: false,
        credential: false,
    },
    receipt_label: "Local AI",
};

pub const OLLAMA: EgressOperation = EgressOperation {
    id: "ollama",
    category: EgressCategory::LocalAi,
    destination_rule: DestinationRule::LiteralLoopbackOnly,
    data_classes: EgressDataClasses {
        content: true,
        metadata: false,
        credential: false,
    },
    receipt_label: "Ollama",
};

pub const LICENSE_VALIDATION: EgressOperation = EgressOperation {
    id: "license-validation",
    category: EgressCategory::Licensing,
    destination_rule: DestinationRule::ExactHosts(&["api.lemonsqueezy.com"]),
    data_classes: EgressDataClasses {
        content: false,
        metadata: true,
        credential: true,
    },
    receipt_label: "license validation",
};

pub const OUTLOOK_MAIL_OAUTH: EgressOperation = EgressOperation {
    id: "outlook-mail-oauth",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&["login.microsoftonline.com"]),
    data_classes: EgressDataClasses {
        content: false,
        metadata: true,
        credential: true,
    },
    receipt_label: "Outlook mail sign-in",
};
pub const OUTLOOK_MAIL_SYNC: EgressOperation = EgressOperation {
    id: "outlook-mail-sync",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&["graph.microsoft.com"]),
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: true,
    },
    receipt_label: "Outlook mail sync",
};
pub const GMAIL_OAUTH: EgressOperation = EgressOperation {
    id: "gmail-oauth",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&[
        "accounts.google.com",
        "oauth2.googleapis.com",
    ]),
    data_classes: EgressDataClasses {
        content: false,
        metadata: true,
        credential: true,
    },
    receipt_label: "Gmail sign-in",
};
pub const GMAIL_SYNC: EgressOperation = EgressOperation {
    id: "gmail-sync",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&["gmail.googleapis.com"]),
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: true,
    },
    receipt_label: "Gmail sync",
};
pub const IMAP_SYNC: EgressOperation = EgressOperation {
    id: "imap-sync",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::UserConfiguredHost,
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: true,
    },
    receipt_label: "IMAP mail sync",
};
pub const SMTP_SEND: EgressOperation = EgressOperation {
    id: "smtp-send",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::UserConfiguredHost,
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: true,
    },
    receipt_label: "send mail",
};
pub const ONEDRIVE_OAUTH: EgressOperation = EgressOperation {
    id: "onedrive-oauth",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&["login.microsoftonline.com"]),
    data_classes: EgressDataClasses {
        content: false,
        metadata: true,
        credential: true,
    },
    receipt_label: "OneDrive sign-in",
};
pub const ONEDRIVE_SYNC: EgressOperation = EgressOperation {
    id: "onedrive-sync",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&["graph.microsoft.com"]),
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: true,
    },
    receipt_label: "OneDrive sync",
};
pub const OUTLOOK_CALENDAR_OAUTH: EgressOperation = EgressOperation {
    id: "outlook-calendar-oauth",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&["login.microsoftonline.com"]),
    data_classes: EgressDataClasses {
        content: false,
        metadata: true,
        credential: true,
    },
    receipt_label: "Outlook Calendar sign-in",
};
pub const OUTLOOK_CALENDAR_SYNC: EgressOperation = EgressOperation {
    id: "outlook-calendar-sync",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&["graph.microsoft.com"]),
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: true,
    },
    receipt_label: "Outlook Calendar sync",
};
pub const GOOGLE_CALENDAR_OAUTH: EgressOperation = EgressOperation {
    id: "google-calendar-oauth",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&[
        "accounts.google.com",
        "oauth2.googleapis.com",
    ]),
    data_classes: EgressDataClasses {
        content: false,
        metadata: true,
        credential: true,
    },
    receipt_label: "Google Calendar sign-in",
};
pub const GOOGLE_CALENDAR_SYNC: EgressOperation = EgressOperation {
    id: "google-calendar-sync",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&["www.googleapis.com"]),
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: true,
    },
    receipt_label: "Google Calendar sync",
};
pub const ICS_CALENDAR_SYNC: EgressOperation = EgressOperation {
    id: "ics-calendar-sync",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::UserConfiguredHost,
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: true,
    },
    receipt_label: "ICS calendar sync",
};

pub const WEALTHBOX_AUTH: EgressOperation = EgressOperation {
    id: "crm-auth-wealthbox",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&["api.crmworkspace.com"]),
    data_classes: EgressDataClasses {
        content: false,
        metadata: true,
        credential: true,
    },
    receipt_label: "Wealthbox connection check",
};
pub const WEALTHBOX_SYNC: EgressOperation = EgressOperation {
    id: "crm-sync-wealthbox",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&["api.crmworkspace.com"]),
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: true,
    },
    receipt_label: "Wealthbox sync",
};
pub const WEALTHBOX_WRITE: EgressOperation = EgressOperation {
    id: "crm-write-wealthbox",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&["api.crmworkspace.com"]),
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: true,
    },
    receipt_label: "Wealthbox write-back",
};
pub const CALENDLY_SYNC: EgressOperation = EgressOperation {
    id: "calendly-sync",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&["api.calendly.com"]),
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: true,
    },
    receipt_label: "Calendly sync",
};
pub const ADDEPAR_SYNC: EgressOperation = EgressOperation {
    id: "addepar-sync",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::UserConfiguredHost,
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: true,
    },
    receipt_label: "Addepar sync",
};
pub const BOX_SYNC: EgressOperation = EgressOperation {
    id: "box-sync",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&["api.box.com", "dl.boxcloud.com"]),
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: true,
    },
    receipt_label: "Box sync",
};
pub const DOCUSIGN_OAUTH: EgressOperation = EgressOperation {
    id: "docusign-oauth",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&[
        "account-d.docusign.com",
        "account.docusign.com",
    ]),
    data_classes: EgressDataClasses {
        content: false,
        metadata: true,
        credential: true,
    },
    receipt_label: "DocuSign sign-in",
};
pub const DOCUSIGN_SYNC: EgressOperation = EgressOperation {
    id: "docusign-sync",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::UserConfiguredHost,
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: true,
    },
    receipt_label: "DocuSign sync",
};
pub const JOTFORM_SYNC: EgressOperation = EgressOperation {
    id: "jotform-sync",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&["api.jotform.com"]),
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: true,
    },
    receipt_label: "Jotform sync",
};
pub const SHAREFILE_SYNC: EgressOperation = EgressOperation {
    id: "sharefile-sync",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::UserConfiguredHost,
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: true,
    },
    receipt_label: "ShareFile sync",
};
pub const ZOCKS_SYNC: EgressOperation = EgressOperation {
    id: "zocks-sync",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&["api.zocks.io"]),
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: true,
    },
    receipt_label: "Zocks sync",
};
pub const SALESFORCE_OAUTH: EgressOperation = EgressOperation {
    id: "crm-auth-salesforce",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&["login.salesforce.com"]),
    data_classes: EgressDataClasses {
        content: false,
        metadata: true,
        credential: true,
    },
    receipt_label: "Salesforce sign-in",
};
pub const SALESFORCE_SYNC: EgressOperation = EgressOperation {
    id: "crm-sync-salesforce",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::UserConfiguredHost,
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: true,
    },
    receipt_label: "Salesforce sync",
};
pub const SALESFORCE_IDENTITY: EgressOperation = EgressOperation {
    id: "crm-auth-salesforce-instance",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::UserConfiguredHost,
    data_classes: EgressDataClasses {
        content: false,
        metadata: true,
        credential: true,
    },
    receipt_label: "Salesforce account check",
};
pub const SALESFORCE_LOGIN_IDENTITY: EgressOperation = EgressOperation {
    id: "crm-auth-salesforce-identity",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&["login.salesforce.com", "test.salesforce.com"]),
    data_classes: EgressDataClasses {
        content: false,
        metadata: true,
        credential: true,
    },
    receipt_label: "Salesforce account identity",
};
pub const REDTAIL_OAUTH: EgressOperation = EgressOperation {
    id: "crm-auth-redtail",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&["api2.redtailtechnology.com"]),
    data_classes: EgressDataClasses {
        content: false,
        metadata: true,
        credential: true,
    },
    receipt_label: "Redtail sign-in",
};
pub const REDTAIL_SYNC: EgressOperation = EgressOperation {
    id: "crm-sync-redtail",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&["api2.redtailtechnology.com"]),
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: true,
    },
    receipt_label: "Redtail sync",
};
pub const CRM_MIGRATION_IMPORT: EgressOperation = EgressOperation {
    id: "crm-migration-import",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::UserConfiguredHost,
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: true,
    },
    receipt_label: "CRM sample migration",
};

// Hugging Face first resolves on huggingface.co, then redirects model bytes to
// its Xet storage CDN.  The download client follows redirects manually and
// authorizes every hop. `us.aws.cdn.hf.co` is the current file-storage host
// observed for all three production downloads (2026-07-11); keep this list
// synchronized with the downloader's redirect tests when Hugging Face changes
// its delivery network.
const HUGGING_FACE_MODEL_DOWNLOAD_HOSTS: &[&str] = &["huggingface.co", "us.aws.cdn.hf.co"];
pub const RAG_MODEL_DOWNLOAD: EgressOperation = EgressOperation {
    id: "rag-model-download",
    category: EgressCategory::ProductMaintenance,
    destination_rule: DestinationRule::ExactHosts(HUGGING_FACE_MODEL_DOWNLOAD_HOSTS),
    data_classes: EgressDataClasses {
        content: false,
        metadata: true,
        credential: false,
    },
    receipt_label: "RAG model download",
};
pub const RERANKER_MODEL_DOWNLOAD: EgressOperation = EgressOperation {
    id: "reranker-model-download",
    category: EgressCategory::ProductMaintenance,
    destination_rule: DestinationRule::ExactHosts(HUGGING_FACE_MODEL_DOWNLOAD_HOSTS),
    data_classes: EgressDataClasses {
        content: false,
        metadata: true,
        credential: false,
    },
    receipt_label: "reranker model download",
};
pub const LOCAL_LLM_MODEL_DOWNLOAD: EgressOperation = EgressOperation {
    id: "local-llm-model-download",
    category: EgressCategory::ProductMaintenance,
    destination_rule: DestinationRule::ExactHosts(HUGGING_FACE_MODEL_DOWNLOAD_HOSTS),
    data_classes: EgressDataClasses {
        content: false,
        metadata: true,
        credential: false,
    },
    receipt_label: "local LLM model download",
};
pub const VOICE_MODEL_DOWNLOAD: EgressOperation = EgressOperation {
    id: "voice-model-download",
    category: EgressCategory::ProductMaintenance,
    // Canonical product setting: src/config/brand.ts → BRAND.urls.voices.
    // Rust cannot import TypeScript at runtime, so keep this literal paired
    // with the generated brand configuration and its URL below in tts.rs.
    destination_rule: DestinationRule::ExactHosts(&["advisorprephero.com"]),
    data_classes: EgressDataClasses {
        content: false,
        metadata: true,
        credential: false,
    },
    receipt_label: "voice model download",
};
pub const MEETING_AUTO_JOIN: EgressOperation = EgressOperation {
    id: "meeting-auto-join",
    category: EgressCategory::Navigation,
    destination_rule: DestinationRule::UserConfiguredHost,
    data_classes: EgressDataClasses {
        content: false,
        metadata: true,
        credential: false,
    },
    receipt_label: "meeting auto-join",
};
pub const EXTERNAL_NAVIGATION: EgressOperation = EgressOperation {
    id: "external-navigation",
    category: EgressCategory::Navigation,
    destination_rule: DestinationRule::UserConfiguredHost,
    data_classes: EgressDataClasses {
        content: false,
        metadata: true,
        credential: false,
    },
    receipt_label: "external navigation",
};
pub const MCP_EXTERNAL_CLIENT_EXPORT: EgressOperation = EgressOperation {
    id: "mcp-external-client-export",
    category: EgressCategory::ExternalClientExport,
    // MCP approval crosses the desktop/external-client boundary over a local
    // rendezvous file, not a remote URL.  This fixed logical host lets that
    // boundary use the same policy + audit receipt mechanism without ever
    // resolving or contacting a fictional network endpoint.
    destination_rule: DestinationRule::ExactHosts(&["mcp-external-client.invalid"]),
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: false,
    },
    receipt_label: "MCP access",
};

/// Logical-only MCP destination. This name is never resolved or contacted;
/// the MCP sidecar exchanges data through a local rendezvous file. It exists
/// so both MCP binaries can use one policy operation and one durable receipt
/// path when they cross the desktop/external-client boundary.
pub const MCP_EXTERNAL_CLIENT_LOGICAL_DESTINATION: &str = "https://mcp-external-client.invalid/";

/// A small seed registry for Lane 0.  Later lanes extend this list as they
/// migrate real sinks; authorization never trusts an unregistered operation.
pub const EGRESS_OPERATION_REGISTRY: &[EgressOperation] = &[
    LOCAL_LLAMA,
    OLLAMA,
    LICENSE_VALIDATION,
    OUTLOOK_MAIL_OAUTH,
    OUTLOOK_MAIL_SYNC,
    GMAIL_OAUTH,
    GMAIL_SYNC,
    IMAP_SYNC,
    SMTP_SEND,
    ONEDRIVE_OAUTH,
    ONEDRIVE_SYNC,
    OUTLOOK_CALENDAR_OAUTH,
    OUTLOOK_CALENDAR_SYNC,
    GOOGLE_CALENDAR_OAUTH,
    GOOGLE_CALENDAR_SYNC,
    ICS_CALENDAR_SYNC,
    WEALTHBOX_AUTH,
    WEALTHBOX_SYNC,
    WEALTHBOX_WRITE,
    CALENDLY_SYNC,
    ADDEPAR_SYNC,
    BOX_SYNC,
    DOCUSIGN_OAUTH,
    DOCUSIGN_SYNC,
    JOTFORM_SYNC,
    SHAREFILE_SYNC,
    ZOCKS_SYNC,
    SALESFORCE_OAUTH,
    SALESFORCE_LOGIN_IDENTITY,
    SALESFORCE_IDENTITY,
    SALESFORCE_SYNC,
    REDTAIL_OAUTH,
    REDTAIL_SYNC,
    CRM_MIGRATION_IMPORT,
    RAG_MODEL_DOWNLOAD,
    RERANKER_MODEL_DOWNLOAD,
    LOCAL_LLM_MODEL_DOWNLOAD,
    VOICE_MODEL_DOWNLOAD,
    MEETING_AUTO_JOIN,
    EXTERNAL_NAVIGATION,
    MCP_EXTERNAL_CLIENT_EXPORT,
];

pub fn registered_operation(id: &str) -> Option<&'static EgressOperation> {
    EGRESS_OPERATION_REGISTRY
        .iter()
        .find(|operation| operation.id == id)
}

/// A parsed network destination.  Parsing happens before authorization so the
/// policy never bases a decision on a raw, ambiguous URL string.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Destination {
    url: Url,
    host: String,
    configured_host: Option<String>,
}

impl Destination {
    pub fn parse(url: Url) -> Result<Self, NetworkPolicyError> {
        let host = url
            .host_str()
            .ok_or_else(|| NetworkPolicyError::InvalidDestination("URL has no host".to_string()))?
            .to_ascii_lowercase();
        Ok(Self {
            url,
            host,
            configured_host: None,
        })
    }

    /// Parse a user-configured remote destination.  `configured_host` must be
    /// read from the already-stored connector configuration, not accepted from
    /// a command argument, so one connector cannot borrow another connector's
    /// authority.
    pub fn parse_for_configured_host(
        url: Url,
        configured_host: &str,
    ) -> Result<Self, NetworkPolicyError> {
        let mut destination = Self::parse(url)?;
        let configured_host = configured_host
            .trim()
            .trim_matches('[')
            .trim_matches(']')
            .to_ascii_lowercase();
        if configured_host.is_empty() || destination.host != configured_host {
            return Err(NetworkPolicyError::DestinationNotAllowed(destination.host));
        }
        destination.configured_host = Some(configured_host);
        Ok(destination)
    }

    pub fn url(&self) -> &Url {
        &self.url
    }

    pub fn host(&self) -> &str {
        &self.host
    }

    fn is_literal_loopback(&self) -> bool {
        // `Url::host_str()` retains brackets around an IPv6 host.  Strip only
        // that URL syntax so `::1` remains a literal address, never a name.
        self.host
            .strip_prefix('[')
            .and_then(|host| host.strip_suffix(']'))
            .unwrap_or(&self.host)
            .parse::<IpAddr>()
            .map(|address| address.is_loopback())
            .unwrap_or(false)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthorizedGeneration {
    generation: u64,
    operation: EgressOperation,
    destination: Destination,
    /// Fixed when the request is authorized so a workspace switch cannot split
    /// one request's allowed + terminal receipts across two audit histories.
    audit_workspace: Option<PathBuf>,
}

impl AuthorizedGeneration {
    pub fn value(&self) -> u64 {
        self.generation
    }
}

/// A receiver for the policy-change broadcast.  A future lane can hold this
/// beside an HTTP task, timer, or socket and stop immediately on a generation
/// change without polling the renderer.
pub struct PolicyCancellation {
    generation: u64,
    changes: watch::Receiver<u64>,
}

impl PolicyCancellation {
    pub fn is_cancelled(&self) -> bool {
        *self.changes.borrow() != self.generation
    }

    pub async fn cancelled(&mut self) {
        while !self.is_cancelled() {
            if self.changes.changed().await.is_err() {
                return;
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OfflineModeBlockedError {
    action: &'static str,
}

impl OfflineModeBlockedError {
    fn for_operation(operation: &EgressOperation) -> Self {
        Self {
            action: operation.receipt_label,
        }
    }
}

impl fmt::Display for OfflineModeBlockedError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "Network lockdown is on. {} is paused so nothing can leave this computer. Turn off Network lockdown in Privacy settings to continue.",
            self.action
        )
    }
}

impl std::error::Error for OfflineModeBlockedError {}

#[derive(Debug, thiserror::Error)]
pub enum NetworkPolicyError {
    #[error("{0}")]
    OfflineModeBlocked(#[from] OfflineModeBlockedError),
    #[error("Network policy has not loaded safely; off-device connections are blocked")]
    Uninitialized,
    #[error("Network operation `{0}` is not registered")]
    UnregisteredOperation(String),
    #[error("Destination `{0}` is not allowed for this network operation")]
    DestinationNotAllowed(String),
    #[error("Invalid network destination: {0}")]
    InvalidDestination(String),
    #[error("Could not persist Offline Mode: {0}")]
    Persistence(String),
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PolicyRecord {
    version: u32,
    offline_mode: bool,
    updated_at: String,
}

struct NetworkPolicyInner {
    state: AtomicU8,
    /// True only when fail-closed memory moved to OFFLINE but its matching
    /// disk write failed. This lets an explicit retry repair the file without
    /// making ordinary duplicate enable requests rewrite it.
    persistence_dirty: AtomicBool,
    /// Keeps two renderer commands from racing over the one Windows temp file.
    mode_change_lock: Mutex<()>,
    generation: AtomicU64,
    changes: watch::Sender<u64>,
    policy_path: PathBuf,
    load_error: Option<String>,
    /// The active workspace is supplied by the existing audit command.  Keep
    /// it here so every native egress caller shares the same encrypted,
    /// append-only receipt writer instead of inventing connector-local logs.
    audit_workspace: Mutex<Option<PathBuf>>,
    receipt_sequence: AtomicU64,
}

/// Cloneable managed Tauri state.  Clones share the same atomics and broadcast
/// registry, which lets `EgressHttpClient` safely retain a handle.
#[derive(Clone)]
pub struct NetworkPolicy {
    inner: Arc<NetworkPolicyInner>,
}

impl NetworkPolicy {
    /// The one conversion from native state to the public lockdown truth.
    /// Both the UI status command and every remote-egress guard use it.
    fn remote_egress_is_blocked(state: u8) -> bool {
        state != STATE_ONLINE
    }

    /// Loads synchronously.  Any failure leaves the policy uninitialized and
    /// therefore closed to off-device traffic.
    pub fn load_from_app_data_dir(app_data_dir: &Path) -> Self {
        let policy = Self::load_from_directory(app_data_dir);
        // The desktop process starts closed on every launch. The renderer must
        // explicitly send the current privacy choice before any CRM socket can
        // open. This closes the startup race where an old saved online value
        // could briefly disagree with the current Local-only setting.
        policy
            .inner
            .state
            .store(STATE_UNINITIALIZED, Ordering::Release);
        policy
    }

    pub(crate) fn load_from_directory(app_data_dir: &Path) -> Self {
        let policy_path = app_data_dir.join(POLICY_FILE_NAME);
        let (state, load_error) = match Self::read_or_create_record(&policy_path) {
            Ok(record) => (
                if record.offline_mode {
                    STATE_OFFLINE
                } else {
                    STATE_ONLINE
                },
                None,
            ),
            Err(error) => (STATE_UNINITIALIZED, Some(error)),
        };
        let (changes, _) = watch::channel(0);
        Self {
            inner: Arc::new(NetworkPolicyInner {
                state: AtomicU8::new(state),
                persistence_dirty: AtomicBool::new(false),
                mode_change_lock: Mutex::new(()),
                generation: AtomicU64::new(0),
                changes,
                policy_path,
                load_error,
                audit_workspace: Mutex::new(None),
                receipt_sequence: AtomicU64::new(0),
            }),
        }
    }

    fn read_or_create_record(path: &Path) -> Result<PolicyRecord, String> {
        match fs::read_to_string(path) {
            Ok(contents) => Self::parse_record(&contents),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                let record = PolicyRecord {
                    version: POLICY_VERSION,
                    offline_mode: false,
                    updated_at: Utc::now().to_rfc3339(),
                };
                Self::write_record_atomic(path, &record)?;
                Ok(record)
            }
            Err(error) => Err(format!("could not read {}: {error}", path.display())),
        }
    }

    fn parse_record(contents: &str) -> Result<PolicyRecord, String> {
        let record: PolicyRecord = serde_json::from_str(contents)
            .map_err(|error| format!("malformed policy file: {error}"))?;
        if record.version != POLICY_VERSION {
            return Err(format!("unsupported policy version {}", record.version));
        }
        DateTime::parse_from_rfc3339(&record.updated_at)
            .map_err(|error| format!("invalid policy updatedAt: {error}"))?;
        Ok(record)
    }

    fn write_record_atomic(path: &Path, record: &PolicyRecord) -> Result<(), String> {
        let parent = path
            .parent()
            .ok_or_else(|| "policy file has no parent directory".to_string())?;
        fs::create_dir_all(parent)
            .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
        let serialized = serde_json::to_vec(record)
            .map_err(|error| format!("could not serialize policy: {error}"))?;
        let temporary = parent.join(format!(".{POLICY_FILE_NAME}.{}.tmp", std::process::id()));

        let write_result = (|| -> Result<(), String> {
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options
                .open(&temporary)
                .map_err(|error| format!("could not create policy temp file: {error}"))?;
            file.write_all(&serialized)
                .map_err(|error| format!("could not write policy temp file: {error}"))?;
            file.write_all(b"\n")
                .map_err(|error| format!("could not finish policy temp file: {error}"))?;
            file.sync_all()
                .map_err(|error| format!("could not sync policy temp file: {error}"))?;
            // Windows cannot promote the temporary file with ReplaceFileW
            // while this process still has that same file open. Closing it
            // before the atomic swap prevents ERROR_SHARING_VIOLATION (32).
            drop(file);
            atomic_replace(&temporary, path)
                .map_err(|error| format!("could not replace policy file: {error}"))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(path, fs::Permissions::from_mode(0o600))
                    .map_err(|error| format!("could not protect policy file: {error}"))?;
                File::open(parent)
                    .and_then(|directory| directory.sync_all())
                    .map_err(|error| format!("could not sync policy directory: {error}"))?;
            }
            Ok(())
        })();
        if write_result.is_err() {
            let _ = fs::remove_file(&temporary);
        }
        write_result
    }

    pub fn status(&self) -> PolicyStatusDto {
        let state = self.inner.state.load(Ordering::Acquire);
        PolicyStatusDto {
            offline_mode: Self::remote_egress_is_blocked(state),
            generation: self.inner.generation.load(Ordering::Acquire),
            hydrated: state != STATE_UNINITIALIZED,
            load_error: self.inner.load_error.clone(),
        }
    }

    /// Points native egress receipts at the same encrypted audit database the
    /// renderer uses.  It is intentionally set only as part of
    /// `audit_set_workspace`, so a native receipt can never silently land in
    /// another workspace.
    pub fn set_audit_workspace(&self, workspace: PathBuf) {
        *self
            .inner
            .audit_workspace
            .lock()
            .expect("network receipt workspace lock poisoned") = Some(workspace);
    }

    fn destination_class(operation: &EgressOperation) -> &'static str {
        match operation.destination_rule {
            DestinationRule::LiteralLoopbackOnly => "literal-loopback",
            DestinationRule::ExactHosts(_) => "exact-host",
            DestinationRule::UserConfiguredHost => "user-configured-host",
        }
    }

    fn direction(operation: &EgressOperation) -> &'static str {
        match operation.category {
            EgressCategory::LocalAi | EgressCategory::CloudAi => "send",
            EgressCategory::Licensing => "authentication",
            EgressCategory::ProductMaintenance => "download",
            EgressCategory::Navigation => "navigation",
            EgressCategory::ExternalClientExport => "external-client-export",
            EgressCategory::Connector => "sync",
        }
    }

    fn failure_code(error: Option<&NetworkPolicyError>) -> Option<&'static str> {
        match error {
            Some(NetworkPolicyError::OfflineModeBlocked(_)) => Some("OFFLINE_MODE_BLOCKED"),
            Some(NetworkPolicyError::DestinationNotAllowed(_)) => Some("DESTINATION_NOT_ALLOWED"),
            Some(NetworkPolicyError::UnregisteredOperation(_)) => Some("UNREGISTERED_OPERATION"),
            Some(NetworkPolicyError::Uninitialized) => Some("POLICY_CHANGED_OR_UNAVAILABLE"),
            Some(NetworkPolicyError::InvalidDestination(_)) => Some("INVALID_DESTINATION"),
            Some(NetworkPolicyError::Persistence(_)) | None => None,
        }
    }

    /// Best-effort receipt writer for native egress.  The receipt is strictly
    /// metadata-only: no URL path, query, headers, request body, or response
    /// body is serialized.  Audit trouble must never reopen a blocked request
    /// or make a permitted connector fail after its policy decision.
    fn record_native_egress_receipt(
        &self,
        operation: &EgressOperation,
        destination: &Destination,
        generation: u64,
        offline_mode: bool,
        result: &'static str,
        error: Option<&NetworkPolicyError>,
        audit_workspace: Option<&Path>,
    ) {
        use crate::commands::audit::store::{AuditEntryRecord, EncryptedAuditStore};

        let Some(workspace) = audit_workspace else {
            // Before a workspace opens there is no audit database to write to.
            // The policy still fails closed; the first workspace-bound action
            // gets a durable receipt as usual.
            return;
        };

        let timestamp = Utc::now().to_rfc3339();
        let sequence = self.inner.receipt_sequence.fetch_add(1, Ordering::Relaxed);
        let id = format!(
            "audit_native_network_egress_{}_{}",
            Utc::now().timestamp_nanos_opt().unwrap_or_default(),
            sequence
        );
        let failure_code = Self::failure_code(error);
        let description = Self::receipt_description(operation, destination, result);
        let payload_json = serde_json::json!({
            "id": id,
            "timestamp": timestamp,
            "action": "network_egress",
            "description": description,
            "model": serde_json::Value::Null,
            "inputs": {},
            "outputs": {},
            "userDecision": "auto",
            "metadata": {
                "version": 1,
                "policyGeneration": generation,
                "operationId": operation.id,
                "operationLabel": operation.receipt_label,
                "destinationClass": Self::destination_class(operation),
                "destination": destination.host(),
                "direction": Self::direction(operation),
                "dataClasses": {
                    "content": operation.data_classes.content,
                    "metadata": operation.data_classes.metadata,
                    "credential": operation.data_classes.credential,
                    "binaryDownload": matches!(operation.category, EgressCategory::ProductMaintenance),
                },
                // Native connector traffic is independent of the selected AI
                // provider.  Do not claim a renderer-only setting we cannot
                // safely read here.
                "aiMode": "not-applicable",
                "offlineMode": offline_mode,
                "result": result,
                "failureCode": failure_code,
                "scope": { "kind": "allMatters" },
                "source": "native-network-policy",
            },
        })
        .to_string();
        let record = AuditEntryRecord {
            id,
            timestamp,
            action: "network_egress".to_string(),
            description,
            payload_json,
        };
        if let Err(error) =
            EncryptedAuditStore::open(workspace).and_then(|store| store.append(&record).map(|_| ()))
        {
            log::warn!("native network egress receipt was not saved: {error:#}");
        }
    }

    fn receipt_description(
        operation: &EgressOperation,
        destination: &Destination,
        result: &'static str,
    ) -> String {
        match result {
            "blocked-before-network" => format!(
                "Network action blocked before connection: {}",
                operation.receipt_label
            ),
            "allowed" => format!(
                "Network action allowed before connection: {} for {}",
                operation.receipt_label,
                destination.host()
            ),
            "completed" => format!(
                "Network action completed: {} contacted {}",
                operation.receipt_label,
                destination.host()
            ),
            "cancelled" => format!(
                "Network action cancelled before it could finish: {} for {}",
                operation.receipt_label,
                destination.host()
            ),
            _ => format!(
                "Network action {result}: {} for {}",
                operation.receipt_label,
                destination.host()
            ),
        }
    }

    /// Records the terminal outcome for a request that previously received an
    /// `allowed` receipt.  Connector helpers call this around their transport
    /// future, so all native clients share exactly one terminal receipt per
    /// attempt without passing raw URLs through every command.
    pub fn record_egress_result(
        &self,
        authorized: &AuthorizedGeneration,
        result: &'static str,
        failure_code: Option<&'static str>,
    ) {
        // The existing safe-error mapping only needs policy errors.  For a
        // transport failure, construct the payload directly with the stable
        // code supplied by the guarded caller.
        if failure_code.is_none() {
            self.record_native_egress_receipt(
                &authorized.operation,
                &authorized.destination,
                authorized.generation,
                Self::remote_egress_is_blocked(self.inner.state.load(Ordering::Acquire)),
                result,
                None,
                authorized.audit_workspace.as_deref(),
            );
            return;
        }

        use crate::commands::audit::store::{AuditEntryRecord, EncryptedAuditStore};
        let Some(workspace) = authorized.audit_workspace.as_deref() else {
            return;
        };
        let timestamp = Utc::now().to_rfc3339();
        let sequence = self.inner.receipt_sequence.fetch_add(1, Ordering::Relaxed);
        let id = format!(
            "audit_native_network_egress_{}_{}",
            Utc::now().timestamp_nanos_opt().unwrap_or_default(),
            sequence
        );
        let description =
            Self::receipt_description(&authorized.operation, &authorized.destination, result);
        let payload_json = serde_json::json!({
            "id": id,
            "timestamp": timestamp,
            "action": "network_egress",
            "description": description,
            "model": serde_json::Value::Null,
            "inputs": {}, "outputs": {}, "userDecision": "auto",
            "metadata": {
                "version": 1,
                "policyGeneration": authorized.generation,
                "operationId": authorized.operation.id,
                "operationLabel": authorized.operation.receipt_label,
                "destinationClass": Self::destination_class(&authorized.operation),
                "destination": authorized.destination.host(),
                "direction": Self::direction(&authorized.operation),
                "dataClasses": {
                    "content": authorized.operation.data_classes.content,
                    "metadata": authorized.operation.data_classes.metadata,
                    "credential": authorized.operation.data_classes.credential,
                    "binaryDownload": matches!(authorized.operation.category, EgressCategory::ProductMaintenance),
                },
                "aiMode": "not-applicable",
                "offlineMode": Self::remote_egress_is_blocked(self.inner.state.load(Ordering::Acquire)),
                "result": result,
                "failureCode": failure_code,
                "scope": { "kind": "allMatters" },
                "source": "native-network-policy",
            },
        }).to_string();
        let record = AuditEntryRecord {
            id,
            timestamp,
            action: "network_egress".to_string(),
            description,
            payload_json,
        };
        if let Err(error) =
            EncryptedAuditStore::open(workspace).and_then(|store| store.append(&record).map(|_| ()))
        {
            log::warn!("native network egress receipt was not saved: {error:#}");
        }
    }

    pub fn register_cancellation(&self) -> PolicyCancellation {
        self.register_cancellation_for(self.inner.generation.load(Ordering::Acquire))
    }

    /// Register cancellation against a capability generation that was already
    /// authorized.  This is deliberately not equivalent to registering "now":
    /// a policy flip between authorization and registration must be visible
    /// immediately rather than becoming the receiver's new baseline.
    pub fn register_cancellation_for(&self, generation: u64) -> PolicyCancellation {
        PolicyCancellation {
            generation,
            changes: self.inner.changes.subscribe(),
        }
    }

    pub fn authorize(
        &self,
        operation: &EgressOperation,
        destination: &Destination,
    ) -> Result<AuthorizedGeneration, NetworkPolicyError> {
        let state = self.inner.state.load(Ordering::Acquire);
        let remote_egress_blocked = Self::remote_egress_is_blocked(state);
        let generation = self.inner.generation.load(Ordering::Acquire);
        let audit_workspace = self
            .inner
            .audit_workspace
            .lock()
            .ok()
            .and_then(|workspace| workspace.clone());
        if state == STATE_UNINITIALIZED {
            let error = NetworkPolicyError::Uninitialized;
            self.record_native_egress_receipt(
                operation,
                destination,
                generation,
                true,
                "blocked-before-network",
                Some(&error),
                audit_workspace.as_deref(),
            );
            return Err(error);
        }
        let registered = match registered_operation(operation.id) {
            Some(registered) => registered,
            None => {
                let error = NetworkPolicyError::UnregisteredOperation(operation.id.to_string());
                self.record_native_egress_receipt(
                    operation,
                    destination,
                    generation,
                    remote_egress_blocked,
                    "blocked-before-network",
                    Some(&error),
                    audit_workspace.as_deref(),
                );
                return Err(error);
            }
        };
        if remote_egress_blocked {
            // Literal loopback is an Offline Mode exception only for the two
            // local-AI operations that explicitly declare that destination
            // rule. A meeting URL or external navigation may never turn an IP
            // spelling into an Offline Mode bypass.
            if registered.destination_rule == DestinationRule::LiteralLoopbackOnly
                && destination.is_literal_loopback()
            {
                self.record_native_egress_receipt(
                    registered,
                    destination,
                    generation,
                    true,
                    "allowed",
                    None,
                    audit_workspace.as_deref(),
                );
                return Ok(AuthorizedGeneration {
                    generation,
                    operation: *registered,
                    destination: destination.clone(),
                    audit_workspace,
                });
            }
            let error =
                NetworkPolicyError::from(OfflineModeBlockedError::for_operation(registered));
            self.record_native_egress_receipt(
                registered,
                destination,
                generation,
                true,
                "blocked-before-network",
                Some(&error),
                audit_workspace.as_deref(),
            );
            return Err(error);
        }
        if !Self::destination_allowed(registered, destination) {
            let error = NetworkPolicyError::DestinationNotAllowed(destination.host().to_string());
            self.record_native_egress_receipt(
                registered,
                destination,
                generation,
                false,
                "blocked-before-network",
                Some(&error),
                audit_workspace.as_deref(),
            );
            return Err(error);
        }
        self.record_native_egress_receipt(
            registered,
            destination,
            generation,
            false,
            "allowed",
            None,
            audit_workspace.as_deref(),
        );
        Ok(AuthorizedGeneration {
            generation,
            operation: *registered,
            destination: destination.clone(),
            audit_workspace,
        })
    }

    /// Authorize the MCP external-client boundary. MCP has no remote URL to
    /// parse because its sidecar speaks over stdio and local files, so it uses
    /// a fixed non-resolvable logical destination solely for policy receipts.
    pub fn authorize_mcp_external_client_access(
        &self,
    ) -> Result<AuthorizedGeneration, NetworkPolicyError> {
        let destination = Destination::parse(
            Url::parse(MCP_EXTERNAL_CLIENT_LOGICAL_DESTINATION)
                .expect("the fixed MCP logical destination must be a valid URL"),
        )
        .expect("the fixed MCP logical destination must have a host");
        self.authorize(&MCP_EXTERNAL_CLIENT_EXPORT, &destination)
    }

    fn destination_allowed(operation: &EgressOperation, destination: &Destination) -> bool {
        match operation.destination_rule {
            DestinationRule::LiteralLoopbackOnly => destination.is_literal_loopback(),
            DestinationRule::ExactHosts(hosts) => hosts
                .iter()
                .any(|allowed_host| destination.host() == *allowed_host),
            DestinationRule::UserConfiguredHost => destination.configured_host.is_some(),
        }
    }

    /// Rechecks a previously granted capability before the next network step.
    pub fn assert_authorized_generation(
        &self,
        authorized: &AuthorizedGeneration,
    ) -> Result<(), NetworkPolicyError> {
        let state = self.inner.state.load(Ordering::Acquire);
        let remote_egress_blocked = Self::remote_egress_is_blocked(state);
        if state == STATE_UNINITIALIZED {
            return Err(NetworkPolicyError::Uninitialized);
        }
        if remote_egress_blocked
            && !(authorized.operation.destination_rule == DestinationRule::LiteralLoopbackOnly
                && authorized.destination.is_literal_loopback())
        {
            return Err(OfflineModeBlockedError::for_operation(&authorized.operation).into());
        }
        if authorized.generation != self.inner.generation.load(Ordering::Acquire) {
            if remote_egress_blocked {
                return Err(OfflineModeBlockedError::for_operation(&authorized.operation).into());
            }
            return Err(NetworkPolicyError::Uninitialized);
        }
        Ok(())
    }

    /// Persists a mode change.  Enabling is fail-closed: memory flips and all
    /// registered work is notified before this function returns, even if the
    /// subsequent disk write reports an error.  Disabling writes first so a
    /// persistence failure cannot accidentally reopen off-device traffic.
    pub fn set_offline_mode(&self, enabled: bool) -> Result<(), NetworkPolicyError> {
        let _change_guard = self
            .inner
            .mode_change_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let current = self.inner.state.load(Ordering::Acquire);
        let desired = if enabled { STATE_OFFLINE } else { STATE_ONLINE };
        if current == desired {
            if enabled && self.inner.persistence_dirty.load(Ordering::Acquire) {
                // A previous fail-closed enable may already have moved memory
                // to OFFLINE while its disk write failed. Repeating that same
                // request repairs the file. A normal duplicate enable and an
                // ONLINE no-op remain harmless no-ops.
                self.persist(true)?;
                self.inner.persistence_dirty.store(false, Ordering::Release);
            }
            return Ok(());
        }
        if !enabled {
            self.persist(false)?;
            self.inner.persistence_dirty.store(false, Ordering::Release);
        }
        self.inner.state.store(desired, Ordering::Release);
        let generation = self.inner.generation.fetch_add(1, Ordering::AcqRel) + 1;
        self.inner.changes.send_replace(generation);
        if enabled {
            self.inner.persistence_dirty.store(true, Ordering::Release);
            self.persist(true)?;
            self.inner.persistence_dirty.store(false, Ordering::Release);
        }
        Ok(())
    }

    fn persist(&self, offline_mode: bool) -> Result<(), NetworkPolicyError> {
        Self::write_record_atomic(
            &self.inner.policy_path,
            &PolicyRecord {
                version: POLICY_VERSION,
                offline_mode,
                updated_at: Utc::now().to_rfc3339(),
            },
        )
        .map_err(NetworkPolicyError::Persistence)
    }
}

/// `rename` replaces atomically on Unix.  Windows needs `ReplaceFileW` when
/// the destination already exists; removing it first would create exactly the
/// torn-write window this policy record must avoid.
#[cfg(not(windows))]
fn atomic_replace(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(temporary, destination)
}

#[cfg(windows)]
fn atomic_replace(temporary: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{ReplaceFileW, REPLACEFILE_WRITE_THROUGH};

    if !destination.exists() {
        return fs::rename(temporary, destination);
    }
    let destination_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let temporary_wide: Vec<u16> = temporary
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let replaced = unsafe {
        ReplaceFileW(
            destination_wide.as_ptr(),
            temporary_wide.as_ptr(),
            std::ptr::null(),
            REPLACEFILE_WRITE_THROUGH,
            std::ptr::null(),
            std::ptr::null(),
        )
    };
    if replaced == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    const TEST_REMOTE: EgressOperation = EgressOperation {
        id: "license-validation",
        category: EgressCategory::Licensing,
        destination_rule: DestinationRule::ExactHosts(&["wrong.example"]),
        data_classes: EgressDataClasses {
            content: false,
            metadata: true,
            credential: true,
        },
        receipt_label: "license validation",
    };
    const UNKNOWN_OPERATION: EgressOperation = EgressOperation {
        id: "not-registered",
        category: EgressCategory::Connector,
        destination_rule: DestinationRule::ExactHosts(&["example.test"]),
        data_classes: EgressDataClasses {
            content: false,
            metadata: false,
            credential: false,
        },
        receipt_label: "do something online",
    };

    fn destination(value: &str) -> Destination {
        Destination::parse(Url::parse(value).unwrap()).unwrap()
    }

    #[test]
    fn missing_file_is_created_and_loads_online() {
        let directory = tempfile::tempdir().unwrap();
        let policy = NetworkPolicy::load_from_directory(directory.path());
        assert!(policy.status().hydrated);
        assert!(!policy.status().offline_mode);
        let contents = fs::read_to_string(directory.path().join(POLICY_FILE_NAME)).unwrap();
        assert!(contents.contains("\"offlineMode\":false"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(directory.path().join(POLICY_FILE_NAME))
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600);
        }
    }

    #[test]
    fn corrupt_file_stays_closed() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join(POLICY_FILE_NAME), "not json").unwrap();
        let policy = NetworkPolicy::load_from_directory(directory.path());
        assert!(!policy.status().hydrated);
        assert!(matches!(
            policy.authorize(
                &TEST_REMOTE,
                &destination("https://api.lemonsqueezy.com/v1")
            ),
            Err(NetworkPolicyError::Uninitialized)
        ));
    }

    #[test]
    fn valid_off_state_permits_registered_host_even_when_caller_metadata_differs() {
        let directory = tempfile::tempdir().unwrap();
        let policy = NetworkPolicy::load_from_directory(directory.path());
        assert!(policy
            .authorize(
                &TEST_REMOTE,
                &destination("https://api.lemonsqueezy.com/v1/licenses")
            )
            .is_ok());
    }

    #[test]
    fn offline_allows_only_literal_loopback() {
        let directory = tempfile::tempdir().unwrap();
        let policy = NetworkPolicy::load_from_directory(directory.path());
        policy.set_offline_mode(true).unwrap();
        assert!(policy
            .authorize(&LOCAL_LLAMA, &destination("http://127.0.0.1:18089"))
            .is_ok());
        assert!(policy
            .authorize(&OLLAMA, &destination("http://[::1]:11434"))
            .is_ok());
        for denied in [
            "http://localhost:11434",
            "http://192.168.1.10:11434",
            "https://api.lemonsqueezy.com/v1",
        ] {
            let error = policy
                .authorize(&LOCAL_LLAMA, &destination(denied))
                .unwrap_err();
            assert!(matches!(error, NetworkPolicyError::OfflineModeBlocked(_)));
        }
    }

    /// Registry additions are not just an allowlist change: native receipts
    /// expose these fields to people, so every operation must carry a safe,
    /// human-readable receipt shape.
    #[test]
    fn every_registered_operation_has_receipt_metadata() {
        for operation in EGRESS_OPERATION_REGISTRY {
            assert!(!operation.id.is_empty(), "operation id must be non-empty");
            assert!(
                !operation.receipt_label.is_empty(),
                "{} needs a receipt label",
                operation.id
            );
        }
    }

    /// Boundary coverage for the whole native registry. A future operation is
    /// not allowed to quietly opt out of the Offline Mode stop-sign: only the
    /// two literal-loopback local-AI operations can pass while Offline Mode is
    /// on. The inventory gate names this test for every Rust registry row.
    #[test]
    fn offline_mode_blocks_every_registered_non_loopback_operation() {
        let directory = tempfile::tempdir().unwrap();
        let policy = NetworkPolicy::load_from_directory(directory.path());
        policy.set_offline_mode(true).unwrap();

        for operation in EGRESS_OPERATION_REGISTRY {
            let destination = match operation.destination_rule {
                DestinationRule::LiteralLoopbackOnly => destination("http://127.0.0.1:18089"),
                _ => destination("https://egress-boundary.example.test"),
            };
            let result = policy.authorize(operation, &destination);
            if matches!(
                operation.destination_rule,
                DestinationRule::LiteralLoopbackOnly
            ) {
                assert!(
                    result.is_ok(),
                    "{} should remain available locally",
                    operation.id
                );
            } else {
                assert!(
                    matches!(result, Err(NetworkPolicyError::OfflineModeBlocked(_))),
                    "{} must be blocked before transport while Offline Mode is on",
                    operation.id
                );
            }
        }
    }

    #[test]
    fn offline_blocks_loopback_meeting_auto_join_but_keeps_local_ai_available() {
        let directory = tempfile::tempdir().unwrap();
        let policy = NetworkPolicy::load_from_directory(directory.path());
        policy.set_offline_mode(true).unwrap();

        let meeting = Destination::parse_for_configured_host(
            Url::parse("https://127.0.0.1/meeting").unwrap(),
            "127.0.0.1",
        )
        .unwrap();
        assert!(matches!(
            policy.authorize(&MEETING_AUTO_JOIN, &meeting),
            Err(NetworkPolicyError::OfflineModeBlocked(_))
        ));
        assert!(policy
            .authorize(&LOCAL_LLAMA, &destination("http://127.0.0.1:18089"))
            .is_ok());
        assert!(policy
            .authorize(&OLLAMA, &destination("http://[::1]:11434"))
            .is_ok());
    }

    #[test]
    fn model_download_allows_only_the_traced_hugging_face_storage_cdn() {
        let directory = tempfile::tempdir().unwrap();
        let policy = NetworkPolicy::load_from_directory(directory.path());
        assert!(policy
            .authorize(
                &RAG_MODEL_DOWNLOAD,
                &destination("https://us.aws.cdn.hf.co/xet-bridge-us/model")
            )
            .is_ok());
        assert!(matches!(
            policy.authorize(
                &RAG_MODEL_DOWNLOAD,
                &destination("https://unapproved-cdn.example/model")
            ),
            Err(NetworkPolicyError::DestinationNotAllowed(_))
        ));
    }

    #[test]
    fn unregistered_operation_and_host_are_denied() {
        let directory = tempfile::tempdir().unwrap();
        let policy = NetworkPolicy::load_from_directory(directory.path());
        assert!(matches!(
            policy.authorize(&UNKNOWN_OPERATION, &destination("https://example.test")),
            Err(NetworkPolicyError::UnregisteredOperation(_))
        ));
        assert!(matches!(
            policy.authorize(&TEST_REMOTE, &destination("https://wrong.example")),
            Err(NetworkPolicyError::DestinationNotAllowed(_))
        ));
    }

    #[test]
    fn mode_flip_invalidates_generation_and_notifies_registered_work() {
        let directory = tempfile::tempdir().unwrap();
        let policy = NetworkPolicy::load_from_directory(directory.path());
        let authorized = policy
            .authorize(
                &TEST_REMOTE,
                &destination("https://api.lemonsqueezy.com/v1"),
            )
            .unwrap();
        let cancellation = policy.register_cancellation();
        policy.set_offline_mode(true).unwrap();
        assert!(cancellation.is_cancelled());
        assert!(policy.assert_authorized_generation(&authorized).is_err());
        assert_eq!(policy.status().generation, 1);
        policy.set_offline_mode(true).unwrap();
        assert_eq!(policy.status().generation, 1, "same value is a no-op");
    }

    #[test]
    fn bug_21_release_lockdown_round_trip_persists_and_restores_remote_egress() {
        let directory = tempfile::tempdir().unwrap();
        let policy_path = directory.path().join(POLICY_FILE_NAME);
        let policy = NetworkPolicy::load_from_directory(directory.path());
        let remote = destination("https://api.lemonsqueezy.com/v1");

        policy.set_offline_mode(true).unwrap();
        assert!(matches!(
            policy.authorize(&TEST_REMOTE, &remote),
            Err(NetworkPolicyError::OfflineModeBlocked(_))
        ));
        let engaged = fs::read_to_string(&policy_path).unwrap();
        assert!(NetworkPolicy::parse_record(&engaged).unwrap().offline_mode);

        policy.set_offline_mode(false).unwrap();
        assert!(policy.authorize(&TEST_REMOTE, &remote).is_ok());
        let released = fs::read_to_string(&policy_path).unwrap();
        assert!(!NetworkPolicy::parse_record(&released).unwrap().offline_mode);
    }

    #[test]
    fn repeated_enable_retries_a_failed_fail_closed_persistence() {
        let directory = tempfile::tempdir().unwrap();
        let policy_path = directory.path().join(POLICY_FILE_NAME);
        let policy = NetworkPolicy::load_from_directory(directory.path());

        fs::remove_file(&policy_path).unwrap();
        fs::create_dir(&policy_path).unwrap();
        assert!(policy.set_offline_mode(true).is_err());
        assert!(matches!(
            policy.authorize(
                &TEST_REMOTE,
                &destination("https://api.lemonsqueezy.com/v1"),
            ),
            Err(NetworkPolicyError::OfflineModeBlocked(_))
        ));

        fs::remove_dir(&policy_path).unwrap();
        policy.set_offline_mode(true).unwrap();
        let retried = fs::read_to_string(&policy_path).unwrap();
        assert!(NetworkPolicy::parse_record(&retried).unwrap().offline_mode);
    }

    #[test]
    fn repeated_enable_after_success_is_a_harmless_no_op() {
        let directory = tempfile::tempdir().unwrap();
        let policy_path = directory.path().join(POLICY_FILE_NAME);
        let policy = NetworkPolicy::load_from_directory(directory.path());

        policy.set_offline_mode(true).unwrap();
        fs::remove_file(&policy_path).unwrap();
        fs::create_dir(&policy_path).unwrap();

        policy.set_offline_mode(true).unwrap();
        assert!(matches!(
            policy.authorize(
                &TEST_REMOTE,
                &destination("https://api.lemonsqueezy.com/v1"),
            ),
            Err(NetworkPolicyError::OfflineModeBlocked(_))
        ));
    }

    #[test]
    fn repeated_online_request_does_not_report_a_false_lockdown_failure() {
        let directory = tempfile::tempdir().unwrap();
        let policy_path = directory.path().join(POLICY_FILE_NAME);
        let policy = NetworkPolicy::load_from_directory(directory.path());

        fs::remove_file(&policy_path).unwrap();
        fs::create_dir(&policy_path).unwrap();
        policy.set_offline_mode(false).unwrap();
        assert!(policy
            .authorize(
                &TEST_REMOTE,
                &destination("https://api.lemonsqueezy.com/v1"),
            )
            .is_ok());
    }

    #[test]
    fn failed_release_stays_closed_and_retry_reopens_remote_egress() {
        let directory = tempfile::tempdir().unwrap();
        let policy_path = directory.path().join(POLICY_FILE_NAME);
        let policy = NetworkPolicy::load_from_directory(directory.path());
        let remote = destination("https://api.lemonsqueezy.com/v1");

        policy.set_offline_mode(true).unwrap();
        fs::remove_file(&policy_path).unwrap();
        fs::create_dir(&policy_path).unwrap();
        assert!(policy.set_offline_mode(false).is_err());
        assert!(matches!(
            policy.authorize(&TEST_REMOTE, &remote),
            Err(NetworkPolicyError::OfflineModeBlocked(_))
        ));

        fs::remove_dir(&policy_path).unwrap();
        policy.set_offline_mode(false).unwrap();
        assert!(policy.authorize(&TEST_REMOTE, &remote).is_ok());
        let retried = fs::read_to_string(&policy_path).unwrap();
        assert!(!NetworkPolicy::parse_record(&retried).unwrap().offline_mode);
    }

    #[test]
    fn finding_20_display_status_always_matches_enforced_remote_egress() {
        let directory = tempfile::tempdir().unwrap();
        let policy_path = directory.path().join(POLICY_FILE_NAME);
        let remote = destination("https://api.lemonsqueezy.com/v1");
        let policy = NetworkPolicy::load_from_directory(directory.path());

        let assert_display_matches_enforcement = |policy: &NetworkPolicy| {
            let displayed = policy.status().offline_mode;
            let enforced = policy.authorize(&TEST_REMOTE, &remote).is_err();
            assert_eq!(
                displayed, enforced,
                "the public UI status must come from the same state as remote-egress enforcement"
            );
        };

        // Initial load and both successful toggle directions.
        assert_display_matches_enforcement(&policy);
        policy.set_offline_mode(true).unwrap();
        assert_display_matches_enforcement(&policy);

        // A failed release remains closed, and the display reports that exact
        // enforced truth rather than the rejected requested value.
        fs::remove_file(&policy_path).unwrap();
        fs::create_dir(&policy_path).unwrap();
        assert!(policy.set_offline_mode(false).is_err());
        assert_display_matches_enforcement(&policy);

        // BUG-21: retry releases immediately without restarting.
        fs::remove_dir(&policy_path).unwrap();
        policy.set_offline_mode(false).unwrap();
        assert_display_matches_enforcement(&policy);

        // Restart reads the persisted value into the same enforcement state.
        drop(policy);
        let restarted = NetworkPolicy::load_from_directory(directory.path());
        assert_display_matches_enforcement(&restarted);
    }

    #[test]
    fn offline_state_blocks_even_before_the_generation_notification_arrives() {
        let directory = tempfile::tempdir().unwrap();
        let policy = NetworkPolicy::load_from_directory(directory.path());
        let authorized = policy
            .authorize(
                &TEST_REMOTE,
                &destination("https://api.lemonsqueezy.com/v1"),
            )
            .unwrap();

        // Model the few instructions inside set_offline_mode between closing
        // the state gate and publishing the generation change. A request must
        // not use that tiny interval as an escape hatch.
        policy.inner.state.store(STATE_OFFLINE, Ordering::Release);
        assert!(matches!(
            policy.assert_authorized_generation(&authorized),
            Err(NetworkPolicyError::OfflineModeBlocked(_))
        ));
    }

    #[test]
    fn receipt_wording_never_claims_a_cancelled_request_contacted_the_host() {
        let operation = TEST_REMOTE;
        let destination = destination("https://api.lemonsqueezy.com/v1");
        let cancelled = NetworkPolicy::receipt_description(&operation, &destination, "cancelled");
        assert!(cancelled.contains("cancelled"));
        assert!(!cancelled.contains("contacted"));

        let allowed = NetworkPolicy::receipt_description(&operation, &destination, "allowed");
        assert!(!allowed.contains("contacted"));
        let completed = NetworkPolicy::receipt_description(&operation, &destination, "completed");
        assert!(completed.contains("contacted"));
    }

    #[test]
    fn offline_error_has_the_stable_user_message() {
        let directory = tempfile::tempdir().unwrap();
        let policy = NetworkPolicy::load_from_directory(directory.path());
        policy.set_offline_mode(true).unwrap();
        let error = policy
            .authorize(
                &TEST_REMOTE,
                &destination("https://api.lemonsqueezy.com/v1"),
            )
            .unwrap_err();
        assert_eq!(
            error.to_string(),
            "Network lockdown is on. license validation is paused so nothing can leave this computer. Turn off Network lockdown in Privacy settings to continue."
        );
    }

    #[test]
    fn user_configured_host_rule_requires_the_stored_connector_host() {
        let directory = tempfile::tempdir().unwrap();
        let policy = NetworkPolicy::load_from_directory(directory.path());
        let configured = Destination::parse_for_configured_host(
            Url::parse("imaps://mail.example.test:993").unwrap(),
            "mail.example.test",
        )
        .unwrap();
        assert!(policy.authorize(&IMAP_SYNC, &configured).is_ok());
        assert!(Destination::parse_for_configured_host(
            Url::parse("imaps://other.example.test:993").unwrap(),
            "mail.example.test",
        )
        .is_err());
    }
}
