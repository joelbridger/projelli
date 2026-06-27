//! CRM text renderer — turns normalised CRM model structs into the
//! readable text that the RAG engine indexes.
//!
//! All functions are pure (no network, no disk) and return a
//! `(source_id, text)` pair.  Missing / empty fields are simply omitted so
//! sparse objects produce clean output with no stray "Label: " lines.
//!
//! The engine (Plan 1B.4) calls these and passes the resulting text to
//! `index_crm_text_internal` for embedding + storage.

use crate::commands::crm::model::{CrmContact, CrmEvent, CrmNote, CrmTask};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Append `"label: value\n"` to `buf` only when `value` (trimmed) is non-empty.
fn append_line(buf: &mut String, label: &str, value: &str) {
    let v = value.trim();
    if !v.is_empty() {
        buf.push_str(label);
        buf.push_str(": ");
        buf.push_str(v);
        buf.push('\n');
    }
}

/// Same as `append_line` but for `Option<String>`.
fn append_opt(buf: &mut String, label: &str, value: &Option<String>) {
    if let Some(v) = value {
        append_line(buf, label, v);
    }
}

/// Format a `serde_json::Value` financial field (may be a number or a string
/// from the Wealthbox API) as a human-readable string.  Returns `None` when
/// the value is null or empty.
fn format_json_value(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::Null => None,
        serde_json::Value::Number(n) => {
            // Prefer integer display when there is no fractional part.
            if let Some(i) = n.as_i64() {
                Some(format!("{}", i))
            } else if let Some(f) = n.as_f64() {
                if f.fract() == 0.0 {
                    Some(format!("{}", f as i64))
                } else {
                    Some(format!("{:.2}", f))
                }
            } else {
                None
            }
        }
        serde_json::Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        _ => None,
    }
}

/// Append a serde_json::Value financial field, only when it is non-null /
/// non-empty.
fn append_json_val(buf: &mut String, label: &str, v: &Option<serde_json::Value>) {
    if let Some(val) = v {
        if let Some(s) = format_json_value(val) {
            append_line(buf, label, &s);
        }
    }
}

/// Build a display name from individual name parts, joining only those that
/// are non-empty.
fn build_full_name(prefix: &str, first: &str, middle: &str, last: &str, suffix: &str) -> String {
    let parts: Vec<&str> = [prefix, first, middle, last, suffix]
        .iter()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .collect();
    parts.join(" ")
}

// ---------------------------------------------------------------------------
// Public renderers
// ---------------------------------------------------------------------------

