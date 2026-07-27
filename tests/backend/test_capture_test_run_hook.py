"""Contract tests for the Claude Code test-run marker hook."""

import json
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
HOOK = REPO_ROOT / ".claude" / "hooks" / "capture-test-run.sh"
SETTINGS = REPO_ROOT / ".claude" / "settings.json"


def run_hook(tmp_path, payload):
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(
        [str(HOOK)],
        cwd=tmp_path,
        input=json.dumps(payload),
        text=True,
        check=True,
    )


def marker(tmp_path, category):
    path = tmp_path / ".claude" / "test-runs" / f"{category}.json"
    return json.loads(path.read_text()) if path.exists() else None


def successful_bash(command):
    return {
        "hook_event_name": "PostToolUse",
        "tool_name": "Bash",
        "tool_input": {"command": command},
        "tool_response": {
            "stdout": "passed",
            "stderr": "",
            "interrupted": False,
            "isImage": False,
        },
    }


def failed_bash(command, error="Command exited with non-zero status code 2"):
    return {
        "hook_event_name": "PostToolUseFailure",
        "tool_name": "Bash",
        "tool_input": {"command": command},
        "error": error,
        "is_interrupt": False,
    }


def test_successful_pytest_records_green_backend_marker(tmp_path):
    run_hook(tmp_path, successful_bash(".venv/bin/pytest tests/backend -q"))

    saved = marker(tmp_path, "backend")
    assert saved["exit_code"] == 0
    assert saved["command"] == ".venv/bin/pytest tests/backend -q"


def test_failed_pytest_replaces_old_green_marker(tmp_path):
    run_hook(tmp_path, successful_bash(".venv/bin/pytest tests/backend -q"))
    run_hook(tmp_path, failed_bash(".venv/bin/pytest tests/backend -q"))

    assert marker(tmp_path, "backend")["exit_code"] == 2


def test_explicit_legacy_exit_code_is_preserved(tmp_path):
    payload = successful_bash("pytest")
    payload["tool_response"]["exitCode"] = 3

    run_hook(tmp_path, payload)

    assert marker(tmp_path, "backend")["exit_code"] == 3


def test_failure_without_numeric_status_records_generic_failure(tmp_path):
    run_hook(tmp_path, failed_bash("pytest", error="Process interrupted"))

    assert marker(tmp_path, "backend")["exit_code"] == 1


def test_playwright_and_local_curl_record_their_markers(tmp_path):
    run_hook(tmp_path, successful_bash("npx playwright test"))
    run_hook(
        tmp_path,
        successful_bash("curl --fail http://127.0.0.1:5051/api/health"),
    )

    assert marker(tmp_path, "frontend")["exit_code"] == 0
    assert marker(tmp_path, "live_check")["exit_code"] == 0


def test_unrelated_bash_command_creates_no_markers(tmp_path):
    run_hook(tmp_path, successful_bash("git status --short"))

    assert not (tmp_path / ".claude" / "test-runs").exists()


def test_settings_registers_success_and_failure_events():
    settings = json.loads(SETTINGS.read_text())
    hooks = settings["hooks"]

    assert "PostToolUse" in hooks
    assert "PostToolUseFailure" in hooks
