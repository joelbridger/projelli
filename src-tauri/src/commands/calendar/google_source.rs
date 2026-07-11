//! Google Calendar source: events.list with singleEvents=true, which expands
//! recurring series into occurrences server-side.

use super::graph_source::CalendarSource;
use super::model::{CalendarAttendee, CalendarEvent, CalendarProvider};

type TokenFn = std::sync::Arc<
    dyn Fn() -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<String, String>> + Send>>
        + Send
        + Sync,
>;

pub struct GoogleCalendarSource {
    base_url: String,
    token: TokenFn,
    http: reqwest::Client,
    policy: crate::network_policy::NetworkPolicy,
    operation: crate::network_policy::EgressOperation,
}

impl GoogleCalendarSource {
    pub fn new(policy: crate::network_policy::NetworkPolicy) -> Self {
        let token_policy = policy.clone();
        Self::new_with_base(
            "https://www.googleapis.com/calendar/v3".to_string(),
            move || {
                let policy = token_policy.clone();
                async move { super::commands::fresh_google_access_token(&policy).await }
            },
            policy,
        )
    }

    pub fn new_with_base<F, Fut>(
        base_url: String,
        token: F,
        policy: crate::network_policy::NetworkPolicy,
    ) -> Self
    where
        F: Fn() -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = Result<String, String>> + Send + 'static,
    {
        let token: TokenFn = std::sync::Arc::new(move || Box::pin(token()));
        let http = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .connect_timeout(std::time::Duration::from_secs(15))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("build reqwest client");
        Self {
            base_url,
            token,
            http,
            policy,
            operation: {
                #[cfg(test)]
                {
                    crate::network_policy::LOCAL_LLAMA
                }
                #[cfg(not(test))]
                {
                    crate::network_policy::GOOGLE_CALENDAR_SYNC
                }
            },
        }
    }
}

#[async_trait::async_trait]
impl CalendarSource for GoogleCalendarSource {
    fn provider(&self) -> CalendarProvider {
        CalendarProvider::Google
    }

    async fn fetch_events(
        &self,
        from_utc: &str,
        to_utc: &str,
    ) -> anyhow::Result<Vec<CalendarEvent>> {
        let access = (self.token)().await.map_err(|e| anyhow::anyhow!(e))?;
        let mut page_token: Option<String> = None;
        let mut out = Vec::new();
        loop {
            let mut url = format!(
                // conferenceDataVersion=1 makes Google return the structured
                // `conferenceData` block, so we can read the meeting join URL
                // (e.g. Zoom added via a Google Calendar add-on) for the Notice
                // Card, not just the legacy `hangoutLink` (Meet).
                "{}/calendars/primary/events?singleEvents=true&maxResults=250&conferenceDataVersion=1\
                 &timeMin={}&timeMax={}",
                self.base_url,
                crate::commands::mail::gmail::oauth::urlencoding_encode(from_utc),
                crate::commands::mail::gmail::oauth::urlencoding_encode(to_utc),
            );
            if let Some(t) = &page_token {
                // codex-review P2 (round 7): an opaque token containing
                // reserved query chars (+, &, =) would otherwise corrupt
                // the query string and break/skip later pages.
                url.push_str(&format!(
                    "&pageToken={}",
                    crate::commands::mail::gmail::oauth::urlencoding_encode(t)
                ));
            }
            let resp = crate::commands::connector_network::send_with_authorized_redirects(
                &self.policy,
                &self.operation,
                &url,
                |request_url| {
                    let http = self.http.clone();
                    let access = access.clone();
                    async move {
                        Ok(http.get(request_url).bearer_auth(&access).send().await?)
                    }
                },
            )
            .await?;
            if !resp.status().is_success() {
                anyhow::bail!("google events.list http {}", resp.status().as_u16());
            }
            let v: serde_json::Value = resp.json().await?;
            for item in v.get("items").and_then(|x| x.as_array()).unwrap_or(&vec![]) {
                if let Some(e) = map_google_event(item)? {
                    out.push(e);
                }
            }
            match v.get("nextPageToken").and_then(|x| x.as_str()) {
                Some(t) if !t.is_empty() => page_token = Some(t.to_string()),
                _ => break,
            }
        }
        Ok(out)
    }
}

