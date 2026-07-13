//! Normalised data models for CRM provider objects.
//!
//! All structs derive `Default` and carry `#[serde(default)]` so missing or
//! null fields are tolerated gracefully. Wealthbox is the first provider and
//! its API omits empty arrays and optional fields entirely rather than sending
//! `null`.
//!
//! Sensitive government-ID fields (passport_number, green_card_number,
//! drivers_license) are deliberately **omitted** per the privacy design (§5.5):
//! they offer little Client-Map value and Reg S-P warrants extra care.

/// Default page size for Wealthbox pagination requests.
///
/// The documented maximum `per_page` is not stated in the official API docs —
/// we default to 50 (conservative) and make it a named constant so it is easy
/// to raise once tested against a live token.
///
/// TODO(live-probe): confirm updated_since format + max per_page against a real token.
pub const DEFAULT_PER_PAGE: usize = 50;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CrmRecordProvider {
    #[default]
    Wealthbox,
    Salesforce,
    Redtail,
}

pub fn crm_key_belongs_to_provider(key: &str, provider_id: &str) -> bool {
    let trimmed = key.trim();
    match provider_id {
        "salesforce" => trimmed.starts_with("sfdc:"),
        "redtail" => trimmed.starts_with("redtail:"),
        "wealthbox" => !trimmed.starts_with("sfdc:") && !trimmed.starts_with("redtail:"),
        _ => false,
    }
}

pub fn crm_source_id_belongs_to_provider(source_id: &str, provider_id: &str) -> bool {
    let Some(rest) = source_id.strip_prefix("crm:") else {
        return false;
    };
    let Some((_, key)) = rest.split_once(':') else {
        return false;
    };
    crm_key_belongs_to_provider(key, provider_id)
}

// ---------------------------------------------------------------------------
// Serde helper — tolerates both MISSING and explicit NULL
// ---------------------------------------------------------------------------

/// Deserialize a field that may be absent (handled by `#[serde(default)]`) OR
/// present as `null` (NOT handled by `#[serde(default)]`).
///
/// `#[serde(default)]` on the struct only fills in the Rust default when a
/// JSON key is completely absent.  When the key is present as `null`, serde
/// tries to deserialize `null` into the target type (e.g. `String` or
/// `Vec<T>`) and fails with "invalid type: null, expected …".  This helper
/// turns `null` into the type's `Default` value instead, covering both cases.
fn null_to_default<'de, D, T>(d: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: serde::Deserialize<'de> + Default,
{
    Ok(<Option<T> as serde::Deserialize<'de>>::deserialize(d)?.unwrap_or_default())
}

/// Wealthbox represents an unassigned contact as a non-null `household`
/// object whose `id` is null. Treat that provider shape as no household.
/// Keeping it as a fake id `0` would silently file unrelated contacts together.
fn null_id_household_to_none<'de, D>(d: D) -> Result<Option<CrmHouseholdRef>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = <Option<serde_json::Value> as serde::Deserialize<'de>>::deserialize(d)?;
    let Some(value) = value else {
        return Ok(None);
    };

    let has_real_id = value
        .get("id")
        .and_then(serde_json::Value::as_i64)
        .is_some_and(|id| id > 0);
    if !has_real_id {
        return Ok(None);
    }

    serde_json::from_value(value)
        .map(Some)
        .map_err(serde::de::Error::custom)
}

// ---------------------------------------------------------------------------
// Household reference (embedded inside a person contact)
// ---------------------------------------------------------------------------

/// A member of a Wealthbox household, as embedded in `CrmHouseholdRef.members`.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct CrmHouseholdMember {
    #[serde(default, deserialize_with = "null_to_default")]
    pub id: i64,
    #[serde(default, deserialize_with = "null_to_default")]
    pub external_id: String,
    #[serde(skip)]
    pub source_provider: CrmRecordProvider,
    #[serde(default, deserialize_with = "null_to_default")]
    pub first_name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub last_name: String,
    /// Household title role: Head, Spouse, Partner, Child, Grandchild, etc.
    #[serde(default, deserialize_with = "null_to_default")]
    pub title: String,
    /// Contact type for this member (person / organization / trust).
    #[serde(rename = "type", default, deserialize_with = "null_to_default")]
    pub r#type: String,
}

