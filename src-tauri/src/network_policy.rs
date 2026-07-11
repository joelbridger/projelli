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
        atomic::{AtomicU64, AtomicU8, Ordering},
        Arc,
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

pub const WEALTHBOX_SYNC: EgressOperation = EgressOperation {
    id: "wealthbox-sync",
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
    id: "wealthbox-write",
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
    id: "salesforce-oauth",
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
    id: "salesforce-sync",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::UserConfiguredHost,
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: true,
    },
    receipt_label: "Salesforce sync",
};
pub const REDTAIL_OAUTH: EgressOperation = EgressOperation {
    id: "redtail-oauth",
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
    id: "redtail-sync",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&["api2.redtailtechnology.com"]),
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: true,
    },
    receipt_label: "Redtail sync",
};

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
    SALESFORCE_SYNC,
    REDTAIL_OAUTH,
    REDTAIL_SYNC,
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
pub struct AuthorizedGeneration(u64);

impl AuthorizedGeneration {
    pub fn value(&self) -> u64 {
        self.0
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
            "Offline Mode is on. Lantern cannot connect to the internet. Turn it off to use {}.",
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
    generation: AtomicU64,
    changes: watch::Sender<u64>,
    policy_path: PathBuf,
    load_error: Option<String>,
}

/// Cloneable managed Tauri state.  Clones share the same atomics and broadcast
/// registry, which lets `EgressHttpClient` safely retain a handle.
#[derive(Clone)]
pub struct NetworkPolicy {
    inner: Arc<NetworkPolicyInner>,
}

impl NetworkPolicy {
    /// Loads synchronously.  Any failure leaves the policy uninitialized and
    /// therefore closed to off-device traffic.
    pub fn load_from_app_data_dir(app_data_dir: &Path) -> Self {
        Self::load_from_directory(app_data_dir)
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
                generation: AtomicU64::new(0),
                changes,
                policy_path,
                load_error,
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
            offline_mode: state != STATE_ONLINE,
            generation: self.inner.generation.load(Ordering::Acquire),
            hydrated: state != STATE_UNINITIALIZED,
            load_error: self.inner.load_error.clone(),
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
        if state == STATE_UNINITIALIZED {
            return Err(NetworkPolicyError::Uninitialized);
        }
        let registered = registered_operation(operation.id)
            .ok_or_else(|| NetworkPolicyError::UnregisteredOperation(operation.id.to_string()))?;
        if state == STATE_OFFLINE {
            if destination.is_literal_loopback() {
                return Ok(AuthorizedGeneration(
                    self.inner.generation.load(Ordering::Acquire),
                ));
            }
            return Err(OfflineModeBlockedError::for_operation(registered).into());
        }
        if !Self::destination_allowed(registered, destination) {
            return Err(NetworkPolicyError::DestinationNotAllowed(
                destination.host().to_string(),
            ));
        }
        Ok(AuthorizedGeneration(
            self.inner.generation.load(Ordering::Acquire),
        ))
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
        if authorized.0 != self.inner.generation.load(Ordering::Acquire) {
            return Err(NetworkPolicyError::Uninitialized);
        }
        if self.inner.state.load(Ordering::Acquire) == STATE_UNINITIALIZED {
            return Err(NetworkPolicyError::Uninitialized);
        }
        Ok(())
    }

    /// Persists a mode change.  Enabling is fail-closed: memory flips and all
    /// registered work is notified before this function returns, even if the
    /// subsequent disk write reports an error.  Disabling writes first so a
    /// persistence failure cannot accidentally reopen off-device traffic.
    pub fn set_offline_mode(&self, enabled: bool) -> Result<(), NetworkPolicyError> {
        let current = self.inner.state.load(Ordering::Acquire);
        let desired = if enabled { STATE_OFFLINE } else { STATE_ONLINE };
        if current == desired {
            return Ok(());
        }
        if !enabled {
            self.persist(false)?;
        }
        self.inner.state.store(desired, Ordering::Release);
        let generation = self.inner.generation.fetch_add(1, Ordering::AcqRel) + 1;
        self.inner.changes.send_replace(generation);
        if enabled {
            self.persist(true)?;
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
            "Offline Mode is on. Lantern cannot connect to the internet. Turn it off to use license validation."
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