/// Render a single Wealthbox contact (person / org / trust) into an indexed
/// text record.
///
/// Returns `("crm:contact:<id>", text)`.
#[allow(dead_code)]
pub fn render_contact(c: &CrmContact) -> (String, String) {
    let source_id = format!("crm:contact:{}", c.crm_key());
    let full_name = build_full_name(
        &c.prefix,
        &c.first_name,
        &c.middle_name,
        &c.last_name,
        &c.suffix,
    );

    let mut text = String::new();

    // Header line
    let display_name = if !full_name.is_empty() {
        full_name
    } else if !c.company_name.trim().is_empty() {
        c.company_name.trim().to_string()
    } else {
        format!("(id {})", c.id)
    };
    text.push_str(&format!("Wealthbox contact: {}\n", display_name));

    // Identity extras
    append_line(&mut text, "Nickname", &c.nickname);
    append_line(&mut text, "Company", &c.company_name);
    append_line(&mut text, "Job title", &c.job_title);

    // Key dates
    append_opt(&mut text, "Date of birth", &c.birth_date);
    append_opt(&mut text, "Client since", &c.client_since);
    append_opt(&mut text, "Anniversary", &c.anniversary);
    append_opt(&mut text, "Retirement date", &c.retirement_date);
    append_opt(&mut text, "Date of death", &c.date_of_death);

    // Classification
    append_line(&mut text, "Contact type", &c.contact_type);
    append_line(&mut text, "Status", &c.status);
    append_line(&mut text, "Marital status", &c.marital_status);

    // Investment profile
    append_line(&mut text, "Investment objective", &c.investment_objective);
    append_line(&mut text, "Time horizon", &c.time_horizon);
    append_line(&mut text, "Risk tolerance", &c.risk_tolerance);

    // Financial profile — labelled "(self-reported)" as a section header so
    // the LLM (and tests) can distinguish it from live account data.
    let has_financials = c.gross_annual_income.is_some()
        || c.assets.is_some()
        || c.non_liquid_assets.is_some()
        || c.liabilities.is_some()
        || c.adjusted_gross_income.is_some()
        || c.tax_bracket.is_some()
        || c.tax_year.is_some();

    if has_financials {
        text.push_str("Financial profile (self-reported):\n");
        append_json_val(&mut text, "  Gross annual income", &c.gross_annual_income);
        append_json_val(&mut text, "  Assets", &c.assets);
        append_json_val(&mut text, "  Non-liquid assets", &c.non_liquid_assets);
        append_json_val(&mut text, "  Liabilities", &c.liabilities);
        append_json_val(
            &mut text,
            "  Adjusted gross income",
            &c.adjusted_gross_income,
        );
        append_json_val(&mut text, "  Tax bracket", &c.tax_bracket);
        append_json_val(&mut text, "  Tax year", &c.tax_year);
    }

    // Professional team — presence only in v1 (ids, not names).
    // TODO(resolve): show the professional's name once the CRM store can look up contact ids.
    if c.attorney.is_some() {
        text.push_str("Professional team: Has an attorney on file\n");
    }
    if c.cpa.is_some() {
        text.push_str("Professional team: Has a CPA on file\n");
    }
    if c.doctor.is_some() {
        text.push_str("Professional team: Has a doctor on file\n");
    }
    if c.insurance.is_some() {
        text.push_str("Professional team: Has an insurance professional on file\n");
    }
    if c.business_manager.is_some() {
        text.push_str("Professional team: Has a business manager on file\n");
    }
    if c.family_officer.is_some() {
        text.push_str("Professional team: Has a family officer on file\n");
    }
    if c.trusted_contact.is_some() {
        text.push_str("Professional team: Has a trusted contact on file\n");
    }

    // Primary city/state (from the principal street address, or first if none
    // is marked principal).
    let addr = c
        .street_addresses
        .iter()
        .find(|a| a.principal)
        .or_else(|| c.street_addresses.first());
    if let Some(a) = addr {
        let city_state = match (a.city.trim(), a.state.trim()) {
            ("", "") => String::new(),
            (city, "") => city.to_string(),
            ("", state) => state.to_string(),
            (city, state) => format!("{}, {}", city, state),
        };
        append_line(&mut text, "Location", &city_state);
    }

    // Primary email
    let email = c
        .email_addresses
        .iter()
        .find(|e| e.principal)
        .or_else(|| c.email_addresses.first());
    if let Some(e) = email {
        append_line(&mut text, "Email", &e.address);
    }

    // Primary phone
    let phone = c
        .phone_numbers
        .iter()
        .find(|p| p.principal)
        .or_else(|| c.phone_numbers.first());
    if let Some(p) = phone {
        let label = if p.kind.trim().is_empty() {
            "Phone".to_string()
        } else {
            format!("Phone ({})", p.kind.trim())
        };
        append_line(&mut text, &label, &p.address);
    }

    // Free-text knowledge fields
    append_line(&mut text, "Personal interests", &c.personal_interests);
    append_line(&mut text, "Background", &c.background_information);
    append_line(&mut text, "Important notes", &c.important_information);

    // Tags
    if !c.tags.is_empty() {
        let tag_names: Vec<&str> = c.tags.iter().map(|t| t.name.as_str()).collect();
        append_line(&mut text, "Tags", &tag_names.join(", "));
    }

    (source_id, text)
}

/// Render a Wealthbox note (returned by the API under the `status_updates` key).
///
/// Returns `("crm:note:<id>", text)`.
#[allow(dead_code)]
pub fn render_note(n: &CrmNote) -> (String, String) {
    let source_id = format!("crm:note:{}", n.crm_key());

    // Prefer created_at; fall back to updated_at when created_at is blank.
    let date = if !n.created_at.trim().is_empty() {
        n.created_at.trim()
    } else {
        n.updated_at.trim()
    };

    let mut text = String::new();
    text.push_str(&format!("Wealthbox note ({}):\n", date));
    if !n.content.trim().is_empty() {
        text.push_str(n.content.trim());
        text.push('\n');
    }

    (source_id, text)
}

