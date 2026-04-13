#!/usr/bin/env bash
# Render build script for the Python worker
set -e

pip install -r worker/requirements.txt

# Install Playwright's bundled Chromium + its OS-level dependencies
python -m playwright install --with-deps chromium
