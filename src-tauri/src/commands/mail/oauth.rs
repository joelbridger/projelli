pub const SCOPES: &str = "offline_access User.Read Mail.Read";

pub struct OAuth { client_id: String, base: String, http: reqwest::Client }
impl OAuth {
    pub fn new(client_id: String) -> Self { Self::new_with_base(client_id, "https://login.microsoftonline.com".into()) }
    pub fn new_with_base(client_id: String, base: String) -> Self {
        Self { client_id, base, http: reqwest::Client::new() }
    }
    pub async fn request_device_code(&self) -> anyhow::Result<DeviceCode> {
        let url = format!("{}/common/oauth2/v2.0/devicecode", self.base);
        let v: serde_json::Value = self.http.post(&url)
            .form(&[("client_id", self.client_id.as_str()), ("scope", SCOPES)])
            .send().await?.json().await?;
        DeviceCode::from_json(&v).ok_or_else(|| anyhow::anyhow!("bad devicecode response"))
    }
    /// Poll the token endpoint once. Caller loops on Pending/SlowDown.
    pub async fn poll_token(&self, device_code: &str) -> anyhow::Result<TokenOutcome> {
        let url = format!("{}/common/oauth2/v2.0/token", self.base);
        let resp = self.http.post(&url).form(&[
            ("grant_type","urn:ietf:params:oauth:grant-type:device_code"),
            ("client_id", self.client_id.as_str()),
            ("device_code", device_code),
        ]).send().await?;
        let status = resp.status().as_u16();
        let v: serde_json::Value = resp.json().await?;
        Ok(TokenOutcome::from_json(status, &v))
    }
    /// Exchange a stored refresh token for a fresh access token.
    pub async fn refresh(&self, refresh_token: &str) -> anyhow::Result<TokenOutcome> {
        let url = format!("{}/common/oauth2/v2.0/token", self.base);
        let resp = self.http.post(&url).form(&[
            ("grant_type","refresh_token"),
            ("client_id", self.client_id.as_str()),
            ("scope", SCOPES),
            ("refresh_token", refresh_token),
        ]).send().await?;
        let status = resp.status().as_u16();
        let v: serde_json::Value = resp.json().await?;
        Ok(TokenOutcome::from_json(status, &v))
    }
}

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

    #[tokio::test]
    async fn requests_device_code_from_endpoint() {
        use wiremock::{Mock, MockServer, ResponseTemplate};
        use wiremock::matchers::{method, path};
        let server = MockServer::start().await;
        Mock::given(method("POST")).and(path("/common/oauth2/v2.0/devicecode"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "device_code":"DC","user_code":"WXYZ","verification_uri":"https://microsoft.com/devicelogin",
                "expires_in":900,"interval":5 }))).mount(&server).await;
        let auth = OAuth::new_with_base("client-123".into(), server.uri());
        let dc = auth.request_device_code().await.expect("device code");
        assert_eq!(dc.user_code, "WXYZ");
    }

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
