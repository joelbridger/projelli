//! File-storage connector egress operations — OneDrive/SharePoint, Box,
//! ShareFile, and DocuSign document retrieval.

use crate::network_policy::{
    DestinationRule, EgressCategory, EgressDataClasses, EgressOperation,
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

/// This domain's egress slice. Registered once in `operations::EGRESS_MODULES`.
pub const FILE_STORAGE_OPERATIONS: &[EgressOperation] = &[
    ONEDRIVE_OAUTH,
    ONEDRIVE_SYNC,
    BOX_SYNC,
    SHAREFILE_SYNC,
    DOCUSIGN_OAUTH,
    DOCUSIGN_SYNC,
];
