//! Local-AI egress operations. These are the only operations that stay
//! available while Network lockdown (Offline Mode) is on, and only to a literal
//! loopback address.

use crate::network_policy::{
    DestinationRule, EgressCategory, EgressDataClasses, EgressOperation,
};

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

/// This domain's egress slice. Registered once in `operations::EGRESS_MODULES`.
pub const LOCAL_AI_OPERATIONS: &[EgressOperation] = &[LOCAL_LLAMA, OLLAMA];
