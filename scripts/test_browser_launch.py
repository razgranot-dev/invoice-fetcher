"""Diagnostic: test Playwright browser launch on this machine.

Run: python scripts/test_browser_launch.py
"""
import asyncio
import os
import platform
import sys
from pathlib import Path


def find_chromium():
    """Locate Playwright-managed Chromium executable."""
    home = Path.home()
    candidates = []

    env_path = os.environ.get("PLAYWRIGHT_BROWSERS_PATH")
    if env_path:
        candidates.append(Path(env_path))

    candidates.append(home / "AppData" / "Local" / "ms-playwright")
    candidates.append(Path(sys.prefix) / "ms-playwright")

    for base in candidates:
        if not base.exists():
            print(f"  [skip] {base} does not exist")
            continue
        print(f"  [scan] {base}")
        chromium_dirs = sorted(base.glob("chromium-*"), reverse=True)
        for cdir in chromium_dirs:
            print(f"    Found dir: {cdir}")
            for subdir in ["chrome-win", "chrome-win64"]:
                exe = cdir / subdir / "chrome.exe"
                if exe.is_file():
                    print(f"    -> FOUND: {exe}")
                    return str(exe)
                else:
                    print(f"    -> not at: {exe}")
    return None


async def test_launch():
    print(f"Platform: {platform.system()} {platform.release()}")
    print(f"Python: {sys.executable}")
    print(f"Python version: {sys.version}")
    print()

    # Step 1: Check playwright import
    try:
        import playwright
        print(f"Playwright version: {playwright.__version__}")
    except ImportError:
        print("FAIL: playwright not installed")
        return

    # Step 2: Find executable
    print("\nSearching for Chromium executable:")
    exe = find_chromium()
    if not exe:
        print("\nFAIL: Chromium executable not found.")
        print("Run: python -m playwright install chromium")
        return
    print(f"\nUsing executable: {exe}")

    # Step 3: Try launch
    from playwright.async_api import async_playwright

    args = []
    if platform.system() == "Windows":
        args = ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"]
    print(f"Launch args: {args}")

    pw = await async_playwright().start()

    # Attempt 1: with explicit path + args
    print("\n--- Attempt 1: explicit path + args ---")
    try:
        browser = await pw.chromium.launch(
            headless=True,
            executable_path=exe,
            args=args,
        )
        print("SUCCESS: Browser launched!")
        version = browser.version
        print(f"Browser version: {version}")
        page = await browser.new_page()
        await page.set_content("<h1>Test</h1>")
        title = await page.title()
        print(f"Page rendered, title: '{title}'")
        await page.close()
        await browser.close()
        await pw.stop()
        return
    except Exception as e:
        print(f"FAILED: {type(e).__name__}: {e}")
        print(f"  repr: {repr(e)}")
        if hasattr(e, "message"):
            print(f"  message: {e.message}")

    # Attempt 2: auto-detect path + args
    print("\n--- Attempt 2: auto-detect path + args ---")
    try:
        browser = await pw.chromium.launch(headless=True, args=args)
        print("SUCCESS: Browser launched (auto-detect)!")
        await browser.close()
        await pw.stop()
        return
    except Exception as e:
        print(f"FAILED: {type(e).__name__}: {e}")
        print(f"  repr: {repr(e)}")

    # Attempt 3: bare launch (original code path)
    print("\n--- Attempt 3: bare launch (no args) ---")
    try:
        browser = await pw.chromium.launch(headless=True)
        print("SUCCESS: Browser launched (bare)!")
        await browser.close()
    except Exception as e:
        print(f"FAILED: {type(e).__name__}: {e}")
        print(f"  repr: {repr(e)}")

    await pw.stop()


if __name__ == "__main__":
    asyncio.run(test_launch())
