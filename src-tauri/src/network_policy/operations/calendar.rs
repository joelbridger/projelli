//! Calendar connector egress operations — provider import today. Wave-4
//! calendar write operations (event create/update, booking write-back) append
//! their operation constants here.

use crate::network_policy::{
    DestinationRule, EgressCategory, EgressDataClasses, EgressOperation,
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

/// This domain's egress slice. Registered once in `operations::EGRESS_MODULES`.
pub const CALENDAR_OPERATIONS: &[EgressOperation] = &[
    OUTLOOK_CALENDAR_OAUTH,
    OUTLOOK_CALENDAR_SYNC,
    GOOGLE_CALENDAR_OAUTH,
    GOOGLE_CALENDAR_SYNC,
    ICS_CALENDAR_SYNC,
];
