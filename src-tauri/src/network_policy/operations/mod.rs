//! Per-domain egress operation slices, mounted through one append-only list.
//!
//! Each domain owns its operation constants in its own module and exports a
//! `*_OPERATIONS` slice. `EGRESS_MODULES` is the single registry: authorization
//! (`registered_operation`) and the boundary tests iterate the flattened slices
//! rather than one central array. A feature lane appends its operation to its
//! domain slice (or adds a new slice module and one `EGRESS_MODULES` line) — it
//! never edits the authorization engine in the parent module.
//!
//! Splitting the catalogue into slices does not change the operation surface:
//! `parity_tests` freezes the exact set of ids, categories, destination rules,
//! data classes, and receipt labels and fails on any add, remove, or loosening.

pub mod calendar;
pub mod connectors;
pub mod crm;
pub mod external_client;
pub mod files;
pub mod licensing;
pub mod local_ai;
pub mod mail;
pub mod model_downloads;
pub mod navigation;

// Surface the operation constants (LOCAL_LLAMA, WEALTHBOX_AUTH, …) and the
// logical MCP destination at `operations::…` so the parent module re-exports
// them unchanged as `network_policy::…` for existing callers. Slice-array and
// operation-constant names are unique across domains, so these globs never
// collide.
pub use calendar::*;
pub use connectors::*;
pub use crm::*;
pub use external_client::*;
pub use files::*;
pub use licensing::*;
pub use local_ai::*;
pub use mail::*;
pub use model_downloads::*;
pub use navigation::*;

use crate::network_policy::EgressOperation;

/// The append-only egress registry: every per-domain slice, listed once.
/// Order is not security-relevant (lookup is by id and the boundary tests are
/// order-independent), but existing entries are never reordered or removed.
pub const EGRESS_MODULES: &[&[EgressOperation]] = &[
    local_ai::LOCAL_AI_OPERATIONS,
    licensing::LICENSING_OPERATIONS,
    mail::MAIL_OPERATIONS,
    calendar::CALENDAR_OPERATIONS,
    files::FILE_STORAGE_OPERATIONS,
    crm::CRM_OPERATIONS,
    connectors::CONNECTOR_OPERATIONS,
    model_downloads::MODEL_DOWNLOAD_OPERATIONS,
    navigation::NAVIGATION_OPERATIONS,
    external_client::EXTERNAL_CLIENT_OPERATIONS,
];

/// Flatten every registered per-domain slice into one iterator of operations.
pub fn all_operations() -> impl Iterator<Item = &'static EgressOperation> {
    EGRESS_MODULES.iter().flat_map(|slice| slice.iter())
}

/// Structural gate for a set of egress module slices. Returns a stable list of
/// problems (empty when well-formed). It rejects a duplicate operation id and a
/// missing required field (empty id or empty receipt label) — the fields native
/// receipts expose to people. It never changes what an operation may do.
pub fn registry_problems(modules: &[&[EgressOperation]]) -> Vec<String> {
    let mut problems = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for slice in modules {
        for operation in slice.iter() {
            if operation.id.is_empty() {
                problems.push("operation has an empty id".to_string());
            } else if !seen.insert(operation.id) {
                problems.push(format!("duplicate operation id {}", operation.id));
            }
            if operation.receipt_label.is_empty() {
                problems.push(format!("{} has an empty receipt label", operation.id));
            }
        }
    }
    problems
}

#[cfg(test)]
mod parity_tests {
    use super::*;
    use crate::network_policy::DestinationRule;

    fn signature(operation: &EgressOperation) -> String {
        let rule = match operation.destination_rule {
            DestinationRule::LiteralLoopbackOnly => "loopback".to_string(),
            DestinationRule::ExactHosts(hosts) => format!("exact:{}", hosts.join("+")),
            DestinationRule::UserConfiguredHost => "user-host".to_string(),
        };
        format!(
            "{} | {:?} | rule={} | data=c{}m{}k{} | label={}",
            operation.id,
            operation.category,
            rule,
            operation.data_classes.content as u8,
            operation.data_classes.metadata as u8,
            operation.data_classes.credential as u8,
            operation.receipt_label,
        )
    }

