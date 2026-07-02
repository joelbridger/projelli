//! ICS feed fetch + parse. Hand-rolled parser (no new parsing crates): line
//! unfolding, VEVENT extraction, TZID/Z/all-day date handling via
//! `chrono-tz`, and a BOUNDED RRULE expander supporting
//! FREQ=DAILY|WEEKLY|MONTHLY with INTERVAL, COUNT, UNTIL, BYDAY (weekly),
//! and EXDATE. Anything outside that support indexes the master occurrence
//! only (honest limitation, logged at debug level).

use super::graph_source::CalendarSource;
use super::model::{CalendarAttendee, CalendarEvent, CalendarProvider};
use chrono::{Datelike, DateTime, Duration, TimeZone, Utc};

/// GET the ICS text with a bounded timeout. No auth: secret ICS URLs carry
/// their token in the URL itself — codex-review P2 (round 7): reqwest
/// follows redirects by default, so an https:// feed that 3xx-redirects to
/// a plain http:// URL would silently leak that token over the network
/// despite the https-only check in `calendar_connect_ics`. Only follow a
/// redirect that stays on https (or loopback http, matching the connect
/// command's own dev exception).
pub async fn fetch_ics_text(url: &str) -> anyhow::Result<String> {
    let http = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .connect_timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let safe = attempt.url().scheme() == "https"
                || matches!(attempt.url().host_str(), Some("localhost") | Some("127.0.0.1") | Some("::1"));
            if safe { attempt.follow() } else { attempt.stop() }
        }))
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
            // RFC 5545 §3.2: a param value MAY be quoted (e.g.
            // TZID="America/New_York"). codex-review P2 (round 7): leaving
            // the quotes in place broke resolve_tz's chrono-tz lookup,
            // silently falling back to UTC for every quoted TZID.
            let v = v.trim().strip_prefix('"').and_then(|s| s.strip_suffix('"')).unwrap_or(v);
            Some((k.to_ascii_uppercase(), v.to_string()))
        })
        .collect();
    Some((name, params, value))
}

/// Parse the wall-clock naive datetime out of an ICS value, ignoring any
/// timezone semantics — a 'Z'-suffixed or DATE-only value still just yields
/// its literal digits as a naive datetime; callers apply the zone (if any)
/// separately via `resolve_tz` + `naive_to_utc`.
fn parse_ics_naive(value: &str) -> anyhow::Result<chrono::NaiveDateTime> {
    let v = value.trim();
    if let Some(stripped) = v.strip_suffix('Z') {
        return chrono::NaiveDateTime::parse_from_str(stripped, "%Y%m%dT%H%M%S")
            .map_err(|e| anyhow::anyhow!("ics utc datetime {v:?}: {e}"));
    }
    if v.len() == 8 && !v.contains('T') {
        let date = chrono::NaiveDate::parse_from_str(v, "%Y%m%d")
            .map_err(|e| anyhow::anyhow!("ics date {v:?}: {e}"))?;
        return Ok(date.and_hms_opt(0, 0, 0).unwrap());
    }
    chrono::NaiveDateTime::parse_from_str(v, "%Y%m%dT%H%M%S")
        .map_err(|e| anyhow::anyhow!("ics local datetime {v:?}: {e}"))
}

/// True when an ICS value is inherently UTC (a literal 'Z' suffix, or the
/// DATE-only all-day form) — a TZID param never applies to these.
fn is_inherently_utc(value: &str) -> bool {
    let v = value.trim();
    v.ends_with('Z') || (v.len() == 8 && !v.contains('T'))
}

/// Common Windows-style ICS TZID names (as exported by Outlook/Exchange)
/// mapped to their IANA equivalent. Not exhaustive by design — covers the
/// zones most likely for this product's ICP (US-based financial-advisory
/// practices) plus a few major international ones, the same bounded/honest
/// pattern as the RRULE expander below: an unmapped name falls back to UTC
/// rather than dropping the whole event.
fn windows_tz_to_iana(name: &str) -> Option<&'static str> {
    Some(match name {
        "Eastern Standard Time" => "America/New_York",
        "Central Standard Time" => "America/Chicago",
        "Mountain Standard Time" => "America/Denver",
        "US Mountain Standard Time" => "America/Phoenix",
        "Pacific Standard Time" => "America/Los_Angeles",
        "Alaskan Standard Time" => "America/Anchorage",
        "Hawaiian Standard Time" => "Pacific/Honolulu",
        "Atlantic Standard Time" => "America/Halifax",
        "GMT Standard Time" => "Europe/London",
        "W. Europe Standard Time" => "Europe/Berlin",
        "Central Europe Standard Time" => "Europe/Warsaw",
        "Romance Standard Time" => "Europe/Paris",
        "China Standard Time" => "Asia/Shanghai",
        "Tokyo Standard Time" => "Asia/Tokyo",
        "India Standard Time" => "Asia/Kolkata",
        "AUS Eastern Standard Time" => "Australia/Sydney",
        "UTC" => "Etc/UTC",
        _ => return None,
    })
}

