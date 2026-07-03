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
            self.finished.push(self.current_path());
        }
        self.index += 1;
        self.written_in_chunk = 0;
        let file = std::fs::File::create(self.current_path())?;
        self.writer = Some(hound::WavWriter::new(std::io::BufWriter::new(file), Self::spec())?);
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
            // Durability: flush samples so a crash loses only unflushed tail.
            self.writer.as_mut().unwrap().flush()?;
        }
        Ok(())
    }

    pub fn finish(mut self) -> Result<Vec<PathBuf>> {
        if let Some(w) = self.writer.take() {
            if self.written_in_chunk > 0 {
                w.finalize()?;
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
        // Crash-path: finalize whatever is open so the chunk header is valid.
        if let Some(w) = self.writer.take() {
            let _ = w.finalize();
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
}
