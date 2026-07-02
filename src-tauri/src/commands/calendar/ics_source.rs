//! ICS feed fetch + parse. Hand-rolled parser (no new parsing crates): line
//! unfolding, VEVENT extraction, TZID/Z/all-day date handling via
//! `chrono-tz`, and a BOUNDED RRULE expander supporting
//! FREQ=DAILY|WEEKLY|MONTHLY with INTERVAL, COUNT, UNTIL, BYDAY (weekly),
//! and EXDATE. Anything outside that support indexes the master occurrence
//! only (honest limitation, logged at debug level).

use super::graph_source::CalendarSource;
use super::model::{CalendarAttendee, CalendarEvent, CalendarProvider};
use chrono::{DateTime, Duration, TimeZone, Utc};

/// GET the ICS text with a bounded timeout. No auth: secret ICS URLs carry
/// their token in the URL itself.
pub async fn fetch_ics_text(url: &str) -> anyhow::Result<String> {
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(15))
        .build()?;
    let resp = http.get(url).send().await?;
    if !resp.status().is_success() {
        anyhow::bail!("http {}", resp.status().as_u16());
    }
    Ok(resp.text().await?)
}

pub struct IcsCalendarSource;

impl IcsCalendarSource {
    pub fn new() -> Self {
        Self
    }
}

impl Default for IcsCalendarSource {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait::async_trait]
impl CalendarSource for IcsCalendarSource {
    fn provider(&self) -> CalendarProvider {
        CalendarProvider::Ics
    }

    async fn fetch_events(
        &self,
        from_utc: &str,
        to_utc: &str,
    ) -> anyhow::Result<Vec<CalendarEvent>> {
        let url = super::commands::ics_url().map_err(|e| anyhow::anyhow!(e))?;
        let text = fetch_ics_text(&url).await?;
        parse_ics(&text, from_utc, to_utc)
    }
}

/// Unfold RFC 5545 lines: CRLF (or LF) followed by space/tab joins to the
/// previous line with the fold removed.
fn unfold(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for raw in text.replace("\r\n", "\n").split('\n') {
        if (raw.starts_with(' ') || raw.starts_with('\t')) && !out.is_empty() {
            let cont = &raw[1..];
            let last = out.last_mut().unwrap();
            last.push_str(cont);
        } else {
            out.push(raw.to_string());
        }
    }
    out
}

/// "NAME;PARAM=V;PARAM2=V2:value" -> (name, params, value)
fn split_prop(line: &str) -> Option<(String, Vec<(String, String)>, String)> {
    let colon = line.find(':')?;
    let (head, value) = line.split_at(colon);
    let value = value[1..].to_string();
    let mut parts = head.split(';');
    let name = parts.next()?.to_ascii_uppercase();
    let params = parts
        .filter_map(|p| {
            let (k, v) = p.split_once('=')?;
            Some((k.to_ascii_uppercase(), v.to_string()))
        })
        .collect();
    Some((name, params, value))
}

/// Parse an ICS datetime value: "20260702T160000Z" (UTC), "20260702T160000"
/// with TZID param, or all-day "20260702" (DATE) -> midnight UTC.
fn parse_ics_datetime(value: &str, tzid: Option<&str>) -> anyhow::Result<DateTime<Utc>> {
    let v = value.trim();
    if let Some(stripped) = v.strip_suffix('Z') {
        let naive = chrono::NaiveDateTime::parse_from_str(stripped, "%Y%m%dT%H%M%S")
            .map_err(|e| anyhow::anyhow!("ics utc datetime {v:?}: {e}"))?;
        return Ok(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc));
    }
    if v.len() == 8 && !v.contains('T') {
        let date = chrono::NaiveDate::parse_from_str(v, "%Y%m%d")
            .map_err(|e| anyhow::anyhow!("ics date {v:?}: {e}"))?;
        let naive = date.and_hms_opt(0, 0, 0).unwrap();
        return Ok(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc));
    }
    let naive = chrono::NaiveDateTime::parse_from_str(v, "%Y%m%dT%H%M%S")
        .map_err(|e| anyhow::anyhow!("ics local datetime {v:?}: {e}"))?;
    match tzid {
        Some(zone) => {
            let tz: chrono_tz::Tz = zone
                .parse()
                .map_err(|_| anyhow::anyhow!("unknown ics TZID {zone:?}"))?;
            tz.from_local_datetime(&naive)
                .earliest()
                .ok_or_else(|| anyhow::anyhow!("nonexistent local time {v:?} in {zone}"))
                .map(|d| d.with_timezone(&Utc))
        }
        // Floating time without TZID: treat as UTC (documented limitation).
        None => Ok(DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc)),
    }
}

