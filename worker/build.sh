#!/usr/bin/env bash
# Render build script for the Python worker
set -e

pip install -r requirements.txt

# Download Playwright's bundled Chromium (Render already has OS-level deps)
python -m playwright install chromium
