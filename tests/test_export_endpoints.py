"""Regression tests for the worker endpoints (worker/main.py).

Covers the QA findings fixed in the export/scan hardening pass:

  - C1/C2 (original export bugs: failure report inside the ZIP, job-unique
    docx path with read-before-yield + cleanup)
  - H11: /export/word no longer runs a dead screenshot phase
  - M23: ZIP entry names derive from the supplier/company, not sender domain
  - S3:  export artifacts persist to disk and survive a worker restart
  - S6:  first progress line reports the real export scope + count
  - M1/S4: cooperative scan cancellation (/scan/cancel/{id} + batch checks)
  - H5:  blocking pipelines run off the event loop (/health stays responsive)
  - C3:  bearer middleware + zip-slip-proof archive entry names

The endpoints are exercised directly as async callables (no ASGI client
needed — httpx is not a worker dependency): each streaming endpoint returns
a StreamingResponse whose body_iterator yields the NDJSON lines.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import sys
import time
import zipfile
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import worker.main as wm
from worker.main import ExportRequest, export_screenshots_zip, export_word

# CUID-shaped ids — the only job_id form the endpoints accept ("c" + 20-30
# alphanumerics). Anything else is rejected before touching the filesystem.
VALID_JOB_ID = "cqa1word2path3test4job5x"
VALID_CACHE_ID = "cabc123def456ghi789jkl0m"


def _run_ndjson(endpoint, req: ExportRequest) -> list[dict]:
    """Invoke an async NDJSON endpoint and return the parsed lines."""

    async def collect() -> list[dict]:
        resp = await endpoint(req)
        chunks: list[str] = []
        async for chunk in resp.body_iterator:
            chunks.append(chunk if isinstance(chunk, str) else chunk.decode())
        lines = "".join(chunks).splitlines()
        return [json.loads(line) for line in lines if line.strip()]

    return asyncio.run(collect())


def _fake_screenshot_gen(assignments: dict[str, dict]):
    """Build a stand-in for generate_screenshots_with_progress.

    Mirrors the real protocol: yields the (mutated) invoice list once per
    invoice. `assignments` maps invoice id -> fields to set on that invoice
    (screenshot_path / screenshot_error).
    """

    async def fake(invoices, *args, **kwargs):
        for inv in invoices:
            inv.update(assignments.get(inv.get("id"), {}))
            yield invoices

    return fake


def _invoice(inv_id: str, **extra) -> dict:
    return {
        "id": inv_id,
        "sender": f"Vendor <billing@{inv_id}.example.com>",
        "subject": f"Receipt {inv_id}",
        "date": "2026-07-01",
        "company": f"Vendor {inv_id}",
        **extra,
    }


class TestScreenshotsZipFailureReport:
    def test_missing_file_does_not_fail_export(self, tmp_path, monkeypatch):
        """A screenshot file missing from disk must degrade gracefully:
        the good screenshots ship, and the failure report is INSIDE the ZIP."""
        png_a = tmp_path / "a.png"
        png_b = tmp_path / "b.png"
        png_a.write_bytes(b"\x89PNG fake-a")
        png_b.write_bytes(b"\x89PNG fake-b")

        import core.email_screenshotter as shooter

        monkeypatch.setattr(
            shooter,
            "generate_screenshots_with_progress",
            _fake_screenshot_gen({
                "inv_good_a": {"screenshot_path": str(png_a)},
                "inv_good_b": {"screenshot_path": str(png_b)},
                # Path assigned but the file does not exist on disk.
                "inv_missing": {"screenshot_path": str(tmp_path / "vanished.png")},
                # Plain render failure — no path at all.
                "inv_render_fail": {"screenshot_error": "Timeout rendering email"},
            }),
        )

        req = ExportRequest(invoices=[
            _invoice("inv_good_a"),
            _invoice("inv_good_b"),
            _invoice("inv_missing"),
            _invoice("inv_render_fail"),
        ])
        lines = _run_ndjson(export_screenshots_zip, req)
        final = lines[-1]

        assert not final.get("error"), f"export failed: {final}"
        assert final["succeeded"] == 2
        assert final["failed_count"] == 2

        with zipfile.ZipFile(io.BytesIO(base64.b64decode(final["file"]))) as zf:
            names = zf.namelist()
            assert "_failed_screenshots.txt" in names
            assert sum(1 for n in names if n.endswith(".png")) == 2
            report = zf.read("_failed_screenshots.txt").decode()
            assert "Screenshot file missing from disk" in report
            assert "Timeout rendering email" in report
            assert "2 screenshots succeeded, 2 failed out of 4 total." in report

    def test_render_failures_produce_report_without_missing_files(self, tmp_path, monkeypatch):
        """The failure report must appear for ordinary render failures too —
        previously it was only attempted when files went missing from disk."""
        png = tmp_path / "ok.png"
        png.write_bytes(b"\x89PNG fake")

        import core.email_screenshotter as shooter

        monkeypatch.setattr(
            shooter,
            "generate_screenshots_with_progress",
            _fake_screenshot_gen({
                "inv_ok": {"screenshot_path": str(png)},
                "inv_fail": {"screenshot_error": "Chromium crashed"},
            }),
        )

        req = ExportRequest(invoices=[_invoice("inv_ok"), _invoice("inv_fail")])
        final = _run_ndjson(export_screenshots_zip, req)[-1]

        assert not final.get("error")
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(final["file"]))) as zf:
            assert "_failed_screenshots.txt" in zf.namelist()
            assert "Chromium crashed" in zf.read("_failed_screenshots.txt").decode()


def _isolate_cache(tmp_path, monkeypatch):
    """Point the disk cache at a tmp dir and start with an empty memory cache."""
    monkeypatch.setattr(wm, "_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setattr(wm, "_FILE_CACHE", {})


class TestWordExportFilePath:
    def test_unique_path_per_job_and_cleanup(self, tmp_path, monkeypatch):
        """The .docx must be written to a job-unique path (never the shared
        date-based name) and removed from disk once its bytes are read."""
        _isolate_cache(tmp_path, monkeypatch)
        exports_dir = Path("output/exports")
        before = set(exports_dir.glob("*")) if exports_dir.exists() else set()

        # Must be CUID-shaped — non-CUID job ids are rejected with a 400
        # before they can shape a filesystem path (C3 hardening).
        job_id = VALID_JOB_ID
        req = ExportRequest(
            invoices=[
                _invoice("inv1", amount=100.0, currency="ILS"),
                _invoice("inv2", amount=50.5, currency="ILS"),
            ],
            organization_name="QA Org",
            job_id=job_id,
        )
        final = _run_ndjson(export_word, req)[-1]

        assert not final.get("error"), f"word export failed: {final}"
        assert final.get("file_cached") is True
        assert final.get("file_size", 0) > 0

        assert not (exports_dir / f"invoices_report_{job_id}.docx").exists(), (
            "job report file should be deleted after its bytes are cached"
        )
        after = set(exports_dir.glob("*")) if exports_dir.exists() else set()
        assert after == before, "export must not leave new files on disk"

    def test_non_cuid_job_id_rejected(self):
        req = ExportRequest(invoices=[_invoice("inv1")], job_id="../evil")
        with pytest.raises(HTTPException) as exc:
            _run_ndjson(export_word, req)
        assert exc.value.status_code == 400


# ── Fake Gmail connector (scan / debug endpoint tests) ──────────────────────


class _FakeGmailService:
    """Chainable stub for connector.service.users().messages().list(...)."""

    def users(self):
        return self

    def messages(self):
        return self

    def list(self, **kwargs):
        return {"kwargs": kwargs}


class _BaseFakeConnector:
    """Minimal GmailConnector stand-in. Subclass per test and override the
    stage whose behavior (slowness, message ids) the test needs."""

    fetch_failed_final = 0
    fetch_recovered = 0
    fetch_failed_ids: list = []
    instances: list = []

    def __init__(self):
        self.service = _FakeGmailService()
        self.batches_fetched = 0
        type(self).instances.append(self)

    def build_service_from_json(self, creds_json):
        return True, "ok"

    def build_query(self, keywords, days_back, unread_only=False):
        return "query"

    def _exec(self, request):
        return {"resultSizeEstimate": 0, "messages": []}

    def get_message(self, mid):
        raise AssertionError("unexpected get_message call")

    def list_message_ids(self, keywords, days_back, unread_only):
        return []

    def get_messages_batch(self, ids):
        self.batches_fetched += 1
        return [None] * len(ids)


class TestWordExportIgnoresScreenshotFlag:
    def test_screenshot_phase_removed(self, monkeypatch):
        """H11: include_screenshots must be a no-op — the old phase burned
        0-70% of the job without ever embedding anything in the .docx."""
        import core.email_screenshotter as shooter

        def _forbidden(*args, **kwargs):
            raise AssertionError("Word export must never invoke the screenshotter")

        monkeypatch.setattr(shooter, "generate_screenshots_with_progress", _forbidden)
        monkeypatch.setattr(shooter, "generate_screenshots", _forbidden, raising=False)

        req = ExportRequest(
            invoices=[_invoice("inv1", amount=10.0, currency="ILS")],
            include_screenshots=True,
        )
        lines = _run_ndjson(export_word, req)
        final = lines[-1]
        assert not final.get("error"), f"export failed: {final}"
        assert final.get("file"), "docx bytes must be returned inline"
        # No screenshot phase: the stream opens with the export scope line.
        assert "Exporting 1 selected invoice" in lines[0]["message"]


class TestExportScopeMessages:
    def test_word_first_line_reports_selection_scope(self):
        """S6: the first progress line must state the real scope + count."""
        req = ExportRequest(invoices=[
            _invoice("inv1", amount=10.0, currency="ILS"),
            _invoice("inv2", amount=20.0, currency="ILS"),
        ])
        first = _run_ndjson(export_word, req)[0]
        assert "Exporting 2 selected invoices" in first["message"]
        assert first["count"] == 2

    def test_zip_first_line_reports_selection_scope(self, tmp_path, monkeypatch):
        png = tmp_path / "s.png"
        png.write_bytes(b"\x89PNG fake")
        import core.email_screenshotter as shooter
        monkeypatch.setattr(
            shooter, "generate_screenshots_with_progress",
            _fake_screenshot_gen({"inv1": {"screenshot_path": str(png)}}),
        )
        first = _run_ndjson(export_screenshots_zip, ExportRequest(invoices=[_invoice("inv1")]))[0]
        assert "Exporting 1 selected invoice" in first["message"]
        assert first["count"] == 1


class TestZipEntryNaming:
    def _final_names(self, req, monkeypatch, assignments):
        import core.email_screenshotter as shooter
        monkeypatch.setattr(
            shooter, "generate_screenshots_with_progress",
            _fake_screenshot_gen(assignments),
        )
        final = _run_ndjson(export_screenshots_zip, req)[-1]
        assert not final.get("error"), f"zip export failed: {final}"
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(final["file"]))) as zf:
            return zf.namelist()

    def test_company_preferred_with_domain_fallback_and_sanitizing(self, tmp_path, monkeypatch):
        """M23: entries are named after the supplier; the sender domain is
        only a fallback (PayPal-routed merchants all became paypal_*.png)."""
        pngs = {}
        for key in ("a", "b", "c"):
            p = tmp_path / f"{key}.png"
            p.write_bytes(b"\x89PNG fake")
            pngs[key] = str(p)

        req = ExportRequest(invoices=[
            _invoice("invapple", company="Apple", sender="no_reply@email.apple.com"),
            _invoice("invnc", company="", sender="billing@stripe.com"),
            _invoice("invdirty", company="Acme <Ltd>/Inc"),
        ])
        names = self._final_names(req, monkeypatch, {
            "invapple": {"screenshot_path": pngs["a"]},
            "invnc": {"screenshot_path": pngs["b"]},
            "invdirty": {"screenshot_path": pngs["c"]},
        })
        assert "Apple_2026-07-01_invapple.png" in names
        assert "stripe_2026-07-01_invnc.png" in names, (
            "empty company must fall back to the sender domain stem"
        )
        assert "Acme_Ltd_Inc_2026-07-01_invdirty.png" in names

    def test_path_shaped_invoice_id_neutralized(self, tmp_path, monkeypatch):
        """C3: an id like '../../evil' must not yield a zip-slip entry name."""
        png = tmp_path / "e.png"
        png.write_bytes(b"\x89PNG fake")
        req = ExportRequest(invoices=[_invoice("../../evil", company="Evil Corp")])
        names = self._final_names(req, monkeypatch, {
            "../../evil": {"screenshot_path": str(png)},
        })
        for name in names:
            assert "/" not in name and "\\" not in name and ".." not in name


class TestDiskBackedExportCache:
    def test_survives_memory_loss(self, tmp_path, monkeypatch):
        """S3: a worker restart (memory wipe) must not 410 pending downloads."""
        _isolate_cache(tmp_path, monkeypatch)
        wm._cache_put(VALID_CACHE_ID, b"PAYLOAD", {
            "content_type": "application/zip", "filename": "x.zip",
        })
        wm._FILE_CACHE.clear()  # simulated restart
        entry = wm._cache_get(VALID_CACHE_ID)
        assert entry is not None
        assert entry["data"] == b"PAYLOAD"
        assert entry["filename"] == "x.zip"

    def test_expired_disk_entry_unlinked_on_access(self, tmp_path, monkeypatch):
        _isolate_cache(tmp_path, monkeypatch)
        wm._cache_put(VALID_CACHE_ID, b"OLD", {"filename": "x.zip"})
        bin_path, meta_path = wm._disk_cache_paths(VALID_CACHE_ID)
        meta = json.loads(Path(meta_path).read_text(encoding="utf-8"))
        meta["created"] = time.time() - wm._CACHE_TTL - 60
        Path(meta_path).write_text(json.dumps(meta), encoding="utf-8")
        wm._FILE_CACHE.clear()
        assert wm._cache_get(VALID_CACHE_ID) is None
        assert not Path(bin_path).exists()
        assert not Path(meta_path).exists()

    def test_invalid_job_id_never_reaches_disk(self, tmp_path, monkeypatch):
        _isolate_cache(tmp_path, monkeypatch)
        wm._cache_put("../evil", b"x", {"filename": "e.bin"})
        cache_dir = Path(wm._CACHE_DIR)
        assert not cache_dir.exists() or not any(cache_dir.iterdir())

    def test_download_endpoint_serves_disk_copy(self, tmp_path, monkeypatch):
        _isolate_cache(tmp_path, monkeypatch)
        wm._cache_put(VALID_CACHE_ID, b"ZIPBYTES", {
            "content_type": "application/zip", "filename": "shots.zip",
        })
        wm._FILE_CACHE.clear()
        resp = asyncio.run(wm.download_export(VALID_CACHE_ID))
        assert resp.status_code == 200
        assert resp.body == b"ZIPBYTES"
        assert "shots.zip" in resp.headers["content-disposition"]


class TestWorkerAuthMiddleware:
    @staticmethod
    def _request(path="/scan", headers=None):
        from starlette.requests import Request
        raw = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
        return Request({
            "type": "http", "method": "POST", "path": path, "headers": raw,
            "query_string": b"", "scheme": "http", "server": ("test", 80),
            "root_path": "",
        })

    @staticmethod
    async def _call_next(request):
        return "PASSED_THROUGH"

    def test_rejects_missing_bearer_when_secret_set(self, monkeypatch):
        monkeypatch.setattr(wm, "_WORKER_SECRET", "sekrit")
        resp = asyncio.run(wm.verify_worker_auth(self._request(), self._call_next))
        assert getattr(resp, "status_code", None) == 401

    def test_accepts_matching_bearer(self, monkeypatch):
        monkeypatch.setattr(wm, "_WORKER_SECRET", "sekrit")
        resp = asyncio.run(wm.verify_worker_auth(
            self._request(headers={"authorization": "Bearer sekrit"}), self._call_next,
        ))
        assert resp == "PASSED_THROUGH"

    def test_health_is_exempt(self, monkeypatch):
        monkeypatch.setattr(wm, "_WORKER_SECRET", "sekrit")
        resp = asyncio.run(wm.verify_worker_auth(self._request(path="/health"), self._call_next))
        assert resp == "PASSED_THROUGH"


class TestScanCancellation:
    def test_cancel_endpoint_sets_flag_and_validates(self, monkeypatch):
        monkeypatch.setattr(wm, "_CANCELLED_SCANS", {})
        resp = asyncio.run(wm.cancel_scan("scan-abc"))
        assert resp == {"status": "cancel_requested", "scan_id": "scan-abc"}
        assert "scan-abc" in wm._CANCELLED_SCANS
        with pytest.raises(HTTPException) as exc:
            asyncio.run(wm.cancel_scan("x" * 65))
        assert exc.value.status_code == 400

    def test_stale_flags_are_pruned(self, monkeypatch):
        monkeypatch.setattr(wm, "_CANCELLED_SCANS", {
            "old-scan": time.time() - wm._CANCEL_TTL - 5,
        })
        asyncio.run(wm.cancel_scan("new-scan"))
        assert "old-scan" not in wm._CANCELLED_SCANS
        assert "new-scan" in wm._CANCELLED_SCANS

    def test_scan_stream_stops_cleanly_after_cancel(self, monkeypatch):
        """M1/S4: a cancel between batches must end the stream with a final
        cancelled line — no further Gmail batches fetched."""

        class Connector(_BaseFakeConnector):
            instances = []

            def list_message_ids(self, keywords, days_back, unread_only):
                return [f"m{i}" for i in range(120)]

        monkeypatch.setattr(wm, "GmailConnector", Connector)
        monkeypatch.setattr(wm, "_CANCELLED_SCANS", {})
        req = wm.ScanRequest(access_token="tok", scan_id="scan-cancel-1")

        async def scenario():
            resp = await wm.run_scan(req)
            lines: list[dict] = []
            async for chunk in resp.body_iterator:
                for raw in chunk.splitlines():
                    if raw.strip():
                        lines.append(json.loads(raw))
                if lines and lines[-1].get("message", "").startswith("Found"):
                    await wm.cancel_scan("scan-cancel-1")
            return lines

        lines = asyncio.run(scenario())
        final = lines[-1]
        assert final["stage"] == "cancelled"
        assert final["result"]["error"] == "cancelled"
        assert final["result"]["invoices"] == []
        assert Connector.instances[-1].batches_fetched == 0, (
            "no Gmail batch may be fetched after the cancel flag is set"
        )
        assert "scan-cancel-1" not in wm._CANCELLED_SCANS, (
            "cancel flag must be cleared when the stream ends"
        )


class TestEventLoopResponsiveness:
    """H5: blocking pipeline work must run off the event loop so /health
    (and any concurrent request) answers while a scan/debug run is active."""

    def test_scan_stream_keeps_event_loop_free(self, monkeypatch):
        class SlowScanConnector(_BaseFakeConnector):
            instances = []

            def list_message_ids(self, keywords, days_back, unread_only):
                time.sleep(0.6)  # blocking Gmail discovery
                return []

        monkeypatch.setattr(wm, "GmailConnector", SlowScanConnector)
        req = wm.ScanRequest(access_token="tok", scan_id="scan-h5")

        async def scenario():
            resp = await wm.run_scan(req)
            lines: list[dict] = []

            async def consume():
                async for chunk in resp.body_iterator:
                    for raw in chunk.splitlines():
                        if raw.strip():
                            lines.append(json.loads(raw))

            t0 = time.perf_counter()
            consumer = asyncio.create_task(consume())
            await asyncio.sleep(0.05)  # consumer is now inside the slow stage
            await wm.health()
            health_done = time.perf_counter() - t0
            await consumer
            return health_done, lines

        health_done, lines = asyncio.run(scenario())
        assert health_done < 0.5, (
            f"/health took {health_done:.2f}s — the scan pipeline is blocking the loop"
        )
        # NDJSON semantics preserved: same lines, same order (empty-scan case).
        assert lines[0]["message"] == "Searching inbox..."
        final = lines[-1]
        assert final["message"] == "No messages found"
        assert final["result"]["total_messages"] == 0

    def test_paypal_import_runs_off_the_event_loop(self, monkeypatch):
        class SlowConnector(_BaseFakeConnector):
            instances = []
            exec_calls = 0

            def _exec(self, request):
                type(self).exec_calls += 1
                time.sleep(0.25)  # each Gmail list call blocks
                return {"resultSizeEstimate": 0, "messages": []}

        monkeypatch.setattr(wm, "GmailConnector", SlowConnector)
        req = wm.PaypalImportRequest(access_token="tok")

        async def scenario():
            task = asyncio.create_task(wm.debug_paypal_import(req))
            t0 = time.perf_counter()
            await asyncio.sleep(0.05)  # handler is now in its blocking pipeline
            await wm.health()
            health_done = time.perf_counter() - t0
            resp = await task
            return health_done, resp

        health_done, resp = asyncio.run(scenario())
        assert SlowConnector.exec_calls >= 4, "the fake pipeline must actually run"
        assert resp.status_code == 200
        body = json.loads(resp.body)
        assert body["auth_ok"] is True
        assert body["funnel"]["discovery_ids"] == 0
        assert health_done < 0.5, (
            f"/health took {health_done:.2f}s — debug_paypal_import is blocking the loop"
        )
