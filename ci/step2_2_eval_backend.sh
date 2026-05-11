#!/usr/bin/env bash
# step2_2 backend CI (Git Bash on Windows runner). Repo root from script path.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/step2_2/backend"

if command -v python >/dev/null 2>&1; then python -m venv .venv-ci
elif command -v python3 >/dev/null 2>&1; then python3 -m venv .venv-ci
elif command -v py >/dev/null 2>&1; then py -3 -m venv .venv-ci
else
  echo "python not found (tried python, python3, py). Add Python to PATH or install from python.org" >&2
  exit 1
fi

if [ -x .venv-ci/bin/python ]; then PY=.venv-ci/bin/python
elif [ -x .venv-ci/Scripts/python.exe ]; then PY=.venv-ci/Scripts/python.exe
else echo "venv python not found" >&2; exit 1; fi

"$PY" -m pip install -U pip wheel
"$PY" -m pip install -r requirements.txt
"$PY" -m compileall -q app