/// Render a Wealthbox task.
///
/// Returns `("crm:task:<id>", text)`.
#[allow(dead_code)]
pub fn render_task(t: &CrmTask) -> (String, String) {
    let source_id = format!("crm:task:{}", t.crm_key());
    let mut text = String::new();

    let header = if !t.name.trim().is_empty() {
        format!("Wealthbox task: {}\n", t.name.trim())
    } else {
        format!("Wealthbox task (id {})\n", t.id)
    };
    text.push_str(&header);

    let status = if t.complete { "Complete" } else { "Open" };
    text.push_str(&format!("Status: {}\n", status));

    append_opt(&mut text, "Due date", &t.due_date);
    append_line(&mut text, "Priority", &t.priority);
    append_line(&mut text, "Description", &t.description);

    (source_id, text)
}

/// Render a Wealthbox calendar event.
///
/// Returns `("crm:event:<id>", text)`.
#[allow(dead_code)]
pub fn render_event(e: &CrmEvent) -> (String, String) {
    let source_id = format!("crm:event:{}", e.crm_key());
    let mut text = String::new();

    let header = if !e.title.trim().is_empty() {
        format!("Wealthbox event: {}\n", e.title.trim())
    } else {
        format!("Wealthbox event (id {})\n", e.id)
    };
    text.push_str(&header);

    if e.all_day {
        append_line(&mut text, "Date", &e.starts_at);
        text.push_str("All-day: Yes\n");
    } else {
        append_line(&mut text, "Start", &e.starts_at);
        append_line(&mut text, "End", &e.ends_at);
    }

    append_line(&mut text, "Location", &e.location);
    append_line(&mut text, "Description", &e.description);

    (source_id, text)
}

