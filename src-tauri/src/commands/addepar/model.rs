//! Normalized Addepar models.
//!
//! Addepar responses are JSON:API-shaped and may include firm-specific custom
//! attributes. These structs parse the stable envelope and keep attributes
//! flexible so sparse or customized firms still sync.

use std::collections::BTreeMap;

fn null_to_default<'de, D, T>(d: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de> + Default,
{
    Ok(<Option<T> as serde::Deserialize<'de>>::deserialize(d)?.unwrap_or_default())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct AddeparConfig {
    pub api_key: String,
    pub api_secret: String,
    pub subdomain: String,
    pub firm_id: String,
}

impl AddeparConfig {
    pub fn api_base(&self) -> anyhow::Result<String> {
        let host = self
            .subdomain
            .trim()
            .trim_end_matches("/")
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .trim_end_matches("/api/v1")
            .trim_end_matches(".addepar.com");
        // P1-B: the subdomain becomes the URL host, so a value like
        // `attacker.example/foo` would build
        // `https://attacker.example/foo.addepar.com/...` and send the API
        // key/secret to attacker.example during validation. Require a bare
        // hostname (no slashes, ports, or userinfo) before the host is used.
        if !crate::commands::connector::is_valid_hostname(host) {
            anyhow::bail!(
                "Addepar subdomain is not a valid hostname (no slashes, ports, or special characters)"
            );
        }
        Ok(format!("https://{host}.addepar.com/api/v1"))
    }
}

#[derive(Debug, Clone, serde::Deserialize, Default, PartialEq)]
#[serde(bound(deserialize = "T: serde::Deserialize<'de> + Default"))]
#[serde(default)]
pub struct AddeparResource<T> {
    #[serde(default, deserialize_with = "null_to_default")]
    pub id: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub r#type: String,
    pub attributes: T,
}

#[derive(Debug, Clone, serde::Deserialize, Default, PartialEq)]
#[serde(bound(deserialize = "T: serde::Deserialize<'de> + Default"))]
#[serde(default)]
pub struct AddeparCollection<T> {
    #[serde(default)]
    pub data: Vec<AddeparResource<T>>,
    pub links: Option<AddeparLinks>,
}

#[derive(Debug, Clone, serde::Deserialize, Default, PartialEq)]
#[serde(bound(deserialize = "T: serde::Deserialize<'de> + Default"))]
#[serde(default)]
pub struct AddeparSingle<T> {
    pub data: AddeparResource<T>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct AddeparLinks {
    pub next: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct AddeparEntityAttributes {
    #[serde(default, deserialize_with = "null_to_default")]
    pub display_name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub original_name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub model_type: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub ownership_type: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub currency_factor: String,
}

pub type AddeparEntity = AddeparResource<AddeparEntityAttributes>;

impl AddeparEntity {
    pub fn name(&self) -> String {
        let display = self.attributes.display_name.trim();
        if !display.is_empty() {
            return display.to_string();
        }
        let original = self.attributes.original_name.trim();
        if !original.is_empty() {
            return original.to_string();
        }
        format!("Addepar entity {}", self.id)
    }

    pub fn is_household_or_client(&self) -> bool {
        let model = self.attributes.model_type.trim().to_ascii_uppercase();
        if model.contains("HOUSEHOLD") || model.contains("CLIENT") || model == "PERSON_NODE" {
            return true;
        }
        let name = self.name().to_ascii_lowercase();
        name.contains("household") || name.contains("client")
    }
}

#[derive(Debug, Clone, serde::Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct AddeparPortfolioQueryResponse {
    pub data: Option<AddeparResource<AddeparPortfolioAttributes>>,
    pub meta: Option<serde_json::Value>,
}

#[derive(Debug, Clone, serde::Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct AddeparPortfolioAttributes {
    pub total: Option<AddeparPortfolioNode>,
}

#[derive(Debug, Clone, serde::Deserialize, Default, PartialEq)]
#[serde(default)]
pub struct AddeparPortfolioNode {
    #[serde(default, deserialize_with = "null_to_default")]
    pub name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub grouping: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub columns: BTreeMap<String, serde_json::Value>,
    #[serde(default, deserialize_with = "null_to_default")]
    pub children: Vec<AddeparPortfolioNode>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AddeparMatterMapEntry {
    pub addepar_key: String,
    pub matter_id: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AddeparEntityDto {
    pub id: String,
    pub name: String,
    pub model_type: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AddeparHouseholdRecord {
    pub entity: AddeparEntity,
    pub asset_allocation: Option<AddeparPortfolioQueryResponse>,
    pub performance: Option<AddeparPortfolioQueryResponse>,
    pub account_list: Option<AddeparPortfolioQueryResponse>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AddeparNeedsAssignment {
    pub source_id: String,
    pub entity_id: String,
    pub name: String,
    pub reason: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_entity_fixture_into_household() {
        let json = r#"{
          "data": {
            "id": "329263",
            "type": "entities",
            "attributes": {
              "display_name": "Northcrest Family Household",
              "original_name": "Northcrest",
              "model_type": "PERSON_NODE"
            }
          }
        }"#;
        let parsed: AddeparSingle<AddeparEntityAttributes> = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.data.id, "329263");
        assert_eq!(parsed.data.name(), "Northcrest Family Household");
        assert!(parsed.data.is_household_or_client());
    }

    #[test]
    fn api_base_accepts_a_bare_subdomain() {
        let cfg = AddeparConfig {
            subdomain: "acme".into(),
            ..Default::default()
        };
        assert_eq!(cfg.api_base().unwrap(), "https://acme.addepar.com/api/v1");

        let cfg2 = AddeparConfig {
            subdomain: "https://acme.addepar.com/api/v1".into(),
            ..Default::default()
        };
        assert_eq!(cfg2.api_base().unwrap(), "https://acme.addepar.com/api/v1");
    }

    #[test]
    fn api_base_rejects_a_host_smuggling_subdomain() {
        // P1-B: a subdomain with a slash would build
        // https://attacker.example/foo.addepar.com/... and send credentials to
        // attacker.example. Reject before any request is made.
        for bad in ["attacker.example/foo", "evil.com:8443", "user@evil", "a b", ""] {
            let cfg = AddeparConfig {
                subdomain: bad.into(),
                ..Default::default()
            };
            assert!(
                cfg.api_base().is_err(),
                "subdomain {bad:?} must be rejected"
            );
        }
    }
}
