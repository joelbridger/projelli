//! Outlook calendar source: GET /me/calendarView over the sync window.
//! calendarView expands recurring series into occurrences server-side, so
//! recurrence needs no local expansion for Outlook.

use super::model::{CalendarAttendee, CalendarEvent, CalendarProvider};

#[async_trait::async_trait]
pub trait CalendarSource: Send + Sync {
    /// Provider label used for store rows and cursors.
    fn provider(&self) -> CalendarProvider;
    /// Fetch all kept-or-not events overlapping [from_utc, to_utc).
    /// Recurring events arrive EXPANDED into occurrences.
    async fn fetch_events(
        &self,
        from_utc: &str,
        to_utc: &str,
    ) -> anyhow::Result<Vec<CalendarEvent>>;
}

type TokenFn = std::sync::Arc<
    dyn Fn() -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<String, String>> + Send>,
        > + Send
        + Sync,
>;

pub struct GraphCalendarSource {
    base_url: String,
    token: TokenFn,
    http: reqwest::Client,
}

impl GraphCalendarSource {
    pub fn new() -> Self {
        Self::new_with_base("https://graph.microsoft.com/v1.0".to_string(), || async {
            super::commands::fresh_ms_access_token().await
        })
    }

    pub fn new_with_base<F, Fut>(base_url: String, token: F) -> Self
    where
        F: Fn() -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = Result<String, String>> + Send + 'static,
    {
        let token: TokenFn = std::sync::Arc::new(move || Box::pin(token()));
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .connect_timeout(std::time::Duration::from_secs(15))
            .build()
            .expect("build reqwest client");
        Self { base_url, token, http }
    }
}

#[async_trait::async_trait]
impl CalendarSource for GraphCalendarSource {
    fn provider(&self) -> CalendarProvider {
        CalendarProvider::Outlook
    }

    async fn fetch_events(
        &self,
        from_utc: &str,
        to_utc: &str,
    ) -> anyhow::Result<Vec<CalendarEvent>> {
        let access = (self.token)().await.map_err(|e| anyhow::anyhow!(e))?;
        // Google's API tells us per-attendee which one is "me" (`self: true`);
        // Graph's attendee objects carry no such field, so parity requires a
        // separate lookup of the advisor's own mailbox address to filter it
        // out of the attendees list the same way Google's source does. A
        // failed lookup degrades to "don't filter" (today's behavior) rather
        // than failing the whole calendar fetch over a cosmetic mismatch.
        let self_emails = fetch_self_emails(&self.base_url, &self.http, &access).await;
        let mut url = format!(
            "{}/me/calendarView?startDateTime={}&endDateTime={}&$top=100",
            self.base_url, from_utc, to_utc
        );
        let mut out = Vec::new();
        loop {
            // Same-origin guard before following absolute pagination links
            // with the bearer token (connector/mod.rs:192 assert_same_origin).
            crate::commands::connector::assert_same_origin(&self.base_url, &url)?;
            let resp = self
                .http
                .get(&url)
                .bearer_auth(&access)
                // VERIFY-LIVE: Prefer header pins returned times to UTC.
                .header("Prefer", "outlook.timezone=\"UTC\"")
                .send()
                .await?;
            if !resp.status().is_success() {
                anyhow::bail!("graph calendarView http {}", resp.status().as_u16());
            }
            let v: serde_json::Value = resp.json().await?;
            for item in v.get("value").and_then(|x| x.as_array()).unwrap_or(&vec![]) {
                out.push(map_graph_event(item, &self_emails)?);
            }
            match v.get("@odata.nextLink").and_then(|x| x.as_str()) {
                Some(next) if !next.is_empty() => url = next.to_string(),
                _ => break,
            }
        }
        Ok(out)
    }
}

/// The signed-in user's own mailbox address, via Graph's `/me` (already
/// covered by the `User.Read` scope this connector requests — see
/// `oauth.rs`'s `MS_SCOPES`). `mail` is preferred; some tenants leave it
/// null for accounts provisioned without an Exchange mailbox alias, so
/// `userPrincipalName` is the fallback. Returns `None` on any failure
/// (network, non-2xx, missing fields) — callers treat that as "can't
/// determine self, don't filter" rather than failing the calendar fetch.
/// Both of the signed-in user's addresses, not just `mail` — codex-review
/// round 6 (P3): some tenants have `mail` and `userPrincipalName` set to
/// different values, and Graph calendar attendees can carry either one, so
/// filtering on only the preferred address missed the advisor's own row
/// for those tenants.
async fn fetch_self_emails(base_url: &str, http: &reqwest::Client, access: &str) -> Vec<String> {
    let url = format!("{base_url}/me?$select=mail,userPrincipalName");
    let Ok(resp) = http.get(&url).bearer_auth(access).send().await else {
        return Vec::new();
    };
    if !resp.status().is_success() {
        return Vec::new();
    }
    let Ok(v) = resp.json::<serde_json::Value>().await else {
        return Vec::new();
    };
    let mut emails = Vec::new();
    for key in ["mail", "userPrincipalName"] {
        if let Some(addr) = v.get(key).and_then(|x| x.as_str()).filter(|s| !s.is_empty()) {
            if !emails.iter().any(|e: &String| e.eq_ignore_ascii_case(addr)) {
                emails.push(addr.to_string());
            }
        }
    }
    emails
}

