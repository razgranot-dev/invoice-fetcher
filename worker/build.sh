#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

pip install --upgrade pip
pip install -r "$SCRIPT_DIR/requirements.txt"

# Install Chromium into a repo-relative directory that persists into the
# runtime filesystem on Render's native Python runtime.
#
# Why not PLAYWRIGHT_BROWSERS_PATH=0: "0" is a sentinel meaning "install into
# the playwright package dir" — the runtime browser locator could only find it
# if the same env var was also exported at runtime. A real path removes that
# coupling: core/email_screenshotter.py:_find_chromium_executable searches
# worker/.pw-browsers explicitly, so no runtime env var is required. (If you
# prefer an env var anyway, set PLAYWRIGHT_BROWSERS_PATH to this same path in
# the Render dashboard / render.yaml.)
export PLAYWRIGHT_BROWSERS_PATH="$SCRIPT_DIR/.pw-browsers"
python -m playwright install chromium

# System libraries for Chromium. Needs root; Render's native runtime has none,
# so tolerate failure — the base image already ships the required libs.
# Do NOT switch back to `playwright install --with-deps`: that fails the whole
# build without root (see commit 5549b80). If Chromium still cannot launch
# because of missing system libs, the real fix is a Docker-based deploy.
python -m playwright install-deps chromium \
    || echo "playwright install-deps skipped (no root — relying on base image libs)"

# Hebrew glyph coverage for email screenshots: install Noto Sans Hebrew as a
# user font (no root needed — fontconfig picks up ~/.local/share/fonts).
# Without it, Hebrew invoice emails render as tofu boxes on bare Linux images.
FONT_DIR="$HOME/.local/share/fonts"
FONT_FILE="$FONT_DIR/NotoSansHebrew.ttf"
FONT_URL="https://github.com/google/fonts/raw/main/ofl/notosanshebrew/NotoSansHebrew%5Bwdth%2Cwght%5D.ttf"
mkdir -p "$FONT_DIR"
if [ ! -f "$FONT_FILE" ]; then
    FONT_TMP="$FONT_DIR/.NotoSansHebrew.ttf.tmp"
    if curl -fsSL --retry 3 -o "$FONT_TMP" "$FONT_URL"; then
        mv "$FONT_TMP" "$FONT_FILE"
    else
        rm -f "$FONT_TMP"
        echo "WARNING: Hebrew font download failed — Hebrew text may render as boxes"
    fi
fi
if command -v fc-cache >/dev/null 2>&1; then
    fc-cache -f "$FONT_DIR" || true
fi
