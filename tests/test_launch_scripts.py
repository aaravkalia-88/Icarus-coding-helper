"""Exercise the real launch scripts with a local stand-in for npm/Electron.

Run with: python3 -m unittest discover -s tests -v
Each test gets its own project and process session; the real app never opens.
"""

import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[1]
FAKE_NPM = r'''
import json, os, signal, subprocess, sys, time
from pathlib import Path

assert sys.argv[1:] == json.loads(os.environ["TEST_NPM_ARGS"]), sys.argv
record = Path(os.environ["TEST_RECORD"])
with record.open("a") as stream:
    stream.write(json.dumps({"pid": os.getpid(), "cwd": os.getcwd(),
                             "python": os.environ.get("ICARUS_PYTHON")}) + "\n")
mode = os.environ.get("TEST_MODE", "running")
if mode == "exit":
    sys.exit(int(os.environ.get("TEST_EXIT_CODE", "0")))
worker_code = "import time; time.sleep(60)"
if mode == "stubborn":
    worker_code = "import signal, time; signal.signal(signal.SIGTERM, signal.SIG_IGN); time.sleep(60)"
worker = subprocess.Popen([sys.executable, "-c", worker_code])
Path(os.environ["TEST_WORKER"]).write_text(str(worker.pid))
# Give the worker time to install its handler before the test stops the app.
time.sleep(0.1)
Path(os.environ["TEST_READY"]).touch()
if mode == "orphan":
    sys.exit(0)
time.sleep(60)
'''


def running(pid):
    """Treat a zombie as stopped while its parent finishes reaping it."""
    result = subprocess.run(
        ["ps", "-p", str(pid), "-o", "stat="], capture_output=True, text=True
    )
    return result.returncode == 0 and not result.stdout.strip().startswith("Z")