/// The nested `household` object carried on a person/trust/org contact.
/// Tells us which household the contact belongs to and lists all members.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct CrmHouseholdRef {
    pub id: i64,
    #[serde(default, deserialize_with = "null_to_default")]
    pub external_id: String,
    #[serde(skip)]
    pub source_provider: CrmRecordProvider,
    #[serde(default, deserialize_with = "null_to_default")]
    pub name: String,
    /// This contact's role within the household (e.g. "Head", "Spouse").
    #[serde(default, deserialize_with = "null_to_default")]
    pub title: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub members: Vec<CrmHouseholdMember>,
}

impl CrmHouseholdRef {
    pub fn crm_key(&self) -> String {
        provider_prefixed_external_id(self.source_provider, &self.external_id)
            .unwrap_or_else(|| self.id.to_string())
    }
}

// ---------------------------------------------------------------------------
// Address / email / phone sub-structs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct CrmStreetAddress {
    #[serde(default, deserialize_with = "null_to_default")]
    pub address: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub city: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub state: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub zip: String,
    /// Kind label (e.g. "Home", "Work").
    #[serde(default, deserialize_with = "null_to_default")]
    pub kind: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub principal: bool,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct CrmEmailAddress {
    #[serde(default, deserialize_with = "null_to_default")]
    pub address: String,
    /// Kind label (e.g. "Personal", "Work").
    #[serde(default, deserialize_with = "null_to_default")]
    pub kind: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub principal: bool,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct CrmPhoneNumber {
    #[serde(default, deserialize_with = "null_to_default")]
    pub address: String,
    /// Kind label (e.g. "Cell", "Office").
    #[serde(default, deserialize_with = "null_to_default")]
    pub kind: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub principal: bool,
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/// A generic "linked to" record: the Wealthbox object (contact / note / etc.)
/// that a note, task, or event is linked to.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct CrmLink {
    #[serde(default, deserialize_with = "null_to_default")]
    pub id: i64,
    #[serde(default, deserialize_with = "null_to_default")]
    pub external_id: String,
    #[serde(skip)]
    pub source_provider: CrmRecordProvider,
    #[serde(rename = "type", default, deserialize_with = "null_to_default")]
    pub r#type: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub name: String,
}

impl CrmLink {
    pub fn crm_key(&self) -> String {
        provider_prefixed_external_id(self.source_provider, &self.external_id)
            .unwrap_or_else(|| self.id.to_string())
    }
}

/// A tag attached to a contact.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct CrmTag {
    #[serde(default, deserialize_with = "null_to_default")]
    pub id: i64,
    #[serde(default, deserialize_with = "null_to_default")]
    pub name: String,
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

/// A normalized CRM contact — `type` ∈ `person | household | organization | trust`.
///
/// Captures the client-knowledge core used by the dossier / Client Map.
/// Sensitive government-ID fields are intentionally absent (§5.5).
///
/// # Null-safety
///
/// `#[serde(default)]` on the struct handles MISSING keys (the Wealthbox API
/// omits empty fields entirely).  `#[serde(deserialize_with = "null_to_default")]`
/// on every bare `String` / `Vec<…>` field handles keys that are present but
/// explicitly `null` — as the live API sends on household-type contacts that
/// omit person-only fields.  `Option<…>` fields already tolerate null.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct CrmContact {
    pub id: i64,
    #[serde(default, deserialize_with = "null_to_default")]
    pub external_id: String,
    #[serde(skip)]
    pub source_provider: CrmRecordProvider,
    #[serde(rename = "type", default, deserialize_with = "null_to_default")]
    pub r#type: String,

    // ── display name (household contacts) ────────────────────────────────────
    /// Top-level `name` field returned by the live API on household contacts
    /// (e.g. `"Ellison, Robert & Margaret"`).  Empty on person/org/trust contacts.
    #[serde(default, deserialize_with = "null_to_default")]
    pub name: String,

    // ── identity ─────────────────────────────────────────────────────────────
    #[serde(default, deserialize_with = "null_to_default")]
    pub first_name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub middle_name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub last_name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub nickname: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub prefix: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub suffix: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub company_name: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub job_title: String,

    // ── key dates ────────────────────────────────────────────────────────────
    pub birth_date: Option<String>,
    pub anniversary: Option<String>,
    pub client_since: Option<String>,
    pub retirement_date: Option<String>,
    pub date_of_death: Option<String>,

    // ── classification ───────────────────────────────────────────────────────
    #[serde(default, deserialize_with = "null_to_default")]
    pub marital_status: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub contact_type: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub status: String,
    // Wealthbox's live API returns this as `background_info`; the alias reads
    // BOTH names so the real Background text actually syncs (it was silently
    // dropping before). `background_information` stays the primary name so
    // existing fixtures/tests are unaffected.
    #[serde(
        default,
        alias = "background_info",
        deserialize_with = "null_to_default"
    )]
    pub background_information: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub important_information: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub personal_interests: String,

    // ── investment profile ───────────────────────────────────────────────────
    #[serde(default, deserialize_with = "null_to_default")]
    pub investment_objective: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub time_horizon: String,
    #[serde(default, deserialize_with = "null_to_default")]
    pub risk_tolerance: String,

    // ── financial profile (self-reported; tolerant Value to handle number/string/null) ──
    pub gross_annual_income: Option<serde_json::Value>,
    pub assets: Option<serde_json::Value>,
    pub non_liquid_assets: Option<serde_json::Value>,
    pub liabilities: Option<serde_json::Value>,
    pub adjusted_gross_income: Option<serde_json::Value>,
    pub tax_bracket: Option<serde_json::Value>,
    pub tax_year: Option<serde_json::Value>,

    // ── professional relationships (each is a contact id) ────────────────────
    pub attorney: Option<i64>,
    pub cpa: Option<i64>,
    pub doctor: Option<i64>,
    pub insurance: Option<i64>,
    pub business_manager: Option<i64>,
    pub family_officer: Option<i64>,
    pub trusted_contact: Option<i64>,

    // ── arrays ───────────────────────────────────────────────────────────────
    #[serde(default, deserialize_with = "null_to_default")]
    pub street_addresses: Vec<CrmStreetAddress>,
    #[serde(default, deserialize_with = "null_to_default")]
    pub email_addresses: Vec<CrmEmailAddress>,
    #[serde(default, deserialize_with = "null_to_default")]
    pub phone_numbers: Vec<CrmPhoneNumber>,

    // ── nested ───────────────────────────────────────────────────────────────
    /// Populated on person/trust/org contacts; `None` on household contacts.
    #[serde(default, deserialize_with = "null_id_household_to_none")]
    pub household: Option<CrmHouseholdRef>,
    #[serde(default, deserialize_with = "null_to_default")]
    pub tags: Vec<CrmTag>,
    #[serde(default, deserialize_with = "null_to_default")]
    pub contact_roles: Vec<serde_json::Value>,
}

