//! Crash-durable chunked WAV writer. Every rotate finalizes the current WAV
//! header and fsyncs, so a hard kill loses at most the currently-open chunk's
//! tail — never the meeting. (Master plan: capture reliability is XL-critical.)

use anyhow::Result;
use std::path::{Path, PathBuf};

pub const SAMPLE_RATE: u32 = 16_000;
pub const CHUNK_SECONDS: u32 = 20;
const SAMPLES_PER_CHUNK: u64 = (SAMPLE_RATE as u64) * (CHUNK_SECONDS as u64);

pub struct ChunkWriter {
    dir: PathBuf,
    channel: String,
    index: u32,
    written_in_chunk: u64,
    writer: Option<hound::WavWriter<std::io::BufWriter<std::fs::File>>>,
    /// A second fd on the same underlying file as `writer`'s `BufWriter`,
    /// kept ONLY to fsync it. `hound::WavWriter` doesn't expose the file it
    /// wraps, but `File::sync_all` just forces whatever has already been
    /// `write()`n to the kernel — through EITHER fd — out to stable
    /// storage, so this doesn't need to be the same fd hound writes
    /// through, only the same underlying file.
    sync_handle: Option<std::fs::File>,
    finished: Vec<PathBuf>,
}

impl ChunkWriter {
    pub fn new(dir: &Path, channel: &str) -> Result<Self> {
        std::fs::create_dir_all(dir)?;
        let mut w = Self {
            dir: dir.to_path_buf(),
            channel: channel.to_string(),
            index: 0,
            written_in_chunk: 0,
            writer: None,
            sync_handle: None,
            finished: Vec::new(),
        };
        w.rotate()?;
        Ok(w)
    }

    fn spec() -> hound::WavSpec {
        hound::WavSpec {
            channels: 1,
            sample_rate: SAMPLE_RATE,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        }
    }

    fn current_path(&self) -> PathBuf {
        self.dir.join(format!("{}-{:06}.wav", self.channel, self.index))
    }

    fn rotate(&mut self) -> Result<()> {
        if let Some(w) = self.writer.take() {
            w.finalize()?; // writes the header length + flushes
            // flush() only pushes bytes out of Rust's BufWriter into the
            // OS's page cache — a power loss (not just this process dying)
            // can still lose them if they were never forced to stable
            // storage. sync_all() is the actual fsync this module's own doc
            // comment has always promised.
            if let Some(h) = self.sync_handle.take() {
                h.sync_all()?;
            }
            self.finished.push(self.current_path());
        }
        self.index += 1;
        self.written_in_chunk = 0;
        let file = std::fs::File::create(self.current_path())?;
        let sync_handle = file.try_clone()?;
        let mut writer = hound::WavWriter::new(std::io::BufWriter::new(file), Self::spec())?;
        // `WavWriter::new` only buffers the header in the `BufWriter`, it
        // does not push it to the OS. If the process is hard-killed any time
        // between here and the first `write()`'s own flush (which, for a
        // silent stretch or right at meeting-end, can be the whole rest of
        // the chunk's 20s window), the file on disk is 0 bytes — not even a
        // valid WAV header. `finalize_session` opens every chunk with
        // `hound::WavReader::open`, which requires a parseable header, so
        // one such file would fail to open and abort recovery of the ENTIRE
        // meeting, not just this chunk's tail — directly contradicting this
        // module's crash-durability guarantee. Flushing (and syncing) right
        // away pushes a valid (empty) header to stable storage immediately,
        // so a crash before any samples land here leaves a parseable
        // zero-sample chunk instead.
        writer.flush()?;
        sync_handle.sync_all()?;
        self.writer = Some(writer);
        self.sync_handle = Some(sync_handle);
        Ok(())
    }

    pub fn write(&mut self, samples: &[i16]) -> Result<()> {
        let w = self.writer.as_mut().expect("writer always present");
        for s in samples {
            w.write_sample(*s)?;
        }
        self.written_in_chunk += samples.len() as u64;
        if self.written_in_chunk >= SAMPLES_PER_CHUNK {
            self.rotate()?;
        } else {
            // Durability: flush AND sync so a crash — process death or a
            // genuine power loss — loses only whatever arrives after this
            // call, not this call's own samples sitting unsynced in the OS
            // page cache.
            self.writer.as_mut().unwrap().flush()?;
            if let Some(h) = self.sync_handle.as_ref() {
                h.sync_all()?;
            }
        }
        Ok(())
    }

    pub fn finish(mut self) -> Result<Vec<PathBuf>> {
        if let Some(w) = self.writer.take() {
            if self.written_in_chunk > 0 {
                w.finalize()?;
                if let Some(h) = self.sync_handle.take() {
                    h.sync_all()?;
                }
                self.finished.push(self.current_path());
            } else {
                w.finalize()?;
                let _ = std::fs::remove_file(self.current_path());
            }
        }
        Ok(self.finished.clone())
    }
}

impl Drop for ChunkWriter {
    fn drop(&mut self) {
        // Crash-path: finalize whatever is open so the chunk header is
        // valid, and sync it so that header (and whatever samples are
        // already in the OS page cache) survives a subsequent power loss,
        // not just this process's own death.
        if let Some(w) = self.writer.take() {
            let _ = w.finalize();
        }
        if let Some(h) = self.sync_handle.take() {
            let _ = h.sync_all();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn chunk_writer_rotates_and_survives_drop_without_finish() {
        let dir = tempdir().unwrap();
        let mut w = ChunkWriter::new(dir.path(), "mic").unwrap();
        // 25 s of silence at 16 kHz → must produce 2 chunks (20 s + 5 s)
        let one_sec = vec![0i16; 16_000];
        for _ in 0..25 {
            w.write(&one_sec).unwrap();
        }
        drop(w); // simulate crash: NO finish() call
        let mut names: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        names.sort();
        assert_eq!(names, vec!["mic-000001.wav", "mic-000002.wav"]);
        // Every chunk on disk must be a valid, readable WAV even without finish().
        for n in &names {
            let r = hound::WavReader::open(dir.path().join(n)).unwrap();
            assert_eq!(r.spec().sample_rate, 16_000);
            assert!(r.len() > 0);
        }
    }

    /// Regression for the codex-review round-10 finding: `WavWriter::new`
    /// only buffers the header in a `BufWriter` — it isn't pushed to disk
    /// until a flush. A hard kill in the window between chunk creation and
    /// the first `write()`'s own flush (which can be the whole 20s chunk
    /// window during a silent stretch) used to leave a literal 0-byte file
    /// that `hound::WavReader::open` can't parse at all, which would abort
    /// recovery of the ENTIRE meeting in `finalize_session`, not just this
    /// chunk's tail. `std::mem::forget` simulates a hard kill: unlike
    /// `drop(w)`, it skips `Drop::drop`'s own `finalize()` call entirely, so
    /// this only passes if `rotate()` itself already flushed a valid header.
    #[test]
    fn newly_rotated_chunk_is_a_valid_wav_even_before_any_write_or_drop() {
        let dir = tempdir().unwrap();
        let w = ChunkWriter::new(dir.path(), "mic").unwrap();
        std::mem::forget(w);
        let r = hound::WavReader::open(dir.path().join("mic-000001.wav")).unwrap();
        assert_eq!(r.spec().sample_rate, 16_000);
        assert_eq!(r.len(), 0);
    }
}
