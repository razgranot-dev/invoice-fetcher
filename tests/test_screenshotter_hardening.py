"""Tests for the hardening work in core.email_screenshotter.

Pure helpers (filename sanitization, SSRF URL-block decision, concurrency
config, Chromium locator) run without a browser. The capture-height-cap test
is an integration test that launches real Chromium and is skipped when it is
not installed.
"""

import asyncio
import struct

import pytest

import core.email_screenshotter as shooter
from core.email_screenshotter import _is_blocked_url, _safe_filename_id


class TestSafeFilenameId:
    def test_plain_id_unchanged(self):
        assert _safe_filename_id("invoice-123_A") == "invoice-123_A"

    def test_path_traversal_neutralized(self):
        out = _safe_filename_id("../evil test")
        assert "/" not in out and "\\" not in out and ".." not in out
        assert out == "___evil_test"

    def test_slashes_and_spaces_replaced(self):
        assert _safe_filename_id("a/b\\c d") == "a_b_c_d"

    def test_empty_falls_back_to_inv(self):
        assert _safe_filename_id("") == "inv"

    def test_all_illegal_falls_back_to_inv(self):
        # Every char replaced would still be non-empty ("___"), so only truly
        # empty input hits the fallback; a string of illegal chars becomes "_".
        assert _safe_filename_id("///") == "___"

    def test_none_does_not_crash(self):
        assert _safe_filename_id(None) == "None"

    def test_capped_at_64_chars(self):
        out = _safe_filename_id("x" * 200)
        assert len(out) == 64

    def test_only_allowed_charset(self):
        out = _safe_filename_id("héllo@wörld!#$%")
        assert all(c.isalnum() or c in "_-" for c in out)


class TestIsBlockedUrl:
    def test_public_https_allowed(self):
        assert _is_blocked_url("https://example.com/logo.png") is False

    def test_public_http_allowed(self):
        assert _is_blocked_url("http://cdn.example.org/a.jpg") is False

    def test_data_uri_allowed(self):
        assert _is_blocked_url("data:image/png;base64,AAAA") is False

    def test_file_scheme_blocked(self):
        assert _is_blocked_url("file:///etc/passwd") is True

    def test_ftp_scheme_blocked(self):
        assert _is_blocked_url("ftp://example.com/x") is True

    def test_localhost_blocked(self):
        assert _is_blocked_url("http://localhost/admin") is True

    def test_gcp_metadata_blocked(self):
        assert _is_blocked_url("http://metadata.google.internal/computeMetadata/v1/") is True

    def test_loopback_ip_blocked(self):
        assert _is_blocked_url("http://127.0.0.1/") is True

    def test_private_ip_blocked(self):
        assert _is_blocked_url("http://10.0.0.5/") is True
        assert _is_blocked_url("http://192.168.1.1/") is True
        assert _is_blocked_url("http://172.16.0.1/") is True

    def test_link_local_ip_blocked(self):
        # 169.254.169.254 is the classic cloud metadata IP.
        assert _is_blocked_url("http://169.254.169.254/latest/meta-data/") is True

    def test_ipv6_loopback_blocked(self):
        assert _is_blocked_url("http://[::1]/") is True

    def test_unspecified_ip_blocked(self):
        assert _is_blocked_url("http://0.0.0.0/") is True

    def test_public_ip_allowed(self):
        assert _is_blocked_url("http://8.8.8.8/") is False

    def test_regular_domain_allowed(self):
        assert _is_blocked_url("https://sub.domain.co.uk/path?q=1") is False

    def test_unparseable_blocked(self):
        # No scheme -> not in allowed set -> blocked.
        assert _is_blocked_url("not a url") is True

    def test_http_without_host_blocked(self):
        assert _is_blocked_url("http://") is True

    # --- legacy IP notations Chromium resolves as addresses (C3 remainder) ---

    def test_decimal_integer_loopback_blocked(self):
        # 2130706433 == 127.0.0.1
        assert _is_blocked_url("http://2130706433/") is True

    def test_hex_integer_loopback_blocked(self):
        # 0x7f000001 == 127.0.0.1
        assert _is_blocked_url("http://0x7f000001/") is True

    def test_octal_dotted_loopback_blocked(self):
        # 0177.0.0.1 == 127.0.0.1
        assert _is_blocked_url("http://0177.0.0.1/") is True

    def test_shorthand_dotted_loopback_blocked(self):
        # 127.1 == 127.0.0.1
        assert _is_blocked_url("http://127.1/") is True

    def test_decimal_integer_private_blocked(self):
        # 3232235777 == 192.168.1.1
        assert _is_blocked_url("http://3232235777/") is True

    def test_integer_public_ip_allowed(self):
        # 134744072 == 0x08080808 == 8.8.8.8 (public)
        assert _is_blocked_url("http://134744072/") is False
        assert _is_blocked_url("http://0x08080808/") is False

    def test_ipv4_mapped_ipv6_loopback_blocked(self):
        assert _is_blocked_url("http://[::ffff:127.0.0.1]/") is True

    def test_ipv4_mapped_ipv6_private_blocked(self):
        assert _is_blocked_url("http://[::ffff:10.0.0.1]/") is True

    def test_trailing_dot_localhost_blocked(self):
        assert _is_blocked_url("http://localhost./") is True

    def test_trailing_dot_loopback_blocked(self):
        assert _is_blocked_url("http://127.0.0.1./") is True

    def test_hexy_domain_still_allowed(self):
        # All hex chars, but not a number — a genuine domain.
        assert _is_blocked_url("https://face.cafe/logo.png") is False


