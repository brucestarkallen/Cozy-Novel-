#!/usr/bin/env bash
# Cozy Novel — the one-time setup in Termux (safe to run again).
#   bash install.sh
# Afterwards one word does everything: cozynovel
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
if command -v pkg >/dev/null 2>&1; then pkg install -y python git curl procps >/dev/null 2>&1 || true; fi
BIN="${PREFIX:-$HOME/.local}/bin"
mkdir -p "$BIN"
printf '#!/usr/bin/env bash\n# Cozy Novel installed launcher\nexec "%s/cozynovel.sh" "$@"\n' "$HERE" > "$BIN/cozynovel"
chmod +x "$BIN/cozynovel" "$HERE/cozynovel.sh"
mkdir -p "${COZYNOVEL_HOME:-$HOME/.cozynovel}"
echo "Cozy Novel is ready. From now on, type:"
echo "  cozynovel"
echo "It updates itself, starts the server and opens http://127.0.0.1:${COZYNOVEL_PORT:-8081}"
