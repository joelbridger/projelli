//! Policy-guarded Hugging Face downloads.
//!
//! `hf-hub` follows its storage redirect internally, which means it cannot
//! prove each host against Lantern's egress registry. This small adapter keeps
//! the cache layout `hf-hub`/fastembed expects while using `EgressHttpClient`,
//! whose redirects are disabled and authorized one hop at a time.

use anyhow::{bail, Context, Result};
use futures_util::StreamExt;
use std::path::{Path, PathBuf};
use tokio::io::AsyncWriteExt;

use crate::commands::connector_network::{authorize_url, await_authorized};
use crate::egress_http::EgressHttpClient;
use crate::network_policy::{EgressOperation, NetworkPolicy};

const MANAGED_SNAPSHOT: &str = "lantern-policy-managed";

fn resolve_url(repo: &str, file: &str) -> String {
    format!("https://huggingface.co/{repo}/resolve/main/{file}")
}

fn snapshot_file(cache_dir: &Path, repo: &str, file: &str) -> PathBuf {
    cache_dir
        .join(format!("models--{}", repo.replace('/', "--")))
        .join("snapshots")
        .join(MANAGED_SNAPSHOT)
        .join(file)
}

fn write_ref(cache_dir: &Path, repo: &str) -> Result<()> {
    let ref_path = cache_dir
        .join(format!("models--{}", repo.replace('/', "--")))
        .join("refs")
        .join("main");
    std::fs::create_dir_all(ref_path.parent().expect("ref parent"))?;
    std::fs::write(ref_path, MANAGED_SNAPSHOT)?;
    Ok(())
}

pub async fn total_size(
    policy: &NetworkPolicy,
    operation: &EgressOperation,
    repo: &str,
    files: &[&str],
) -> Option<u64> {
    let client = EgressHttpClient::new(policy.clone()).ok()?;
    let mut total = 0_u64;
    for file in files {
        let url = resolve_url(repo, file);
        let grant = authorize_url(policy, operation, &url).ok()?;
        let parsed_url = url.parse().ok()?;
        let response = await_authorized(policy, &grant, async {
            Ok(client.head(operation, parsed_url).await?)
        })
        .await
        .ok()?;
        if !response.status().is_success() {
            return None;
        }
        let length = response
            .headers()
            .get(reqwest::header::CONTENT_LENGTH)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
            .or_else(|| {
                response
                    .headers()
                    .get("x-linked-size")
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.parse::<u64>().ok())
            })?;
        total += length;
    }
    Some(total)
}

pub async fn download_missing_files(
    policy: &NetworkPolicy,
    operation: &EgressOperation,
    cache_dir: &Path,
    repo: &str,
    files: &[&str],
    mut on_progress: impl FnMut(&str, u64),
) -> Result<()> {
    let client = EgressHttpClient::new(policy.clone())?;
    for file in files {
        let target = snapshot_file(cache_dir, repo, file);
        if target.exists() {
            continue;
        }
        let url = resolve_url(repo, file);
        let grant = authorize_url(policy, operation, &url)?;
        let response = await_authorized(policy, &grant, async {
            Ok(client.get(operation, url.parse()?).await?)
        })
        .await
        .with_context(|| format!("start download {file}"))?;
        if !response.status().is_success() {
            bail!("download {file}: HTTP {}", response.status());
        }
        let partial = target.with_extension("part");
        tokio::fs::create_dir_all(target.parent().expect("target parent")).await?;
        let mut output = tokio::fs::File::create(&partial).await?;
        let mut bytes = 0_u64;
        await_authorized(policy, &grant, async {
            let mut body = response.bytes_stream();
            while let Some(chunk) = body.next().await {
                let chunk = chunk?;
                output.write_all(&chunk).await?;
                bytes += chunk.len() as u64;
                on_progress(file, bytes);
            }
            output.flush().await?;
            Ok::<(), anyhow::Error>(())
        })
        .await
        .with_context(|| format!("download {file}"))?;
        tokio::fs::rename(&partial, &target).await?;
        write_ref(cache_dir, repo)?;
    }
    // A cache consisting only of already-present files may predate this
    // adapter; rewriting the reference is harmless and makes its layout
    // explicit for hf-hub's Cache::get reader.
    write_ref(cache_dir, repo)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_the_cache_layout_hf_hub_reads() {
        let root = tempfile::tempdir().unwrap();
        write_ref(root.path(), "owner/model").unwrap();
        let path = snapshot_file(root.path(), "owner/model", "nested/file.onnx");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"model").unwrap();
        let cache = hf_hub::Cache::new(root.path().to_owned());
        assert_eq!(
            cache
                .repo(hf_hub::Repo::model("owner/model".into()))
                .get("nested/file.onnx"),
            Some(path)
        );
    }
}
