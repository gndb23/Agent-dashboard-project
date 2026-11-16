#!/bin/sh
# Agent Ops for macOS / Linux: installs, builds and starts in the background, then opens the browser.
cd "$(dirname "$0")" || exit 1
mkdir -p data/logs
nohup node scripts/supervisor.mjs >/dev/null 2>&1 &
for i in $(seq 1 60); do
  curl -s -o /dev/null http://127.0.0.1:4321/api/health && break
  sleep 1
done
URL=http://localhost:4321
command -v open >/dev/null && open "$URL" || (command -v xdg-open >/dev/null && xdg-open "$URL") || echo "Open $URL"
