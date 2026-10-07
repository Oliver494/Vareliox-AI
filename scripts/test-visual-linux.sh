#!/usr/bin/env bash
# Isolated UI fixtures: mocked IPC, no user credentials, files or commands.
set -euo pipefail
node node_modules/vite/bin/vite.js --host 127.0.0.1 &
vite_pid=$!
trap 'kill "$vite_pid" 2>/dev/null || true' EXIT
for attempt in $(seq 1 30); do
  if curl --fail --silent http://127.0.0.1:1420/tests/visual-chat.html >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent http://127.0.0.1:1420/tests/visual-chat.html >/dev/null
check_ui() {
  if command -v xvfb-run >/dev/null; then
    xvfb-run -a python3 scripts/check-chat-webkit.py "$@"
  elif [ -n "${DISPLAY:-}" ]; then
    python3 scripts/check-chat-webkit.py "$@"
  else
    printf 'Visual checks need Xvfb or an active Linux display.\n' >&2
    return 1
  fi
}
check_ui 'http://127.0.0.1:1420/tests/visual-chat.html?theme=dark' 1280 720
check_ui 'http://127.0.0.1:1420/tests/visual-chat.html?theme=light' 1366 768
check_ui 'http://127.0.0.1:1420/tests/visual-media.html?provider=lm_studio' 1280 720
check_ui 'http://127.0.0.1:1420/tests/visual-media.html?provider=ollama&mode=video' 1280 720
check_ui 'http://127.0.0.1:1420/tests/visual-media.html?provider=gemini&theme=light' 1366 768
check_ui 'http://127.0.0.1:1420/tests/visual-media.html?provider=open_ai' 1920 1080
check_ui 'http://127.0.0.1:1420/tests/visual-media.html?missing=true' 1280 720
check_ui 'http://127.0.0.1:1420/tests/visual-providers.html' 1280 720
check_ui 'http://127.0.0.1:1420/tests/visual-code-summary.html' 1280 720
