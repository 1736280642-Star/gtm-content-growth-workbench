import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

RUNNER_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RUNNER_ROOT))

from joto_arcs_runner.env import load_project_env
from joto_arcs_runner import platforms


class FakeChromiumOptions:
    last_instance = None

    def __init__(self):
        self.browser_path = None
        self.local_port = None
        self.user_data_path = None
        FakeChromiumOptions.last_instance = self

    def set_browser_path(self, path):
        self.browser_path = path

    def set_local_port(self, port):
        self.local_port = port

    def set_user_data_path(self, path):
        self.user_data_path = path

    def set_argument(self, _argument):
        return None

    def headless(self, _enabled):
        return None


class FakeChromium:
    def __init__(self, addr_or_opts):
        self.options = addr_or_opts


class BrowserConnectError(Exception):
    pass


class RetryChromium(FakeChromium):
    calls = 0

    def __init__(self, addr_or_opts):
        RetryChromium.calls += 1
        if RetryChromium.calls == 1:
            raise BrowserConnectError("browser is still starting")
        super().__init__(addr_or_opts)


class BrowserConfigurationTests(unittest.TestCase):
    def test_project_env_loads_browser_path_without_overriding_process_env(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            (root / ".env.local").write_text("ARCS_BROWSER_PATH=file-edge.exe\nARCS_RUNNER_PORT=9999\n", encoding="utf-8")
            with patch.dict(os.environ, {"ARCS_RUNNER_PORT": "9530"}, clear=True):
                load_project_env(root)
                self.assertEqual(os.environ["ARCS_BROWSER_PATH"], "file-edge.exe")
                self.assertEqual(os.environ["ARCS_RUNNER_PORT"], "9530")

    def test_browser_uses_arcs_browser_path(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            executable = root / "msedge.exe"
            executable.touch()
            profile = root / "csdn-profile"
            fake_module = types.SimpleNamespace(Chromium=FakeChromium, ChromiumOptions=FakeChromiumOptions)
            with patch.dict(
                os.environ,
                {
                    "ARCS_BROWSER_PATH": str(executable),
                    "CSDN_BROWSER_PROFILE_DIR": str(profile),
                },
                clear=True,
            ), patch.dict(sys.modules, {"DrissionPage": fake_module}):
                browser = platforms._browser("csdn")

            self.assertIsInstance(browser, FakeChromium)
            self.assertEqual(FakeChromiumOptions.last_instance.browser_path, str(executable.resolve()))
            self.assertEqual(FakeChromiumOptions.last_instance.local_port, 9330)
            self.assertEqual(FakeChromiumOptions.last_instance.user_data_path, str(profile.resolve()))

    def test_missing_browser_executable_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            missing = Path(temporary_dir) / "missing-msedge.exe"
            with patch.dict(os.environ, {"ARCS_BROWSER_PATH": str(missing)}, clear=True):
                with self.assertRaisesRegex(RuntimeError, "ARCS_BROWSER_PATH"):
                    platforms.browser_executable_path()

    def test_browser_path_auto_discovers_installed_edge(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            program_files_x86 = Path(temporary_dir)
            executable = program_files_x86 / "Microsoft" / "Edge" / "Application" / "msedge.exe"
            executable.parent.mkdir(parents=True)
            executable.touch()
            with patch.dict(os.environ, {"PROGRAMFILES(X86)": str(program_files_x86)}, clear=True):
                self.assertEqual(platforms.browser_executable_path(), executable.resolve())

    def test_browser_retries_one_transient_connection_failure(self):
        with tempfile.TemporaryDirectory() as temporary_dir:
            profile = Path(temporary_dir) / "juejin-profile"
            RetryChromium.calls = 0
            fake_module = types.SimpleNamespace(Chromium=RetryChromium, ChromiumOptions=FakeChromiumOptions)
            with patch.dict(
                os.environ,
                {"JUEJIN_BROWSER_PROFILE_DIR": str(profile)},
                clear=True,
            ), patch.dict(sys.modules, {"DrissionPage": fake_module}), patch("joto_arcs_runner.platforms.time.sleep") as sleep:
                browser = platforms._browser("juejin")

            self.assertIsInstance(browser, RetryChromium)
            self.assertEqual(RetryChromium.calls, 2)
            sleep.assert_called_once_with(2)


if __name__ == "__main__":
    unittest.main()
