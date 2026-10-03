#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "Checking LibreOffice for relieving-letter PDF export…"

if node scripts/check-libreoffice.mjs 2>/dev/null; then
  echo "Already installed."
  exit 0
fi

OS="$(uname -s)"

install_macos() {
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew is required on macOS. Install from https://brew.sh then run: npm run setup:libreoffice"
    exit 1
  fi
  echo "Installing LibreOffice via Homebrew (this may take several minutes)…"
  export HOMEBREW_NO_AUTO_UPDATE=1
  brew install --cask libreoffice
}

install_linux() {
  if command -v apt-get >/dev/null 2>&1; then
    echo "Installing LibreOffice via apt (may prompt for sudo)…"
    sudo apt-get update -qq
    sudo apt-get install -y libreoffice libreoffice-writer
    return
  fi
  if command -v dnf >/dev/null 2>&1; then
    echo "Installing LibreOffice via dnf…"
    sudo dnf install -y libreoffice libreoffice-writer
    return
  fi
  echo "Unsupported Linux package manager. Install LibreOffice manually and ensure soffice is on PATH."
  exit 1
}

case "$OS" in
  Darwin) install_macos ;;
  Linux) install_linux ;;
  *)
    echo "Install LibreOffice manually for $OS and ensure soffice is on PATH."
    exit 1
    ;;
esac

node scripts/check-libreoffice.mjs
