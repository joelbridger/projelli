//! lantern-diarize — offline speaker diarization sidecar.
//!
//! Wraps sherpa-onnx's speaker pipeline (segmentation + embedding + clustering)
//! behind a stable CLI/JSON contract so the host app never links onnxruntime.
//! Reads one mono 16 kHz WAV, prints one JSON object to stdout (schema in the
//! Wave 4 plan, Task 6), exits non-zero with a stderr message on failure.
use anyhow::{anyhow, bail, Context, Result};

#[derive(Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnMs {
    pub start_ms: u64,
    pub end_ms: u64,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerOut {
    pub index: usize,
    pub label: String,
    pub turns: Vec<TurnMs>,
    pub centroid: Vec<f32>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiarizeOut {
    pub dims: usize,
    pub speakers: Vec<SpeakerOut>,
}

#[derive(Debug, PartialEq)]
pub struct Args {
    pub wav: String,
    pub seg_model: String,
    pub emb_model: String,
    pub num_speakers: Option<u32>,
    pub threshold: f32,
}

pub fn parse_args(argv: &[String]) -> Result<Args> {
    let mut wav = None;
    let mut seg = None;
    let mut emb = None;
    let mut num_speakers = None;
    let mut threshold = 0.5f32;
    let mut i = 0;
    while i < argv.len() {
        let take = |i: usize| -> Result<&String> {
            argv.get(i + 1).context("missing value for flag")
        };
        match argv[i].as_str() {
            "--wav" => wav = Some(take(i)?.clone()),
            "--seg-model" => seg = Some(take(i)?.clone()),
            "--emb-model" => emb = Some(take(i)?.clone()),
            "--num-speakers" => num_speakers = Some(take(i)?.parse::<u32>()?),
            "--threshold" => threshold = take(i)?.parse::<f32>()?,
            other => bail!("unknown flag: {other}"),
        }
        i += 2;
    }
    Ok(Args {
        wav: wav.context("--wav is required")?,
        seg_model: seg.context("--seg-model is required")?,
        emb_model: emb.context("--emb-model is required")?,
        num_speakers,
        threshold,
    })
}

/// Group raw (start_ms, end_ms, speaker_idx) segments into per-speaker turn
/// lists, 1-based display labels, sorted by speaker index.
pub fn group_turns(raw: &[(u64, u64, usize)]) -> Vec<(usize, String, Vec<TurnMs>)> {
    let mut by_speaker: std::collections::BTreeMap<usize, Vec<TurnMs>> = Default::default();
    for &(s, e, idx) in raw {
        by_speaker.entry(idx).or_default().push(TurnMs { start_ms: s, end_ms: e });
    }
    by_speaker
        .into_iter()
        .map(|(idx, mut turns)| {
            turns.sort_by_key(|t| t.start_ms);
            (idx, format!("Speaker {}", idx + 1), turns)
        })
        .collect()
}

/// Mean of the given embeddings, L2-normalized. Used to build one centroid
/// per speaker from that speaker's per-turn embeddings. Embeddings containing
/// a non-finite value are dropped first: VERIFY-LIVE 2026-07-03 found that
/// sherpa-onnx's embedding model can emit NaN for a very short (sub-second)
/// turn, and a single bad turn must not poison the whole speaker's centroid.
pub fn mean_normalized(embeddings: &[Vec<f32>]) -> Vec<f32> {
    let embeddings: Vec<&Vec<f32>> = embeddings.iter().filter(|e| e.iter().all(|v| v.is_finite())).collect();
    if embeddings.is_empty() {
        return Vec::new();
    }
    let dims = embeddings[0].len();
    let mut mean = vec![0.0f32; dims];
    for e in &embeddings {
        for (m, v) in mean.iter_mut().zip(e.iter()) {
            *m += v;
        }
    }
    let n = embeddings.len() as f32;
    for m in mean.iter_mut() {
        *m /= n;
    }
    let norm = mean.iter().map(|v| v * v).sum::<f32>().sqrt();
    if norm > 0.0 {
        for m in mean.iter_mut() {
            *m /= norm;
        }
    }
    mean
}

/// sherpa-onnx's pyannote segmentation + speaker-embedding models are trained
/// on 16 kHz audio; the sidecar contract requires callers to resample first.
const EXPECTED_SAMPLE_RATE: u32 = 16_000;

fn main() {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let out = parse_args(&argv).and_then(run);
    match out {
        Ok(json) => println!("{json}"),
        Err(e) => {
            eprintln!("lantern-diarize error: {e:#}");
            std::process::exit(1);
        }
    }
}

fn run(args: Args) -> Result<String> {
    // Read mono 16 kHz WAV into f32 samples (sherpa expects f32 PCM).
    let mut reader = hound::WavReader::open(&args.wav).context("open wav")?;
    let spec = reader.spec();
    if spec.channels != 1 {
        bail!("expected mono wav, got {} channels", spec.channels);
    }
    if spec.sample_rate != EXPECTED_SAMPLE_RATE {
        bail!(
            "expected {} Hz wav, got {} Hz (resample before calling lantern-diarize)",
            EXPECTED_SAMPLE_RATE,
            spec.sample_rate
        );
    }
    let samples: Vec<f32> = match spec.sample_format {
        hound::SampleFormat::Int => reader
            .samples::<i16>()
            .map(|s| s.map(|v| f32::from(v) / 32768.0))
            .collect::<std::result::Result<_, _>>()?,
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .collect::<std::result::Result<_, _>>()?,
    };

    let raw: Vec<(u64, u64, usize)> = diarize_with_sherpa(&args, &samples)?;
    let mut speakers = Vec::new();
    let mut dims = 0usize;
    for (idx, label, turns) in group_turns(&raw) {
        let embs: Vec<Vec<f32>> = embed_turns_with_sherpa(&args, &samples, &turns)?;
        let centroid = mean_normalized(&embs);
        dims = dims.max(centroid.len());
        speakers.push(SpeakerOut { index: idx, label, turns, centroid });
    }
    Ok(serde_json::to_string(&DiarizeOut { dims, speakers })?)
}

/// Run sherpa-onnx's offline speaker diarization pipeline (pyannote
/// segmentation + embedding-based clustering) and return raw
/// (start_ms, end_ms, speaker_idx) tuples. Segments sherpa marks as
/// unclustered (speaker < 0) are dropped.
fn diarize_with_sherpa(args: &Args, samples: &[f32]) -> Result<Vec<(u64, u64, usize)>> {
    use sherpa_rs::diarize::{Diarize, DiarizeConfig};

    // sherpa-rs returns eyre::Result, not anyhow::Result — its error type
    // doesn't implement std::error::Error the way anyhow::Context expects,
    // so bridge via the Display impl instead of `.context()`.
    let mut diarizer = Diarize::new(
        &args.seg_model,
        &args.emb_model,
        DiarizeConfig {
            num_clusters: args.num_speakers.map(|n| n as i32),
            threshold: Some(args.threshold),
            ..Default::default()
        },
    )
    .map_err(|e| anyhow!("initialize sherpa-onnx diarizer: {e}"))?;

    // sherpa-rs's compute() cannot distinguish "genuinely zero segments" (a
    // meeting's far-end channel with no speech at all — a real, non-error
    // outcome) from a null-result-pointer failure: both raise the same
    // "No segments found or invalid pointer." error (crates/sherpa-rs/src/
    // diarize.rs, VERIFY-LIVE 2026-07-03). Treat that specific message as
    // zero speakers rather than a hard failure; any other error still bails.
    let segments = match diarizer.compute(samples.to_vec(), None) {
        Ok(segments) => segments,
        Err(e) if e.to_string().contains("No segments found") => Vec::new(),
        Err(e) => return Err(anyhow!("run sherpa-onnx diarization: {e}")),
    };

    Ok(segments
        .into_iter()
        .filter(|s| s.speaker >= 0)
        .map(|s| {
            let start_ms = (f64::from(s.start) * 1000.0).round() as u64;
            let end_ms = (f64::from(s.end) * 1000.0).round() as u64;
            (start_ms, end_ms, s.speaker as usize)
        })
        .collect())
}

/// Compute one speaker-embedding vector per turn by re-running the embedding
/// model over that turn's raw samples. The diarizer's Segment output carries
/// only (start, end, speaker) — no embeddings — so centroids are computed
/// explicitly here, reusing the same embedding model passed via --emb-model.
fn embed_turns_with_sherpa(args: &Args, samples: &[f32], turns: &[TurnMs]) -> Result<Vec<Vec<f32>>> {
    use sherpa_rs::speaker_id::{EmbeddingExtractor, ExtractorConfig};

    let mut extractor = EmbeddingExtractor::new(ExtractorConfig {
        model: args.emb_model.clone(),
        provider: None,
        num_threads: None,
        debug: false,
    })
    .map_err(|e| anyhow!("initialize sherpa-onnx embedding extractor: {e}"))?;

    let mut embeddings = Vec::with_capacity(turns.len());
    for turn in turns {
        let start_idx = ((turn.start_ms as f64 / 1000.0) * f64::from(EXPECTED_SAMPLE_RATE)).round() as usize;
        let end_idx = (((turn.end_ms as f64 / 1000.0) * f64::from(EXPECTED_SAMPLE_RATE)).round() as usize)
            .min(samples.len());
        if start_idx >= end_idx {
            continue;
        }
        let chunk = samples[start_idx..end_idx].to_vec();
        let embedding = extractor
            .compute_speaker_embedding(chunk, EXPECTED_SAMPLE_RATE)
            .map_err(|e| anyhow!("compute speaker embedding for turn: {e}"))?;
        embeddings.push(embedding);
    }
    Ok(embeddings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parse_args_requires_wav_and_models() {
        assert!(parse_args(&a(&["--wav", "x.wav"])).is_err());
        let ok = parse_args(&a(&["--wav", "x.wav", "--seg-model", "s.onnx", "--emb-model", "e.onnx"])).unwrap();
        assert_eq!(ok.threshold, 0.5);
        assert_eq!(ok.num_speakers, None);
    }

    #[test]
    fn parse_args_reads_optional_flags() {
        let ok = parse_args(&a(&["--wav", "x", "--seg-model", "s", "--emb-model", "e", "--num-speakers", "2", "--threshold", "0.7"])).unwrap();
        assert_eq!(ok.num_speakers, Some(2));
        assert!((ok.threshold - 0.7).abs() < 1e-6);
    }

    #[test]
    fn group_turns_labels_and_sorts() {
        let raw = vec![(5000, 6000, 1), (0, 1000, 0), (2000, 3000, 1)];
        let grouped = group_turns(&raw);
        assert_eq!(grouped.len(), 2);
        assert_eq!(grouped[0].1, "Speaker 1");
        assert_eq!(grouped[1].1, "Speaker 2");
        assert_eq!(grouped[1].2[0].start_ms, 2000); // sorted within speaker
    }

    #[test]
    fn mean_normalized_is_unit_length() {
        let c = mean_normalized(&[vec![1.0, 0.0], vec![0.0, 1.0]]);
        let norm: f32 = c.iter().map(|v| v * v).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-5);
    }

    #[test]
    fn mean_normalized_drops_non_finite_embeddings() {
        // A single sub-second turn can make sherpa-onnx's embedding model
        // emit NaN (observed live 2026-07-03 on a 506ms turn); it must not
        // poison the speaker's centroid.
        let c = mean_normalized(&[vec![1.0, 0.0], vec![f32::NAN, f32::NAN]]);
        assert_eq!(c, vec![1.0, 0.0]);
        let all_bad = mean_normalized(&[vec![f32::NAN, f32::INFINITY]]);
        assert!(all_bad.is_empty());
    }

    #[test]
    fn json_contract_shape() {
        let out = DiarizeOut {
            dims: 2,
            speakers: vec![SpeakerOut { index: 0, label: "Speaker 1".into(), turns: vec![TurnMs { start_ms: 320, end_ms: 3010 }], centroid: vec![0.6, 0.8] }],
        };
        let j = serde_json::to_string(&out).unwrap();
        assert!(j.contains(r#""startMs":320"#));
        assert!(j.contains(r#""label":"Speaker 1""#));
        assert!(j.contains(r#""dims":2"#));
    }
}