    /// The frozen pre-carve native egress surface (grouped by slice, in module
    /// order). Both this list and the live registry are sorted before compare,
    /// so a reorder is intentionally not a failure but any added, removed, or
    /// loosened operation is.
    const GOLDEN: &[&str] = &[
        // local_ai
        "local-llama | LocalAi | rule=loopback | data=c1m0k0 | label=Local AI",
        "ollama | LocalAi | rule=loopback | data=c1m0k0 | label=Ollama",
        // licensing
        "license-validation | Licensing | rule=exact:api.lemonsqueezy.com | data=c0m1k1 | label=license validation",
        // mail
        "outlook-mail-oauth | Connector | rule=exact:login.microsoftonline.com | data=c0m1k1 | label=Outlook mail sign-in",
        "outlook-mail-sync | Connector | rule=exact:graph.microsoft.com | data=c1m1k1 | label=Outlook mail sync",
        "gmail-oauth | Connector | rule=exact:accounts.google.com+oauth2.googleapis.com | data=c0m1k1 | label=Gmail sign-in",
        "gmail-sync | Connector | rule=exact:gmail.googleapis.com | data=c1m1k1 | label=Gmail sync",
        "imap-sync | Connector | rule=user-host | data=c1m1k1 | label=IMAP mail sync",
        "smtp-send | Connector | rule=user-host | data=c1m1k1 | label=send mail",
        // calendar
        "outlook-calendar-oauth | Connector | rule=exact:login.microsoftonline.com | data=c0m1k1 | label=Outlook Calendar sign-in",
        "outlook-calendar-sync | Connector | rule=exact:graph.microsoft.com | data=c1m1k1 | label=Outlook Calendar sync",
        "google-calendar-oauth | Connector | rule=exact:accounts.google.com+oauth2.googleapis.com | data=c0m1k1 | label=Google Calendar sign-in",
        "google-calendar-sync | Connector | rule=exact:www.googleapis.com | data=c1m1k1 | label=Google Calendar sync",
        "ics-calendar-sync | Connector | rule=user-host | data=c1m1k1 | label=ICS calendar sync",
        // files
        "onedrive-oauth | Connector | rule=exact:login.microsoftonline.com | data=c0m1k1 | label=OneDrive sign-in",
        "onedrive-sync | Connector | rule=exact:graph.microsoft.com | data=c1m1k1 | label=OneDrive sync",
        "box-sync | Connector | rule=exact:api.box.com+dl.boxcloud.com | data=c1m1k1 | label=Box sync",
        "sharefile-sync | Connector | rule=user-host | data=c1m1k1 | label=ShareFile sync",
        "docusign-oauth | Connector | rule=exact:account-d.docusign.com+account.docusign.com | data=c0m1k1 | label=DocuSign sign-in",
        "docusign-sync | Connector | rule=user-host | data=c1m1k1 | label=DocuSign sync",
        // crm
        "crm-auth-wealthbox | Connector | rule=exact:api.crmworkspace.com | data=c0m1k1 | label=Wealthbox connection check",
        "crm-sync-wealthbox | Connector | rule=exact:api.crmworkspace.com | data=c1m1k1 | label=Wealthbox sync",
        "crm-write-wealthbox | Connector | rule=exact:api.crmworkspace.com | data=c1m1k1 | label=Wealthbox write-back",
        "crm-auth-salesforce | Connector | rule=exact:login.salesforce.com | data=c0m1k1 | label=Salesforce sign-in",
        "crm-auth-salesforce-identity | Connector | rule=exact:login.salesforce.com+test.salesforce.com | data=c0m1k1 | label=Salesforce account identity",
        "crm-auth-salesforce-instance | Connector | rule=user-host | data=c0m1k1 | label=Salesforce account check",
        "crm-sync-salesforce | Connector | rule=user-host | data=c1m1k1 | label=Salesforce sync",
        "crm-auth-redtail | Connector | rule=exact:api2.redtailtechnology.com | data=c0m1k1 | label=Redtail sign-in",
        "crm-sync-redtail | Connector | rule=exact:api2.redtailtechnology.com | data=c1m1k1 | label=Redtail sync",
        "crm-migration-import | Connector | rule=user-host | data=c1m1k1 | label=CRM sample migration",
        // connectors
        "calendly-sync | Connector | rule=exact:api.calendly.com | data=c1m1k1 | label=Calendly sync",
        "addepar-sync | Connector | rule=user-host | data=c1m1k1 | label=Addepar sync",
        "jotform-sync | Connector | rule=exact:api.jotform.com | data=c1m1k1 | label=Jotform sync",
        "zocks-sync | Connector | rule=exact:api.zocks.io | data=c1m1k1 | label=Zocks sync",
        // model_downloads
        "rag-model-download | ProductMaintenance | rule=exact:huggingface.co+us.aws.cdn.hf.co | data=c0m1k0 | label=RAG model download",
        "reranker-model-download | ProductMaintenance | rule=exact:huggingface.co+us.aws.cdn.hf.co | data=c0m1k0 | label=reranker model download",
        "local-llm-model-download | ProductMaintenance | rule=exact:huggingface.co+us.aws.cdn.hf.co | data=c0m1k0 | label=local LLM model download",
        "voice-model-download | ProductMaintenance | rule=exact:advisorprephero.com | data=c0m1k0 | label=voice model download",
        // navigation
        "meeting-auto-join | Navigation | rule=user-host | data=c0m1k0 | label=meeting auto-join",
        "external-navigation | Navigation | rule=user-host | data=c0m1k0 | label=external navigation",
        // external_client
        "mcp-external-client-export | ExternalClientExport | rule=exact:mcp-external-client.invalid | data=c1m1k0 | label=MCP access",
    ];

