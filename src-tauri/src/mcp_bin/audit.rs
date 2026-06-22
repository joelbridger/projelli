use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use keepance_lib::commands::audit::store::{AuditEntryRecord, EncryptedAuditStore};
use serde_json::{json, Value};

const TEST_AUDIT_KEY_ENV: &str = "KEEPANCE_MCP_AUDIT_KEY_HEX";

pub fn append_mcp_audit(
    workspace_root: &Path,
    action: &str,
    description: &str,
    metadata: Value,
) -> Result<(), String> {
    let timestamp = chrono::Utc::now().to_rfc3339();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or_default();
    let id = format!("audit_mcp_{nanos}_{}", std::process::id());
    let mut metadata_map = metadata.as_object().cloned().unwrap_or_default();
    metadata_map.insert("auditEventType".into(), json!(action));
    metadata_map.insert("source".into(), json!("mcp-sidecar"));
    metadata_map.insert("sidecarPid".into(), json!(std::process::id()));
    let payload = json!({
        "id": id,
        "timestamp": timestamp,
        "action": action,
        "description": description,
        "model": null,
        "inputs": {},
        "outputs": {},
        "userDecision": "auto",
        "metadata": metadata_map
    });
    let rec = AuditEntryRecord {
        id,
        timestamp,
        action: action.to_string(),
        description: description.to_string(),
        payload_json: serde_json::to_string(&payload)
            .map_err(|e| format!("serialize MCP audit payload: {e}"))?,
    };
    let store = open_store(workspace_root)?;
    store
        .append(&rec)
        .map_err(|e| format!("append MCP audit entry: {e}"))?;
    Ok(())
}

fn open_store(workspace_root: &Path) -> Result<EncryptedAuditStore, String> {
    if let Ok(hex_key) = std::env::var(TEST_AUDIT_KEY_ENV) {
        let bytes =
            hex::decode(hex_key.trim()).map_err(|e| format!("decode {TEST_AUDIT_KEY_ENV}: {e}"))?;
        if bytes.len() != 32 {
            return Err(format!("{TEST_AUDIT_KEY_ENV} must decode to 32 bytes"));
        }
        let mut key = [0u8; 32];
        key.copy_from_slice(&bytes);
        return EncryptedAuditStore::open_with_key(workspace_root, &key)
            .map_err(|e| format!("open MCP audit store with test key: {e}"));
    }
    EncryptedAuditStore::open(workspace_root).map_err(|e| format!("open MCP audit store: {e}"))
}
