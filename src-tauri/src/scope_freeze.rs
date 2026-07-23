//! FROZEN OAuth scope requests — the privileges we ask an advisor to grant.
//!
//! # Why this file exists
//!
//! Every connector's scope constant is the list of privileges the advisor is
//! asked to hand over at Microsoft's / Google's / Salesforce's / DocuSign's own
//! consent screen. Widening one is a privilege escalation against the advisor's
//! own accounts, and it is a ONE-WORD edit to a string literal.
//!
//! Before this file, six of those constants were "asserted" with `contains`:
//!
//! ```ignore
//! assert!(url.contains("offline_access"), "missing offline_access scope");
//! assert!(url.contains("Mail.ReadWrite"), "missing Mail.ReadWrite scope");
//! ```
//!
//! **A `contains` assertion is structurally blind to an ADDITION.** It can only
//! notice a removal. This was not a suspicion — it was measured. With a real
//! privilege widening planted into all seven shipped constants at once
//! (`Files.ReadWrite.All` into mail and onedrive, `auth/drive` into gmail,
//! `Contacts.Read` and `auth/contacts` into calendar, `impersonation` into
//! docusign, `full` into salesforce), the **entire** Rust workspace suite ran
//! `1836 passed; 0 failed` — byte-identical to the unplanted baseline, exit 0.
//! Not one test in the repository noticed. The `contains` belts printed `ok`.
//!
//! The same defect reached by a different route lives in
//! `commands::rag::store`'s `validate_external_source_type_accepts_only_known_values`,
//! which **iterated the very constant it was checking** — so adding a value made
//! the loop assert the new value is accepted, by construction. That one is fixed
//! in place. The general class is broader than substring-vs-exact:
//! **an assertion whose source of truth is the thing under test proves nothing,
//! even with `assert_eq!`.**
//!
//! # The shape of the fix
//!
//! An exact, frozen expectation, compared in BOTH directions. A denylist is
//! widened by SHORTENING it, so "no additions" alone is not enough — losing
//! `offline_access` breaks token refresh, and losing a deny entry is a widening.
//! `assert_frozen` therefore reports additions and removals separately, naming
//! the offending tokens.
//!
//! # The bound on this file — read it before trusting the green
//!
//! This file proves the shipped constants MATCH THIS TABLE. It does **not**
//! prove the table is a good policy. Approving `Files.Read.All` here is a human
//! judgement that this file only records and pins; it cannot tell a considered
//! approval from a rubber-stamped one. Its guarantee is narrower and worth
//! stating exactly: **a scope can never again be widened silently** — the change
//! must be made twice, once in the connector and once here, and the second edit
//! is the one a reviewer can see.
//!
//! It is also `#[cfg(test)]`: nothing here ships in the binary.

use std::collections::BTreeSet;

/// Compare a shipped whitespace-separated scope string against its frozen
/// approved set, in both directions.
fn assert_frozen(label: &str, shipped: &str, approved: &[&str]) {
    let shipped_set: BTreeSet<&str> = shipped.split_whitespace().collect();
    let approved_set: BTreeSet<&str> = approved.iter().copied().collect();

    assert!(
        !shipped_set.is_empty(),
        "{label}: the shipped scope string parsed to ZERO scopes. An empty parse must never \
         read as 'nothing was added' — it means this check is looking at the wrong thing."
    );
    assert_eq!(
        approved_set.len(),
        approved.len(),
        "{label}: the approved list in scope_freeze.rs contains a DUPLICATE, so its length is \
         not a reliable count. Fix the table."
    );

    let added: Vec<&str> = shipped_set.difference(&approved_set).copied().collect();
    let removed: Vec<&str> = approved_set.difference(&shipped_set).copied().collect();

    assert!(
        added.is_empty(),
        "{label}: the OAuth scope request was WIDENED by {added:?}. Every scope here is a \
         privilege the advisor is asked to grant at the provider's own consent screen. A new \
         one must be approved in src-tauri/src/scope_freeze.rs in the same change."
    );
    assert!(
        removed.is_empty(),
        "{label}: the OAuth scope request LOST {removed:?}. A shortened list is not \
         automatically safer — dropping offline_access silently breaks token refresh — so \
         removals are surfaced too. Update scope_freeze.rs deliberately if this is intended."
    );
}

// ── THE FROZEN TABLE ────────────────────────────────────────────────────────
// One entry per shipped OAuth scope constant. `covered()` below asserts this
// table accounts for every such constant in src/commands, derived from the
// source tree rather than from this list, so a NEW connector cannot be added
// without either a freeze entry or a loud failure.

