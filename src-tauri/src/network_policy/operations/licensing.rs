//! Licensing egress operations.

use crate::network_policy::{
    DestinationRule, EgressCategory, EgressDataClasses, EgressOperation,
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

/// This domain's egress slice. Registered once in `operations::EGRESS_MODULES`.
pub const LICENSING_OPERATIONS: &[EgressOperation] = &[LICENSE_VALIDATION];
