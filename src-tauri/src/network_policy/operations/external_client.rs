//! External-client (MCP) egress operation. The MCP boundary crosses the
//! desktop/external-client divide over a local rendezvous file, not a remote
//! URL, so it uses a fixed non-resolvable logical destination solely for the
//! shared policy + audit-receipt path.

use crate::network_policy::{
    DestinationRule, EgressCategory, EgressDataClasses, EgressOperation,
};

pub const MCP_EXTERNAL_CLIENT_EXPORT: EgressOperation = EgressOperation {
    id: "mcp-external-client-export",
    category: EgressCategory::ExternalClientExport,
    // MCP approval crosses the desktop/external-client boundary over a local
    // rendezvous file, not a remote URL.  This fixed logical host lets that
    // boundary use the same policy + audit receipt mechanism without ever
    // resolving or contacting a fictional network endpoint.
    destination_rule: DestinationRule::ExactHosts(&["mcp-external-client.invalid"]),
    data_classes: EgressDataClasses {
        content: true,
        metadata: true,
        credential: false,
    },
    receipt_label: "MCP access",
};

/// Logical-only MCP destination. This name is never resolved or contacted;
/// the MCP sidecar exchanges data through a local rendezvous file. It exists
/// so both MCP binaries can use one policy operation and one durable receipt
/// path when they cross the desktop/external-client boundary.
pub const MCP_EXTERNAL_CLIENT_LOGICAL_DESTINATION: &str = "https://mcp-external-client.invalid/";

/// This domain's egress slice. Registered once in `operations::EGRESS_MODULES`.
pub const EXTERNAL_CLIENT_OPERATIONS: &[EgressOperation] = &[MCP_EXTERNAL_CLIENT_EXPORT];