impl CrmContact {
    /// Provider-safe CRM id used in the local store and RAG source ids.
    ///
    /// Wealthbox keeps the historical numeric id forever (for example `10001`).
    /// Providers with global string ids, such as Salesforce, must set
    /// `external_id` to a provider-prefixed value such as `sfdc:001...` so their
    /// rows can never collide with Wealthbox rows. A stray unprefixed Wealthbox
    /// `external_id` is ignored, because honoring it would shift existing
    /// `crm:<kind>:<id>` source ids and make old chunks look orphaned.
    pub fn crm_key(&self) -> String {
        provider_prefixed_external_id(self.source_provider, &self.external_id)
            .unwrap_or_else(|| self.id.to_string())
    }

    /// Returns the id of the household this contact belongs to.
    ///
    /// - For a contact whose `type` is `"household"`, returns the contact's own id.
    /// - For a member person/trust/org with a nested `household` ref, returns that ref's id.
    /// - For an unhouseholded contact, returns `None`.
    pub fn household_id(&self) -> Option<i64> {
        if self.r#type == "household" {
            Some(self.id)
        } else {
            self.household.as_ref().map(|h| h.id)
        }
    }

    pub fn household_key(&self) -> Option<String> {
        if self.r#type.eq_ignore_ascii_case("household") {
            Some(self.crm_key())
        } else {
            self.household.as_ref().map(|h| h.crm_key())
        }
    }
}

