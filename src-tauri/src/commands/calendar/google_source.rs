//! Google Calendar source: events.list with singleEvents=true, which expands
//! recurring series into occurrences server-side.

use super::graph_source::CalendarSource;
use super::model::{CalendarAttendee, CalendarEvent, CalendarProvider};

type TokenFn = std::sync::Arc<
    dyn Fn() -> std::pin::Pin<
            Box<dyn std::future::Future<Output = Result<String, String>> + Send>,
        > + Send
        + Sync,
>;

pub struct GoogleCalendarSource {
    base_url: String,
    token: TokenFn,
    http: reqwest::Client,
}

impl GoogleCalendarSource {
    pub fn new() -> Self {
        Self::new_with_base(
            "https://www.googleapis.com/calendar/v3".to_string(),
            || async { super::commands::fresh_google_access_token().await },
        )
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
                "{}/calendars/primary/events?singleEvents=true&maxResults=250\
                 &timeMin={}&timeMax={}",
                self.base_url,
                crate::commands::mail::gmail::oauth::urlencoding_encode(from_utc),
                crate::commands::mail::gmail::oauth::urlencoding_encode(to_utc),
            );
            if let Some(t) = &page_token {
                url.push_str(&format!("&pageToken={t}"));
            }
            let resp = self.http.get(&url).bearer_auth(&access).send().await?;
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
            return Ok(Some(rfc3339_to_utc(dt)?));
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
    for a in item.get("attendees").and_then(|x| x.as_array()).unwrap_or(&vec![]) {
        let Some(email) = a.get("email").and_then(|e| e.as_str()) else { continue };
        let is_self = a.get("self").and_then(|s| s.as_bool()).unwrap_or(false);
        let response = a.get("responseStatus").and_then(|r| r.as_str()).unwrap_or("");
        if is_self {
            if response == "declined" {
                self_declined = true;
            }
            continue; // the advisor is not a "client attendee"
        }
        let name = a.get("displayName").and_then(|n| n.as_str()).unwrap_or("").to_string();
        attendees.push(CalendarAttendee { email: email.to_string(), name });
    }
    Ok(Some(CalendarEvent {
        id: format!("google:{id}"),
        provider: CalendarProvider::Google,
        title: item.get("summary").and_then(|x| x.as_str()).unwrap_or("").to_string(),
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
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::calendar::graph_source::CalendarSource;
    use wiremock::matchers::{method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

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

        let source = GoogleCalendarSource::new_with_base(server.uri(), || async {
            Ok("test-token".to_string())
        });
        let events = source
            .fetch_events("2026-07-01T00:00:00Z", "2026-07-10T00:00:00Z")
            .await
            .unwrap();

        assert_eq!(events.len(), 3);
        assert_eq!(events[0].id, "google:g1");
        assert_eq!(events[0].start_utc, "2026-07-02T16:00:00Z", "offset -06:00 normalizes");
        assert_eq!(events[0].attendees.len(), 1, "self attendee is filtered out");
        assert!(events[1].is_cancelled, "status cancelled maps");
        assert!(events[2].self_declined, "self attendee declined maps");
    }
}
