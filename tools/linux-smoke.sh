#!/usr/bin/env bash
set -euo pipefail
binary=$1
log=$2
set +e
timeout --signal=TERM 15s "$binary" >"$log" 2>&1
status=$?
set -e
cat "$log"
if [ "$status" -ne 124 ]; then
  echo "Application exited before the 15-second startup check (status $status)." >&2
  exit 1
fi
if grep -Eiq 'panicked at|error while loading shared libraries|Failed to initialize GTK' "$log"; then
  echo "Fatal startup error detected." >&2
  exit 1
fi
echo "Application remained running for the startup check."
