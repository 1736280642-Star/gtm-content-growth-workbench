import sys
import tempfile
import unittest
from pathlib import Path


RUNNER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNNER_ROOT))

from joto_arcs_runner.instance_lock import RunnerInstanceLock


class RunnerInstanceLockTests(unittest.TestCase):
    def test_second_owner_is_rejected_until_first_releases(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "runner.lock"
            first = RunnerInstanceLock(path)
            second = RunnerInstanceLock(path)
            first.acquire()
            try:
                with self.assertRaisesRegex(RuntimeError, "already owns"):
                    second.acquire()
            finally:
                first.release()

            second.acquire()
            second.release()


if __name__ == "__main__":
    unittest.main()
