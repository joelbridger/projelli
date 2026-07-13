//! CRM provider registry and provider-scoped keychain helpers.
//!
//! A future CRM provider plugs in by adding one client/normalizer that implements
//! `CrmSource`, then registering it in the match statements below. The shared
//! engine/store/render code stays provider-neutral.

use crate::commands::crm::client::WealthboxClient;
use crate::commands::crm::redtail::{RedtailAuthInfo, RedtailClient};
use crate::commands::crm::salesforce::{SalesforceClient, SalesforceTokenSet};
use crate::commands::crm::source::CrmSource;

const KEYCHAIN_TOKEN_KEY: &str = "api-token";
const LEGACY_WEALTHBOX_SERVICE: &str = crate::identity::WEALTHBOX_LEGACY_SERVICE;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CrmProvider {
    Wealthbox,
    Salesforce,
    Redtail,
}

impl CrmProvider {
    pub fn from_optional(provider: Option<&str>) -> Result<Self, String> {
        match provider
            .unwrap_or("wealthbox")
            .trim()
            .to_ascii_lowercase()
            .as_str()
        {
            "" | "wealthbox" => Ok(Self::Wealthbox),
            "salesforce" | "sfdc" => Ok(Self::Salesforce),
            "redtail" => Ok(Self::Redtail),
            other => Err(format!("unsupported CRM provider: {other}")),
        }
    }

    pub fn id(self) -> &'static str {
        match self {
            Self::Wealthbox => "wealthbox",
            Self::Salesforce => "salesforce",
            Self::Redtail => "redtail",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::Wealthbox => "Wealthbox",
            Self::Salesforce => "Salesforce",
            Self::Redtail => "Redtail",
        }
    }

    pub fn audit_action(self, action: &str) -> String {
        format!("{}.{}", self.id(), action)
    }

    fn keychain_service(self) -> String {
        crate::identity::crm_keychain_service(self.id())
    }

    fn legacy_keychain_service(self) -> Option<&'static str> {
        match self {
            Self::Wealthbox => Some(LEGACY_WEALTHBOX_SERVICE),
            Self::Salesforce => None,
            Self::Redtail => None,
        }
    }
}