/// Resolve a TZID param to a chrono-tz zone: try it as a literal IANA name
/// first (the common case), then the Windows-name table above. `None`
/// (absent TZID, or a name we don't recognize either way) means "treat as
/// UTC" — codex-review P2: a genuinely unknown zone must not drop the whole
/// event, only lose DST-correctness for that one event.
fn resolve_tz(tzid: Option<&str>) -> Option<chrono_tz::Tz> {
    let zone = tzid?;
    if let Ok(tz) = zone.parse::<chrono_tz::Tz>() {
        return Some(tz);
    }
    if let Some(iana) = windows_tz_to_iana(zone) {
        if let Ok(tz) = iana.parse::<chrono_tz::Tz>() {
            return Some(tz);
        }
    }
    log::debug!("calendar ics: unrecognized TZID {zone:?}, treating as UTC (documented limitation)");
    None
}

/// Apply a resolved zone (or none, for literal-UTC/floating values) to a
/// naive wall-clock datetime, producing the UTC instant. A DST-fold
/// ambiguous local time picks the earlier of the two valid UTC instants.
fn naive_to_utc(naive: chrono::NaiveDateTime, tz: Option<chrono_tz::Tz>) -> DateTime<Utc> {
    match tz {
        Some(z) => z
            .from_local_datetime(&naive)
            .earliest()
            .map(|d| d.with_timezone(&Utc))
            .unwrap_or_else(|| DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc)),
        None => DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc),
    }
}

/// The inverse of `naive_to_utc`: express a UTC instant in a zone's local
/// wall-clock time. Used only for the recurrence fast-forward's coarse
/// target (a day or so of slop near a DST boundary is irrelevant there —
/// exact window filtering happens per-occurrence in `naive_to_utc` space).
fn utc_to_naive_local(dt: DateTime<Utc>, tz: Option<chrono_tz::Tz>) -> chrono::NaiveDateTime {
    match tz {
        Some(z) => z.from_utc_datetime(&dt.naive_utc()).naive_local(),
        None => dt.naive_utc(),
    }
}