/// Render a concise household summary for the Client Map's story / standing
/// sections.
///
/// `household` must be the household-type `CrmContact` (its `id` is used as
/// the household id).  `members` are the full per-person contacts that belong
/// to this household (already fetched from the CRM store).
///
/// Returns `("crm:household:<id>", text)`.
#[allow(dead_code)]
pub fn render_household_summary(
    household: &CrmContact,
    members: &[CrmContact],
) -> (String, String) {
    let source_id = format!("crm:household:{}", household.crm_key());
    let mut text = String::new();

    // Household name priority:
    //  1. `name` — the top-level field the live API returns on household contacts
    //     (e.g. "Ellison, Robert & Margaret").  This is the most specific source.
    //  2. `company_name` — the fallback used by legacy fixtures and advisors who
    //     store the household name there.
    //  3. Constructed from the first member's last name + " Household".
    //  4. Generic "(id N)" fallback when nothing else is available.
    let hh_name = if !household.name.trim().is_empty() {
        household.name.trim().to_string()
    } else if !household.company_name.trim().is_empty() {
        household.company_name.trim().to_string()
    } else if let Some(m) = members.first() {
        let last = m.last_name.trim();
        if !last.is_empty() {
            format!("{} Household", last)
        } else {
            format!("Household (id {})", household.id)
        }
    } else {
        format!("Household (id {})", household.id)
    };

    text.push_str(&format!("Household: {}\n", hh_name));
    append_line(&mut text, "Contact type", &household.contact_type);
    append_line(&mut text, "Status", &household.status);

    // Members — name, household title, birth year.
    if !members.is_empty() {
        text.push_str("Members:\n");
        for member in members {
            let name = build_full_name(
                &member.prefix,
                &member.first_name,
                &member.middle_name,
                &member.last_name,
                &member.suffix,
            );
            // Each member's household title lives in their own nested
            // CrmHouseholdRef (the title field is "this member's role").
            let title = member
                .household
                .as_ref()
                .map(|h| h.title.as_str())
                .unwrap_or("");
            // Birth year: take the first 4 characters of birth_date.
            let birth_year = member
                .birth_date
                .as_deref()
                .and_then(|d| d.get(..4))
                .filter(|y| !y.is_empty());

            let mut member_line = format!("  - {}", name);
            if !title.is_empty() {
                member_line.push_str(&format!(" ({})", title));
            }
            if let Some(yr) = birth_year {
                member_line.push_str(&format!(", born {}", yr));
            }
            text.push_str(&member_line);
            text.push('\n');
        }
    }

    // Headline financial picture.  First try the household contact itself (some
    // advisors enter aggregate figures there); if absent, aggregate from members.
    let hh_has_financials = household.gross_annual_income.is_some()
        || household.assets.is_some()
        || household.non_liquid_assets.is_some()
        || household.liabilities.is_some()
        || household.adjusted_gross_income.is_some();

    if hh_has_financials {
        text.push_str("Financial picture (self-reported):\n");
        append_json_val(
            &mut text,
            "  Gross annual income",
            &household.gross_annual_income,
        );
        append_json_val(&mut text, "  Assets", &household.assets);
        append_json_val(
            &mut text,
            "  Non-liquid assets",
            &household.non_liquid_assets,
        );
        append_json_val(&mut text, "  Liabilities", &household.liabilities);
        append_json_val(
            &mut text,
            "  Adjusted gross income",
            &household.adjusted_gross_income,
        );
    } else {
        // Fall back: sum each member's self-reported figures.
        let agg_assets: Option<f64> = members
            .iter()
            .filter_map(|m| m.assets.as_ref())
            .filter_map(|v| v.as_f64())
            .reduce(|a, b| a + b);
        let agg_liabilities: Option<f64> = members
            .iter()
            .filter_map(|m| m.liabilities.as_ref())
            .filter_map(|v| v.as_f64())
            .reduce(|a, b| a + b);

        if agg_assets.is_some() || agg_liabilities.is_some() {
            // Keep "(self-reported)" as a top-level label so citations are clear;
            // note that figures are summed from the member contacts.
            text.push_str("Financial picture (self-reported):\n");
            text.push_str("  (Figures aggregated from member contacts.)\n");
            if let Some(a) = agg_assets {
                append_line(&mut text, "  Total assets", &format!("{}", a as i64));
            }
            if let Some(l) = agg_liabilities {
                append_line(&mut text, "  Total liabilities", &format!("{}", l as i64));
            }
        }
    }

    // Professional team — union across the household contact + all members.
    // TODO(resolve): show each professional's name once the CRM store supports id → name lookup.
    let mut pro_set: Vec<&str> = Vec::new();
    let all = std::iter::once(household).chain(members.iter());
    for c in all {
        if c.attorney.is_some() && !pro_set.contains(&"attorney") {
            pro_set.push("attorney");
        }
        if c.cpa.is_some() && !pro_set.contains(&"CPA") {
            pro_set.push("CPA");
        }
        if c.doctor.is_some() && !pro_set.contains(&"doctor") {
            pro_set.push("doctor");
        }
        if c.insurance.is_some() && !pro_set.contains(&"insurance") {
            pro_set.push("insurance");
        }
        if c.business_manager.is_some() && !pro_set.contains(&"business manager") {
            pro_set.push("business manager");
        }
        if c.family_officer.is_some() && !pro_set.contains(&"family officer") {
            pro_set.push("family officer");
        }
        if c.trusted_contact.is_some() && !pro_set.contains(&"trusted contact") {
            pro_set.push("trusted contact");
        }
    }
    if !pro_set.is_empty() {
        append_line(&mut text, "Professional team on file", &pro_set.join(", "));
    }

    // Key dates: client_since from the household contact or the earliest member
    // that has one.
    let client_since = household.client_since.as_deref().or_else(|| {
        members
            .iter()
            .filter_map(|m| m.client_since.as_deref())
            .next()
    });
    if let Some(cs) = client_since {
        append_line(&mut text, "Client since", cs);
    }

    (source_id, text)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::crm::model::{
        CrmContact, CrmEmailAddress, CrmEvent, CrmHouseholdRef, CrmNote, CrmPhoneNumber,
        CrmStreetAddress, CrmTag, CrmTask,
    };

    // ── fixture helpers ───────────────────────────────────────────────────────

    fn fixture_household() -> CrmContact {
        CrmContact {
            id: 10001,
            r#type: "household".to_string(),
            company_name: "The Andersons".to_string(),
            contact_type: "Client".to_string(),
            status: "Active".to_string(),
            ..Default::default()
        }
    }

    fn fixture_head() -> CrmContact {
        CrmContact {
            id: 10002,
            r#type: "person".to_string(),
            first_name: "Robert".to_string(),
            last_name: "Anderson".to_string(),
            birth_date: Some("1965-04-12".to_string()),
            client_since: Some("2018-01-15".to_string()),
            marital_status: "Married".to_string(),
            contact_type: "Client".to_string(),
            status: "Active".to_string(),
            risk_tolerance: "Moderate".to_string(),
            investment_objective: "Growth".to_string(),
            time_horizon: "Long-term".to_string(),
            gross_annual_income: Some(serde_json::Value::Number(serde_json::Number::from(
                320_000_i64,
            ))),
            assets: Some(serde_json::Value::Number(serde_json::Number::from(
                4_200_000_i64,
            ))),
            liabilities: Some(serde_json::Value::Number(serde_json::Number::from(
                850_000_i64,
            ))),
            background_information: "Retired engineer, active in the local community.".to_string(),
            attorney: Some(20001),
            cpa: Some(20002),
            household: Some(CrmHouseholdRef {
                id: 10001,
                external_id: String::new(),
                name: "The Andersons".to_string(),
                title: "Head".to_string(),
                members: vec![],
            }),
            tags: vec![CrmTag {
                id: 1,
                name: "VIP".to_string(),
            }],
            street_addresses: vec![CrmStreetAddress {
                address: "123 Oak Lane".to_string(),
                city: "Denver".to_string(),
                state: "CO".to_string(),
                zip: "80201".to_string(),
                kind: "Home".to_string(),
                principal: true,
            }],
            email_addresses: vec![CrmEmailAddress {
                address: "robert@andersonfamily.com".to_string(),
                kind: "Personal".to_string(),
                principal: true,
            }],
            phone_numbers: vec![CrmPhoneNumber {
                address: "555-100-2000".to_string(),
                kind: "Cell".to_string(),
                principal: true,
            }],
            ..Default::default()
        }
    }

    fn fixture_spouse() -> CrmContact {
        CrmContact {
            id: 10003,
            r#type: "person".to_string(),
            first_name: "Linda".to_string(),
            last_name: "Anderson".to_string(),
            birth_date: Some("1968-09-20".to_string()),
            contact_type: "Client".to_string(),
            status: "Active".to_string(),
            household: Some(CrmHouseholdRef {
                id: 10001,
                external_id: String::new(),
                name: "The Andersons".to_string(),
                title: "Spouse".to_string(),
                members: vec![],
            }),
            ..Default::default()
        }
    }

    // ── render_household_summary ─────────────────────────────────────────────

    #[test]
    fn household_summary_contains_name_members_financials_self_reported() {
        let hh = fixture_household();
        let head = fixture_head();
        let spouse = fixture_spouse();
        let members = vec![head.clone(), spouse.clone()];

        let (source_id, text) = render_household_summary(&hh, &members);

        assert_eq!(source_id, "crm:household:10001");
        assert!(
            text.contains("The Andersons"),
            "should contain household name"
        );
        assert!(
            text.contains("Robert Anderson"),
            "should contain head's name"
        );
        assert!(
            text.contains("Linda Anderson"),
            "should contain spouse's name"
        );
        // Head has assets = 4_200_000.
        assert!(
            text.contains("4200000") || text.contains("4,200,000"),
            "should contain assets figure"
        );
        assert!(
            text.contains("(self-reported)"),
            "should label financials as self-reported; actual text:\n{}",
            text
        );
    }

    // ── render_household_summary with live-API `name` field ─────────────────

    #[test]
    fn household_summary_prefers_name_field_over_company_name() {
        // Simulates a household contact as returned by the live Wealthbox API:
        // `name` is set to the formatted household display name; `company_name`
        // is absent (defaults to "").  The rendered summary must use `name`.
        let hh = CrmContact {
            id: 20001,
            r#type: "household".to_string(),
            name: "Ellison, Robert & Margaret".to_string(),
            // company_name intentionally empty — as it arrives from the live API
            company_name: "".to_string(),
            contact_type: "Client".to_string(),
            status: "Active".to_string(),
            ..Default::default()
        };

        let (source_id, text) = render_household_summary(&hh, &[]);

        assert_eq!(source_id, "crm:household:20001");
        assert!(
            text.contains("Ellison, Robert & Margaret"),
            "rendered summary must use the top-level `name` field; got:\n{}",
            text
        );
        assert!(
            !text.contains("Household (id 20001)"),
            "must not fall back to the generic id label when `name` is set; got:\n{}",
            text
        );
    }

    // ── render_contact (head) ────────────────────────────────────────────────

    #[test]
    fn contact_contains_name_risk_assets_self_reported() {
        let head = fixture_head();
        let (source_id, text) = render_contact(&head);

        assert_eq!(source_id, "crm:contact:10002");
        assert!(text.contains("Robert Anderson"), "should contain full name");
        assert!(text.contains("Moderate"), "should contain risk tolerance");
        assert!(
            text.contains("4200000") || text.contains("4,200,000"),
            "should contain assets figure"
        );
        assert!(
            text.contains("(self-reported)"),
            "should label financials as self-reported"
        );
    }

    #[test]
    fn contact_does_not_contain_sensitive_govt_ids() {
        // Sensitive government IDs (passport, SSN, driver's license, green card) are
        // deliberately absent from the CrmContact model (§5.5 Reg S-P).
        // Verify the rendered text never mentions them.
        let head = fixture_head();
        let (_, text) = render_contact(&head);
        let lower = text.to_lowercase();
        assert!(
            !lower.contains("passport"),
            "must not render passport number"
        );
        assert!(
            !lower.contains("ssn"),
            "must not render social security number"
        );
        assert!(
            !lower.contains("social security"),
            "must not render SSN label"
        );
        assert!(
            !lower.contains("driver"),
            "must not render driver's license"
        );
        assert!(!lower.contains("green card"), "must not render green card");
    }

    // ── render_note ───────────────────────────────────────────────────────────

    #[test]
    fn note_contains_date_and_content() {
        let note = CrmNote {
            id: 30001,
            created_at: "2026-03-10 09:15 AM -0500".to_string(),
            updated_at: "2026-03-10 09:15 AM -0500".to_string(),
            content: "Reviewed Q1 portfolio allocations with Robert. Discussed rebalancing RSUs."
                .to_string(),
            ..Default::default()
        };

        let (source_id, text) = render_note(&note);
        assert_eq!(source_id, "crm:note:30001");
        assert!(text.contains("2026-03-10"), "should contain the date");
        assert!(
            text.contains("Q1 portfolio"),
            "should contain the note content"
        );
    }

    // ── render_task ───────────────────────────────────────────────────────────

    #[test]
    fn task_contains_key_fields() {
        let task = CrmTask {
            id: 40001,
            name: "Consolidate inherited IRA".to_string(),
            due_date: Some("2026-12-31".to_string()),
            complete: false,
            priority: "High".to_string(),
            description: "Roll Linda's inherited IRA from her mother before year-end.".to_string(),
            ..Default::default()
        };

        let (source_id, text) = render_task(&task);
        assert_eq!(source_id, "crm:task:40001");
        assert!(
            text.contains("Consolidate inherited IRA"),
            "should contain task name"
        );
        assert!(text.contains("2026-12-31"), "should contain due date");
        assert!(text.contains("Open"), "should show open status");
        assert!(text.contains("High"), "should contain priority");
        assert!(
            text.contains("Roll Linda"),
            "should contain description text"
        );
    }

    // ── render_event ─────────────────────────────────────────────────────────

    #[test]
    fn event_contains_key_fields() {
        let event = CrmEvent {
            id: 50001,
            title: "Annual Review — Andersons".to_string(),
            starts_at: "2026-07-15 10:00 AM -0600".to_string(),
            ends_at: "2026-07-15 11:00 AM -0600".to_string(),
            all_day: false,
            location: "Advisor Office".to_string(),
            description: "Comprehensive annual review including tax-loss harvest discussion."
                .to_string(),
            ..Default::default()
        };

        let (source_id, text) = render_event(&event);
        assert_eq!(source_id, "crm:event:50001");
        assert!(text.contains("Annual Review"), "should contain event title");
        assert!(text.contains("2026-07-15"), "should contain the start date");
        assert!(
            text.contains("Advisor Office"),
            "should contain the location"
        );
        assert!(
            text.contains("tax-loss harvest"),
            "should contain description text"
        );
    }

    // ── sparse contact — no empty label lines ─────────────────────────────────

    #[test]
    fn sparse_contact_does_not_panic_and_has_no_empty_label_lines() {
        let sparse = CrmContact {
            id: 999,
            r#type: "person".to_string(),
            first_name: "Alice".to_string(),
            ..Default::default()
        };

        let (source_id, text) = render_contact(&sparse);
        assert_eq!(source_id, "crm:contact:999");
        assert!(
            text.starts_with("Wealthbox contact: Alice"),
            "should start with header containing the name"
        );

        // Every line that contains ':' must have a non-empty value after it.
        for line in text.lines() {
            if let Some(pos) = line.find(':') {
                let after = line[pos + 1..].trim();
                assert!(
                    !after.is_empty(),
                    "found empty-value label line: {:?}",
                    line
                );
            }
        }
    }
}
