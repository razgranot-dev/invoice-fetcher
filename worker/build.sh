#!/usr/bin/env bash
# Render build script for the Python worker
set -e

pip install -r requirements.txt

# Install Chromium next to the playwright package (hermetic, no user-cache)
PLAYWRIGHT_BROWSERS_PATH=0 python -m playwright install chromium
