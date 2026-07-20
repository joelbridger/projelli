//! THE CSV CHOKEPOINT (native side).
//!
//! Counterpart to `src/platform/export/csvSafe.ts`. The renderer's CSV writers
//! and the native ones were two separate populations with two separate
//! opinions about escaping: `src/features/audit/audit-export.ts` guarded
//! against formula injection, `commands/crm/importer/export.rs` quoted the
//! field and stopped there. A migration rollback CSV is built from Wealthbox
//! payloads — third-party data — so `=cmd|'/c calc'!A1` in a contact's name
//! landed in the file unprefixed and ran when the operator opened it.
//!
//! Same three doors as the TypeScript module, same reasons:
//!   `csv_cell`          — guarded. The default.
//!   `csv_formula_cell`  — deliberately a formula. Named so it is greppable.
//!   `csv_verbatim_cell` — deliberately unguarded, REASON REQUIRED as an
//!                         argument so the justification cannot be deleted by
//!                         a comment sweep.
//!
//! `scripts/check-untrusted-sink-derivation.mjs` requires every Rust file in
//! the derived CSV-emitter set to reach `crate::safe_csv`, so a seventh writer
//! reds the gate on the commit that adds it.

/// Characters that make a spreadsheet application read the cell as a formula.
/// TAB and CR are included because Excel skips leading whitespace before it
/// decides, so `"\t=cmd…"` is still a formula.
const FORMULA_LEAD: [char; 6] = ['=', '+', '-', '@', '\t', '\r'];

fn is_formula_lead(value: &str) -> bool {
    // Judge the first character, and again after skipping leading whitespace,
    // because the spreadsheet does both.
    let first = value.chars().next();
    let first_non_space = value.trim_start().chars().next();
    [first, first_non_space]
        .into_iter()
        .flatten()
        .any(|ch| FORMULA_LEAD.contains(&ch))
}

/// RFC 4180 quoting. Applied AFTER the formula decision; quoting is orthogonal
/// to the guard and never substitutes for it — Excel evaluates `"=1+1"` as a
/// formula just the same.
fn rfc4180(field: &str) -> String {
    format!("\"{}\"", field.replace('"', "\"\""))
}

/// Encode one cell of untrusted text. This is the default and it always
/// applies the formula guard.
pub fn csv_cell(value: &str) -> String {
    if value.is_empty() {
        return rfc4180("");
    }
    if is_formula_lead(value) {
        rfc4180(&format!("'{value}"))
    } else {
        rfc4180(value)
    }
}

/// Emit a cell that IS a formula. Pass the formula WITHOUT the leading `=`.
/// A deliberate, named opt-out from the guard.
#[allow(dead_code)]
pub fn csv_formula_cell(formula: &str) -> String {
    rfc4180(&format!("={formula}"))
}

/// Emit a cell with NO formula guard. The `reason` is taken as an argument so
/// the justification lives in the code, not in a comment beside it.
///
/// # Panics
/// If `reason` is empty — an unguarded cell without a stated reason is the
/// exact thing this module exists to make impossible.
#[allow(dead_code)]
pub fn csv_verbatim_cell(value: &str, reason: &str) -> String {
    assert!(
        !reason.trim().is_empty(),
        "csv_verbatim_cell requires a non-empty reason"
    );
    rfc4180(value)
}

/// Join encoded cells into one CSV record.
pub fn csv_row<I, S>(cells: I) -> String
where
    I: IntoIterator<Item = S>,
    S: AsRef<str>,
{
    cells
        .into_iter()
        .map(|cell| cell.as_ref().to_string())
        .collect::<Vec<_>>()
        .join(",")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guards_every_formula_lead_character() {
        for payload in [
            "=cmd|'/c calc'!A1",
            "+1+1",
            "-1+1",
            "@SUM(A1)",
            "\t=cmd",
            "\r=cmd",
        ] {
            let encoded = csv_cell(payload);
            assert!(
                encoded.starts_with("\"'"),
                "payload {payload:?} was not guarded: {encoded}"
            );
        }
    }

    #[test]
    fn guards_after_leading_whitespace() {
        assert!(csv_cell("   =cmd|'/c calc'!A1").starts_with("\"'"));
    }

    #[test]
    fn leaves_ordinary_text_alone_and_doubles_quotes() {
        assert_eq!(csv_cell("Ada, Advisor"), "\"Ada, Advisor\"");
        assert_eq!(csv_cell("say \"hi\""), "\"say \"\"hi\"\"\"");
        assert_eq!(csv_cell(""), "\"\"");
    }

    #[test]
    fn formula_door_is_explicit() {
        assert_eq!(csv_formula_cell("SUM(A1:A2)"), "\"=SUM(A1:A2)\"");
    }

    #[test]
    #[should_panic(expected = "non-empty reason")]
    fn verbatim_door_requires_a_reason() {
        let _ = csv_verbatim_cell("=cmd", "   ");
    }
}
