#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

pip install --upgrade pip
pip install -r "$SCRIPT_DIR/requirements.txt"

PLAYWRIGHT_BROWSERS_PATH=0 python -m playwright install chromium
