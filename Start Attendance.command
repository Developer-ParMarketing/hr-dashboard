#!/bin/bash
# Double-click this file in Finder to open the Attendance app (Mac).
# Requires Node.js: https://nodejs.org - install the LTS version once.

cd "$(dirname "$0")"

echo ""
echo "  Attendance - starting..."
echo "  Keep this window open while you use the app."
echo "  To stop: close this window or press Ctrl+C"
echo ""

if ! command -v node &>/dev/null; then
  echo "Node.js is not installed."
  echo "Install the LTS version from https://nodejs.org and try again."
  echo ""
  read -r -p "Press Enter to close..."
  exit 1
fi

if [ ! -d "node_modules" ] || [ ! -d "backend/node_modules" ] || [ ! -d "frontend/node_modules" ]; then
  echo "First-time setup: installing dependencies (may take a minute)..."
  npm run setup
  echo ""
fi

exec npm start
