#!/usr/bin/env bash
# Cozy Novel — update, then open.
#
# One word does everything: it pulls the newest Cozy Novel, makes sure the
# server that is running IS the code just pulled (an old server still holding
# the port is an update you cannot see), keeps the phone awake while you
# write, and opens the app. The server keeps running after this returns, so
# closing Termux does not close your book.
#
# An old server is stopped by asking whatever is on Cozy Novel's own port to
# leave, and only then by the exact path of this folder's serve.py — never by
# the name serve.py alone, because Cozy Tavern, Cozy Chat and CozyMaker all
# run a file of that name.
set -u
# Everything is inside main(), read whole before it runs: the pull below can
# replace this very file, and bash reads a script as it goes.
main() {
  HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
  PORT="${COZYNOVEL_PORT:-8081}"
  URL="http://127.0.0.1:$PORT"
  PY="$(command -v python3 || command -v python)"
  DATA="${COZYNOVEL_HOME:-$HOME/.cozynovel}"
  cd "$HERE" || exit 1

  answering() { curl -sf --max-time 2 -o /dev/null "$URL/api/version"; }
  live_commit() { curl -sf --max-time 2 "$URL/api/version" | sed -n 's/.*"commit": *"\([^"]*\)".*/\1/p'; }
  # which Cozy Novel is running, said every time it opens
  live_version() { curl -sf --max-time 2 "$URL/api/version" | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p'; }
  said_open() {
    V="$(live_version)"
    echo "Cozy Novel ${V:+$V }is open at $URL"
  }
  open_it() {
    if command -v termux-open-url >/dev/null 2>&1; then termux-open-url "$URL";
    elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1;
    fi
  }

  if command -v termux-wake-lock >/dev/null 2>&1; then termux-wake-lock; fi

  if [ -d .git ]; then
    echo "Checking for updates…"
    BEFORE="$(git rev-parse HEAD 2>/dev/null)"
    if git pull --ff-only --quiet; then
      AFTER="$(git rev-parse HEAD 2>/dev/null)"
      if [ "$BEFORE" != "$AFTER" ]; then
        echo "Updated: $(git log --oneline -1 | cut -c1-72)"
        # the word itself is kept current too
        if [ -n "${PREFIX:-}" ] && [ -w "${PREFIX}/bin" ]; then
          printf '#!/usr/bin/env bash\n# Cozy Novel installed launcher\nexec "%s/cozynovel.sh" "$@"\n' "$HERE" > "$PREFIX/bin/cozynovel.tmp" \
            && chmod +x "$PREFIX/bin/cozynovel.tmp" && mv "$PREFIX/bin/cozynovel.tmp" "$PREFIX/bin/cozynovel"
        fi
      fi
    else
      echo "(Could not update just now — opening the Cozy Novel you have.)"
    fi
  fi
  WANT="$(git rev-parse HEAD 2>/dev/null || echo none)"

  # a server relighting itself after the pull is briefly silent: give it a moment
  if ! answering && command -v pgrep >/dev/null 2>&1 && pgrep -f "$HERE/serve.py" >/dev/null 2>&1; then
    for i in $(seq 1 25); do answering && break; sleep 0.2; done
  fi

  if answering; then
    if [ "$(live_commit)" = "$WANT" ]; then
      said_open
      open_it
      exit 0
    fi
    echo "An older Cozy Novel is running — replacing it."
    curl -s --max-time 3 -X POST -H 'Content-Type: application/json' -d '{}' "$URL/api/quit" >/dev/null 2>&1
    for i in $(seq 1 30); do answering || break; sleep 0.2; done
    if answering && command -v pkill >/dev/null 2>&1; then
      pkill -f "$HERE/serve.py" 2>/dev/null; sleep 1
    fi
    if answering; then
      echo "Port $PORT is held by something that is not this Cozy Novel."
      echo "Stop it, or run: COZYNOVEL_PORT=8091 cozynovel"
      exit 1
    fi
  fi

  # Whatever else holds the port is the new server's to judge: the first Cozy
  # Novel (which answers elsewhere) is replaced by it, anything else is named.
  mkdir -p "$DATA"
  if command -v setsid >/dev/null 2>&1; then
    setsid nohup "$PY" "$HERE/serve.py" >>"$DATA/server.log" 2>&1 < /dev/null &
  else
    nohup "$PY" "$HERE/serve.py" >>"$DATA/server.log" 2>&1 < /dev/null &
  fi
  SERVER=$!
  for i in $(seq 1 80); do
    answering && break
    kill -0 "$SERVER" 2>/dev/null || break
    sleep 0.2
  done
  if answering; then
    said_open
    echo "Your books live in $DATA"
    open_it
  else
    echo "Cozy Novel did not start. The last lines it wrote:"
    tail -n 6 "$DATA/server.log" 2>/dev/null
    exit 1
  fi
}
main "$@"
exit
