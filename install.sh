#!/usr/bin/env sh
# Install only the Cozy Novel launcher. The repository is the application directory.
set -eu
COZYNOVEL_APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
COZYNOVEL_BIN_DIR=${COZYNOVEL_BIN_DIR:-"${PREFIX:-$HOME/.local}/bin"}
python3 -c 'import sys; assert sys.version_info >= (3,11), "Python 3.11 or newer is required"'
mkdir -p "$COZYNOVEL_BIN_DIR"
COZYNOVEL_LAUNCHER="$COZYNOVEL_BIN_DIR/cozynovel"
if [ -e "$COZYNOVEL_LAUNCHER" ] && ! python3 - "$COZYNOVEL_LAUNCHER" <<'PY'
import pathlib,sys
text=pathlib.Path(sys.argv[1]).read_text()
sys.exit(0 if '# Cozy Novel installed launcher' in text else 1)
PY
then
  printf '%s\n' 'A different launcher already exists. Nothing was replaced.'
  exit 1
fi
python3 - "$COZYNOVEL_APP_DIR" "$COZYNOVEL_LAUNCHER" <<'PY'
import pathlib,shlex,sys
app=pathlib.Path(sys.argv[1]);target=pathlib.Path(sys.argv[2])
target.write_text('#!/usr/bin/env sh\n# Cozy Novel installed launcher\nexec python3 '+shlex.quote(str(app/'serve.py'))+' "$@"\n')
target.chmod(0o755)
PY
printf 'Cozy Novel is installed. Run %s\n' "$COZYNOVEL_LAUNCHER"
printf '%s\n' 'Default address: http://127.0.0.1:8081' 'No shell configuration or other application was changed.'
