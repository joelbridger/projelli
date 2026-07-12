#!/usr/bin/env bash
set -e
WCLI="/tmp/whisper-review/build/bin/whisper-cli"; MODEL="/tmp/whisper-setup/models/ggml-base.en.bin"; RES="/home/jameson/lantern-plus/docs/user-research/2026-07-08-wife-onboarding"
for w in "$RES/wav"/*.wav; do
  name=$(basename "$w" .wav)
  echo "[transcribe] $name ..."
  "$WCLI" -m "$MODEL" -f "$w" -otxt -of "$RES/transcripts/$name" -t 6 -pp 2>/dev/null
  echo "[done] $name.txt"
done
echo "ALL-TRANSCRIBED"
