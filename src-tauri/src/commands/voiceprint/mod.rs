//! Voiceprint naming (Wave 4 Track A): encrypted, per-matter, local-only
//! speaker centroids. Biometric data — never synced, never sent, deletable
//! from the client's page, deletions audit-logged (renderer side).
pub mod crypto;
pub mod store;

use store::{best_match, load, merge_centroid, save, VoiceprintFile, VoiceprintRecord, AUTO_SUGGEST_THRESHOLD};

#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VoiceprintInfo {
    pub id: String,
    pub name: String,
    pub sample_count: u32,
    pub updated_at: String,
}

#[derive(serde::Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct VoiceprintMatch {
    pub id: String,
    pub name: String,
    pub confidence: f32,
}

fn info(r: &VoiceprintRecord) -> VoiceprintInfo {
    VoiceprintInfo { id: r.id.clone(), name: r.name.clone(), sample_count: r.sample_count, updated_at: r.updated_at.clone() }
}

/// Pure core of voiceprint_enroll (unit-tested without keychain/disk).
pub(crate) fn enroll_into(file: &mut VoiceprintFile, name: &str, embedding: &[f32], now_iso: &str) -> VoiceprintInfo {
    if let Some(existing) = file.voiceprints.iter_mut().find(|r| r.name == name) {
        merge_centroid(existing, embedding);
        return info(existing);
    }
    let rec = VoiceprintRecord {
        id: format!("vp_{}_{:04}", now_iso.replace([':', '-', '.'], ""), rand::random::<u16>() % 10_000),
        name: name.to_string(),
        centroid: embedding.to_vec(),
        dims: embedding.len(),
        sample_count: 1,
        created_at: now_iso.to_string(),
        updated_at: now_iso.to_string(),
    };
    let out = info(&rec);
    file.voiceprints.push(rec);
    out
}

/// Pure core of voiceprint_match.
pub(crate) fn match_in(file: &VoiceprintFile, embedding: &[f32]) -> Option<VoiceprintMatch> {
    let (idx, confidence) = best_match(file, embedding)?;
    if confidence < AUTO_SUGGEST_THRESHOLD {
        return None;
    }
    let r = &file.voiceprints[idx];
    Some(VoiceprintMatch { id: r.id.clone(), name: r.name.clone(), confidence })
}

fn with_file<T>(
    workspace_root: &str,
    matter_id: &str,
    f: impl FnOnce(&mut VoiceprintFile) -> Result<(T, bool), String>,
) -> Result<T, String> {
    let ws = std::path::Path::new(workspace_root);
    let key = crypto::get_or_create_master_key()?;
    let mut file = load(ws, matter_id, &key)?;
    let (out, dirty) = f(&mut file)?;
    if dirty {
        save(ws, matter_id, &key, &file)?;
    }
    Ok(out)
}

#[tauri::command]
pub async fn voiceprint_list(workspace_root: String, matter_id: String) -> Result<Vec<VoiceprintInfo>, String> {
    tokio::task::spawn_blocking(move || {
        with_file(&workspace_root, &matter_id, |f| Ok((f.voiceprints.iter().map(info).collect(), false)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn voiceprint_enroll(workspace_root: String, matter_id: String, name: String, embedding: Vec<f32>) -> Result<VoiceprintInfo, String> {
    tokio::task::spawn_blocking(move || {
        let now = chrono::Utc::now().to_rfc3339();
        with_file(&workspace_root, &matter_id, |f| Ok((enroll_into(f, &name, &embedding, &now), true)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn voiceprint_match(workspace_root: String, matter_id: String, embedding: Vec<f32>) -> Result<Option<VoiceprintMatch>, String> {
    tokio::task::spawn_blocking(move || {
        with_file(&workspace_root, &matter_id, |f| Ok((match_in(f, &embedding), false)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn voiceprint_confirm(workspace_root: String, matter_id: String, voiceprint_id: String, embedding: Vec<f32>) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        with_file(&workspace_root, &matter_id, |f| {
            let rec = f.voiceprints.iter_mut().find(|r| r.id == voiceprint_id).ok_or("voiceprint not found")?;
            merge_centroid(rec, &embedding);
            Ok(((), true))
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn voiceprint_delete(workspace_root: String, matter_id: String, voiceprint_id: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        with_file(&workspace_root, &matter_id, |f| {
            let before = f.voiceprints.len();
            f.voiceprints.retain(|r| r.id != voiceprint_id);
            if f.voiceprints.len() == before {
                return Err("voiceprint not found".to_string());
            }
            Ok(((), true))
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::store::*;
    use super::*;

    #[test]
    fn enroll_merge_semantics_new_vs_existing_name() {
        let mut f = VoiceprintFile::default();
        let info1 = enroll_into(&mut f, "Sarah Henderson", &[1.0, 0.0], "t1");
        assert_eq!(f.voiceprints.len(), 1);
        assert_eq!(info1.sample_count, 1);
        let info2 = enroll_into(&mut f, "Sarah Henderson", &[0.0, 1.0], "t2");
        assert_eq!(f.voiceprints.len(), 1, "same name merges, not duplicates");
        assert_eq!(info2.sample_count, 2);
        let info3 = enroll_into(&mut f, "Bob Alvarez", &[0.0, 1.0], "t3");
        assert_eq!(f.voiceprints.len(), 2);
        assert_eq!(info3.name, "Bob Alvarez");
    }

    #[test]
    fn match_applies_threshold() {
        let mut f = VoiceprintFile::default();
        enroll_into(&mut f, "A", &[1.0, 0.0], "t1");
        assert!(match_in(&f, &[0.95, 0.05]).is_some());
        assert!(match_in(&f, &[0.0, 1.0]).is_none(), "orthogonal voice must not suggest");
    }
}
