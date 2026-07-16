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
// Wave-2 Part B calendar WRITE mirror. Create/update one event on the advisor's
// own home calendar. Same exact hosts and data classes as the renderer's
// `calendar-write-*` operations (renderer ids differ by naming convention; the
// host allowlist and data classes are what must agree across the two layers).
// There is deliberately no ICS write: SC-022 keeps the ICS feed read-only.
pub const OUTLOOK_CALENDAR_WRITE: EgressOperation = EgressOperation {
    id: "outlook-calendar-write",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&["graph.microsoft.com"]),
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: true,
    },
    receipt_label: "Outlook Calendar write",
};
pub const GOOGLE_CALENDAR_WRITE: EgressOperation = EgressOperation {
    id: "google-calendar-write",
    category: EgressCategory::Connector,
    destination_rule: DestinationRule::ExactHosts(&["www.googleapis.com"]),
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: true,
    },
    receipt_label: "Google Calendar write",
};

/// This domain's egress slice. Registered once in `operations::EGRESS_MODULES`.
pub const CALENDAR_OPERATIONS: &[EgressOperation] = &[
    OUTLOOK_CALENDAR_OAUTH,
    OUTLOOK_CALENDAR_SYNC,
    GOOGLE_CALENDAR_OAUTH,
    GOOGLE_CALENDAR_SYNC,
    ICS_CALENDAR_SYNC,
    OUTLOOK_CALENDAR_WRITE,
    GOOGLE_CALENDAR_WRITE,
];