/// (module path used in failure messages, source file, constant name)
const COVERED: &[(&str, &str, &str)] = &[
    ("mail (Microsoft)", "src/commands/mail/oauth.rs", "SCOPES"),
    ("mail (Gmail)", "src/commands/mail/gmail/oauth.rs", "SCOPE"),
    (
        "M4 draft handoff (Microsoft)",
        "src/commands/mail/mod.rs",
        "M4_MICROSOFT_DRAFT_SCOPE",
    ),
    (
        "M4 draft handoff (Gmail)",
        "src/commands/mail/mod.rs",
        "M4_GMAIL_DRAFT_SCOPE",
    ),
    ("onedrive", "src/commands/onedrive/oauth.rs", "SCOPES"),
    ("calendar (Microsoft)", "src/commands/calendar/oauth.rs", "MS_SCOPES"),
    ("calendar (Google)", "src/commands/calendar/oauth.rs", "GOOGLE_SCOPE"),
    ("docusign", "src/commands/docusign/oauth.rs", "DOCUSIGN_SCOPES"),
    ("salesforce", "src/commands/crm/salesforce.rs", "SALESFORCE_SCOPE"),
];

/// Constants the source scan finds that are NOT OAuth scope requests.
///
/// The scan below is deliberately BROAD — it matches any `const <NAME>: &str`
/// whose name mentions `SCOPE`. That over-matches, because "scope" is an
/// overloaded word in this codebase. The alternative, narrowing the scan to
/// files named `oauth.rs`, would be a blind spot by construction: the next
/// connector to put its scope constant somewhere else would be invisible.
///
/// So the scan stays broad and everything it finds must be dispositioned
/// EXPLICITLY — either frozen above or written off here WITH A REASON. A
/// constant in neither list fails the test. That keeps the fail-closed
/// property while allowing honest false positives.
const NOT_OAUTH: &[(&str, &str, &str)] = &[(
    "team activity data scope",
    "src/commands/crm/features/activity/commands.rs",
    "FIRM_ACTIVITY_SCOPE",
    // = "firm_home". This is a MATTER ID — the row scope the team-activity
    // feature writes under — not a privilege requested from any provider.
    // Widening it does not grant anyone anything at Microsoft or Google.
    // It is already enforced behaviourally by `validate_scope`, which bails
    // on any matter_id that is not exactly this value.
)];

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mail_microsoft_scopes_are_frozen() {
        assert_frozen(
            "mail (Microsoft)",
            crate::commands::mail::oauth::SCOPES,
            &[
                "offline_access",
                "openid",
                "User.Read",
                "Mail.Read",
                "Mail.ReadWrite",
                "Mail.Send",
            ],
        );
    }

    #[test]
    fn mail_gmail_scopes_are_frozen() {
        assert_frozen(
            "mail (Gmail)",
            crate::commands::mail::gmail::oauth::SCOPE,
            &[
                "openid",
                "email",
                "https://www.googleapis.com/auth/gmail.readonly",
                "https://www.googleapis.com/auth/gmail.send",
                "https://www.googleapis.com/auth/gmail.compose",
            ],
        );
    }

    #[test]
    fn m4_foundation_draft_only_scopes_are_frozen_in_both_directions() {
        assert_frozen(
            "M4 draft handoff (Microsoft)",
            crate::commands::mail::M4_MICROSOFT_DRAFT_SCOPE,
            &["openid", "offline_access", "User.Read", "Mail.ReadWrite"],
        );
        assert_frozen(
            "M4 draft handoff (Gmail)",
            crate::commands::mail::M4_GMAIL_DRAFT_SCOPE,
            &[
                "openid",
                "email",
                "https://www.googleapis.com/auth/gmail.compose",
            ],
        );
    }

    #[test]
    fn onedrive_scopes_are_frozen() {
        assert_frozen(
            "onedrive",
            crate::commands::onedrive::oauth::SCOPES,
            &[
                "offline_access",
                "openid",
                "User.Read",
                "Files.Read.All",
                "Sites.Read.All",
            ],
        );
    }

    #[test]
    fn calendar_microsoft_scopes_are_frozen() {
        assert_frozen(
            "calendar (Microsoft)",
            crate::commands::calendar::oauth::MS_SCOPES,
            &["offline_access", "openid", "User.Read", "Calendars.Read"],
        );
    }

    #[test]
    fn calendar_google_scopes_are_frozen() {
        assert_frozen(
            "calendar (Google)",
            crate::commands::calendar::oauth::GOOGLE_SCOPE,
            &[
                "openid",
                "email",
                "https://www.googleapis.com/auth/calendar.readonly",
            ],
        );
    }

    #[test]
    fn docusign_scopes_are_frozen() {
        // NOTE: the pre-existing belt here was `url.contains("scope=signature%20extended")`,
        // which is a PREFIX match on a query parameter — "signature extended impersonation"
        // still contains it. That is why this one needed an exact freeze, not a tighter
        // substring.
        assert_frozen(
            "docusign",
            crate::commands::docusign::oauth::DOCUSIGN_SCOPES,
            &["signature", "extended"],
        );
    }

    #[test]
    fn salesforce_scopes_are_frozen() {
        assert_frozen(
            "salesforce",
            crate::commands::crm::salesforce::SALESFORCE_SCOPE,
            &["api", "refresh_token"],
        );
    }

    /// The belt on the table itself.
    ///
    /// Every test above is an ENUMERATION, and an enumeration's blind spot is
    /// whatever nobody enumerated — a NEW connector added next quarter with its
    /// own scope constant and its own `contains` belt would be invisible to all
    /// seven tests above and they would all still print `ok`.
    ///
    /// So the set of constants that MUST be frozen is derived from the source
    /// tree (ground truth), not from `COVERED`. `COVERED` is then checked
    /// against the derivation, in both directions.
    ///
    /// 🔴 THE SHAPE BOUND ON THIS SCAN — it decides what the scan CAN find, and
    /// the blindness is invisible from the inside. This scan matches a
    /// declaration `const <NAME>: &str` whose NAME contains `SCOPE`, under
    /// `src/commands`. It therefore CANNOT see:
    ///   - a scope list held as `&[&str]`, a `Vec`, or built at runtime;
    ///   - a scope constant whose name avoids the word SCOPE
    ///     (`PERMISSIONS`, `GRANTS`, `MS_PRIVILEGES`, …);
    ///   - scopes passed as a string literal straight into the URL builder,
    ///     never named by a constant at all;
    ///   - anything outside `src/commands`.
    /// Each of those is indistinguishable from "cleared" in this test's green.
    /// It is a real narrowing of the guarantee and it is why the seven explicit
    /// freeze tests above remain the belt — this test is the brace, not a
    /// replacement for them.
    #[test]
    fn every_oauth_scope_constant_in_the_tree_is_frozen() {
        use std::path::{Path, PathBuf};

        fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
            let entries = std::fs::read_dir(dir)
                .unwrap_or_else(|e| panic!("cannot read {}: {e} — FAILING CLOSED", dir.display()));
            for entry in entries {
                let path = entry.expect("unreadable dir entry — FAILING CLOSED").path();
                if path.is_dir() {
                    walk(&path, out);
                } else if path.extension().is_some_and(|e| e == "rs") {
                    out.push(path);
                }
            }
        }

        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let commands = root.join("src/commands");
        assert!(
            commands.is_dir(),
            "src/commands is not a directory at {} — FAILING CLOSED rather than scanning nothing",
            commands.display()
        );

        let mut files = Vec::new();
        walk(&commands, &mut files);
        assert!(
            files.len() > 50,
            "the walk found only {} .rs files under src/commands. That is not a plausible tree, \
             and a scan that found nothing must never read as 'nothing to freeze'.",
            files.len()
        );

        // A scope constant declaration: a `const <NAME>: &str` whose NAME mentions SCOPE.
        let mut found: Vec<(String, String)> = Vec::new();
        for file in &files {
            let text = std::fs::read_to_string(file)
                .unwrap_or_else(|e| panic!("cannot read {}: {e} — FAILING CLOSED", file.display()));
            let rel = file
                .strip_prefix(&root)
                .unwrap_or(file)
                .to_string_lossy()
                .replace('\\', "/");
            for line in text.lines() {
                let line = line.trim();
                if line.starts_with("//") || !line.contains(": &str") {
                    continue;
                }
                let Some(idx) = line.find("const ") else { continue };
                let after = &line[idx + "const ".len()..];
                let Some(colon) = after.find(':') else { continue };
                let name = after[..colon].trim();
                if !name.contains("SCOPE") {
                    continue;
                }
                found.push((rel.clone(), name.to_string()));
            }
        }

        // POSITIVE CONTROL. "0 found" is exactly the shape of a broken derivation,
        // and it would otherwise read as a clean pass.
        assert!(
            found.len() >= COVERED.len(),
            "the source scan found only {} scope constant(s) but {} are frozen in COVERED. \
             The scan is broken — it is not that constants disappeared.\nfound: {found:?}",
            found.len(),
            COVERED.len()
        );

        let derived: BTreeSet<(String, String)> = found.into_iter().collect();
        let frozen: BTreeSet<(String, String)> = COVERED
            .iter()
            .map(|(_, f, n)| ((*f).to_string(), (*n).to_string()))
            .collect();
        let written_off: BTreeSet<(String, String)> = NOT_OAUTH
            .iter()
            .map(|(_, f, n)| ((*f).to_string(), (*n).to_string()))
            .collect();
        let dispositioned: BTreeSet<(String, String)> =
            frozen.union(&written_off).cloned().collect();

        let undispositioned: Vec<_> = derived.difference(&dispositioned).collect();
        assert!(
            undispositioned.is_empty(),
            "these scope-shaped constant(s) exist in src/commands but appear in NEITHER the \
             frozen table nor the written-off list in scope_freeze.rs: {undispositioned:?}.\n\
             If it is an OAuth scope request, add it to COVERED and write a freeze test — a \
             scope constant with no exact freeze is defended only by `contains` assertions, \
             which are structurally blind to an ADDITION.\n\
             If it is not an OAuth scope, add it to NOT_OAUTH with a reason. Doing nothing is \
             not an option, on purpose."
        );

        let stale: Vec<_> = dispositioned.difference(&derived).collect();
        assert!(
            stale.is_empty(),
            "scope_freeze.rs dispositions {stale:?}, which the source scan no longer finds. \
             Either the constant was renamed/removed (update COVERED / NOT_OAUTH) or the scan \
             has broken."
        );
    }
}