/// Graph returns "2026-07-02T16:00:00.0000000" + a timeZone name; with the
/// UTC Prefer header the zone is UTC. Normalize to RFC3339 "…Z".
fn graph_time_to_utc(v: &serde_json::Value) -> anyhow::Result<String> {
    let raw = v.get("dateTime").and_then(|x| x.as_str()).unwrap_or("");
    let zone = v.get("timeZone").and_then(|x| x.as_str()).unwrap_or("UTC");
    let trimmed = raw.split('.').next().unwrap_or(raw);
    let naive = chrono::NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%dT%H:%M:%S")
        .map_err(|e| anyhow::anyhow!("graph time {raw:?}: {e}"))?;
    let utc = if zone == "UTC" {
        chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(naive, chrono::Utc)
    } else {
        use chrono::TimeZone;
        let tz: chrono_tz::Tz = zone
            .parse()
            .map_err(|_| anyhow::anyhow!("unknown graph timezone {zone:?}"))?;
        tz.from_local_datetime(&naive)
            .earliest()
            .ok_or_else(|| anyhow::anyhow!("nonexistent local time {raw:?} in {zone}"))?
            .with_timezone(&chrono::Utc)
    };
    Ok(utc.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

fn map_graph_event(
    item: &serde_json::Value,
    self_emails: &[String],
) -> anyhow::Result<CalendarEvent> {
    let id = item
        .get("id")
        .and_then(|x| x.as_str())
        .ok_or_else(|| anyhow::anyhow!("graph event missing id"))?;
    let attendees = item
        .get("attendees")
        .and_then(|x| x.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|a| {
                    let email = a.pointer("/emailAddress/address")?.as_str()?.to_string();
                    // Parity with google_source.rs's `self: true` filter: Graph
                    // has no per-attendee "is me" flag, so this compares against
                    // the advisor's own mailbox address(es) fetched separately —
                    // both `mail` and `userPrincipalName`, since some tenants
                    // set them to different values and either can appear here.
                    if self_emails.iter().any(|me| email.eq_ignore_ascii_case(me)) {
                        return None; // the advisor is not a "client attendee"
                    }
                    let name = a
                        .pointer("/emailAddress/name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("")
                        .to_string();
                    Some(CalendarAttendee { email, name })
                })
                .collect()
        })
        .unwrap_or_default();
    let self_response = item
        .pointer("/responseStatus/response")
        .and_then(|x| x.as_str())
        .unwrap_or("");
    Ok(CalendarEvent {
        id: format!("outlook:{id}"),
        provider: CalendarProvider::Outlook,
        title: item.get("subject").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        description: item
            .get("bodyPreview")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        start_utc: graph_time_to_utc(item.get("start").unwrap_or(&serde_json::Value::Null))?,
        end_utc: graph_time_to_utc(item.get("end").unwrap_or(&serde_json::Value::Null))?,
        attendees,
        organizer_email: item
            .pointer("/organizer/emailAddress/address")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        is_cancelled: item.get("isCancelled").and_then(|x| x.as_bool()).unwrap_or(false),
        self_declined: self_response == "declined",
        join_url: extract_graph_join_url(item),
    })
}

/// The online-meeting join URL from a Graph event, if any. Graph puts it on
/// `onlineMeeting.joinUrl` when `isOnlineMeeting` is true (Teams and, for
/// third-party providers configured in the tenant, other services). The older
/// `onlineMeetingUrl` scalar is a fallback for events created before the
/// structured `onlineMeeting` object. Blank strings are treated as absent.
/// VERIFY-LIVE: confirm `onlineMeeting/joinUrl` against one real Teams event.
fn extract_graph_join_url(item: &serde_json::Value) -> Option<String> {
    let from_str = |v: Option<&serde_json::Value>| {
        v.and_then(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    from_str(item.pointer("/onlineMeeting/joinUrl"))
        .or_else(|| from_str(item.get("onlineMeetingUrl")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    /// VERIFY-LIVE: field names below (`subject`, `bodyPreview`, `start.dateTime`,
    /// `start.timeZone`, `attendees[].emailAddress.{address,name}`,
    /// `attendees[].status.response`, `organizer.emailAddress.address`,
    /// `isCancelled`, `responseStatus.response`, `@odata.nextLink`) come from the
    /// Graph event resource reference. Confirm against one real
    /// GET /me/calendarView response and adjust both fixture and mapper.
    fn page(next: Option<&str>) -> serde_json::Value {
        serde_json::json!({
            "value": [
                {
                    "id": "AAMkEvent1",
                    "subject": "Annual review - Henderson",
                    "bodyPreview": "agenda text",
                    "start": { "dateTime": "2026-07-02T16:00:00.0000000", "timeZone": "UTC" },
                    "end": { "dateTime": "2026-07-02T17:00:00.0000000", "timeZone": "UTC" },
                    "attendees": [
                        { "emailAddress": { "address": "kim@henderson.com", "name": "Kim Henderson" },
                          "status": { "response": "accepted" } }
                    ],
                    "organizer": { "emailAddress": { "address": "adv@firm.com", "name": "Advisor" } },
                    "isCancelled": false,
                    "responseStatus": { "response": "organizer" }
                },
                {
                    "id": "AAMkEvent2",
                    "subject": "Declined lunch",
                    "bodyPreview": "",
                    "start": { "dateTime": "2026-07-03T18:00:00.0000000", "timeZone": "UTC" },
                    "end": { "dateTime": "2026-07-03T19:00:00.0000000", "timeZone": "UTC" },
                    "attendees": [],
                    "organizer": { "emailAddress": { "address": "x@y.com", "name": "X" } },
                    "isCancelled": false,
                    "responseStatus": { "response": "declined" }
                }
            ],
            "@odata.nextLink": next
        })
    }

    #[test]
    fn extracts_join_url_from_online_meeting_then_legacy_then_none() {
        // Structured onlineMeeting.joinUrl (the modern Teams shape) wins.
        let modern = serde_json::json!({
            "onlineMeeting": { "joinUrl": "https://teams.microsoft.com/l/meetup-join/abc" },
            "onlineMeetingUrl": "https://legacy.example/should-be-ignored"
        });
        assert_eq!(
            extract_graph_join_url(&modern).as_deref(),
            Some("https://teams.microsoft.com/l/meetup-join/abc")
        );
        // Falls back to the legacy scalar when the structured object is absent.
        let legacy = serde_json::json!({ "onlineMeetingUrl": "https://teams.microsoft.com/legacy" });
        assert_eq!(
            extract_graph_join_url(&legacy).as_deref(),
            Some("https://teams.microsoft.com/legacy")
        );
        // Blank strings and missing fields => None (an in-person meeting).
        assert_eq!(extract_graph_join_url(&serde_json::json!({ "onlineMeeting": { "joinUrl": "" } })), None);
        assert_eq!(extract_graph_join_url(&serde_json::json!({ "subject": "no link" })), None);
    }

    #[tokio::test]
    async fn fetches_maps_and_pages_calendar_view() {
        let server = MockServer::start().await;
        let next_url = format!("{}/me/calendarView?$skip=2", server.uri());
        Mock::given(method("GET"))
            .and(path("/me/calendarView"))
            .and(query_param("startDateTime", "2026-07-01T00:00:00Z"))
            .respond_with(ResponseTemplate::new(200).set_body_json(page(Some(&next_url))))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/me/calendarView"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "value": []
            })))
            .mount(&server)
            .await;

        let source = GraphCalendarSource::new_with_base(server.uri(), || async {
            Ok("test-token".to_string())
        });
        let events = source
            .fetch_events("2026-07-01T00:00:00Z", "2026-07-10T00:00:00Z")
            .await
            .unwrap();

        assert_eq!(events.len(), 2);
        let e1 = &events[0];
        assert_eq!(e1.id, "outlook:AAMkEvent1");
        assert_eq!(e1.title, "Annual review - Henderson");
        assert_eq!(e1.start_utc, "2026-07-02T16:00:00Z");
        assert_eq!(e1.attendees[0].email, "kim@henderson.com");
        assert_eq!(e1.organizer_email, "adv@firm.com");
        assert!(!e1.self_declined);
        assert!(events[1].self_declined, "responseStatus declined maps to self_declined");
    }

    #[tokio::test]
    async fn filters_the_advisors_own_address_out_of_attendees_like_google_does() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/me"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "mail": "adv@firm.com",
                "userPrincipalName": "adv@firm.com"
            })))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/me/calendarView"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "value": [{
                    "id": "AAMkEvent3",
                    "subject": "Henderson check-in",
                    "bodyPreview": "",
                    "start": { "dateTime": "2026-07-02T16:00:00.0000000", "timeZone": "UTC" },
                    "end": { "dateTime": "2026-07-02T17:00:00.0000000", "timeZone": "UTC" },
                    "attendees": [
                        { "emailAddress": { "address": "kim@henderson.com", "name": "Kim Henderson" },
                          "status": { "response": "accepted" } },
                        { "emailAddress": { "address": "ADV@FIRM.COM", "name": "Advisor" },
                          "status": { "response": "organizer" } }
                    ],
                    "organizer": { "emailAddress": { "address": "adv@firm.com", "name": "Advisor" } },
                    "isCancelled": false,
                    "responseStatus": { "response": "organizer" }
                }],
                "@odata.nextLink": null
            })))
            .mount(&server)
            .await;

        let source = GraphCalendarSource::new_with_base(server.uri(), || async {
            Ok("test-token".to_string())
        });
        let events = source
            .fetch_events("2026-07-01T00:00:00Z", "2026-07-10T00:00:00Z")
            .await
            .unwrap();

        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].attendees.len(),
            1,
            "the advisor's own address (case-insensitive) is filtered out, matching google_source.rs"
        );
        assert_eq!(events[0].attendees[0].email, "kim@henderson.com");
    }

    #[tokio::test]
    async fn keeps_all_attendees_when_the_self_lookup_fails_rather_than_erroring_the_whole_fetch() {
        // No /me mock is registered — wiremock returns its default 404, and
        // fetch_self_emails must degrade to an empty list (today's pre-fix
        // behavior) rather than failing the calendar fetch over a cosmetic
        // mismatch.
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/me/calendarView"))
            .respond_with(ResponseTemplate::new(200).set_body_json(page(None)))
            .mount(&server)
            .await;

        let source = GraphCalendarSource::new_with_base(server.uri(), || async {
            Ok("test-token".to_string())
        });
        let events = source
            .fetch_events("2026-07-01T00:00:00Z", "2026-07-10T00:00:00Z")
            .await
            .unwrap();
        assert_eq!(events[0].attendees.len(), 1, "unfiltered when self-email can't be determined");
    }

    #[test]
    fn map_graph_event_is_case_insensitive_when_matching_self_email() {
        let item = serde_json::json!({
            "id": "e1",
            "subject": "t",
            "start": { "dateTime": "2026-07-02T16:00:00.0000000", "timeZone": "UTC" },
            "end": { "dateTime": "2026-07-02T17:00:00.0000000", "timeZone": "UTC" },
            "attendees": [
                { "emailAddress": { "address": "Kim@Henderson.com", "name": "Kim" } },
                { "emailAddress": { "address": "ADV@firm.com", "name": "Advisor" } }
            ],
        });
        let event = map_graph_event(&item, &["adv@firm.com".to_string()]).unwrap();
        assert_eq!(event.attendees.len(), 1);
        assert_eq!(event.attendees[0].email, "Kim@Henderson.com");
    }

    #[test]
    fn map_graph_event_filters_on_either_mail_or_upn_when_they_differ() {
        // codex-review round 6 (P3): some tenants have `mail` and
        // `userPrincipalName` set to different addresses, and Graph
        // attendees can carry either — both must be checked.
        let item = serde_json::json!({
            "id": "e1",
            "subject": "t",
            "start": { "dateTime": "2026-07-02T16:00:00.0000000", "timeZone": "UTC" },
            "end": { "dateTime": "2026-07-02T17:00:00.0000000", "timeZone": "UTC" },
            "attendees": [
                { "emailAddress": { "address": "kim@henderson.com", "name": "Kim" } },
                { "emailAddress": { "address": "advisor@firm.onmicrosoft.com", "name": "Advisor" } }
            ],
        });
        let self_emails = vec!["adv@firm.com".to_string(), "advisor@firm.onmicrosoft.com".to_string()];
        let event = map_graph_event(&item, &self_emails).unwrap();
        assert_eq!(event.attendees.len(), 1);
        assert_eq!(event.attendees[0].email, "kim@henderson.com");
    }

    #[test]
    fn map_graph_event_keeps_everyone_when_self_email_is_unknown() {
        let item = serde_json::json!({
            "id": "e1",
            "subject": "t",
            "start": { "dateTime": "2026-07-02T16:00:00.0000000", "timeZone": "UTC" },
            "end": { "dateTime": "2026-07-02T17:00:00.0000000", "timeZone": "UTC" },
            "attendees": [
                { "emailAddress": { "address": "kim@henderson.com", "name": "Kim" } }
            ],
        });
        let event = map_graph_event(&item, &[]).unwrap();
        assert_eq!(event.attendees.len(), 1);
    }
}
