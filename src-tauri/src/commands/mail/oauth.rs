pub const SCOPES: &str = "offline_access User.Read Mail.Read";

#[derive(Debug, Clone)]
pub struct DeviceCode {
    pub device_code: String, pub user_code: String,
    pub verification_uri: String, pub interval_secs: u64, pub expires_in_secs: u64,
}
impl DeviceCode {
    pub fn from_json(v: &serde_json::Value) -> Option<DeviceCode> {
        Some(DeviceCode {
            device_code: v.get("device_code")?.as_str()?.to_string(),
            user_code: v.get("user_code")?.as_str()?.to_string(),
            verification_uri: v.get("verification_uri")?.as_str()?.to_string(),
            interval_secs: v.get("interval").and_then(|x| x.as_u64()).unwrap_or(5),
            expires_in_secs: v.get("expires_in").and_then(|x| x.as_u64()).unwrap_or(900),
        })
    }
}

#[derive(Debug)]
pub enum TokenOutcome {
    Tokens { access: String, refresh: Option<String>, expires_in: u64 },
    Pending,
    SlowDown,
    Failed(String),
}
impl TokenOutcome {
    pub fn from_json(status: u16, v: &serde_json::Value) -> TokenOutcome {
        if status == 200 {
            return TokenOutcome::Tokens {
                access: v.get("access_token").and_then(|s| s.as_str()).unwrap_or("").to_string(),
                refresh: v.get("refresh_token").and_then(|s| s.as_str()).map(String::from),
                expires_in: v.get("expires_in").and_then(|x| x.as_u64()).unwrap_or(3600),
            };
        }
        match v.get("error").and_then(|s| s.as_str()) {
            Some("authorization_pending") => TokenOutcome::Pending,
            Some("slow_down") => TokenOutcome::SlowDown,
            Some(other) => TokenOutcome::Failed(other.to_string()),
            None => TokenOutcome::Failed(format!("http {status}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_device_code_response() {
        let j = serde_json::json!({
            "device_code": "DC", "user_code": "ABCD-EFGH",
            "verification_uri": "https://microsoft.com/devicelogin",
            "expires_in": 900, "interval": 5 });
        let d = DeviceCode::from_json(&j).unwrap();
        assert_eq!(d.user_code, "ABCD-EFGH");
        assert_eq!(d.interval_secs, 5);
        assert_eq!(d.verification_uri, "https://microsoft.com/devicelogin");
    }
    #[test]
    fn parses_token_response_and_pending() {
        let ok = serde_json::json!({ "access_token":"AT","refresh_token":"RT","expires_in":3600 });
        match TokenOutcome::from_json(200, &ok) {
            TokenOutcome::Tokens { access, refresh, .. } => { assert_eq!(access,"AT"); assert_eq!(refresh.as_deref(),Some("RT")); }
            _ => panic!("expected tokens"),
        }
        let pending = serde_json::json!({ "error": "authorization_pending" });
        assert!(matches!(TokenOutcome::from_json(400, &pending), TokenOutcome::Pending));
        let denied = serde_json::json!({ "error": "authorization_declined" });
        assert!(matches!(TokenOutcome::from_json(400, &denied), TokenOutcome::Failed(_)));
    }
}
