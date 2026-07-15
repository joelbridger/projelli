//! Mail connector egress operations — Outlook/M365, Gmail, and IMAP/SMTP.

use crate::network_policy::{
    DestinationRule, EgressCategory, EgressDataClasses, EgressOperation,
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

/// This domain's egress slice. Registered once in `operations::EGRESS_MODULES`.
pub const MAIL_OPERATIONS: &[EgressOperation] = &[
    OUTLOOK_MAIL_OAUTH,
    OUTLOOK_MAIL_SYNC,
    GMAIL_OAUTH,
    GMAIL_SYNC,
    IMAP_SYNC,
    SMTP_SEND,
];
