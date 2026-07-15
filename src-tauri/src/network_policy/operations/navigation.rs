//! Navigation egress operations — meeting auto-join and opening an external
//! link the person selected. These never carry client content or credentials.

use crate::network_policy::{
    DestinationRule, EgressCategory, EgressDataClasses, EgressOperation,
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

/// This domain's egress slice. Registered once in `operations::EGRESS_MODULES`.
pub const NAVIGATION_OPERATIONS: &[EgressOperation] = &[MEETING_AUTO_JOIN, EXTERNAL_NAVIGATION];
