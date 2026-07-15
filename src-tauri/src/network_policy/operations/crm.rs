//! CRM connector egress operations — Wealthbox, Salesforce, Redtail, and the
//! sample migration importer.

use crate::network_policy::{
    DestinationRule, EgressCategory, EgressDataClasses, EgressOperation,
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

/// This domain's egress slice. Registered once in `operations::EGRESS_MODULES`.
pub const CRM_OPERATIONS: &[EgressOperation] = &[
    WEALTHBOX_AUTH,
    WEALTHBOX_SYNC,
    WEALTHBOX_WRITE,
    SALESFORCE_OAUTH,
    SALESFORCE_LOGIN_IDENTITY,
    SALESFORCE_IDENTITY,
    SALESFORCE_SYNC,
    REDTAIL_OAUTH,
    REDTAIL_SYNC,
    CRM_MIGRATION_IMPORT,
];