#[derive(Default)]
struct RawVevent {
    uid: String,
    summary: String,
    description: String,
    dtstart: Option<(String, Option<String>)>, // (value, tzid)
    dtend: Option<(String, Option<String>)>,
    organizer: String,
    attendees: Vec<CalendarAttendee>,
    cancelled: bool,
    rrule: Option<String>,
    exdates: Vec<(String, Option<String>)>,
}

fn to_rfc3339(dt: DateTime<Utc>) -> String {
    dt.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

/// Expand one VEVENT into occurrences overlapping [from, to). Supports
/// DAILY/WEEKLY (with BYDAY)/MONTHLY, INTERVAL, COUNT, UNTIL, EXDATE.
/// Unsupported rules yield just the master occurrence.
fn expand_occurrences(
    start: DateTime<Utc>,
    rrule: Option<&str>,
    exdates: &[DateTime<Utc>],
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Vec<DateTime<Utc>> {
    const HARD_CAP: usize = 1000; // safety valve against pathological rules
    let Some(rule) = rrule else {
        return if start < to { vec![start] } else { vec![] };
    };
    let mut freq = "";
    let mut interval: i64 = 1;
    let mut count: Option<usize> = None;
    let mut until: Option<DateTime<Utc>> = None;
    let mut bydays: Vec<chrono::Weekday> = Vec::new();
    for part in rule.split(';') {
        let Some((k, v)) = part.split_once('=') else { continue };
        match k.to_ascii_uppercase().as_str() {
            "FREQ" => freq = match v.to_ascii_uppercase().as_str() {
                "DAILY" => "DAILY",
                "WEEKLY" => "WEEKLY",
                "MONTHLY" => "MONTHLY",
                _ => "",
            },
            "INTERVAL" => interval = v.parse().unwrap_or(1).max(1),
            "COUNT" => count = v.parse().ok(),
            "UNTIL" => until = parse_ics_datetime(v, None).ok(),
            "BYDAY" => {
                bydays = v
                    .split(',')
                    .filter_map(|d| match d.trim() {
                        "MO" => Some(chrono::Weekday::Mon),
                        "TU" => Some(chrono::Weekday::Tue),
                        "WE" => Some(chrono::Weekday::Wed),
                        "TH" => Some(chrono::Weekday::Thu),
                        "FR" => Some(chrono::Weekday::Fri),
                        "SA" => Some(chrono::Weekday::Sat),
                        "SU" => Some(chrono::Weekday::Sun),
                        _ => None,
                    })
                    .collect();
            }
            _ => {}
        }
    }
    if freq.is_empty() {
        // Unsupported FREQ: honest fallback to the master occurrence.
        return if start < to { vec![start] } else { vec![] };
    }

    // Candidate generation: step day-by-day from the series start, accept
    // dates matching the rule, count against COUNT across the whole series
    // (not just the window), stop at UNTIL / window end / hard cap.
    use chrono::Datelike;
    let mut occurrences = Vec::new();
    let mut accepted: usize = 0;
    let mut cursor = start;
    let series_end = until.unwrap_or(to).min(to + Duration::days(1));

    // Fast-forward: a series that started years before the window would
    // otherwise burn the entire HARD_CAP stepping one day at a time before
    // ever reaching `from` — a long-running weekly client meeting simply
    // vanishes from every sync (codex-review P2). Jump the cursor (and the
    // COUNT tally, so COUNT= still cuts off correctly) directly to the last
    // full rule period before the window, then resume the normal day-by-day
    // walk, which only needs to cover at most one period from there.
    let target = (from - Duration::days(1)).max(start);
    match freq {
        "DAILY" => {
            let gap_days = (target.date_naive() - start.date_naive()).num_days().max(0);
            let periods = gap_days / interval;
            if periods > 0 {
                accepted = periods as usize;
                cursor = start + Duration::days(periods * interval);
            }
        }
        "WEEKLY" => {
            let gap_days = (target.date_naive() - start.date_naive()).num_days().max(0);
            let period_days = 7 * interval;
            let cycles = gap_days / period_days;
            if cycles > 0 {
                let occurrences_per_cycle = bydays.len().max(1) as i64;
                accepted = (cycles * occurrences_per_cycle) as usize;
                cursor = start + Duration::days(cycles * period_days);
            }
        }
        "MONTHLY" => {
            let gap_months = (target.year() - start.year()) as i64 * 12
                + (target.month() as i64 - start.month() as i64);
            let cycles = gap_months.max(0) / interval;
            if cycles > 0 {
                accepted = cycles as usize;
                let months = (cycles * interval) as u32;
                let new_date = start
                    .date_naive()
                    .checked_add_months(chrono::Months::new(months))
                    .unwrap_or_else(|| start.date_naive());
                cursor = DateTime::<Utc>::from_naive_utc_and_offset(
                    new_date.and_time(start.time()),
                    Utc,
                );
            }
        }
        _ => {}
    }
    // The series already exhausted its COUNT before ever reaching the
    // window: nothing left to emit.
    if let Some(c) = count {
        if accepted >= c {
            return Vec::new();
        }
    }

    let mut steps = 0usize;
    while cursor <= series_end && steps < HARD_CAP {
        steps += 1;
        let matches_rule = match freq {
            "DAILY" => {
                let days = (cursor.date_naive() - start.date_naive()).num_days();
                days % interval == 0
            }
            "WEEKLY" => {
                let days = (cursor.date_naive() - start.date_naive()).num_days();
                let week = days.div_euclid(7);
                let in_week = week % interval == 0;
                let day_ok = if bydays.is_empty() {
                    cursor.weekday() == start.weekday()
                } else {
                    bydays.contains(&cursor.weekday())
                };
                in_week && day_ok
            }
            "MONTHLY" => {
                let month_delta = (cursor.year() - start.year()) as i64 * 12
                    + (cursor.month() as i64 - start.month() as i64);
                cursor.day() == start.day() && month_delta % interval == 0
            }
            _ => false,
        };
        if matches_rule {
            accepted += 1;
            if let Some(c) = count {
                if accepted > c {
                    break;
                }
            }
            if let Some(u) = until {
                if cursor > u {
                    break;
                }
            }
            let excluded = exdates.iter().any(|x| *x == cursor);
            if !excluded && cursor >= from - Duration::days(1) && cursor < to {
                occurrences.push(cursor);
            }
        }
        cursor += Duration::days(1);
    }
    occurrences
}

/// Parse an ICS feed into per-occurrence CalendarEvents inside the window.
pub fn parse_ics(text: &str, from_utc: &str, to_utc: &str) -> anyhow::Result<Vec<CalendarEvent>> {
    let from = DateTime::parse_from_rfc3339(from_utc)?.with_timezone(&Utc);
    let to = DateTime::parse_from_rfc3339(to_utc)?.with_timezone(&Utc);
    let mut events = Vec::new();
    let mut current: Option<RawVevent> = None;

    for line in unfold(text) {
        if line == "BEGIN:VEVENT" {
            current = Some(RawVevent::default());
            continue;
        }
        if line == "END:VEVENT" {
            if let Some(raw) = current.take() {
                events.extend(finish_vevent(raw, from, to)?);
            }
            continue;
        }
        let Some(raw) = current.as_mut() else { continue };
        let Some((name, params, value)) = split_prop(&line) else { continue };
        let tzid = params
            .iter()
            .find(|(k, _)| k == "TZID")
            .map(|(_, v)| v.clone());
        match name.as_str() {
            "UID" => raw.uid = value,
            "SUMMARY" => raw.summary = unescape_ics_text(&value),
            "DESCRIPTION" => raw.description = unescape_ics_text(&value),
            "DTSTART" => raw.dtstart = Some((value, tzid)),
            "DTEND" => raw.dtend = Some((value, tzid)),
            "STATUS" => raw.cancelled = value.eq_ignore_ascii_case("CANCELLED"),
            "RRULE" => raw.rrule = Some(value),
            "EXDATE" => raw.exdates.push((value, tzid)),
            "ORGANIZER" => {
                raw.organizer = value.trim_start_matches("mailto:").to_ascii_lowercase()
            }
            "ATTENDEE" => {
                let email = value.trim_start_matches("mailto:").to_ascii_lowercase();
                if !email.is_empty() {
                    let name = params
                        .iter()
                        .find(|(k, _)| k == "CN")
                        .map(|(_, v)| v.clone())
                        .unwrap_or_default();
                    raw.attendees.push(CalendarAttendee { email, name });
                }
            }
            _ => {}
        }
    }
    Ok(events)
}

fn unescape_ics_text(s: &str) -> String {
    s.replace("\\n", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
}

fn finish_vevent(
    raw: RawVevent,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> anyhow::Result<Vec<CalendarEvent>> {
    let Some((start_val, start_tz)) = raw.dtstart.as_ref() else {
        return Ok(vec![]); // undated: skip, never crash a whole feed
    };
    let start = match parse_ics_datetime(start_val, start_tz.as_deref()) {
        Ok(dt) => dt,
        Err(e) => {
            log::debug!("calendar ics: skipping unparseable DTSTART: {e:#}");
            return Ok(vec![]);
        }
    };
    let duration = match raw.dtend.as_ref() {
        Some((end_val, end_tz)) => parse_ics_datetime(end_val, end_tz.as_deref())
            .map(|end| end - start)
            .unwrap_or_else(|_| Duration::hours(1)),
        None => Duration::hours(1),
    };
    let exdates: Vec<DateTime<Utc>> = raw
        .exdates
        .iter()
        .flat_map(|(v, tz)| {
            v.split(',')
                .filter_map(|one| parse_ics_datetime(one, tz.as_deref()).ok())
                .collect::<Vec<_>>()
        })
        .collect();

    let occurrences = expand_occurrences(start, raw.rrule.as_deref(), &exdates, from, to);
    Ok(occurrences
        .into_iter()
        .filter(|occ| *occ + duration > from && *occ < to)
        .map(|occ| CalendarEvent {
            id: format!("ics:{}:{}", raw.uid, to_rfc3339(occ)),
            provider: CalendarProvider::Ics,
            title: raw.summary.clone(),
            description: raw.description.clone(),
            start_utc: to_rfc3339(occ),
            end_utc: to_rfc3339(occ + duration),
            attendees: raw.attendees.clone(),
            organizer_email: raw.organizer.clone(),
            is_cancelled: raw.cancelled,
            self_declined: false, // ICS has no "self"
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    const WINDOW_FROM: &str = "2026-06-25T00:00:00Z";
    const WINDOW_TO: &str = "2026-07-16T00:00:00Z";

    fn wrap(vevents: &str) -> String {
        format!("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n{vevents}END:VCALENDAR\r\n")
    }

    #[test]
    fn parses_simple_utc_event_with_attendees() {
        let ics = wrap(
            "BEGIN:VEVENT\r\nUID:u1\r\nSUMMARY:Annual review - Henderson\r\n\
             DESCRIPTION:agenda\r\nDTSTART:20260702T160000Z\r\nDTEND:20260702T170000Z\r\n\
             ORGANIZER:mailto:adv@firm.com\r\n\
             ATTENDEE;CN=Kim Henderson:mailto:kim@henderson.com\r\nEND:VEVENT\r\n",
        );
        let events = parse_ics(&ics, WINDOW_FROM, WINDOW_TO).unwrap();
        assert_eq!(events.len(), 1);
        let e = &events[0];
        assert_eq!(e.id, "ics:u1:2026-07-02T16:00:00Z");
        assert_eq!(e.title, "Annual review - Henderson");
        assert_eq!(e.start_utc, "2026-07-02T16:00:00Z");
        assert_eq!(e.attendees[0].email, "kim@henderson.com");
        assert_eq!(e.attendees[0].name, "Kim Henderson");
        assert_eq!(e.organizer_email, "adv@firm.com");
    }

    #[test]
    fn timezone_table() {
        // (dtstart-lines, expected-utc, why) — DST both sides of a US transition.
        let table = [
            (
                "DTSTART;TZID=America/Denver:20260702T100000\r\nDTEND;TZID=America/Denver:20260702T110000",
                "2026-07-02T16:00:00Z",
                "MDT is UTC-6 in July",
            ),
            (
                "DTSTART;TZID=Europe/London:20260702T170000\r\nDTEND;TZID=Europe/London:20260702T180000",
                "2026-07-02T16:00:00Z",
                "BST is UTC+1 in July",
            ),
            (
                "DTSTART:20260702T160000Z\r\nDTEND:20260702T170000Z",
                "2026-07-02T16:00:00Z",
                "explicit Z passes through",
            ),
        ];
        for (dt_lines, expected, why) in table {
            let ics = wrap(&format!(
                "BEGIN:VEVENT\r\nUID:tz\r\nSUMMARY:s\r\n{dt_lines}\r\nEND:VEVENT\r\n"
            ));
            let events = parse_ics(&ics, WINDOW_FROM, WINDOW_TO).unwrap();
            assert_eq!(events[0].start_utc, expected, "{why}");
        }
    }

    #[test]
    fn recurrence_table() {
        // (rrule + exdate lines, expected occurrence count in window, why)
        // Base event: Thursday 2026-07-02 16:00Z. Window ends 2026-07-16 (exclusive).
        let table = [
            ("RRULE:FREQ=WEEKLY;COUNT=10", 2, "weekly: Jul 2, Jul 9 in window (Jul 16 excluded)"),
            ("RRULE:FREQ=DAILY;COUNT=3", 3, "daily x3: Jul 2,3,4"),
            ("RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=4", 1, "biweekly: only Jul 2 fits before Jul 16"),
            ("RRULE:FREQ=WEEKLY;UNTIL=20260709T235959Z", 2, "until caps at Jul 9"),
            (
                "RRULE:FREQ=WEEKLY;COUNT=10\r\nEXDATE:20260709T160000Z",
                1,
                "exdate removes Jul 9",
            ),
            ("RRULE:FREQ=WEEKLY;BYDAY=TU,TH;COUNT=6", 4, "Tu+Th from Thu Jul 2: Jul 2,7,9,14"),
            ("RRULE:FREQ=SECONDLY;COUNT=99", 1, "unsupported freq falls back to master only"),
        ];
        for (extra, expected, why) in table {
            let ics = wrap(&format!(
                "BEGIN:VEVENT\r\nUID:r1\r\nSUMMARY:Recurring\r\n\
                 DTSTART:20260702T160000Z\r\nDTEND:20260702T170000Z\r\n{extra}\r\nEND:VEVENT\r\n"
            ));
            let events = parse_ics(&ics, WINDOW_FROM, WINDOW_TO).unwrap();
            assert_eq!(events.len(), expected, "{why}");
            // Every occurrence id embeds its own start so ids stay unique.
            let ids: std::collections::HashSet<_> = events.iter().map(|e| e.id.clone()).collect();
            assert_eq!(ids.len(), events.len(), "occurrence ids unique ({why})");
        }
    }

    #[test]
    fn old_recurring_series_still_reaches_the_window() {
        // codex-review P2: a weekly meeting that started years ago (well
        // beyond HARD_CAP days-worth of daily stepping) must still surface
        // its occurrences in the current sync window instead of vanishing
        // because the cap was exhausted walking through years of history.
        // 2020-01-02 is a Thursday, same weekday as the window's Jul 2 2026.
        let table = [
            (
                "RRULE:FREQ=WEEKLY;COUNT=1000",
                3,
                // Jun 25 2026 is also a Thursday (7 days before Jul 2), and
                // unlike the recurrence_table test above, this series
                // existed long before the window opened, so it lands too.
                "weekly since 2020: Jun 25, Jul 2, Jul 9 land in window",
            ),
            (
                "RRULE:FREQ=DAILY;COUNT=100000",
                21,
                "daily since 2020: every day Jun 25 through Jul 15 overlaps the window",
            ),
            (
                "RRULE:FREQ=MONTHLY;COUNT=1000",
                1,
                "monthly on the 2nd since 2020: only Jul 2 lands in window",
            ),
        ];
        for (extra, expected, why) in table {
            let ics = wrap(&format!(
                "BEGIN:VEVENT\r\nUID:old1\r\nSUMMARY:Old Recurring\r\n\
                 DTSTART:20200102T160000Z\r\nDTEND:20200102T170000Z\r\n{extra}\r\nEND:VEVENT\r\n"
            ));
            let events = parse_ics(&ics, WINDOW_FROM, WINDOW_TO).unwrap();
            assert_eq!(events.len(), expected, "{why}");
        }
    }

    #[test]
    fn old_series_already_exhausted_before_window_yields_nothing() {
        // COUNT is small enough that the series ended long before the
        // window even opens; the fast-forward must not resurrect it.
        let ics = wrap(
            "BEGIN:VEVENT\r\nUID:old2\r\nSUMMARY:Long Finished\r\n\
             DTSTART:20200102T160000Z\r\nDTEND:20200102T170000Z\r\nRRULE:FREQ=WEEKLY;COUNT=5\r\nEND:VEVENT\r\n",
        );
        let events = parse_ics(&ics, WINDOW_FROM, WINDOW_TO).unwrap();
        assert!(events.is_empty(), "series of 5 weekly occurrences in 2020 is long over by 2026");
    }

    #[test]
    fn cancelled_status_and_folded_lines() {
        let ics = wrap(
            "BEGIN:VEVENT\r\nUID:c1\r\nSUMMARY:Long titled meeting that\r\n  continues on a folded line\r\n\
             STATUS:CANCELLED\r\nDTSTART:20260702T160000Z\r\nDTEND:20260702T170000Z\r\nEND:VEVENT\r\n",
        );
        let events = parse_ics(&ics, WINDOW_FROM, WINDOW_TO).unwrap();
        assert_eq!(events.len(), 1);
        assert!(events[0].is_cancelled);
        // PLAN DEVIATION (Task 7 test fixture): the fixture folds with TWO
        // literal spaces before "continues" (one RFC 5545 fold indicator +
        // one real content space, i.e. the unfolded source read "...that
        // continues..."). RFC 5545 unfolding deletes the CRLF and only the
        // single fold-indicator whitespace character, so the correct result
        // keeps the other space: "that continues", not "thatcontinues". The
        // plan's own doc comment agrees ("CRLF + single leading space...
        // DELETING both") but its assertion expected zero spaces, which
        // only holds if the fixture had exactly one leading space. Fixed
        // here rather than under-unfolding, since silently eating a real
        // content space would corrupt titles/descriptions in real ICS feeds.
        assert_eq!(events[0].title, "Long titled meeting that continues on a folded line");
    }
}
