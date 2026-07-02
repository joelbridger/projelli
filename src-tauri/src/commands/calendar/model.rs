//! Calendar connector: provider-agnostic event model + the pure rules for
//! which events count (exclusions) and which fall in the sync window.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CalendarProvider {
    Outlook,
    Google,
    Ics,
}

impl CalendarProvider {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Outlook => "outlook",
            Self::Google => "google",
            Self::Ics => "ics",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CalendarAttendee {
    pub email: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalendarEvent {
    /// Stable per-occurrence id, prefixed by provider:
    /// "outlook:<graph-event-id>", "google:<event-id>", "ics:<uid>:<start-utc>".
    pub id: String,
    pub provider: CalendarProvider,
    pub title: String,
    pub description: String,
    /// RFC3339 UTC, e.g. "2026-07-02T16:00:00Z".
    pub start_utc: String,
    pub end_utc: String,
    pub attendees: Vec<CalendarAttendee>,
    pub organizer_email: String,
    pub is_cancelled: bool,
    /// The signed-in advisor declined this event (Outlook/Google only; ICS
    /// feeds carry no "self", so ICS events always report false).
    pub self_declined: bool,
}

fn parse_utc(s: &str) -> Option<chrono::DateTime<chrono::Utc>> {
    chrono::DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|d| d.with_timezone(&chrono::Utc))
}

/// Cancelled and self-declined events never reach the store, the index,
/// the strip, or a brief.
pub fn should_keep_event(event: &CalendarEvent) -> bool {
    !event.is_cancelled && !event.self_declined
}

/// Overlap test against a [from, to) UTC window. Unparseable timestamps fail
/// closed (excluded) rather than crashing a sync on one bad event.
pub fn event_in_window(event: &CalendarEvent, from_utc: &str, to_utc: &str) -> bool {
    match (
        parse_utc(&event.start_utc),
        parse_utc(&event.end_utc),
        parse_utc(from_utc),
        parse_utc(to_utc),
    ) {
        (Some(s), Some(e), Some(from), Some(to)) => s < to && e > from,
        _ => false,
    }
}

/// The rolling sync window: past 7 days, next 14.
pub fn sync_window_utc(now: chrono::DateTime<chrono::Utc>) -> (String, String) {
    let from = now - chrono::Duration::days(7);
    let to = now + chrono::Duration::days(14);
    (
        from.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
        to.to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(start: &str, end: &str, cancelled: bool, declined: bool) -> CalendarEvent {
        CalendarEvent {
            id: "outlook:e1".into(),
            provider: CalendarProvider::Outlook,
            title: "Review".into(),
            description: String::new(),
            start_utc: start.into(),
            end_utc: end.into(),
            attendees: vec![],
            organizer_email: String::new(),
            is_cancelled: cancelled,
            self_declined: declined,
        }
    }

    #[test]
    fn excludes_cancelled_and_declined_keeps_normal() {
        // (cancelled, self_declined, expected_keep)
        let table = [
            (false, false, true),
            (true, false, false),
            (false, true, false),
            (true, true, false),
        ];
        for (cancelled, declined, keep) in table {
            let e = ev("2026-07-02T16:00:00Z", "2026-07-02T17:00:00Z", cancelled, declined);
            assert_eq!(should_keep_event(&e), keep, "cancelled={cancelled} declined={declined}");
        }
    }

    #[test]
    fn window_filter_is_inclusive_of_overlap_and_tz_normalizing() {
        let from = "2026-06-25T00:00:00Z";
        let to = "2026-07-16T00:00:00Z";
        // (start, end, expected_in_window, why)
        let table = [
            ("2026-07-02T16:00:00Z", "2026-07-02T17:00:00Z", true, "plain inside"),
            ("2026-06-24T10:00:00Z", "2026-06-24T11:00:00Z", false, "before window"),
            ("2026-07-16T00:00:00Z", "2026-07-16T01:00:00Z", false, "starts at exclusive end"),
            ("2026-06-24T23:00:00Z", "2026-06-25T01:00:00Z", true, "straddles window start"),
            // Offset form must normalize: 18:00+02:00 == 16:00Z (inside).
            ("2026-07-02T18:00:00+02:00", "2026-07-02T19:00:00+02:00", true, "offset normalizes"),
            ("garbage", "2026-07-02T17:00:00Z", false, "unparseable start fails closed"),
        ];
        for (s, e, expected, why) in table {
            let event = ev(s, e, false, false);
            assert_eq!(event_in_window(&event, from, to), expected, "{why}");
        }
    }

    #[test]
    fn sync_window_is_past_7_next_14_days() {
        let now = chrono::DateTime::parse_from_rfc3339("2026-07-02T12:00:00Z")
            .unwrap()
            .with_timezone(&chrono::Utc);
        let (from, to) = sync_window_utc(now);
        assert_eq!(from, "2026-06-25T12:00:00Z");
        assert_eq!(to, "2026-07-16T12:00:00Z");
    }
}
