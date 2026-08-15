#!/usr/bin/env python3
"""Run Claude's official auth login in a PTY and emit only safe state events.

The parent process sends JSON lines on stdin:
  {"type":"code","value":"..."} or {"type":"cancel"}

Raw PTY output and submitted codes never leave this process.
"""

import ctypes
import json
import os
import pty
import re
import select
import signal
import sys
import time


ANSI_RE = re.compile(
    r"\x1B(?:\][^\x07]*(?:\x07|\x1B\\)|\[[0-?]*[ -/]*[@-~]|[()][A-Z0-9]|[@-_])"
)
URL_RE = re.compile(r"https://[^\s\x00-\x20<>\"']{1,2048}")
CODE_PROMPT_RE = re.compile(
    r"(?:paste|enter|input)[^\r\n]{0,80}(?:code|token)|(?:code|token)[^\r\n]{0,80}(?:paste|enter|input)",
    re.IGNORECASE,
)
MAX_OUTPUT = 262144
TIMEOUT_SECONDS = 300


def emit(event, **values):
    print(json.dumps({"event": event, **values}, ensure_ascii=False), flush=True)


def clean(value):
    text = value.decode("utf-8", "replace").replace("\r", "\n")
    text = ANSI_RE.sub("", text).replace("\x0f", "")
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)


def parent_death_signal():
    if sys.platform.startswith("linux"):
        try:
            ctypes.CDLL(None).prctl(1, signal.SIGTERM)
        except Exception:
            pass


def terminate(pid):
    try:
        os.killpg(pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        try:
            os.kill(pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError):
            return
    deadline = time.monotonic() + 1.5
    while time.monotonic() < deadline:
        try:
            result, _ = os.waitpid(pid, os.WNOHANG)
            if result == pid:
                return
        except ChildProcessError:
            return
        time.sleep(0.05)
    try:
        os.killpg(pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        try:
            os.kill(pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass


def main():
    if len(sys.argv) != 6:
        raise SystemExit("usage: claude-auth-pty.py BINARY CWD MODE ATTEMPT_ID MARKER")
    binary, cwd, mode, attempt_id, marker = sys.argv[1:]
    flags = {"subscription": [], "console": ["--console"], "sso": ["--sso"]}
    if mode not in flags:
        raise SystemExit("unsupported login mode")
    if not os.path.isabs(binary) or not os.path.isdir(cwd):
        raise SystemExit("invalid runtime or working directory")

    parent_death_signal()
    pid, fd = pty.fork()
    if pid == 0:
        parent_death_signal()
        os.chdir(cwd)
        env = dict(os.environ)
        env.update({"DISABLE_AUTOUPDATER": "1", "NO_COLOR": "1", "TERM": "xterm-256color"})
        os.execve(binary, [binary, "auth", "login", *flags[mode]], env)

    cancelled = False
    child_done = False

    def request_cancel(_signum=None, _frame=None):
        nonlocal cancelled
        cancelled = True

    signal.signal(signal.SIGTERM, request_cancel)
    signal.signal(signal.SIGINT, request_cancel)
    emit(
        "helper/start",
        attemptId=attempt_id,
        marker=marker,
        uid=os.getuid(),
        gid=os.getgid(),
        home=os.environ.get("HOME", ""),
    )

    output = bytearray()
    total = 0
    seen_urls = set()
    code_required = False
    code_submitted = False
    started = time.monotonic()
    exit_code = None
    failure = None
    try:
        while not child_done:
            if cancelled:
                terminate(pid)
                emit("helper/cancelled")
                return
            if time.monotonic() - started >= TIMEOUT_SECONDS:
                terminate(pid)
                emit("helper/timeout")
                return

            readable, _, _ = select.select([fd, sys.stdin.fileno()], [], [], 0.2)
            if fd in readable:
                try:
                    chunk = os.read(fd, 65536)
                except OSError:
                    chunk = b""
                if chunk:
                    total += len(chunk)
                    if total > MAX_OUTPUT:
                        failure = "output_limit"
                        terminate(pid)
                        break
                    output.extend(chunk)
                    text = clean(bytes(output))
                    for candidate in URL_RE.findall(text):
                        candidate = candidate.rstrip(".,);]")
                        if candidate not in seen_urls:
                            seen_urls.add(candidate)
                            emit("helper/url", url=candidate)
                    if not code_required and CODE_PROMPT_RE.search(text):
                        code_required = True
                        emit("helper/code-required")
                    if len(output) > 65536:
                        del output[:-65536]
                else:
                    child_done = True

            if sys.stdin.fileno() in readable:
                line = sys.stdin.readline(4096)
                if not line:
                    cancelled = True
                    continue
                try:
                    message = json.loads(line)
                except Exception:
                    continue
                if message.get("type") == "cancel":
                    cancelled = True
                elif message.get("type") == "code" and not code_submitted:
                    value = message.get("value")
                    if isinstance(value, str) and 1 <= len(value) <= 512 and re.fullmatch(r"[A-Za-z0-9._~+/=:#-]+", value):
                        os.write(fd, value.encode("utf-8") + b"\r")
                        code_submitted = True
                        value = ""
                        message.clear()
                        emit("helper/verifying")

            try:
                result, status = os.waitpid(pid, os.WNOHANG)
                if result == pid:
                    child_done = True
                    if os.WIFEXITED(status):
                        exit_code = os.WEXITSTATUS(status)
                    elif os.WIFSIGNALED(status):
                        exit_code = 128 + os.WTERMSIG(status)
                    else:
                        exit_code = 1
            except ChildProcessError:
                child_done = True
                exit_code = 0
    finally:
        try:
            os.close(fd)
        except OSError:
            pass

    if failure:
        emit("helper/failed", category=failure)
    else:
        emit("helper/exit", exitCode=exit_code if isinstance(exit_code, int) else 1)


if __name__ == "__main__":
    main()