impl Default for CrmProvider {
    fn default() -> Self {
        Self::Wealthbox
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CrmProviderAccountInfo {
    pub name: String,
    pub plan: String,
    pub email: String,
}

pub fn client_for(
    provider: CrmProvider,
    token: String,
    policy: crate::network_policy::NetworkPolicy,
) -> anyhow::Result<Box<dyn CrmSource>> {
    match provider {
        CrmProvider::Wealthbox => Ok(Box::new(WealthboxClient::new(
            token,
            policy,
            crate::network_policy::WEALTHBOX_SYNC,
        ))),
        CrmProvider::Salesforce => Ok(Box::new(SalesforceClient::new(token, policy)?)),
        CrmProvider::Redtail => Ok(Box::new(RedtailClient::new(token, policy)?)),
    }
}

pub async fn validate_token(
    provider: CrmProvider,
    token: &str,
    policy: crate::network_policy::NetworkPolicy,
) -> anyhow::Result<CrmProviderAccountInfo> {
    match provider {
        CrmProvider::Wealthbox => {
            let client = WealthboxClient::new(
                token.to_string(),
                policy,
                crate::network_policy::WEALTHBOX_AUTH,
            );
            let me = client.me().await?;
            Ok(parse_wealthbox_me_to_info(&me))
        }
        CrmProvider::Salesforce => {
            let _: SalesforceTokenSet = serde_json::from_str(token)?;
            let client = SalesforceClient::new(token.to_string(), policy)?;
            let info = client.identity().await?;
            Ok(CrmProviderAccountInfo {
                name: info.name,
                plan: String::new(),
                email: info.email,
            })
        }
        CrmProvider::Redtail => {
            let client = RedtailClient::new(token.to_string(), policy)?;
            let info: RedtailAuthInfo = client.validate_user_key().await?;
            Ok(CrmProviderAccountInfo {
                name: info.name,
                plan: info.tier,
                email: info.email,
            })
        }
    }
}

pub fn parse_wealthbox_me_to_info(me: &serde_json::Value) -> CrmProviderAccountInfo {
    let firm_name = me
        .get("accounts")
        .and_then(|a| a.get(0))
        .and_then(|acc| acc.get("name"))
        .and_then(|n| n.as_str())
        .unwrap_or("");
    let user_name = me.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let name = if !firm_name.is_empty() {
        firm_name
    } else {
        user_name
    }
    .to_string();
    let plan = me
        .get("plan")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let email = me
        .get("email")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    CrmProviderAccountInfo { name, plan, email }
}

pub fn store_token(provider: CrmProvider, token: &str) -> Result<(), String> {
    let service = provider.keychain_service();
    keyring::Entry::new(&service, KEYCHAIN_TOKEN_KEY)
        .map_err(|e| e.to_string())?
        .set_password(token)
        .map_err(|e| e.to_string())
}

pub fn read_token(provider: CrmProvider) -> Option<String> {
    read_token_from_services(provider, |service| {
        keyring::Entry::new(service, KEYCHAIN_TOKEN_KEY)
            .ok()?
            .get_password()
            .ok()
    })
}

fn read_token_from_services(
    provider: CrmProvider,
    mut read_service: impl FnMut(&str) -> Option<String>,
) -> Option<String> {
    let service = provider.keychain_service();
    read_service(&service).or_else(|| {
        provider
            .legacy_keychain_service()
            .and_then(|legacy| read_service(legacy))
    })
}

pub fn delete_token(provider: CrmProvider) -> Result<(), String> {
    let mut errors = Vec::new();
    let service = provider.keychain_service();
    delete_service_token(&service, &mut errors);
    if let Some(legacy) = provider.legacy_keychain_service() {
        delete_service_token(legacy, &mut errors);
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn delete_service_token(service: &str, errors: &mut Vec<String>) {
    let entry = match keyring::Entry::new(service, KEYCHAIN_TOKEN_KEY) {
        Ok(entry) => entry,
        Err(e) => {
            errors.push(e.to_string());
            return;
        }
    };
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => {}
        Err(e) => errors.push(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    #[test]
    fn provider_defaults_to_wealthbox() {
        assert_eq!(
            CrmProvider::from_optional(None).unwrap(),
            CrmProvider::Wealthbox
        );
        assert_eq!(
            CrmProvider::from_optional(Some("")).unwrap(),
            CrmProvider::Wealthbox
        );
        assert_eq!(
            CrmProvider::from_optional(Some("Salesforce")).unwrap(),
            CrmProvider::Salesforce
        );
        assert_eq!(
            CrmProvider::from_optional(Some("Redtail")).unwrap(),
            CrmProvider::Redtail
        );
        assert_eq!(
            CrmProvider::from_optional(Some("Wealthbox")).unwrap(),
            CrmProvider::Wealthbox
        );
    }

    #[test]
    fn unknown_provider_is_rejected() {
        let err = CrmProvider::from_optional(Some("unknown-crm")).unwrap_err();
        assert!(err.contains("unsupported CRM provider"));
    }

    #[test]
    fn salesforce_uses_provider_scoped_keychain_slot() {
        assert_eq!(
            CrmProvider::Salesforce.keychain_service(),
            crate::identity::crm_keychain_service("salesforce")
        );
        assert_eq!(CrmProvider::Salesforce.legacy_keychain_service(), None);
    }

    #[test]
    fn redtail_uses_provider_scoped_keychain_slot() {
        assert_eq!(
            CrmProvider::Redtail.keychain_service(),
            crate::identity::crm_keychain_service("redtail")
        );
        assert_eq!(CrmProvider::Redtail.legacy_keychain_service(), None);
    }

    #[test]
    fn wealthbox_token_read_falls_back_to_legacy_keychain_slot() {
        let mut slots = HashMap::new();
        slots.insert(crate::identity::WEALTHBOX_LEGACY_SERVICE.to_string(), "legacy-token".to_string());

        let token = read_token_from_services(CrmProvider::Wealthbox, |service| {
            slots.get(service).cloned()
        });

        assert_eq!(token.as_deref(), Some("legacy-token"));
    }

    #[test]
    fn wealthbox_new_keychain_slot_wins_over_legacy_slot() {
        let mut slots = HashMap::new();
        slots.insert(
            crate::identity::crm_keychain_service("wealthbox"),
            "new-token".to_string(),
        );
        slots.insert(crate::identity::WEALTHBOX_LEGACY_SERVICE.to_string(), "legacy-token".to_string());

        let token = read_token_from_services(CrmProvider::Wealthbox, |service| {
            slots.get(service).cloned()
        });

        assert_eq!(token.as_deref(), Some("new-token"));
    }

    #[test]
    fn parse_wealthbox_me_prefers_account_name() {
        let me = serde_json::json!({
            "name": "Jameson Daines",
            "plan": "basic",
            "email": "advisor@northcrest.com",
            "accounts": [{ "name": "Northcrest Advisory" }]
        });

        let info = parse_wealthbox_me_to_info(&me);

        assert_eq!(info.name, "Northcrest Advisory");
        assert_eq!(info.plan, "basic");
        assert_eq!(info.email, "advisor@northcrest.com");
    }
}