class TestScreenshotConcurrencyConfig:
    def test_default_is_3(self, monkeypatch):
        monkeypatch.delenv("SCREENSHOT_CONCURRENCY", raising=False)
        assert shooter._screenshot_concurrency() == 3

    def test_env_override(self, monkeypatch):
        monkeypatch.setenv("SCREENSHOT_CONCURRENCY", "2")
        assert shooter._screenshot_concurrency() == 2

    def test_clamped_to_min_1(self, monkeypatch):
        monkeypatch.setenv("SCREENSHOT_CONCURRENCY", "0")
        assert shooter._screenshot_concurrency() == 1

    def test_clamped_to_max_8(self, monkeypatch):
        monkeypatch.setenv("SCREENSHOT_CONCURRENCY", "99")
        assert shooter._screenshot_concurrency() == 8

    def test_garbage_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("SCREENSHOT_CONCURRENCY", "many")
        assert shooter._screenshot_concurrency() == 3


def _make_fake_chromium_tree(base, subdir="chrome-linux", name="chrome"):
    exe = base / "chromium-9999" / subdir / name
    exe.parent.mkdir(parents=True, exist_ok=True)
    exe.write_bytes(b"")
    return exe


class TestFindChromiumExecutable:
    """The runtime locator must find Chromium wherever build.sh installed it."""

    def test_env_path_directory_honored(self, tmp_path, monkeypatch):
        monkeypatch.setattr("platform.system", lambda: "Linux")
        exe = _make_fake_chromium_tree(tmp_path)
        monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", str(tmp_path))
        assert shooter._find_chromium_executable() == str(exe)

    def test_zero_sentinel_searches_package_local_dir(self, tmp_path, monkeypatch):
        # PLAYWRIGHT_BROWSERS_PATH=0 means "package-local install", not Path('0').
        monkeypatch.setattr("platform.system", lambda: "Linux")
        exe = _make_fake_chromium_tree(tmp_path)
        monkeypatch.setenv("PLAYWRIGHT_BROWSERS_PATH", "0")
        monkeypatch.setattr(shooter, "_package_local_browsers_dir", lambda: tmp_path)
        assert shooter._find_chromium_executable() == str(exe)

    def test_repo_relative_dir_searched_without_env(self, tmp_path, monkeypatch):
        # worker/.pw-browsers (where build.sh installs) is found with NO env var.
        monkeypatch.setattr("platform.system", lambda: "Linux")
        exe = _make_fake_chromium_tree(tmp_path)
        monkeypatch.delenv("PLAYWRIGHT_BROWSERS_PATH", raising=False)
        monkeypatch.setattr(shooter, "_repo_browsers_dir", lambda: tmp_path)
        assert shooter._find_chromium_executable() == str(exe)


class _FakePage:
    def __init__(self):
        self.closed = False

    async def close(self):
        self.closed = True


class _FakeBrowser:
    async def close(self):
        pass


class _FakePw:
    async def stop(self):
        pass


@pytest.fixture
def fake_render_env(tmp_path, monkeypatch):
    """Patch the browser/render layer with fakes that track concurrency."""
    state = {"active": 0, "max_active": 0, "pages_created": 0, "rendered": []}

    async def fake_get_browser():
        return _FakePw(), _FakeBrowser()

    async def fake_new_page(browser):
        state["pages_created"] += 1
        return _FakePage()

    async def fake_render_single(page, html, output_path, invoice_id=""):
        state["active"] += 1
        state["max_active"] = max(state["max_active"], state["active"])
        await asyncio.sleep(0.05)
        state["active"] -= 1
        state["rendered"].append(invoice_id)
        return True, None, {}

    monkeypatch.setattr(shooter, "_get_browser", fake_get_browser)
    monkeypatch.setattr(shooter, "_new_page", fake_new_page)
    monkeypatch.setattr(shooter, "_render_single", fake_render_single)
    monkeypatch.setattr(shooter, "is_screenshot_worthy", lambda inv: (True, None))
    monkeypatch.setattr(shooter, "SCREENSHOT_DIR", str(tmp_path))
    return state