// ---------------------------------------------------------------------------
// Notes, Tasks, Events
// ---------------------------------------------------------------------------

/// A normalized CRM note. Wealthbox returns these under the JSON key
/// `"status_updates"` — not `"notes"`.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct CrmNote {
    pub id: i64,
    #[serde(default, deserialize_with = "null_to_default")]
    pub external_id: String,
    #[serde(skip)]
    pub source_provider: CrmRecordProvider,
    pub created_at: String,
    pub updated_at: String,
    pub content: String,
    pub linked_to: Vec<CrmLink>,
}

impl CrmNote {
    pub fn crm_key(&self) -> String {
        provider_prefixed_external_id(self.source_provider, &self.external_id)
            .unwrap_or_else(|| self.id.to_string())
    }
}

/// A normalized CRM task.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct CrmTask {
    pub id: i64,
    #[serde(default, deserialize_with = "null_to_default")]
    pub external_id: String,
    #[serde(skip)]
    pub source_provider: CrmRecordProvider,
    pub name: String,
    pub due_date: Option<String>,
    pub complete: bool,
    pub priority: String,
    pub description: String,
    /// Present for completeness with `CrmNote`'s same fields (used by the
    /// write path's recovery-verification time floor, `write.rs`); not
    /// otherwise rendered or synced. Defaults to "" if Wealthbox's task
    /// response doesn't carry them.
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
    pub linked_to: Vec<CrmLink>,
}

impl CrmTask {
    pub fn crm_key(&self) -> String {
        provider_prefixed_external_id(self.source_provider, &self.external_id)
            .unwrap_or_else(|| self.id.to_string())
    }
}

/// A normalized CRM calendar event.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct CrmEvent {
    pub id: i64,
    #[serde(default, deserialize_with = "null_to_default")]
    pub external_id: String,
    #[serde(skip)]
    pub source_provider: CrmRecordProvider,
    pub title: String,
    pub starts_at: String,
    pub ends_at: String,
    pub all_day: bool,
    pub location: String,
    pub description: String,
    pub linked_to: Vec<CrmLink>,
}

impl CrmEvent {
    pub fn crm_key(&self) -> String {
        provider_prefixed_external_id(self.source_provider, &self.external_id)
            .unwrap_or_else(|| self.id.to_string())
    }
}

