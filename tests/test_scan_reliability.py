"""Reliability regression tests for the scan worker.

Covers the two intermittent, hard-to-reproduce failure modes that caused
real missed invoices / silent failures:

  1. Gmail batch-fetch PARTIAL failures — some sub-requests in a batch return
     429/5xx while the overall batch succeeds. Those must be recovered by an
     individual retry, not silently dropped. (core.gmail_connector.get_messages_batch)
  2. Revoked / expired Google refresh tokens — must be recognised as auth
     errors so the app prompts a reconnect instead of retrying forever or
     failing opaquely. (core.gmail_connector._is_auth_error)
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core.gmail_connector import GmailConnector, _is_auth_error


# ── Fakes for the Gmail batch protocol ──────────────────────────────────────

class _FakeReq:
    def __init__(self, mid: str, fail_individual: bool):
        self.message_id = mid
        self._fail = fail_individual

    def execute(self, **_kw):
        if self._fail:
            # Non-HttpError so _exec re-raises immediately (no retry sleeps).
            raise RuntimeError(f"individual fetch failed for {self.message_id}")
        return {"id": self.message_id, "payload": {"headers": []}}


class _FakeMessages:
    def __init__(self, svc): self.svc = svc
    def get(self, userId=None, id=None, format=None):  # noqa: A002 - mirror Gmail API
        return _FakeReq(id, id in self.svc.individual_fail_ids)


class _FakeUsers:
    def __init__(self, svc): self.svc = svc
    def messages(self): return _FakeMessages(self.svc)


class _FakeBatch:
    """Mimics googleapiclient BatchHttpRequest: collects (request, callback)
    and on execute() invokes each callback with (id, response, exception)."""
    def __init__(self, svc): self.svc = svc; self.items = []

    def add(self, request, callback=None):
        self.items.append((request, callback))

    def execute(self):
        for req, cb in self.items:
            mid = req.message_id
            if mid in self.svc.batch_fail_ids:
                cb(mid, None, Exception(f"HTTP 503 sub-request failure for {mid}"))
            else:
                cb(mid, {"id": mid, "payload": {"headers": []}}, None)


class _FakeService:
    def __init__(self, batch_fail_ids, individual_fail_ids):
        self.batch_fail_ids = set(batch_fail_ids)
        self.individual_fail_ids = set(individual_fail_ids)

    def users(self): return _FakeUsers(self)
    def new_batch_http_request(self): return _FakeBatch(self)


# ── Partial batch-failure recovery ──────────────────────────────────────────

def test_batch_partial_failure_recovered_individually():
    """3 of 5 sub-requests fail in the batch; 2 are recovered by the individual
    retry, 1 stays failed (and is recorded with safe metadata)."""
    c = GmailConnector()
    c.service = _FakeService(batch_fail_ids={"m1", "m2", "m3"}, individual_fail_ids={"m3"})
    res = c.get_messages_batch(["m0", "m1", "m2", "m3", "m4"])

    assert res[0] is not None and res[4] is not None, "batch-successful messages must be present"
    assert res[1] is not None and res[2] is not None, "transiently-failed messages must be recovered"
    assert res[3] is None, "permanently-failed message stays None (not fabricated)"

    assert c.fetch_recovered == 2
    assert c.fetch_failed_final == 1
    assert len(c.fetch_failed_ids) == 1
    assert c.fetch_failed_ids[0]["id"] == "m3"
    # Safe metadata only — id + reason, never body.
    assert set(c.fetch_failed_ids[0].keys()) == {"id", "reason"}


def test_batch_all_success_no_recovery_needed():
    c = GmailConnector()
    c.service = _FakeService(batch_fail_ids=set(), individual_fail_ids=set())
    res = c.get_messages_batch(["a", "b", "c"])
    assert all(r is not None for r in res)
    assert c.fetch_recovered == 0
    assert c.fetch_failed_final == 0


def test_batch_all_recovered_when_individual_retry_succeeds():
    """Every sub-request fails in the batch but all recover individually —
    the scan should lose ZERO messages (the core 'missing invoices' fix)."""
    c = GmailConnector()
    ids = [f"m{i}" for i in range(10)]
    c.service = _FakeService(batch_fail_ids=set(ids), individual_fail_ids=set())
    res = c.get_messages_batch(ids)
    assert all(r is not None for r in res), "all messages must be recovered"
    assert c.fetch_recovered == 10
    assert c.fetch_failed_final == 0


# ── Revoked / expired token detection ───────────────────────────────────────

def test_is_auth_error_detects_invalid_grant():
    assert _is_auth_error(Exception("invalid_grant: Token has been expired or revoked.")) is True


def test_is_auth_error_detects_revoked_token():
    assert _is_auth_error(Exception("Token has been revoked")) is True


def test_is_auth_error_detects_invalid_scope():
    assert _is_auth_error(Exception("invalid_scope: Bad Request")) is True


def test_is_auth_error_detects_refresh_error():
    from google.auth.exceptions import RefreshError
    assert _is_auth_error(RefreshError("('invalid_grant: Token has been expired or revoked.', ...)")) is True


def test_is_auth_error_false_for_transient_http():
    # A transient 503 is NOT an auth error — it should be retried, not surfaced
    # as "reconnect Google".
    assert _is_auth_error(Exception("503 Service Unavailable")) is False
    assert _is_auth_error(Exception("rate limit exceeded")) is False
