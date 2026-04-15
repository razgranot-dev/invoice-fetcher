#!/usr/bin/env bash
# Render build script for the Python worker
set -e

# Resolve paths relative to this script, not the working directory
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

pip install --upgrade pip
pip install -r "$SCRIPT_DIR/requirements.txt"

# Install Chromium with system deps (needed on Render's Linux)
PLAYWRIGHT_BROWSERS_PATH=0 python -m playwright install --with-deps chromium