fn provider_prefixed_external_id(
    source_provider: CrmRecordProvider,
    external_id: &str,
) -> Option<String> {
    let trimmed = external_id.trim();
    match source_provider {
        CrmRecordProvider::Salesforce if trimmed.starts_with("sfdc:") => Some(trimmed.to_string()),
        CrmRecordProvider::Redtail if trimmed.starts_with("redtail:") => Some(trimmed.to_string()),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Tests — no network, fixture JSON only
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn background_info_alias_populates_background_information() {
        // The live Wealthbox API returns this field as `background_info`, not the
        // documented `background_information`. The serde alias must accept it so
        // the real Background text is not silently dropped on sync.
        let json =
            r#"{ "id": 42, "type": "person", "background_info": "Loyal client; prefers email." }"#;
        let c: CrmContact = serde_json::from_str(json).expect("parse contact with background_info");
        assert_eq!(c.background_information, "Loyal client; prefers email.");

        // The documented primary name must still parse (no fixture/test breakage).
        let json2 = r#"{ "id": 43, "type": "person", "background_information": "Primary name still works." }"#;
        let c2: CrmContact =
            serde_json::from_str(json2).expect("parse with background_information");
        assert_eq!(c2.background_information, "Primary name still works.");
    }

    #[test]
    fn wealthbox_contact_with_stray_external_id_keeps_legacy_numeric_crm_key() {
        let contact = CrmContact {
            id: 10002,
            external_id: "sfdc:evil".to_string(),
            r#type: "person".to_string(),
            ..Default::default()
        };

        assert_eq!(
            contact.crm_key(),
            "10002",
            "Wealthbox source ids must stay crm:<kind>:<legacy-id> even if the API adds external_id"
        );
    }

    #[test]
    fn provider_prefixed_external_id_is_used_for_salesforce_and_redtail() {
        let salesforce = CrmContact {
            id: 42,
            external_id: "sfdc:003CC0000000002AAA".to_string(),
            source_provider: CrmRecordProvider::Salesforce,
            ..Default::default()
        };
        let redtail = CrmContact {
            id: 43,
            external_id: "redtail:contact:123".to_string(),
            source_provider: CrmRecordProvider::Redtail,
            ..Default::default()
        };

        assert_eq!(salesforce.crm_key(), "sfdc:003CC0000000002AAA");
        assert_eq!(redtail.crm_key(), "redtail:contact:123");
    }

    // ── realistic fixture JSON (shaped like documented Wealthbox responses) ──

    /// A contacts page containing one household and one person member.
    /// The person carries a full nested household ref, financial profile,
    /// professional pointers, and address/email/phone arrays.
    const CONTACTS_FIXTURE: &str = r#"{
  "contacts": [
    {
      "id": 10001,
      "type": "household",
      "company_name": "The Andersons",
      "contact_type": "Client",
      "status": "Active",
      "tags": [],
      "street_addresses": [],
      "email_addresses": [],
      "phone_numbers": [],
      "contact_roles": []
    },
    {
      "id": 10002,
      "type": "person",
      "first_name": "Robert",
      "last_name": "Anderson",
      "birth_date": "1965-04-12",
      "client_since": "2018-01-15",
      "marital_status": "Married",
      "contact_type": "Client",
      "status": "Active",
      "risk_tolerance": "Moderate",
      "investment_objective": "Growth",
      "time_horizon": "Long-term",
      "gross_annual_income": 320000,
      "assets": 4200000,
      "liabilities": 850000,
      "background_information": "Retired engineer, active in the local community.",
      "attorney": 20001,
      "cpa": 20002,
      "household": {
        "id": 10001,
        "name": "The Andersons",
        "title": "Head",
        "members": [
          { "id": 10002, "first_name": "Robert", "last_name": "Anderson", "title": "Head",   "type": "person" },
          { "id": 10003, "first_name": "Linda",  "last_name": "Anderson", "title": "Spouse", "type": "person" }
        ]
      },
      "tags": [{ "id": 1, "name": "VIP" }],
      "street_addresses": [
        { "address": "123 Oak Lane", "city": "Denver", "state": "CO", "zip": "80201", "kind": "Home", "principal": true }
      ],
      "email_addresses": [
        { "address": "robert@andersonfamily.com", "kind": "Personal", "principal": true }
      ],
      "phone_numbers": [
        { "address": "555-100-2000", "kind": "Cell", "principal": true }
      ],
      "contact_roles": []
    }
  ]
}"#;

    /// Notes page.  Note: the API key is `status_updates`, not `notes`.
    const NOTES_FIXTURE: &str = r#"{
  "status_updates": [
    {
      "id": 30001,
      "created_at": "2026-03-10 09:15 AM -0500",
      "updated_at": "2026-03-10 09:15 AM -0500",
      "content": "Reviewed Q1 portfolio allocations with Robert. Discussed rebalancing RSUs.",
      "linked_to": [
        { "id": 10002, "type": "contact", "name": "Robert Anderson" }
      ]
    }
  ]
}"#;

    /// Tasks page.
    const TASKS_FIXTURE: &str = r#"{
  "tasks": [
    {
      "id": 40001,
      "name": "Consolidate inherited IRA",
      "due_date": "2026-12-31",
      "complete": false,
      "priority": "High",
      "description": "Roll Linda's inherited IRA from her mother into the existing rollover IRA before year-end.",
      "linked_to": [
        { "id": 10001, "type": "contact", "name": "The Andersons" }
      ]
    }
  ]
}"#;

    /// Events page.
    const EVENTS_FIXTURE: &str = r#"{
  "events": [
    {
      "id": 50001,
      "title": "Annual Review — Andersons",
      "starts_at": "2026-07-15 10:00 AM -0600",
      "ends_at":   "2026-07-15 11:00 AM -0600",
      "all_day": false,
      "location": "Advisor Office",
      "description": "Comprehensive annual review including tax-loss harvest discussion.",
      "linked_to": [
        { "id": 10001, "type": "contact", "name": "The Andersons" }
      ]
    }
  ]
}"#;

    // ── helpers ──────────────────────────────────────────────────────────────

    fn parse_contacts() -> Vec<CrmContact> {
        let v: serde_json::Value = serde_json::from_str(CONTACTS_FIXTURE).unwrap();
        serde_json::from_value(v["contacts"].clone()).unwrap()
    }

    // ── contact + household member tests ─────────────────────────────────────

    #[test]
    fn parses_household_contact() {
        let contacts = parse_contacts();
        let hh = contacts.iter().find(|c| c.id == 10001).unwrap();
        assert_eq!(hh.r#type, "household");
        assert_eq!(hh.company_name, "The Andersons");
        assert_eq!(hh.contact_type, "Client");
        // household_id() for a household contact returns its own id
        assert_eq!(hh.household_id(), Some(10001));
        // no nested household ref on a household contact
        assert!(hh.household.is_none());
    }

    #[test]
    fn parses_person_contact_and_household_members() {
        let contacts = parse_contacts();
        let person = contacts.iter().find(|c| c.id == 10002).unwrap();
        assert_eq!(person.r#type, "person");
        assert_eq!(person.first_name, "Robert");
        assert_eq!(person.last_name, "Anderson");

        let hh_ref = person.household.as_ref().unwrap();
        assert_eq!(hh_ref.id, 10001);
        assert_eq!(hh_ref.name, "The Andersons");
        assert_eq!(hh_ref.title, "Head");
        assert_eq!(hh_ref.members.len(), 2);
        assert_eq!(hh_ref.members[0].title, "Head");
        assert_eq!(hh_ref.members[0].first_name, "Robert");
        assert_eq!(hh_ref.members[1].title, "Spouse");
        assert_eq!(hh_ref.members[1].first_name, "Linda");
    }

    #[test]
    fn household_id_helper_for_person_returns_household_id() {
        let contacts = parse_contacts();
        let person = contacts.iter().find(|c| c.id == 10002).unwrap();
        assert_eq!(person.household_id(), Some(10001));
    }

    #[test]
    fn household_id_helper_for_orphan_person_returns_none() {
        let p = CrmContact {
            id: 42,
            r#type: "person".to_string(),
            household: None,
            ..Default::default()
        };
        assert_eq!(p.household_id(), None);
    }

    // ── financial profile tests ───────────────────────────────────────────────

    #[test]
    fn parses_financial_fields_as_json_values() {
        let contacts = parse_contacts();
        let person = contacts.iter().find(|c| c.id == 10002).unwrap();
        assert_eq!(person.risk_tolerance, "Moderate");
        assert_eq!(person.investment_objective, "Growth");
        assert_eq!(person.time_horizon, "Long-term");

        let income = person.gross_annual_income.as_ref().unwrap();
        assert_eq!(income.as_f64().unwrap(), 320_000.0);
        let assets = person.assets.as_ref().unwrap();
        assert_eq!(assets.as_f64().unwrap(), 4_200_000.0);
        let liabilities = person.liabilities.as_ref().unwrap();
        assert_eq!(liabilities.as_f64().unwrap(), 850_000.0);
    }

    #[test]
    fn parses_professional_relationship_ids() {
        let contacts = parse_contacts();
        let person = contacts.iter().find(|c| c.id == 10002).unwrap();
        assert_eq!(person.attorney, Some(20001));
        assert_eq!(person.cpa, Some(20002));
        assert!(person.doctor.is_none());
    }

    #[test]
    fn parses_address_email_phone_arrays() {
        let contacts = parse_contacts();
        let person = contacts.iter().find(|c| c.id == 10002).unwrap();
        assert_eq!(person.street_addresses.len(), 1);
        assert_eq!(person.street_addresses[0].city, "Denver");
        assert_eq!(person.street_addresses[0].state, "CO");
        assert!(person.street_addresses[0].principal);

        assert_eq!(person.email_addresses.len(), 1);
        assert_eq!(
            person.email_addresses[0].address,
            "robert@andersonfamily.com"
        );
        assert!(person.email_addresses[0].principal);

        assert_eq!(person.phone_numbers.len(), 1);
        assert_eq!(person.phone_numbers[0].address, "555-100-2000");
        assert_eq!(person.phone_numbers[0].kind, "Cell");
    }

    // ── notes (status_updates key) test ──────────────────────────────────────

    #[test]
    fn parses_notes_from_status_updates_key() {
        let v: serde_json::Value = serde_json::from_str(NOTES_FIXTURE).unwrap();
        // Must use "status_updates" — not "notes" — as the JSON key.
        let notes: Vec<CrmNote> = serde_json::from_value(v["status_updates"].clone()).unwrap();
        assert_eq!(notes.len(), 1);
        let note = &notes[0];
        assert_eq!(note.id, 30001);
        assert!(note.content.contains("Q1 portfolio"));
        assert_eq!(note.linked_to.len(), 1);
        assert_eq!(note.linked_to[0].id, 10002);
        assert_eq!(note.linked_to[0].r#type, "contact");
    }

    // ── tasks test ────────────────────────────────────────────────────────────

    #[test]
    fn parses_tasks_fixture() {
        let v: serde_json::Value = serde_json::from_str(TASKS_FIXTURE).unwrap();
        let tasks: Vec<CrmTask> = serde_json::from_value(v["tasks"].clone()).unwrap();
        assert_eq!(tasks.len(), 1);
        let task = &tasks[0];
        assert_eq!(task.id, 40001);
        assert_eq!(task.name, "Consolidate inherited IRA");
        assert!(!task.complete);
        assert_eq!(task.priority, "High");
        assert_eq!(task.due_date.as_deref(), Some("2026-12-31"));
        assert_eq!(task.linked_to.len(), 1);
        assert_eq!(task.linked_to[0].id, 10001);
    }

    // ── events test ───────────────────────────────────────────────────────────

    #[test]
    fn parses_events_fixture() {
        let v: serde_json::Value = serde_json::from_str(EVENTS_FIXTURE).unwrap();
        let events: Vec<CrmEvent> = serde_json::from_value(v["events"].clone()).unwrap();
        assert_eq!(events.len(), 1);
        let event = &events[0];
        assert_eq!(event.id, 50001);
        assert_eq!(event.title, "Annual Review — Andersons");
        assert!(!event.all_day);
        assert_eq!(event.location, "Advisor Office");
        assert_eq!(event.linked_to[0].id, 10001);
    }

    // ── tolerance / defaults test ─────────────────────────────────────────────

    #[test]
    fn tolerates_minimal_contact_with_missing_optional_fields() {
        // The API omits empty/null fields — serde(default) must handle this.
        let json = r#"{ "id": 7, "type": "person", "first_name": "Alice" }"#;
        let c: CrmContact = serde_json::from_str(json).unwrap();
        assert_eq!(c.id, 7);
        assert_eq!(c.first_name, "Alice");
        assert_eq!(c.last_name, "");
        assert!(c.gross_annual_income.is_none());
        assert!(c.attorney.is_none());
        assert!(c.tags.is_empty());
        assert!(c.household.is_none());
        assert_eq!(c.household_id(), None);
    }

    // ── null-field tolerance (the DEMO-BLOCKER fix) ───────────────────────────

    /// Household contacts from the live Wealthbox API:
    ///  - carry a top-level `name` field (e.g. "Ellison, Robert & Margaret")
    ///  - omit person-only fields entirely (handled by `#[serde(default)]`)
    ///  - send some shared fields as explicit `null` rather than absent
    ///
    /// `#[serde(default)]` on the struct does NOT cover present-null — serde
    /// still tries to deserialize `null` into `String` or `Vec<T>` and fails
    /// with "invalid type: null, expected …".  The `null_to_default` helper
    /// (paired with `#[serde(deserialize_with)]` on each bare field) is the
    /// complete fix: null → `Default::default()` for both String and Vec types.
    #[test]
    fn household_with_null_fields_and_top_level_name_parses_correctly() {
        // Shape of a real Wealthbox household-type contact response.
        // Without the null_to_default fix, `"background_info": null` would fail
        // with `invalid type: null, expected a string`, and
        // `"email_addresses": null` would fail with
        // `invalid type: null, expected a sequence`.
        let json = r#"{
            "id": 20001,
            "type": "household",
            "name": "Ellison, Robert & Margaret",
            "background_info": null,
            "email_addresses": null,
            "company_name": null,
            "contact_type": "Client",
            "status": "Active",
            "tags": [],
            "members": []
        }"#;

        let c: CrmContact = serde_json::from_str(json)
            .expect("household contact with explicit null fields must parse without error");

        // Type and top-level name field are captured.
        assert_eq!(c.r#type, "household");
        assert_eq!(
            c.name, "Ellison, Robert & Margaret",
            "top-level `name` field must be captured on household contacts"
        );

        // Explicit nulls on bare String fields become empty strings.
        assert_eq!(
            c.background_information, "",
            "null background_info must deserialize to empty string, not error"
        );
        assert_eq!(
            c.company_name, "",
            "null company_name must deserialize to empty string, not error"
        );

        // Explicit null on a Vec field becomes an empty vec.
        assert!(
            c.email_addresses.is_empty(),
            "null email_addresses must deserialize to empty vec, not error"
        );

        // household_id() for a household-type contact returns its own id.
        assert_eq!(c.household_id(), Some(20001));
    }

    /// The live Wealthbox account used by the packaged-build bench contains an
    /// otherwise valid person contact whose nested `household` object has
    /// `id: null`. Wealthbox uses that shape for "not assigned to a household".
    /// One unassigned contact must not abort the full household import.
    #[test]
    fn contact_with_null_nested_household_id_parses_as_unassigned() {
        let json = r#"{
            "id": 20002,
            "type": "person",
            "first_name": "Avery",
            "last_name": "Example",
            "household": {
                "id": null,
                "external_id": null,
                "name": null,
                "title": null,
                "members": null
            }
        }"#;

        let contact: CrmContact = serde_json::from_str(json)
            .expect("an unassigned contact must not abort the full Wealthbox contact page");

        assert!(
            contact.household.is_none(),
            "a null household id means the contact is not assigned to a household"
        );
        assert_eq!(contact.household_id(), None);
        assert_eq!(contact.household_key(), None);
    }
}
