//! Normalised data models for Wealthbox CRM objects.
//!
//! All structs derive `Default` and carry `#[serde(default)]` so missing or
//! null fields are tolerated gracefully — the Wealthbox API omits empty arrays
//! and optional fields entirely rather than sending `null`.
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

// ---------------------------------------------------------------------------
// Household reference (embedded inside a person contact)
// ---------------------------------------------------------------------------

/// A member of a Wealthbox household, as embedded in `WbHouseholdRef.members`.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct WbHouseholdMember {
    pub id: i64,
    pub first_name: String,
    pub last_name: String,
    /// Household title role: Head, Spouse, Partner, Child, Grandchild, etc.
    pub title: String,
    /// Contact type for this member (person / organization / trust).
    #[serde(rename = "type")]
    pub r#type: String,
}

/// The nested `household` object carried on a person/trust/org contact.
/// Tells us which household the contact belongs to and lists all members.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct WbHouseholdRef {
    pub id: i64,
    pub name: String,
    /// This contact's role within the household (e.g. "Head", "Spouse").
    pub title: String,
    pub members: Vec<WbHouseholdMember>,
}

// ---------------------------------------------------------------------------
// Address / email / phone sub-structs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct WbStreetAddress {
    pub address: String,
    pub city: String,
    pub state: String,
    pub zip: String,
    /// Kind label (e.g. "Home", "Work").
    pub kind: String,
    pub principal: bool,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct WbEmailAddress {
    pub address: String,
    /// Kind label (e.g. "Personal", "Work").
    pub kind: String,
    pub principal: bool,
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct WbPhoneNumber {
    pub address: String,
    /// Kind label (e.g. "Cell", "Office").
    pub kind: String,
    pub principal: bool,
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/// A generic "linked to" record: the Wealthbox object (contact / note / etc.)
/// that a note, task, or event is linked to.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct WbLink {
    pub id: i64,
    #[serde(rename = "type")]
    pub r#type: String,
    pub name: String,
}

/// A tag attached to a contact.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct WbTag {
    pub id: i64,
    pub name: String,
}

// ---------------------------------------------------------------------------
// Contact
// ---------------------------------------------------------------------------

/// A Wealthbox contact — `type` ∈ `person | household | organization | trust`.
///
/// Captures the client-knowledge core used by the dossier / Client Map.
/// Sensitive government-ID fields are intentionally absent (§5.5).
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct WbContact {
    pub id: i64,
    #[serde(rename = "type")]
    pub r#type: String,

    // ── identity ─────────────────────────────────────────────────────────────
    pub first_name: String,
    pub middle_name: String,
    pub last_name: String,
    pub nickname: String,
    pub prefix: String,
    pub suffix: String,
    pub company_name: String,
    pub job_title: String,

    // ── key dates ────────────────────────────────────────────────────────────
    pub birth_date: Option<String>,
    pub anniversary: Option<String>,
    pub client_since: Option<String>,
    pub retirement_date: Option<String>,
    pub date_of_death: Option<String>,

    // ── classification ───────────────────────────────────────────────────────
    pub marital_status: String,
    pub contact_type: String,
    pub status: String,
    // Wealthbox's live API returns this as `background_info`; the alias reads
    // BOTH names so the real Background text actually syncs (it was silently
    // dropping before). `background_information` stays the primary name so
    // existing fixtures/tests are unaffected.
    #[serde(alias = "background_info")]
    pub background_information: String,
    pub important_information: String,
    pub personal_interests: String,

    // ── investment profile ───────────────────────────────────────────────────
    pub investment_objective: String,
    pub time_horizon: String,
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
    pub street_addresses: Vec<WbStreetAddress>,
    pub email_addresses: Vec<WbEmailAddress>,
    pub phone_numbers: Vec<WbPhoneNumber>,

    // ── nested ───────────────────────────────────────────────────────────────
    /// Populated on person/trust/org contacts; `None` on household contacts.
    pub household: Option<WbHouseholdRef>,
    pub tags: Vec<WbTag>,
    pub contact_roles: Vec<serde_json::Value>,
}

impl WbContact {
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
}

// ---------------------------------------------------------------------------
// Notes, Tasks, Events
// ---------------------------------------------------------------------------

/// A Wealthbox note.  The REST API returns these under the JSON key
/// `"status_updates"` — not `"notes"`.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct WbNote {
    pub id: i64,
    pub created_at: String,
    pub updated_at: String,
    pub content: String,
    pub linked_to: Vec<WbLink>,
}

/// A Wealthbox task.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct WbTask {
    pub id: i64,
    pub name: String,
    pub due_date: Option<String>,
    pub complete: bool,
    pub priority: String,
    pub description: String,
    pub linked_to: Vec<WbLink>,
}

/// A Wealthbox calendar event.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize, Default, PartialEq)]
#[serde(default)]
pub struct WbEvent {
    pub id: i64,
    pub title: String,
    pub starts_at: String,
    pub ends_at: String,
    pub all_day: bool,
    pub location: String,
    pub description: String,
    pub linked_to: Vec<WbLink>,
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
        let json = r#"{ "id": 42, "type": "person", "background_info": "Loyal client; prefers email." }"#;
        let c: WbContact = serde_json::from_str(json).expect("parse contact with background_info");
        assert_eq!(c.background_information, "Loyal client; prefers email.");

        // The documented primary name must still parse (no fixture/test breakage).
        let json2 = r#"{ "id": 43, "type": "person", "background_information": "Primary name still works." }"#;
        let c2: WbContact = serde_json::from_str(json2).expect("parse with background_information");
        assert_eq!(c2.background_information, "Primary name still works.");
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

    fn parse_contacts() -> Vec<WbContact> {
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
        let p = WbContact {
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
        assert_eq!(person.email_addresses[0].address, "robert@andersonfamily.com");
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
        let notes: Vec<WbNote> = serde_json::from_value(v["status_updates"].clone()).unwrap();
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
        let tasks: Vec<WbTask> = serde_json::from_value(v["tasks"].clone()).unwrap();
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
        let events: Vec<WbEvent> = serde_json::from_value(v["events"].clone()).unwrap();
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
        let c: WbContact = serde_json::from_str(json).unwrap();
        assert_eq!(c.id, 7);
        assert_eq!(c.first_name, "Alice");
        assert_eq!(c.last_name, "");
        assert!(c.gross_annual_income.is_none());
        assert!(c.attorney.is_none());
        assert!(c.tags.is_empty());
        assert!(c.household.is_none());
        assert_eq!(c.household_id(), None);
    }
}