class TestConcurrentRendering:
    def test_renders_overlap_and_all_complete(self, fake_render_env, monkeypatch):
        monkeypatch.delenv("SCREENSHOT_CONCURRENCY", raising=False)
        invoices = [{"id": f"inv-{i}", "body_html": "<p>" + "x" * 100} for i in range(6)]

        result = asyncio.run(shooter.generate_screenshots(invoices))

        assert fake_render_env["max_active"] >= 2, "renders never overlapped"
        assert len(fake_render_env["rendered"]) == 6
        for inv in result:
            assert inv.get("screenshot_path"), inv
            assert "screenshot_error" not in inv

    def test_progress_yields_once_per_invoice(self, fake_render_env, monkeypatch):
        monkeypatch.setenv("SCREENSHOT_CONCURRENCY", "3")
        invoices = [{"id": f"inv-{i}", "body_html": "<p>" + "x" * 100} for i in range(5)]

        async def consume():
            yields = 0
            async for _ in shooter.generate_screenshots_with_progress(invoices):
                yields += 1
            return yields

        assert asyncio.run(consume()) == 5
        assert all(inv.get("screenshot_path") for inv in invoices)

    def test_crashed_page_is_recycled(self, fake_render_env, monkeypatch):
        monkeypatch.setenv("SCREENSHOT_CONCURRENCY", "1")
        crash_ids = {"inv-1"}

        async def crashy_render(page, html, output_path, invoice_id=""):
            fake_render_env["rendered"].append(invoice_id)
            if invoice_id in crash_ids:
                return False, "Page crashed: boom", {}
            return True, None, {}

        monkeypatch.setattr(shooter, "_render_single", crashy_render)
        invoices = [{"id": f"inv-{i}", "body_html": "<p>" + "x" * 100} for i in range(3)]

        result = asyncio.run(shooter.generate_screenshots(invoices))

        # 1 initial page + 1 recycled after the crash.
        assert fake_render_env["pages_created"] == 2
        assert result[1].get("screenshot_error") == "Page crashed: boom"
        assert result[0].get("screenshot_path") and result[2].get("screenshot_path")


async def _render_one_real(html, out_path):
    """Launch real Chromium, render one HTML, return (ok, reason, diag)."""
    pw, browser = await shooter._get_browser()
    try:
        page = await shooter._new_page(browser)
        result = await shooter._render_single(page, html, str(out_path), "itest")
        await page.close()
        return result
    finally:
        await browser.close()
        await pw.stop()


class TestRealRenderWithJsDisabled:
    """The full render path must work with page JavaScript disabled.

    Regression guard: add_style_tag and in-page setTimeout hang forever under
    java_script_enabled=False, which used to make EVERY render hit the 45s cap.
    """

    def test_normal_email_renders_full_page(self, tmp_path):
        if shooter._find_chromium_executable() is None:
            pytest.skip("Chromium not installed")

        html = shooter._prepare_email_html(
            "<div style='height:1500px'><h1>חשבונית מס</h1><p>Invoice 42</p></div>"
        )
        out = tmp_path / "normal.png"
        ok, reason, diag = asyncio.run(_render_one_real(html, out))

        assert ok, f"render failed: {reason} (diag={diag})"
        assert "screenshot_clipped" not in diag
        header = out.read_bytes()[:32]
        assert header[:8] == b"\x89PNG\r\n\x1a\n"
        _w, h = struct.unpack(">II", header[16:24])
        assert 1500 <= h <= shooter._MAX_VIEWPORT_HEIGHT


class TestCaptureHeightCap:
    """M24: giant emails must be clipped, not captured at full document height."""

    def test_giant_email_png_height_capped(self, tmp_path):
        if shooter._find_chromium_executable() is None:
            pytest.skip("Chromium not installed")

        html = (
            "<html><body style='margin:0'>"
            "<div style='height:30000px;background:#eee'>tall digest</div>"
            "</body></html>"
        )
        out = tmp_path / "capped.png"
        ok, reason, diag = asyncio.run(_render_one_real(html, out))
        assert ok, f"render failed: {reason} (diag={diag})"
        assert "screenshot_clipped" in diag

        header = out.read_bytes()[:32]
        assert header[:8] == b"\x89PNG\r\n\x1a\n"
        _w, h = struct.unpack(">II", header[16:24])
        assert h <= shooter._MAX_VIEWPORT_HEIGHT
