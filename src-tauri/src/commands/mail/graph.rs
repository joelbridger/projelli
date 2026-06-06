use std::time::Duration;

#[derive(Debug, PartialEq)]
pub enum Continuation { Next(String), Delta(String), End }

/// Microsoft says: wait the Retry-After seconds and retry; if absent, back off
/// exponentially. Cap at 60s so a stuck import doesn't sleep forever.
pub fn retry_delay(retry_after_header: Option<&str>, attempt: u32) -> Duration {
    if let Some(h) = retry_after_header {
        if let Ok(secs) = h.trim().parse::<u64>() { return Duration::from_secs(secs); }
    }
    let secs = 1u64.checked_shl(attempt).unwrap_or(60).min(60);
    Duration::from_secs(secs)
}

/// A delta page carries EITHER a nextLink (more pages this round) OR a
/// deltaLink (round complete) OR neither. Never both (per Graph docs).
pub fn page_continuation(page: &serde_json::Value) -> Continuation {
    if let Some(n) = page.get("@odata.nextLink").and_then(|v| v.as_str()) {
        return Continuation::Next(n.to_string());
    }
    if let Some(d) = page.get("@odata.deltaLink").and_then(|v| v.as_str()) {
        return Continuation::Delta(d.to_string());
    }
    Continuation::End
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn retry_after_header_wins() {
        assert_eq!(retry_delay(Some("10"), 0), Duration::from_secs(10));
        assert_eq!(retry_delay(Some("0"), 3), Duration::from_secs(0));
    }

    #[test]
    fn falls_back_to_capped_exponential_backoff() {
        // attempt 0 -> 1s, 1 -> 2s, 2 -> 4s, capped at 60s
        assert_eq!(retry_delay(None, 0), Duration::from_secs(1));
        assert_eq!(retry_delay(None, 2), Duration::from_secs(4));
        assert_eq!(retry_delay(None, 10), Duration::from_secs(60));
    }

    #[test]
    fn extracts_delta_and_next_links() {
        let next = serde_json::json!({ "value": [], "@odata.nextLink": "https://g/n?$skiptoken=s" });
        let delta = serde_json::json!({ "value": [], "@odata.deltaLink": "https://g/d?$deltatoken=d" });
        assert_eq!(page_continuation(&next), Continuation::Next("https://g/n?$skiptoken=s".into()));
        assert_eq!(page_continuation(&delta), Continuation::Delta("https://g/d?$deltatoken=d".into()));
        assert_eq!(page_continuation(&serde_json::json!({"value":[]})), Continuation::End);
    }
}
