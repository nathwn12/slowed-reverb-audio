#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

FILES=(
  manifest.json
  background.js
  shared.js
  content-script.js
  page-hook.js
  dattorro-worklet.js
  popup.html
  popup.js
  audio/icon-16.png
  audio/icon-32.png
  audio/icon-48.png
  audio/icon-128.png
  PRIVACY_POLICY.md
)

# Find highest existing iteration number
HIGHEST=0
for f in slowed-reverb-audio-*.xpi; do
  if [[ -f "$f" ]]; then
    NUM=$(echo "$f" | sed 's/slowed-reverb-audio-//;s/\.xpi//')
    if [[ "$NUM" =~ ^[0-9]+$ ]] && [[ "$NUM" -gt "$HIGHEST" ]]; then
      HIGHEST=$NUM
    fi
  fi
done

NEXT=$((HIGHEST + 1))
OUTPUT="slowed-reverb-audio-${NEXT}.xpi"

if command -v zip &>/dev/null; then
  zip -r "$OUTPUT" "${FILES[@]}"
elif command -v 7z &>/dev/null; then
  7z a -tzip "$OUTPUT" "${FILES[@]}"
else
  echo "ERROR: Neither 'zip' nor '7z' command found."
  echo "Install one of them or manually create the XPI as a zip archive."
  exit 1
fi

echo "Created ${OUTPUT}"
ls -lh "$OUTPUT"