    #[test]
    fn native_egress_surface_is_byte_identical_to_the_frozen_golden() {
        let mut actual: Vec<String> = all_operations().map(signature).collect();
        actual.sort();
        let mut expected: Vec<String> = GOLDEN.iter().map(|entry| entry.to_string()).collect();
        expected.sort();
        assert_eq!(
            actual, expected,
            "the carved native egress surface must match the frozen policy set exactly"
        );
    }

    #[test]
    fn registry_has_no_duplicate_id_or_missing_field() {
        assert!(
            registry_problems(EGRESS_MODULES).is_empty(),
            "shipped registry must be structurally clean: {:?}",
            registry_problems(EGRESS_MODULES)
        );
    }

    #[test]
    fn validator_rejects_a_duplicate_id() {
        const DUP: &[EgressOperation] = &[local_ai::LOCAL_LLAMA, local_ai::LOCAL_LLAMA];
        let problems = registry_problems(&[DUP]);
        assert!(problems
            .iter()
            .any(|problem| problem.contains("duplicate operation id local-llama")));
    }

    #[test]
    fn validator_rejects_a_missing_required_field() {
        const BROKEN: EgressOperation = EgressOperation {
            id: "",
            category: crate::network_policy::EgressCategory::Connector,
            destination_rule: DestinationRule::ExactHosts(&["example.test"]),
            data_classes: crate::network_policy::EgressDataClasses {
                content: false,
                metadata: true,
                credential: false,
            },
            receipt_label: "",
        };
        let problems = registry_problems(&[&[BROKEN]]);
        assert!(problems.iter().any(|problem| problem.contains("empty id")));
        assert!(problems
            .iter()
            .any(|problem| problem.contains("empty receipt label")));
    }
}