fn rfc3339_to_utc(s: &str) -> anyhow::Result<String> {
    let dt = chrono::DateTime::parse_from_rfc3339(s)
        .map_err(|e| anyhow::anyhow!("google time {s:?}: {e}"))?;
    Ok(dt
        .with_timezone(&chrono::Utc)
        .to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

/// Fallback for the defensive case where `dateTime` lacks an explicit UTC
/// offset and instead relies on the sibling `timeZone` IANA name.
/// VERIFY-LIVE: Google's documented Calendar v3 contract always embeds the
/// offset directly in `dateTime` (this codebase's fixtures reflect that),
/// but codex-review P2 (round 6) flagged this as a plausible response shape
/// worth defending against, especially for recurring events — failing soft
/// here means one malformed item doesn't abort the whole calendar fetch.
fn naive_with_zone_to_utc(s: &str, zone: Option<&str>) -> anyhow::Result<String> {
    let naive = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S")
        .map_err(|e| anyhow::anyhow!("google naive time {s:?}: {e}"))?;
    let utc = match zone.and_then(|z| z.parse::<chrono_tz::Tz>().ok()) {
        Some(tz) => {
            use chrono::TimeZone;
            tz.from_local_datetime(&naive)
                .earliest()
                .map(|d| d.with_timezone(&chrono::Utc))
                .unwrap_or_else(|| {
                    chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(naive, chrono::Utc)
                })
        }
        None => chrono::DateTime::<chrono::Utc>::from_naive_utc_and_offset(naive, chrono::Utc),
    };
    Ok(utc.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

/// Returns Ok(None) only for undated items (defensive; singleEvents=true
/// should always yield dated occurrences). All-day events use `date`
/// (midnight UTC of that date, 24h span).
fn map_google_event(item: &serde_json::Value) -> anyhow::Result<Option<CalendarEvent>> {
    let id = match item.get("id").and_then(|x| x.as_str()) {
        Some(id) => id,
        None => return Ok(None),
    };
    let time_of = |key: &str| -> anyhow::Result<Option<String>> {
        let node = item.get(key).unwrap_or(&serde_json::Value::Null);
        if let Some(dt) = node.get("dateTime").and_then(|x| x.as_str()) {
            return match rfc3339_to_utc(dt) {
                Ok(v) => Ok(Some(v)),
                Err(_) => {
                    let zone = node.get("timeZone").and_then(|z| z.as_str());
                    Ok(Some(naive_with_zone_to_utc(dt, zone)?))
                }
            };
        }
        if let Some(d) = node.get("date").and_then(|x| x.as_str()) {
            return Ok(Some(format!("{d}T00:00:00Z")));
        }
        Ok(None)
    };
    let (start_utc, end_utc) = match (time_of("start")?, time_of("end")?) {
        (Some(s), Some(e)) => (s, e),
        _ => return Ok(None),
    };
    let mut self_declined = false;
    let mut attendees = Vec::new();
    for a in item
        .get("attendees")
        .and_then(|x| x.as_array())
        .unwrap_or(&vec![])
    {
        let Some(email) = a.get("email").and_then(|e| e.as_str()) else {
            continue;
        };
        let is_self = a.get("self").and_then(|s| s.as_bool()).unwrap_or(false);
        let response = a
            .get("responseStatus")
            .and_then(|r| r.as_str())
            .unwrap_or("");
        if is_self {
            if response == "declined" {
                self_declined = true;
            }
            continue; // the advisor is not a "client attendee"
        }
        let name = a
            .get("displayName")
            .and_then(|n| n.as_str())
            .unwrap_or("")
            .to_string();
        attendees.push(CalendarAttendee {
            email: email.to_string(),
            name,
        });
    }
    Ok(Some(CalendarEvent {
        id: format!("google:{id}"),
        provider: CalendarProvider::Google,
        title: item
            .get("summary")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        description: item
            .get("description")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        start_utc,
        end_utc,
        attendees,
        organizer_email: item
            .pointer("/organizer/email")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        is_cancelled: item.get("status").and_then(|x| x.as_str()) == Some("cancelled"),
        self_declined,
        join_url: extract_google_join_url(item),
    }))
}

/// The video join URL from a Google Calendar event, if any. Prefers the
/// structured `conferenceData.entryPoints[]` entry whose `entryPointType` is
/// `"video"` (works for Meet and third-party conferencing add-ons), and falls
/// back to the legacy top-level `hangoutLink`. Blank strings are treated as
/// absent. VERIFY-LIVE: confirm shapes against one real events.list response.
fn extract_google_join_url(item: &serde_json::Value) -> Option<String> {
    let clean = |s: &str| {
        let t = s.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    };
    if let Some(points) = item
        .pointer("/conferenceData/entryPoints")
        .and_then(|x| x.as_array())
    {
        if let Some(uri) = points
            .iter()
            .find(|p| p.get("entryPointType").and_then(|t| t.as_str()) == Some("video"))
            .and_then(|p| p.get("uri"))
            .and_then(|u| u.as_str())
            .and_then(clean)
        {
            return Some(uri);
        }
    }
    item.get("hangoutLink")
        .and_then(|x| x.as_str())
        .and_then(clean)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::calendar::graph_source::CalendarSource;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    fn test_policy() -> crate::network_policy::NetworkPolicy {
        crate::network_policy::NetworkPolicy::load_from_directory(
            &tempfile::tempdir().unwrap().keep(),
        )
    }

    #[test]
    fn extracts_video_entry_point_then_hangout_link_then_none() {
        // Prefers the "video" conferenceData entry point over other types.
        let structured = serde_json::json!({
            "conferenceData": { "entryPoints": [
                { "entryPointType": "phone", "uri": "tel:+1-555-0100" },
                { "entryPointType": "video", "uri": "https://meet.google.com/abc-defg-hij" }
            ]},
            "hangoutLink": "https://meet.google.com/legacy-should-be-ignored"
        });
        assert_eq!(
            extract_google_join_url(&structured).as_deref(),
            Some("https://meet.google.com/abc-defg-hij")
        );
        // Falls back to hangoutLink when there is no video entry point.
        let legacy = serde_json::json!({ "hangoutLink": "https://meet.google.com/xyz-1234" });
        assert_eq!(
            extract_google_join_url(&legacy).as_deref(),
            Some("https://meet.google.com/xyz-1234")
        );
        // No conferencing => None.
        assert_eq!(
            extract_google_join_url(&serde_json::json!({ "summary": "in person" })),
            None
        );
    }

    /// VERIFY-LIVE: field names (`items[].id/summary/description`,
    /// `start.dateTime` / `start.date` (all-day), `attendees[].email/
    /// displayName/responseStatus/self`, `organizer.email`, `status`,
    /// `nextPageToken`) come from the Calendar v3 events reference. Confirm
    /// against one real events.list response.
    fn body() -> serde_json::Value {
        serde_json::json!({
            "items": [
                {
                    "id": "g1",
                    "summary": "Ortiz portfolio check-in",
                    "description": "notes",
                    "status": "confirmed",
                    "start": { "dateTime": "2026-07-02T10:00:00-06:00" },
                    "end": { "dateTime": "2026-07-02T11:00:00-06:00" },
                    "organizer": { "email": "adv@firm.com" },
                    "attendees": [
                        { "email": "ortiz@family.com", "displayName": "R Ortiz",
                          "responseStatus": "accepted" },
                        { "email": "adv@firm.com", "self": true,
                          "responseStatus": "accepted" }
                    ]
                },
                {
                    "id": "g2",
                    "summary": "Cancelled thing",
                    "status": "cancelled",
                    "start": { "dateTime": "2026-07-03T10:00:00Z" },
                    "end": { "dateTime": "2026-07-03T11:00:00Z" }
                },
                {
                    "id": "g3",
                    "summary": "Declined by me",
                    "status": "confirmed",
                    "start": { "dateTime": "2026-07-04T10:00:00Z" },
                    "end": { "dateTime": "2026-07-04T11:00:00Z" },
                    "attendees": [
                        { "email": "adv@firm.com", "self": true,
                          "responseStatus": "declined" }
                    ]
                }
            ]
        })
    }

    #[tokio::test]
    async fn fetches_maps_and_flags_google_events() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/calendars/primary/events"))
            .and(query_param("singleEvents", "true"))
            .respond_with(ResponseTemplate::new(200).set_body_json(body()))
            .mount(&server)
            .await;

        let source = GoogleCalendarSource::new_with_base(
            server.uri(),
            || async { Ok("test-token".to_string()) },
            test_policy(),
        );
        let events = source
            .fetch_events("2026-07-01T00:00:00Z", "2026-07-10T00:00:00Z")
            .await
            .unwrap();

        assert_eq!(events.len(), 3);
        assert_eq!(events[0].id, "google:g1");
        assert_eq!(
            events[0].start_utc, "2026-07-02T16:00:00Z",
            "offset -06:00 normalizes"
        );
        assert_eq!(
            events[0].attendees.len(),
            1,
            "self attendee is filtered out"
        );
        assert!(events[1].is_cancelled, "status cancelled maps");
        assert!(events[2].self_declined, "self attendee declined maps");
    }

    #[test]
    fn datetime_without_offset_falls_back_to_sibling_timezone() {
        // codex-review P2 (round 6): a dateTime lacking an explicit UTC
        // offset must resolve via the sibling timeZone field rather than
        // aborting the whole calendar fetch.
        let item = serde_json::json!({
            "id": "g9",
            "summary": "Offsetless",
            "status": "confirmed",
            "start": { "dateTime": "2026-07-02T10:00:00", "timeZone": "America/Denver" },
            "end": { "dateTime": "2026-07-02T11:00:00", "timeZone": "America/Denver" },
        });
        let event = map_google_event(&item).unwrap().unwrap();
        assert_eq!(
            event.start_utc, "2026-07-02T16:00:00Z",
            "MDT is UTC-6 in July"
        );
    }
}
