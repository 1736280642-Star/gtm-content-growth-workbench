import hashlib
import os
import sys
import tempfile
import unittest
from pathlib import Path


RUNNER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNNER_ROOT))

from joto_arcs_runner.ledger import PublishLedger
from joto_arcs_runner.platforms import has_security_challenge, profile_dir
from joto_arcs_runner.server import RunnerService, expected_idempotency_key, validate_publish_payload


class FakePublisher:
    def __init__(self):
        self.publish_calls = 0

    def check_auth(self, platform):
        return {"authenticated": True, "status": "ready"}

    def publish(self, platform, payload):
        self.publish_calls += 1
        return {"ok": True, "status": "published_verified", "publishStatus": "confirmed", "publicUrl": "https://example.com/public"}

    def verify(self, platform, payload):
        return {"ok": True, "status": "published_verified", "publishStatus": "confirmed", "publicUrl": "https://example.com/public"}


def payload():
    value = {
        "scheduleId": "schedule-1",
        "platform": "csdn",
        "contentHash": "a" * 64,
        "title": "Test title",
        "markdown": "Test markdown body",
    }
    value["idempotencyKey"] = hashlib.sha256(f"{value['scheduleId']}:{value['platform']}:{value['contentHash']}".encode("utf-8")).hexdigest()
    return value


class RunnerContractTest(unittest.TestCase):
    def test_idempotency_contract(self):
        value = payload()
        self.assertEqual(expected_idempotency_key(value), value["idempotencyKey"])
        self.assertIsNone(validate_publish_payload(value))
        value["contentHash"] = "b" * 64
        self.assertIn("idempotencyKey", validate_publish_payload(value))

    def test_duplicate_never_publishes_twice(self):
        with tempfile.TemporaryDirectory() as directory:
            publisher = FakePublisher()
            service = RunnerService(PublishLedger(Path(directory) / "ledger.json"), publisher)
            first_status, first = service.publish(payload())
            second_status, second = service.publish(payload())
            self.assertEqual(first_status, 200)
            self.assertEqual(second_status, 200)
            self.assertTrue(first["ok"])
            self.assertTrue(second["duplicateProtected"])
            self.assertEqual(publisher.publish_calls, 1)

    def test_security_challenge_detection(self):
        self.assertTrue(has_security_challenge("请完成手机号验证"))
        self.assertTrue(has_security_challenge("CAPTCHA required"))
        self.assertFalse(has_security_challenge("文章已发布"))

    def test_profiles_are_outside_repository(self):
        with tempfile.TemporaryDirectory() as directory:
            previous = os.environ.get("LOCALAPPDATA")
            os.environ["LOCALAPPDATA"] = directory
            try:
                path = profile_dir("zhihu")
                self.assertTrue(str(path).startswith(str(Path(directory).resolve())))
            finally:
                if previous is None:
                    os.environ.pop("LOCALAPPDATA", None)
                else:
                    os.environ["LOCALAPPDATA"] = previous


if __name__ == "__main__":
    unittest.main()
