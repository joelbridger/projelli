// SHA-256 file hashing for the Templates Marketplace install pipeline.
//
// The frontend calls `verifyChecksum(path, expectedHex)`; that function
// invokes this command, which streams the file from disk through a SHA-256
// digester and returns the lower-case hex digest.

use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{BufReader, Read};
use std::path::PathBuf;

/// Compute the SHA-256 of the file at `path`, returning a lower-case hex
/// string. Errors are stringified for the frontend.
#[tauri::command]
pub async fn sha256_file(path: String) -> Result<String, String> {
    tokio::task::spawn_blocking(move || sha256_file_blocking(&path))
        .await
        .map_err(|e| format!("join error: {}", e))?
}

fn sha256_file_blocking(path: &str) -> Result<String, String> {
    let p = PathBuf::from(path);
    let f = File::open(&p).map_err(|e| format!("open {}: {}", p.display(), e))?;
    let mut reader = BufReader::new(f);
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = reader.read(&mut buf).map_err(|e| format!("read: {}", e))?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    #[test]
    fn empty_file_hash_matches_known_constant() {
        let f = NamedTempFile::new().expect("tmpfile");
        let got = sha256_file_blocking(f.path().to_str().unwrap()).expect("hash");
        assert_eq!(
            got,
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn small_payload_hash_matches_known_constant() {
        let mut f = NamedTempFile::new().expect("tmpfile");
        f.write_all(b"hello").expect("write");
        let got = sha256_file_blocking(f.path().to_str().unwrap()).expect("hash");
        assert_eq!(
            got,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn missing_file_returns_error() {
        let res = sha256_file_blocking("/definitely/does/not/exist/projelli-test.bin");
        assert!(res.is_err());
    }
}
