// JSON-RPC 2.0 wire format + MCP-specific error codes.
//
// Spec references:
//   - JSON-RPC 2.0: https://www.jsonrpc.org/specification
//   - MCP servers over stdio: https://modelcontextprotocol.io/specification
//
// We intentionally model only the subset we emit/consume. Tool arguments are
// plain `serde_json::Value` — lighter than pulling `schemars` into the crate
// graph just to generate JSON Schema for five tools we own end-to-end.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// JSON-RPC 2.0 request. `id` is absent for notifications.
///
/// We accept a flexible `Value` id rather than `i64` only so string-ids work —
/// some clients (Cursor, Zed) use UUID strings.
#[derive(Deserialize, Debug, Clone)]
pub struct JsonRpcRequest {
    #[serde(rename = "jsonrpc")]
    #[allow(dead_code)]
    pub version: String,
    pub method: String,
    #[serde(default)]
    pub id: Option<Value>,
    #[serde(default)]
    pub params: Option<Value>,
}

/// JSON-RPC 2.0 response — either `result` or `error` is present, never both.
#[derive(Serialize, Debug, Clone)]
pub struct JsonRpcResponse {
    pub jsonrpc: &'static str,
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<JsonRpcErrorObject>,
}

impl JsonRpcResponse {
    pub fn ok(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: Some(result),
            error: None,
        }
    }

    pub fn error(id: Value, code: i32, message: impl Into<String>) -> Self {
        Self {
            jsonrpc: "2.0",
            id,
            result: None,
            error: Some(JsonRpcErrorObject {
                code,
                message: message.into(),
                data: None,
            }),
        }
    }
}

/// JSON-RPC error object in a response.
#[derive(Serialize, Debug, Clone)]
pub struct JsonRpcErrorObject {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

/// Internal error helper used by tool bodies. Separate from the wire struct
/// above so tools don't have to import the whole JSON-RPC module.
#[derive(Debug, Clone)]
pub struct JsonRpcError {
    pub code: i32,
    pub message: String,
}

impl JsonRpcError {
    pub fn invalid_params(msg: impl Into<String>) -> Self {
        Self {
            code: ERROR_INVALID_PARAMS,
            message: msg.into(),
        }
    }

    pub fn internal(msg: impl Into<String>) -> Self {
        Self {
            code: ERROR_INTERNAL,
            message: msg.into(),
        }
    }

    pub fn method_not_found(msg: impl Into<String>) -> Self {
        Self {
            code: ERROR_METHOD_NOT_FOUND,
            message: msg.into(),
        }
    }
}

// Standard JSON-RPC 2.0 error codes (see spec section 5.1).
pub const ERROR_PARSE: i32 = -32700;
#[allow(dead_code)]
pub const ERROR_INVALID_REQUEST: i32 = -32600;
pub const ERROR_METHOD_NOT_FOUND: i32 = -32601;
pub const ERROR_INVALID_PARAMS: i32 = -32602;
pub const ERROR_INTERNAL: i32 = -32603;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_request_with_id() {
        let raw = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#;
        let req: JsonRpcRequest = serde_json::from_str(raw).unwrap();
        assert_eq!(req.method, "initialize");
        assert_eq!(req.id, Some(serde_json::Value::from(1)));
    }

    #[test]
    fn parses_notification_without_id() {
        let raw = r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#;
        let req: JsonRpcRequest = serde_json::from_str(raw).unwrap();
        assert!(req.id.is_none());
        assert_eq!(req.method, "notifications/initialized");
    }

    #[test]
    fn parses_request_with_string_id() {
        // Some clients (Cursor, Zed) use UUIDs as ids.
        let raw = r#"{"jsonrpc":"2.0","id":"abc-123","method":"tools/list"}"#;
        let req: JsonRpcRequest = serde_json::from_str(raw).unwrap();
        assert_eq!(req.id, Some(serde_json::Value::from("abc-123")));
    }

    #[test]
    fn serializes_ok_response_without_error_field() {
        let r = JsonRpcResponse::ok(Value::from(1), serde_json::json!({"ok": true}));
        let s = serde_json::to_string(&r).unwrap();
        // The `error` field must be omitted, not set to null — some clients
        // reject responses that include both fields even when `error` is null.
        assert!(!s.contains("\"error\""), "got: {s}");
        assert!(s.contains("\"result\""));
    }

    #[test]
    fn serializes_error_response_without_result_field() {
        let r = JsonRpcResponse::error(Value::from(2), ERROR_INTERNAL, "boom");
        let s = serde_json::to_string(&r).unwrap();
        assert!(!s.contains("\"result\""), "got: {s}");
        assert!(s.contains("\"error\""));
        assert!(s.contains("-32603"));
    }
}
