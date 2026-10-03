#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v pip3 >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; then
  echo "python3 and pip3 are required. Install Python 3.8+ then re-run."
  exit 1
fi

install_with() {
  pip3 install "$@" -r requirements.txt
}

if install_with 2>/dev/null; then
  echo "Python deps installed (system pip3)."
elif install_with --user 2>/dev/null; then
  echo "Python deps installed (pip3 --user)."
elif install_with --break-system-packages 2>/dev/null; then
  echo "Python deps installed (pip3 --break-system-packages; Mac Homebrew / PEP 668)."
elif install_with --user --break-system-packages 2>/dev/null; then
  echo "Python deps installed (pip3 --user --break-system-packages)."
else
  echo "Could not install Python dependencies (no virtualenv in this project)."
  echo "  Try: pip3 install --break-system-packages -r backend/requirements.txt"
  exit 1
fi

node scripts/check-python-deps.mjs