class LaunchScriptsTest(unittest.TestCase):
    start_script = "start.sh"
    stop_script = "stop.sh"
    pid_name = ".icarus-start.pid"
    npm_args = ["run", "start"]

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="icarus scripts ")
        self.project = Path(self.temp.name).resolve()
        for name in ("start.sh", "stop.sh", self.start_script, self.stop_script):
            shutil.copy2(ROOT / name, self.project / name)
        (self.project / "frontend").mkdir()
        binaries = self.project / "bin"
        binaries.mkdir()
        npm = binaries / "npm"
        npm.write_text(f"#!{sys.executable}\n" + FAKE_NPM)
        npm.chmod(0o755)
        self.pid_file = self.project / self.pid_name
        self.record = self.project / "launches.jsonl"
        self.worker = self.project / "worker.pid"
        self.ready = self.project / "ready"
        self.env = {
            **os.environ,
            "PATH": f"{binaries}:{os.environ['PATH']}",
            "TEST_RECORD": str(self.record),
            "TEST_WORKER": str(self.worker),
            "TEST_READY": str(self.ready),
            "TEST_NPM_ARGS": json.dumps(self.npm_args),
        }
        self.processes = []

    def tearDown(self):
        # Never derive teardown targets from an untrusted PID file.
        pids = []
        if self.record.exists():
            pids.extend(json.loads(row)["pid"] for row in self.record.read_text().splitlines())
        if self.worker.exists():
            pids.append(int(self.worker.read_text()))
        for pid in pids:
            if running(pid):
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
        for process in self.processes:
            if process.poll() is None:
                process.kill()
            process.communicate(timeout=5)
        self.temp.cleanup()

    def wait_until(self, predicate, timeout=3):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(0.03)
        self.fail("Timed out waiting for the test process")

    def start(self, mode="running", exit_code=0):
        process = subprocess.Popen(
            [str(self.project / self.start_script)], cwd="/private/tmp",
            env={**self.env, "TEST_MODE": mode, "TEST_EXIT_CODE": str(exit_code)},
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            start_new_session=True,
        )
        self.processes.append(process)
        return process

    def stop(self):
        return subprocess.run(
            [str(self.project / self.stop_script)], cwd="/private/tmp", env=self.env,
            capture_output=True, text=True, timeout=15, start_new_session=True,
        )

    def test_success_cleans_pid_file_and_uses_project_directory(self):
        process = self.start("exit")
        output, _ = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 0, output)
        self.assertFalse(self.pid_file.exists())
        self.assertEqual(json.loads(self.record.read_text())["cwd"], str(self.project / "frontend"))

    def test_build_failure_preserves_exit_code_and_cleans_pid_file(self):
        process = self.start("exit", exit_code=23)
        output, _ = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 23, output)
        self.assertFalse(self.pid_file.exists())

    def test_project_python_is_selected_only_for_desktop_and_keeps_overrides(self):
        self.env.pop("ICARUS_PYTHON", None)
        self.env.pop("VIRTUAL_ENV", None)
        python = self.project / ".venv" / "bin" / "python3"
        for label, override, active, expected in (
            ("system fallback", None, None, None),
            ("project environment", None, None, str(python)),
            ("explicit interpreter", "/fixture/custom-python", None, "/fixture/custom-python"),
            ("activated environment", None, "/fixture/active-venv", None),
        ):
            with self.subTest(label=label):
                if label == "project environment":
                    python.parent.mkdir(parents=True)
                    python.write_text("#!/bin/sh\nexit 0\n")
                    python.chmod(0o755)
                self.env.pop("ICARUS_PYTHON", None)
                self.env.pop("VIRTUAL_ENV", None)
                if override:
                    self.env["ICARUS_PYTHON"] = override
                if active:
                    self.env["VIRTUAL_ENV"] = active
                process = self.start("exit")
                output, _ = process.communicate(timeout=5)
                self.assertEqual(process.returncode, 0, output)
                if self.start_script == "start_web.sh":
                    expected = override
                record = json.loads(self.record.read_text().splitlines()[-1])
                self.assertEqual(record["python"], expected)

    def test_stop_is_repeatable_and_stops_descendants(self):
        process = self.start()
        self.wait_until(self.ready.exists)
        worker_pid = int(self.worker.read_text())
        result = self.stop()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        process.communicate(timeout=5)
        self.assertEqual(process.returncode, 143)
        self.wait_until(lambda: not running(worker_pid))
        self.assertFalse(self.pid_file.exists())
        self.assertEqual(self.stop().returncode, 0)

    def test_terminal_interrupt_stops_descendants(self):
        process = self.start()
        self.wait_until(self.ready.exists)
        worker_pid = int(self.worker.read_text())
        process.send_signal(signal.SIGINT)
        output, _ = process.communicate(timeout=12)
        self.assertEqual(process.returncode, 130, output)
        self.assertFalse(running(worker_pid))
        self.assertFalse(self.pid_file.exists())

    def test_stop_forces_descendants_that_ignore_term(self):
        process = self.start("stubborn")
        self.wait_until(self.ready.exists)
        worker_pid = int(self.worker.read_text())
        result = self.stop()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        process.communicate(timeout=5)
        self.assertFalse(running(worker_pid))
        self.assertFalse(self.pid_file.exists())

    def test_parent_exit_does_not_orphan_descendants(self):
        process = self.start("orphan")
        output, _ = process.communicate(timeout=12)
        self.assertEqual(process.returncode, 0, output)
        self.assertFalse(running(int(self.worker.read_text())))
        self.assertFalse(self.pid_file.exists())

    def test_duplicate_start_leaves_original_running(self):
        first = self.start()
        self.wait_until(self.ready.exists)
        second = self.start()
        output, _ = second.communicate(timeout=5)
        self.assertEqual(second.returncode, 0, output)
        self.assertIsNone(first.poll())
        self.assertEqual(len(self.record.read_text().splitlines()), 1)
        self.assertEqual(self.stop().returncode, 0)

    def test_stale_pid_allows_restart(self):
        gone = subprocess.Popen(["/usr/bin/true"])
        gone.wait()
        self.pid_file.write_text(str(gone.pid) + "\n")
        process = self.start("exit")
        output, _ = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 0, output)
        self.assertFalse(self.pid_file.exists())

    def test_empty_pid_allows_restart(self):
        self.pid_file.touch()
        process = self.start("exit")
        output, _ = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 0, output)
        self.assertFalse(self.pid_file.exists())

    def test_simultaneous_starts_launch_only_one_app(self):
        launches = [self.start() for _ in range(5)]
        self.wait_until(self.ready.exists)
        self.wait_until(lambda: sum(process.poll() is None for process in launches) == 1)
        self.assertEqual(len(self.record.read_text().splitlines()), 1)
        self.assertEqual(self.stop().returncode, 0)

    def test_relative_zsh_invocation_can_start_and_stop(self):
        process = subprocess.Popen(
            ["/bin/zsh", f"./{self.start_script}"], cwd=self.project, env=self.env,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            start_new_session=True,
        )
        self.processes.append(process)
        self.wait_until(self.ready.exists)
        result = subprocess.run(
            ["/bin/zsh", f"./{self.stop_script}"], cwd=self.project, env=self.env,
            capture_output=True, text=True, timeout=15,
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        process.communicate(timeout=5)
        self.assertFalse(self.pid_file.exists())

    def test_missing_npm_fails_without_leaving_a_pid(self):
        process = subprocess.run(
            [str(self.project / self.start_script)],
            env={**self.env, "PATH": "/usr/bin:/bin"},
            capture_output=True, text=True, timeout=5,
        )
        self.assertEqual(process.returncode, 127, process.stdout + process.stderr)
        self.assertFalse(self.pid_file.exists())

    def test_stop_removes_a_stale_pid(self):
        gone = subprocess.Popen(["/usr/bin/true"])
        gone.wait()
        self.pid_file.write_text(str(gone.pid) + "\n")
        self.assertEqual(self.stop().returncode, 0)
        self.assertFalse(self.pid_file.exists())

    def test_stop_refuses_unrelated_process(self):
        unrelated = subprocess.Popen(["/bin/sleep", "60"], start_new_session=True)
        self.processes.append(unrelated)
        self.pid_file.write_text(str(unrelated.pid) + "\n")
        result = self.stop()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIsNone(unrelated.poll(), "stop.sh killed an unrelated process")

    def test_invalid_pid_is_rejected_without_signaling_process_groups(self):
        # stop.sh runs in an isolated session even against the old unsafe code.
        for value in ("", "0", "1", "-1", "not-a-pid", "0123", "2\n3"):
            with self.subTest(value=value):
                self.pid_file.write_text(value + "\n")
                result = self.stop()
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertFalse(self.pid_file.exists())


class WebLaunchScriptsTest(LaunchScriptsTest):
    start_script = "start_web.sh"
    stop_script = "stop_web.sh"
    pid_name = ".icarus-web.pid"
    npm_args = ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5173", "--strictPort"]

    def test_web_stop_refuses_desktop_launcher(self):
        desktop_pid_file = self.project / ".icarus-start.pid"
        desktop = subprocess.Popen(
            [str(self.project / "start.sh")], cwd="/private/tmp",
            env={**self.env, "TEST_NPM_ARGS": json.dumps(["run", "start"])},
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            start_new_session=True,
        )
        self.processes.append(desktop)
        self.wait_until(self.ready.exists)
        self.pid_file.write_text(desktop_pid_file.read_text())
        result = self.stop()
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        self.assertIsNone(desktop.poll(), "Web stop killed the desktop launcher")
        self.assertTrue(desktop_pid_file.exists())
        subprocess.run([str(self.project / "stop.sh")], env=self.env, timeout=15,
                       capture_output=True, start_new_session=True, check=True)


if __name__ == "__main__":
    unittest.main()
