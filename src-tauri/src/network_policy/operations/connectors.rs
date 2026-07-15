//! Single-product connector egress operations that do not belong to the mail,
//! calendar, file-storage, or CRM domains — scheduling (Calendly), portfolio
//! (Addepar), forms (Jotform), and meetings (Zocks) import.

use crate::network_policy::{
    DestinationRule, EgressCategory, EgressDataClasses, EgressOperation,
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

/// This domain's egress slice. Registered once in `operations::EGRESS_MODULES`.
pub const CONNECTOR_OPERATIONS: &[EgressOperation] =
    &[CALENDLY_SYNC, ADDEPAR_SYNC, JOTFORM_SYNC, ZOCKS_SYNC];