/// Parse an ICS datetime value to a UTC instant: "20260702T160000Z" (UTC),
/// "20260702T160000" with TZID param, or all-day "20260702" (DATE, midnight
/// UTC). Used for single-instant fields (DTEND, EXDATE) — DST-correct
/// recurrence stepping uses `parse_ics_naive` + `resolve_tz` directly, see
/// `expand_occurrences`.
fn parse_ics_datetime(value: &str, tzid: Option<&str>) -> anyhow::Result<DateTime<Utc>> {
    let naive = parse_ics_naive(value)?;
    let tz = if is_inherently_utc(value) { None } else { resolve_tz(tzid) };
    Ok(naive_to_utc(naive, tz))
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

/// Parse one BYDAY token: "MO" (no ordinal, used by WEEKLY) or "1MO" /
/// "-1FR" (a positional ordinal + weekday, used by MONTHLY).
fn parse_byday_token(tok: &str) -> Option<(Option<i32>, chrono::Weekday)> {
    if tok.len() < 2 {
        return None;
    }
    let (ord_part, day_part) = tok.split_at(tok.len() - 2);
    let day = match day_part {
        "MO" => chrono::Weekday::Mon,
        "TU" => chrono::Weekday::Tue,
        "WE" => chrono::Weekday::Wed,
        "TH" => chrono::Weekday::Thu,
        "FR" => chrono::Weekday::Fri,
        "SA" => chrono::Weekday::Sat,
        "SU" => chrono::Weekday::Sun,
        _ => return None,
    };
    let ord = if ord_part.is_empty() { None } else { ord_part.parse::<i32>().ok() };
    Some((ord, day))
}

fn last_day_of_month(year: i32, month: u32) -> u32 {
    let next_month_first = if month == 12 {
        chrono::NaiveDate::from_ymd_opt(year + 1, 1, 1)
    } else {
        chrono::NaiveDate::from_ymd_opt(year, month + 1, 1)
    }
    .expect("valid calendar month");
    (next_month_first - Duration::days(1)).day()
}

/// True when `date` is the `ord`-th occurrence of `day` in its own month:
/// `ord > 0` counts from the start (1 = first), `ord < 0` counts from the
/// end (-1 = last).
fn is_nth_weekday_of_month(date: chrono::NaiveDate, ord: i32, day: chrono::Weekday) -> bool {
    if date.weekday() != day || ord == 0 {
        return false;
    }
    if ord > 0 {
        let occurrence = (date.day() as i32 - 1) / 7 + 1;
        occurrence == ord
    } else {
        let last = last_day_of_month(date.year(), date.month());
        let occurrences_from_end = (last as i32 - date.day() as i32) / 7;
        occurrences_from_end == -ord - 1
    }
}

/// Expand one VEVENT into occurrences overlapping [from, to). Supports
/// DAILY/WEEKLY (with BYDAY)/MONTHLY, INTERVAL, COUNT, UNTIL, EXDATE.
/// Unsupported rules yield just the master occurrence.
///
/// Stepping happens entirely in `start_naive`'s wall-clock local time (via
/// `tz`, the DTSTART's resolved zone), converting each CANDIDATE occurrence
/// to UTC individually (`naive_to_utc`) rather than doing the day/week/month
/// arithmetic in UTC and applying one fixed offset — codex-review P2: a
/// weekly meeting stepped in UTC keeps the DTSTART's original UTC offset
/// forever, so it silently shows an hour off in every window after a DST
/// transition. Per-occurrence conversion picks the correct offset for each
/// date, matching a real calendar's "same local time every week" semantics.
///
/// `duration` sizes the from-side lookback so a multi-day recurring event
/// that starts before the window but still overlaps it isn't dropped —
/// codex-review P2 (round 6): a fixed 1-day lookback silently missed a
/// several-day event (e.g. a recurring multi-day conference) starting more
/// than a day before `from`.
fn expand_occurrences(
    start_naive: chrono::NaiveDateTime,
    tz: Option<chrono_tz::Tz>,
    rrule: Option<&str>,
    exdates_naive: &[chrono::NaiveDateTime],
    duration: Duration,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Vec<DateTime<Utc>> {
    let lookback = duration.max(Duration::days(1));
    const HARD_CAP: usize = 1000; // safety valve against pathological rules
    let Some(rule) = rrule else {
        let occ = naive_to_utc(start_naive, tz);
        return if occ < to { vec![occ] } else { vec![] };
    };
    let mut freq = "";
    let mut interval: i64 = 1;
    let mut count: Option<usize> = None;
    let mut until: Option<DateTime<Utc>> = None;
    // (ordinal, weekday): ordinal is None for a plain "MO" (used by WEEKLY),
    // Some(n) for a positional "1MO" / "-1FR" (used by MONTHLY — "the first
    // Monday" / "the last Friday" of the month). WEEKLY ignores the
    // ordinal; MONTHLY requires it (a bare "MO" on a MONTHLY rule matches
    // nothing — narrower than RFC 5545's "every such weekday in the month"
    // reading of that form, but never produces a WRONG date, which is what
    // codex-review P2 (round 5) flagged: this rule shape was previously
    // silently emitting the wrong day of the month).
    let mut bydays: Vec<(Option<i32>, chrono::Weekday)> = Vec::new();
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
            // RFC 5545: UNTIL, when it carries a time, is always UTC
            // regardless of DTSTART's zone — no TZID to apply here.
            "UNTIL" => until = parse_ics_datetime(v, None).ok(),
            "BYDAY" => {
                bydays = v.split(',').filter_map(|d| parse_byday_token(d.trim())).collect();
            }
            _ => {}
        }
    }
    if freq.is_empty() {
        // Unsupported FREQ: honest fallback to the master occurrence.
        let occ = naive_to_utc(start_naive, tz);
        return if occ < to { vec![occ] } else { vec![] };
    }

    // Candidate generation: step day-by-day (in LOCAL wall-clock time) from
    // the series start, accept dates matching the rule, count against COUNT
    // across the whole series (not just the window), stop at UNTIL / window
    // end / hard cap.
    let mut occurrences = Vec::new();
    let mut accepted: usize = 0;
    let mut cursor = start_naive;
    let to_naive = utc_to_naive_local(to, tz);
    let series_end = until
        .map(|u| utc_to_naive_local(u, tz))
        .unwrap_or(to_naive)
        .min(to_naive + Duration::days(1));

    // Fast-forward: a series that started years before the window would
    // otherwise burn the entire HARD_CAP stepping one day at a time before
    // ever reaching `from` — a long-running weekly client meeting simply
    // vanishes from every sync (codex-review P2). Jump the cursor (and the
    // COUNT tally, so COUNT= still cuts off correctly) directly to the last
    // full rule period before the window, then resume the normal day-by-day
    // walk, which only needs to cover at most one period from there. This
    // target is intentionally coarse (naive local, no DST subtlety) — it's
    // only a starting point for stepping, not the final filter.
    let target = utc_to_naive_local(from - lookback, tz).max(start_naive);
    match freq {
        "DAILY" => {
            let gap_days = (target.date() - start_naive.date()).num_days().max(0);
            let periods = gap_days / interval;
            if periods > 0 {
                accepted = periods as usize;
                cursor = start_naive + Duration::days(periods * interval);
            }
        }
        "WEEKLY" => {
            let gap_days = (target.date() - start_naive.date()).num_days().max(0);
            let period_days = 7 * interval;
            let cycles = gap_days / period_days;
            if cycles > 0 {
                // codex-review P2 (round 7): `occurrences_per_cycle` assumes
                // every elapsed week contributes one hit per BYDAY entry,
                // but the FIRST week only contributes matches from
                // DTSTART's weekday onward, not all of them — so the naive
                // `cycles * occurrences_per_cycle` product can OVERcount.
                // An overcounted `accepted` is unsafe: it can trip the
                // count>=COUNT early-return below and drop a series that
                // hasn't actually finished. Holding back one full cycle as
                // a safety margin keeps `accepted` a true lower bound (the
                // main loop's own per-day matching is exact and will
                // correctly count the held-back cycle for real), at the
                // cost of at most one extra cycle's worth of day-stepping —
                // negligible against HARD_CAP.
                let safe_cycles = cycles.saturating_sub(1);
                let occurrences_per_cycle = bydays.len().max(1) as i64;
                accepted = (safe_cycles * occurrences_per_cycle) as usize;
                cursor = start_naive + Duration::days(safe_cycles * period_days);
            }
        }
        "MONTHLY" => {
            let gap_months = (target.year() - start_naive.year()) as i64 * 12
                + (target.month() as i64 - start_naive.month() as i64);
            let cycles = gap_months.max(0) / interval;
            if cycles > 0 {
                accepted = cycles as usize;
                let months = (cycles * interval) as u32;
                let new_date = start_naive
                    .date()
                    .checked_add_months(chrono::Months::new(months))
                    .unwrap_or_else(|| start_naive.date());
                cursor = new_date.and_time(start_naive.time());
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
                let days = (cursor.date() - start_naive.date()).num_days();
                days % interval == 0
            }
            "WEEKLY" => {
                let days = (cursor.date() - start_naive.date()).num_days();
                let week = days.div_euclid(7);
                let in_week = week % interval == 0;
                let day_ok = if bydays.is_empty() {
                    cursor.weekday() == start_naive.weekday()
                } else {
                    bydays.iter().any(|(_, d)| *d == cursor.weekday())
                };
                in_week && day_ok
            }
            "MONTHLY" => {
                let month_delta = (cursor.year() - start_naive.year()) as i64 * 12
                    + (cursor.month() as i64 - start_naive.month() as i64);
                let month_ok = month_delta % interval == 0;
                let day_ok = if bydays.is_empty() {
                    cursor.day() == start_naive.day()
                } else {
                    // Positional BYDAY ("1MO" = first Monday, "-1FR" = last
                    // Friday). A bare "MO" with no ordinal matches nothing
                    // for MONTHLY — see the bydays doc comment above.
                    bydays.iter().any(|(ord, day)| {
                        ord.is_some_and(|o| is_nth_weekday_of_month(cursor.date(), o, *day))
                    })
                };
                month_ok && day_ok
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
            // Per-occurrence UTC conversion — the DST-correctness fix:
            // each candidate picks its own offset instead of inheriting
            // DTSTART's.
            let occ_utc = naive_to_utc(cursor, tz);
            if let Some(u) = until {
                if occ_utc > u {
                    break;
                }
            }
            let excluded = exdates_naive.iter().any(|x| *x == cursor);
            // Exact overlap test (matches finish_vevent's final filter) —
            // a multi-day event starting well before `from` still counts
            // if its duration carries it into the window.
            if !excluded && occ_utc + duration > from && occ_utc < to {
                occurrences.push(occ_utc);
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
    let start_naive = match parse_ics_naive(start_val) {
        Ok(dt) => dt,
        Err(e) => {
            log::debug!("calendar ics: skipping unparseable DTSTART: {e:#}");
            return Ok(vec![]);
        }
    };
    let tz = if is_inherently_utc(start_val) { None } else { resolve_tz(start_tz.as_deref()) };
    let start = naive_to_utc(start_naive, tz);
    // RFC 5545 §3.6.1: a VEVENT with no DTEND defaults to a 1-day duration
    // when DTSTART is a DATE (all-day, no time component), and 1 hour
    // otherwise (VEVENT/VALUE=DATE-TIME default duration is undefined by
    // the spec; 1 hour is this codebase's documented fallback).
    let is_all_day_start = start_val.trim().len() == 8 && !start_val.contains('T');
    let default_duration = if is_all_day_start { Duration::days(1) } else { Duration::hours(1) };
    let duration = match raw.dtend.as_ref() {
        Some((end_val, end_tz)) => parse_ics_datetime(end_val, end_tz.as_deref())
            .map(|end| end - start)
            .unwrap_or(default_duration),
        None => default_duration,
    };
    // EXDATE is assumed to share DTSTART's zone (the standard RFC 5545
    // usage) — compared as naive wall-clock values against the naive
    // recurrence cursor in expand_occurrences, not converted to UTC here.
    let exdates_naive: Vec<chrono::NaiveDateTime> = raw
        .exdates
        .iter()
        .flat_map(|(v, _tz)| v.split(',').filter_map(|one| parse_ics_naive(one).ok()).collect::<Vec<_>>())
        .collect();

    let occurrences =
        expand_occurrences(start_naive, tz, raw.rrule.as_deref(), &exdates_naive, duration, from, to);
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
    fn quoted_tzid_param_value_resolves_the_same_as_unquoted() {
        // codex-review P2 (round 7): RFC 5545 permits a quoted param value
        // (DTSTART;TZID="America/Denver":...). Leaving the quotes in place
        // broke the chrono-tz lookup and silently fell back to UTC.
        let ics = wrap(
            "BEGIN:VEVENT\r\nUID:q1\r\nSUMMARY:s\r\n\
             DTSTART;TZID=\"America/Denver\":20260702T100000\r\n\
             DTEND;TZID=\"America/Denver\":20260702T110000\r\nEND:VEVENT\r\n",
        );
        let events = parse_ics(&ics, WINDOW_FROM, WINDOW_TO).unwrap();
        assert_eq!(events[0].start_utc, "2026-07-02T16:00:00Z", "MDT is UTC-6 in July");
    }

    #[test]
    fn all_day_event_with_no_dtend_defaults_to_one_day_not_one_hour() {
        // codex-review P3: RFC 5545 defaults a DATE-only DTSTART with no
        // DTEND to a 1-day span, not this codebase's usual 1-hour fallback.
        let ics = wrap("BEGIN:VEVENT\r\nUID:ad1\r\nSUMMARY:Conference\r\nDTSTART:20260702\r\nEND:VEVENT\r\n");
        let events = parse_ics(&ics, WINDOW_FROM, WINDOW_TO).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].start_utc, "2026-07-02T00:00:00Z");
        assert_eq!(events[0].end_utc, "2026-07-03T00:00:00Z", "1-day default, not 1-hour");
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
    fn weekly_tzid_recurrence_stays_correct_across_a_dst_transition() {
        // codex-review P2 (round 4): stepping a TZID recurrence in UTC
        // instead of local wall-clock time bakes in DTSTART's original UTC
        // offset forever, so occurrences after a DST transition show up an
        // hour off. US DST ends the first Sunday of November; a Monday
        // 10:00 America/New_York meeting is UTC-4 (EDT) before that and
        // UTC-5 (EST) after — both hours must appear, proving each
        // occurrence picks its own offset rather than inheriting one fixed
        // offset from DTSTART.
        let ics = wrap(
            "BEGIN:VEVENT\r\nUID:dst1\r\nSUMMARY:Weekly check-in\r\n\
             DTSTART;TZID=America/New_York:20261005T100000\r\n\
             DTEND;TZID=America/New_York:20261005T110000\r\n\
             RRULE:FREQ=WEEKLY;COUNT=10\r\nEND:VEVENT\r\n",
        );
        let events = parse_ics(&ics, "2026-10-01T00:00:00Z", "2026-11-16T00:00:00Z").unwrap();
        assert!(events.len() >= 5, "several weekly occurrences should land in a 6-week window");
        use chrono::Timelike;
        let hours: std::collections::HashSet<u32> = events
            .iter()
            .map(|e| {
                chrono::DateTime::parse_from_rfc3339(&e.start_utc)
                    .unwrap()
                    .hour()
            })
            .collect();
        assert!(hours.contains(&14), "EDT (UTC-4) occurrences before the Nov transition: {hours:?}");
        assert!(hours.contains(&15), "EST (UTC-5) occurrences after the Nov transition: {hours:?}");
    }

    #[test]
    fn windows_style_tzid_name_resolves_instead_of_dropping_the_event() {
        // codex-review P2 (round 4): Outlook/Exchange feeds commonly export
        // Windows zone names ("Pacific Standard Time") instead of IANA
        // names. Previously this failed TZID parsing entirely and the whole
        // event silently vanished; it must now resolve via the Windows-name
        // table (or at minimum survive as a UTC fallback), never disappear.
        let ics = wrap(
            "BEGIN:VEVENT\r\nUID:win1\r\nSUMMARY:Exchange-exported meeting\r\n\
             DTSTART;TZID=Pacific Standard Time:20260702T090000\r\n\
             DTEND;TZID=Pacific Standard Time:20260702T100000\r\nEND:VEVENT\r\n",
        );
        let events = parse_ics(&ics, WINDOW_FROM, WINDOW_TO).unwrap();
        assert_eq!(events.len(), 1, "the event must not be dropped for an unrecognized-by-chrono-tz name");
        assert_eq!(
            events[0].start_utc, "2026-07-02T16:00:00Z",
            "Pacific Standard Time -> America/Los_Angeles, PDT is UTC-7 in July"
        );
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
            (
                "RRULE:FREQ=MONTHLY;BYDAY=1TH;COUNT=6",
                1,
                // codex-review P2 (round 5): positional monthly BYDAY. Jul 2
                // 2026 is itself the first Thursday of July, so it's the
                // only in-window occurrence (June's and August's first
                // Thursdays fall outside the window).
                "first Thursday of the month: only Jul 2 in window",
            ),
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
    fn monthly_last_friday_positional_byday() {
        // codex-review P2 (round 5): a negative ordinal ("last Friday").
        // Jul 3 2026 is a Friday; the last Friday of July 2026 is Jul 31
        // (28 days later, same weekday). Window covers only late July, so
        // exactly that one occurrence should land, on the correct date.
        let ics = wrap(
            "BEGIN:VEVENT\r\nUID:lastfri\r\nSUMMARY:Month-end review\r\n\
             DTSTART:20260703T160000Z\r\nDTEND:20260703T170000Z\r\n\
             RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=6\r\nEND:VEVENT\r\n",
        );
        let events = parse_ics(&ics, "2026-07-25T00:00:00Z", "2026-08-01T00:00:00Z").unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].start_utc, "2026-07-31T16:00:00Z", "must land on the actual last Friday, not shift to DTSTART's day-of-month");
    }

    #[test]
    fn multi_day_recurring_event_starting_before_window_still_overlaps() {
        // codex-review P2 (round 6): a fixed 1-day from-side lookback
        // silently dropped a multi-day recurring event (e.g. an annual
        // conference) whose occurrence starts more than a day before
        // `from` but whose DURATION still carries it into the window.
        // Weekly 3-day event: Jun 29 09:00Z - Jul 2 09:00Z, Jul 6 - Jul 9,
        // Jul 13 - Jul 16. Window [Jul 1, Jul 3) only overlaps the FIRST
        // occurrence (which starts 2 days before the window opens).
        let ics = wrap(
            "BEGIN:VEVENT\r\nUID:conf1\r\nSUMMARY:Annual conference\r\n\
             DTSTART:20260629T090000Z\r\nDTEND:20260702T090000Z\r\n\
             RRULE:FREQ=WEEKLY;COUNT=3\r\nEND:VEVENT\r\n",
        );
        let events = parse_ics(&ics, "2026-07-01T00:00:00Z", "2026-07-03T00:00:00Z").unwrap();
        assert_eq!(events.len(), 1, "the Jun 29 occurrence overlaps despite starting before the window");
        assert_eq!(events[0].start_utc, "2026-06-29T09:00:00Z");
        assert_eq!(events[0].end_utc, "2026-07-02T09:00:00Z");
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
