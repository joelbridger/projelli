// G6: Best-effort OS full-disk encryption detection.
// Non-blocking — never errors the app if detection fails.
// Returns FdeState::Unknown when detection is not possible.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum FdeState {
    On,
    Off,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FdeStatus {
    pub status: FdeState,
    pub platform: String,
    pub detail: Option<String>,
}

/// Best-effort OS full-disk encryption detection. Never panics; never blocks
/// user flow. Returns FdeState::Unknown if the check cannot be completed.
pub fn detect() -> FdeStatus {
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let out = Command::new("fdesetup").arg("status").output();
        match out {
            Ok(o) => {
                let s = String::from_utf8_lossy(&o.stdout).to_lowercase();
                let state = if s.contains("filevault is on") {
                    FdeState::On
                } else if s.contains("filevault is off") {
                    FdeState::Off
                } else {
                    FdeState::Unknown
                };
                return FdeStatus {
                    status: state,
                    platform: "macOS".into(),
                    detail: None,
                };
            }
            Err(_) => {
                return FdeStatus {
                    status: FdeState::Unknown,
                    platform: "macOS".into(),
                    detail: Some("fdesetup unavailable".into()),
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        // `manage-bde -status C:` — 0 exit + "Protection On" = encrypted.
        let out = Command::new("manage-bde").args(["-status", "C:"]).output();
        match out {
            Ok(o) => {
                let s = String::from_utf8_lossy(&o.stdout).to_lowercase();
                let state = if s.contains("percentage encrypted: 100")
                    || s.contains("protection on")
                {
                    FdeState::On
                } else if s.contains("protection off")
                    || s.contains("percentage encrypted: 0")
                {
                    FdeState::Off
                } else {
                    FdeState::Unknown
                };
                return FdeStatus {
                    status: state,
                    platform: "Windows".into(),
                    detail: None,
                };
            }
            Err(_) => {
                return FdeStatus {
                    status: FdeState::Unknown,
                    platform: "Windows".into(),
                    detail: Some("manage-bde unavailable".into()),
                }
            }
        }
    }
    #[cfg(target_os = "linux")]
    {
        // Linux best-effort: check if any block device uses LUKS (lsblk -o NAME,TYPE).
        // If lsblk shows a "crypt" type, the system has a LUKS volume.
        // If lsblk succeeds but shows no crypt, we return Unknown (not Off) because
        // the user may use other encryption methods (eCryptfs, loop-AES, etc.) that
        // are not visible to lsblk.
        use std::process::Command;
        let out = Command::new("lsblk").args(["-o", "NAME,TYPE"]).output();
        let (state, detail) = match out {
            Ok(o) => {
                let s = String::from_utf8_lossy(&o.stdout);
                if s.contains("crypt") {
                    (FdeState::On, "LUKS crypt device detected".into())
                } else {
                    (
                        FdeState::Unknown,
                        "no LUKS crypt device detected (other encryption methods may be in use)"
                            .into(),
                    )
                }
            }
            Err(_) => (FdeState::Unknown, "lsblk unavailable".into()),
        };
        return FdeStatus {
            status: state,
            platform: "Linux".into(),
            detail: Some(detail),
        };
    }
    #[allow(unreachable_code)]
    FdeStatus {
        status: FdeState::Unknown,
        platform: "unknown".into(),
        detail: None,
    }
}

#[tauri::command]
pub async fn mail_fde_status() -> Result<FdeStatus, String> {
    Ok(detect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fde_status_has_known_variant() {
        // Smoke test: detect() returns a valid FdeStatus without panicking.
        // We cannot assert a specific value in CI (may vary by platform),
        // so we verify it serializes cleanly with a 'status' field.
        let status = detect();
        let json = serde_json::to_string(&status).expect("serialize FdeStatus");
        assert!(
            json.contains("\"status\""),
            "FdeStatus must serialize with a 'status' field: {}",
            json
        );
    }

    #[test]
    fn fde_status_serializes_camel_case() {
        let s = FdeStatus {
            status: FdeState::On,
            platform: "test".into(),
            detail: None,
        };
        let json = serde_json::to_string(&s).expect("serialize");
        // FdeState::On must serialize as "on" (lowercase via serde rename_all)
        // Frontend checks `status === 'on'`
        assert!(
            json.contains("\"on\"") || json.contains("\"off\"") || json.contains("\"unknown\""),
            "FdeState variants must serialize as lowercase strings, got: {}",
            json
        );
        assert!(
            json.contains("\"on\""),
            "FdeState::On must serialize as \"on\", got: {}",
            json
        );
    }

    #[test]
    fn fde_state_off_serializes_as_off() {
        let s = FdeStatus {
            status: FdeState::Off,
            platform: "test".into(),
            detail: Some("test detail".into()),
        };
        let json = serde_json::to_string(&s).expect("serialize");
        assert!(json.contains("\"off\""), "FdeState::Off must serialize as \"off\"");
        assert!(json.contains("\"status\""), "must have status field");
    }

    #[test]
    fn fde_state_unknown_serializes_as_unknown() {
        let s = FdeStatus {
            status: FdeState::Unknown,
            platform: "test".into(),
            detail: None,
        };
        let json = serde_json::to_string(&s).expect("serialize");
        assert!(json.contains("\"unknown\""), "FdeState::Unknown must serialize as \"unknown\"");
    }
}
