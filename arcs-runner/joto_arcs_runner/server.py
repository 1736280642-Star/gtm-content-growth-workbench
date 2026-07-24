import hashlib
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .ledger import PublishLedger
from .platforms import BrowserPublisher, PLATFORM_CONFIG


LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}


def default_ledger_path() -> Path:
    local_data = os.environ.get("LOCALAPPDATA", "").strip()
    root = Path(local_data) if local_data else Path.home() / ".joto-publish-runner"
    return root / "JotoPublishRunner" / "arcs-ledger.json"


def expected_idempotency_key(payload: dict[str, Any]) -> str:
    value = f"{payload.get('scheduleId', '')}:{payload.get('platform', '')}:{payload.get('contentHash', '')}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def validate_publish_payload(payload: dict[str, Any]) -> str | None:
    required = ["scheduleId", "platform", "contentHash", "idempotencyKey", "title", "markdown"]
    missing = [name for name in required if not str(payload.get(name, "")).strip()]
    if missing:
        return f"missing fields: {', '.join(missing)}"
    if payload["platform"] not in PLATFORM_CONFIG:
        return "platform is not supported"
    if payload["idempotencyKey"] != expected_idempotency_key(payload):
        return "idempotencyKey does not match scheduleId, platform, and contentHash"
    return None


class RunnerService:
    def __init__(self, ledger: PublishLedger, publisher: BrowserPublisher):
        self.ledger = ledger
        self.publisher = publisher

    def check_auth(self, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        platform = str(payload.get("platform", ""))
        if platform not in PLATFORM_CONFIG:
            return 400, {"authenticated": False, "status": "failed", "message": "unsupported platform", "nextAction": "Use csdn, juejin, or zhihu."}
        return 200, self.publisher.check_auth(platform)

    def publish(self, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        error = validate_publish_payload(payload)
        if error:
            return 400, {"ok": False, "status": "precheck_failed", "publishStatus": "failed", "failureCode": "payload_invalid", "failureReason": error, "nextAction": "Create a new publish schedule from V5."}

        key = str(payload["idempotencyKey"])
        created, record = self.ledger.begin(key, {"scheduleId": payload["scheduleId"], "platform": payload["platform"], "contentHash": payload["contentHash"], "title": payload["title"]})
        if not created:
            if isinstance(record.get("result"), dict):
                return 200, {**record["result"], "duplicateProtected": True}
            return 409, {"ok": False, "status": "pending_verify", "publishStatus": "submitted", "failureCode": "duplicate_protected", "failureReason": "The same idempotency key is already in progress.", "nextAction": "Verify the platform state; do not publish again.", "duplicateProtected": True}

        result = self.publisher.publish(str(payload["platform"]), payload)
        self.ledger.complete(key, result)
        return (200 if result.get("ok") else 409 if result.get("status") == "manual_takeover_required" else 502), result

    def verify(self, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        key = str(payload.get("idempotencyKey", ""))
        record = self.ledger.get(key) if key else None
        if not record:
            return 404, {"ok": False, "status": "pending_verify", "failureCode": "verification_failed", "failureReason": "idempotency record was not found", "nextAction": "Inspect the platform creator center manually."}
        platform = str(record.get("platform", ""))
        verify_payload = {**record, **payload}
        result = self.publisher.verify(platform, verify_payload)
        self.ledger.complete(key, result)
        return 200, result


class Handler(BaseHTTPRequestHandler):
    service: RunnerService
    bearer_token: str

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self) -> bool:
        return bool(self.bearer_token) and self.headers.get("Authorization") == f"Bearer {self.bearer_token}"

    def _payload(self) -> dict[str, Any]:
        length = min(int(self.headers.get("Content-Length", "0")), 5_000_000)
        value = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
        return value if isinstance(value, dict) else {}

    def do_GET(self) -> None:
        if not self._authorized():
            self._json(401, {"message": "Unauthorized"})
            return
        if urlparse(self.path).path == "/status":
            self._json(200, {"ok": True, "service": "joto-arcs-publish-runner", "supportedPlatforms": list(PLATFORM_CONFIG)})
            return
        self._json(404, {"message": "Not found"})

    def do_POST(self) -> None:
        if not self._authorized():
            self._json(401, {"message": "Unauthorized"})
            return
        try:
            payload = self._payload()
            path = urlparse(self.path).path
            if path == "/auth/check":
                status, result = self.service.check_auth(payload)
            elif path == "/publish":
                status, result = self.service.publish(payload)
            elif path == "/verify":
                status, result = self.service.verify(payload)
            else:
                status, result = 404, {"message": "Not found"}
            self._json(status, result)
        except (ValueError, json.JSONDecodeError) as error:
            self._json(400, {"message": str(error)})
        except Exception as error:
            self._json(500, {"ok": False, "status": "failed", "failureCode": "adapter_failed", "failureReason": type(error).__name__, "nextAction": "Inspect the local runner and platform page; do not retry blindly."})


def main() -> None:
    host = os.environ.get("ARCS_RUNNER_HOST", "127.0.0.1").strip()
    port = int(os.environ.get("ARCS_RUNNER_PORT", "9530"))
    token = os.environ.get("JOTO_PUBLISH_RUNNER_TOKEN", "").strip() or os.environ.get("WECHATSYNC_BRIDGE_TOKEN", "").strip()
    if host not in LOOPBACK_HOSTS:
        raise RuntimeError("ARCS_RUNNER_HOST must be a loopback host")
    if not token:
        raise RuntimeError("JOTO_PUBLISH_RUNNER_TOKEN or WECHATSYNC_BRIDGE_TOKEN is required")

    ledger_path = Path(os.environ.get("JOTO_PUBLISH_RUNNER_LEDGER_PATH", "").strip() or default_ledger_path()).expanduser().resolve()
    repository_root = Path(__file__).resolve().parents[2]
    if ledger_path == repository_root or repository_root in ledger_path.parents:
        raise RuntimeError("The publish ledger must be stored outside the repository")

    Handler.service = RunnerService(PublishLedger(ledger_path), BrowserPublisher())
    Handler.bearer_token = token
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"JOTO Arcs runner listening on http://{host}:{port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
