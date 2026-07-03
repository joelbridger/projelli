#!/usr/bin/env bash
# scripts/fetch-diarize-models.sh — download the sherpa-onnx diarization models
# into src-tauri/resources/diarize/ (bundled via the resources/**/* glob).
# Mirrors scripts/fetch-piper-sidecar.sh: pinned URLs + SHA256 verification.
set -euo pipefail
cd "$(dirname "$0")/.."
DEST=src-tauri/resources/diarize
mkdir -p "$DEST"

# Pinned to k2-fsa/sherpa-onnx release assets, verified 2026-07-03:
#   segmentation: sherpa-onnx-pyannote-segmentation-3-0.tar.bz2 -> model.onnx
#   embedding:    nemo_en_titanet_small.onnx (SHA256 cross-checked against the
#                 upstream checksum.txt in the same release)
SEG_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
SEG_SHA256="24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488"
EMB_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/nemo_en_titanet_small.onnx"
EMB_SHA256="ad4a1802485d8b34c722d2a9d04249662f2ece5d28a7a039063ca22f515a789e"

fetch () { # url dest sha256
  local url="$1" dest="$2" want="$3"
  if [[ -f "$dest" ]]; then echo "have $dest"; else curl -fL --retry 3 -o "$dest" "$url"; fi
  local got
  got=$(sha256sum "$dest" | cut -d' ' -f1)
  [[ "$got" == "$want" ]] || { echo "SHA256 mismatch for $dest: got $got want $want" >&2; exit 1; }
}

fetch "$SEG_URL" "$DEST/segmentation.tar.bz2" "$SEG_SHA256"
tar -xjf "$DEST/segmentation.tar.bz2" -C "$DEST" --strip-components=1 --wildcards "*/model.onnx"
mv "$DEST/model.onnx" "$DEST/segmentation.onnx"
rm -f "$DEST/segmentation.tar.bz2"
fetch "$EMB_URL" "$DEST/embedding.onnx" "$EMB_SHA256"
echo "diarize models staged in $DEST"
