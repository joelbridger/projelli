//! Per-matter encrypted voiceprint store: <workspace-data-dir>/voiceprints/
//! <matter>.kpv, AES-256-GCM (lantern-vault KPV1). Local-only by design.
use std::path::{Path, PathBuf};

pub const AUTO_SUGGEST_THRESHOLD: f32 = 0.60;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VoiceprintRecord {
    pub id: String,
    pub name: String,
    pub centroid: Vec<f32>,
    pub dims: usize,
    pub sample_count: u32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct VoiceprintFile {
    pub voiceprints: Vec<VoiceprintRecord>,
}

fn sanitize_for_filename(matter_id: &str) -> String {
    matter_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect()
}

pub fn store_path(workspace_root: &Path, matter_id: &str) -> PathBuf {
    // Always ask the data-dir seam so every internal store uses the same
    // `.lantern` folder.
    crate::commands::data_dir::workspace_data_dir(workspace_root)
        .join("voiceprints")
        .join(format!("{}.kpv", sanitize_for_filename(matter_id)))
}

pub fn load(workspace_root: &Path, matter_id: &str, key: &[u8; 32]) -> Result<VoiceprintFile, String> {
    let path = store_path(workspace_root, matter_id);
    if !path.exists() {
        return Ok(VoiceprintFile::default());
    }
    let blob = std::fs::read(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    let plain = lantern_vault::format::decrypt_file(&blob, key).map_err(|e| format!("decrypt voiceprints: {e}"))?;
    serde_json::from_slice(&plain).map_err(|e| format!("parse voiceprints: {e}"))
}

pub fn save(workspace_root: &Path, matter_id: &str, key: &[u8; 32], file: &VoiceprintFile) -> Result<(), String> {
    let path = store_path(workspace_root, matter_id);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let plain = serde_json::to_vec(file).map_err(|e| e.to_string())?;
    let blob = lantern_vault::format::encrypt_file(&plain, key).map_err(|e| format!("encrypt voiceprints: {e}"))?;
    lantern_vault::atomic::atomic_write(&path, &blob).map_err(|e| format!("write voiceprints: {e}"))
}

pub fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.is_empty() || a.len() != b.len() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let na: f32 = a.iter().map(|v| v * v).sum::<f32>().sqrt();
    let nb: f32 = b.iter().map(|v| v * v).sum::<f32>().sqrt();
    if na == 0.0 || nb == 0.0 {
        return 0.0;
    }
    dot / (na * nb)
}

pub fn best_match(file: &VoiceprintFile, embedding: &[f32]) -> Option<(usize, f32)> {
    file.voiceprints
        .iter()
        .enumerate()
        .map(|(i, r)| (i, cosine(&r.centroid, embedding)))
        .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal))
}

pub fn merge_centroid(rec: &mut VoiceprintRecord, embedding: &[f32]) {
    if embedding.len() != rec.centroid.len() {
        return; // dimension mismatch (model change) — keep the existing centroid
    }
    let n = rec.sample_count as f32;
    for (c, e) in rec.centroid.iter_mut().zip(embedding) {
        *c = (*c * n + e) / (n + 1.0);
    }
    let norm: f32 = rec.centroid.iter().map(|v| v * v).sum::<f32>().sqrt();
    if norm > 0.0 {
        for c in rec.centroid.iter_mut() {
            *c /= norm;
        }
    }
    rec.sample_count += 1;
    rec.updated_at = chrono::Utc::now().to_rfc3339();
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    const KEY: [u8; 32] = [7u8; 32];

    fn rec(name: &str, centroid: Vec<f32>) -> VoiceprintRecord {
        VoiceprintRecord {
            id: format!("vp_{name}"),
            name: name.to_string(),
            dims: centroid.len(),
            centroid,
            sample_count: 1,
            created_at: "2026-07-02T00:00:00Z".into(),
            updated_at: "2026-07-02T00:00:00Z".into(),
        }
    }

    #[test]
    fn store_path_is_encrypted_per_matter_under_workspace_data_dir() {
        let p = store_path(std::path::Path::new("/ws"), "matter_abc/../etc");
        let voiceprints_dir = std::path::Path::new("/ws").join(".lantern").join("voiceprints");
        assert!(p.starts_with(&voiceprints_dir));
        assert_eq!(p.extension().and_then(|ext| ext.to_str()), Some("kpv"));
        assert!(
            !p.file_name().unwrap().to_string_lossy().contains(".."),
            "matter id must be sanitized for the filename"
        );
    }

    #[test]
    fn save_load_roundtrip_and_ciphertext_on_disk() {
        let ws = tempdir().unwrap();
        let mut f = VoiceprintFile::default();
        f.voiceprints.push(rec("Sarah Henderson", vec![0.6, 0.8]));
        save(ws.path(), "m-1", &KEY, &f).unwrap();
        let raw = std::fs::read(store_path(ws.path(), "m-1")).unwrap();
        assert!(!raw.windows(5).any(|w| w == b"Sarah"), "name must not be plaintext on disk");
        assert!(lantern_vault::format::has_vault_magic(&raw), "must be a KPV1 blob");
        let loaded = load(ws.path(), "m-1", &KEY).unwrap();
        assert_eq!(loaded.voiceprints[0].name, "Sarah Henderson");
    }

    #[test]
    fn load_missing_is_empty_and_wrong_key_errors() {
        let ws = tempdir().unwrap();
        assert!(load(ws.path(), "m-none", &KEY).unwrap().voiceprints.is_empty());
        let mut f = VoiceprintFile::default();
        f.voiceprints.push(rec("A", vec![1.0, 0.0]));
        save(ws.path(), "m-1", &KEY, &f).unwrap();
        assert!(load(ws.path(), "m-1", &[9u8; 32]).is_err());
    }

    #[test]
    fn cosine_and_best_match_with_threshold_semantics() {
        assert!((cosine(&[1.0, 0.0], &[1.0, 0.0]) - 1.0).abs() < 1e-6);
        assert!(cosine(&[1.0, 0.0], &[0.0, 1.0]).abs() < 1e-6);
        let mut f = VoiceprintFile::default();
        f.voiceprints.push(rec("A", vec![1.0, 0.0]));
        f.voiceprints.push(rec("B", vec![0.0, 1.0]));
        let (idx, conf) = best_match(&f, &[0.9, 0.1]).unwrap();
        assert_eq!(f.voiceprints[idx].name, "A");
        assert!(conf > AUTO_SUGGEST_THRESHOLD);
        assert!(best_match(&VoiceprintFile::default(), &[1.0]).is_none());
    }

    #[test]
    fn merge_centroid_running_mean_renormalizes_and_counts() {
        let mut r = rec("A", vec![1.0, 0.0]);
        merge_centroid(&mut r, &[0.0, 1.0]);
        assert_eq!(r.sample_count, 2);
        let norm: f32 = r.centroid.iter().map(|v| v * v).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-5);
        assert!((r.centroid[0] - r.centroid[1]).abs() < 1e-5); // equal blend of the two
    }
}
