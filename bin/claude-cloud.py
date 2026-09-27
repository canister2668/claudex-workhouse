#!/usr/bin/env python3
"""Create a Claude Code cloud session through the official `claude --cloud`.

The CLI only creates Anthropic-hosted cloud sessions from an interactive
terminal (a non-interactive `--cloud "<task>"` is rejected), so this helper
drives it in a pseudo-terminal and returns the session it printed as JSON.
"""

import json
import os
import pty
import re
import select
import signal
import stat
import subprocess
import sys
import time


ANSI_RE = re.compile(
    r"\x1B(?:\][^\x07]*(?:\x07|\x1B\\)|\[[0-?]*[ -/]*[@-~]|[()][A-Z0-9]|[@-_])"
)
VIEW_RE = re.compile(r"View:\s*(https://\S+)")
SESSION_RE = re.compile(r"\b((?:session|cse)_[A-Za-z0-9]+)\b")
TITLE_RE = re.compile(r"Created cloud session:\s*(.+)")
TIMEOUT_S = 300


def clean_terminal(value: bytes) -> str:
    text = value.decode("utf-8", "replace").replace("\r", "\n")
    text = ANSI_RE.sub("", text).replace("\x0f", "")
    return re.sub(r"\n{3,}", "\n\n", text)


def git(cwd, *args):
    result = subprocess.run(
        ["git", "-C", cwd, *args],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        universal_newlines=True,
    )
    return result.stdout.strip() if result.returncode == 0 else None


def ensure_private_seed_directory(config_home):
    # A share ACL can create the CLI's upload scratch directory as 0777, and the
    # CLI then refuses to stage a repository bundle there. It holds scratch only.
    path = os.path.join(config_home, "seed-admin")
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return
    if stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and info.st_mode & 0o077:
        os.chmod(path, 0o700)


def parse_created(text):
    view = VIEW_RE.search(text)
    session = SESSION_RE.search(view.group(1)) if view else None
    if not session:
        return None
    title = TITLE_RE.search(text)
    return {
        "sessionId": session.group(1),
        "url": view.group(1).split("?")[0],
        "title": title.group(1).strip() if title else None,
    }


def failure_detail(text):
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    start = next((index for index, line in enumerate(lines) if line.startswith("Error")), None)
    return " ".join(lines[start:] if start is not None else lines[-6:])[:1200]


def create(binary, cwd, task, bundle):
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(cwd)
        env = dict(os.environ)
        env.update(
            {
                "DISABLE_AUTOUPDATER": "1",
                "NO_COLOR": "1",
                "TERM": "xterm-256color",
                "COLUMNS": "200",
                "LINES": "50",
            }
        )
        # Same as bin/claude-usage.py: an inherited CLAUDE_CONFIG_DIR sends the
        # CLI into first-run onboarding instead of the signed-in account.
        env.pop("CLAUDE_CONFIG_DIR", None)
        if bundle:
            env["CCR_FORCE_BUNDLE"] = "1"
        os.execvpe(binary, [binary, "--ax-screen-reader", "--no-chrome", "--cloud", task], env)

    output = bytearray()
    trusted = False
    started = time.monotonic()
    try:
        while time.monotonic() - started < TIMEOUT_S:
            readable, _, _ = select.select([fd], [], [], 0.25)
            if readable:
                try:
                    chunk = os.read(fd, 65536)
                except OSError:
                    break
                if not chunk:
                    break
                output.extend(chunk)
                if len(output) > 262144:
                    del output[:-262144]
            text = clean_terminal(bytes(output))
            if not trusted and "Quick safety check" in text and (
                "Enter y/n" in text or "Enter to confirm" in text
            ):
                # The caller chose this registered Workspace for the session.
                os.write(fd, b"y\r")
                trusted = True
            if VIEW_RE.search(text):
                time.sleep(0.5)
                break
    finally:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            os.waitpid(pid, 0)
        except ChildProcessError:
            pass
        os.close(fd)
    return clean_terminal(bytes(output))


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "parse":
        text = clean_terminal(sys.stdin.buffer.read())
        print(json.dumps({"created": parse_created(text), "error": failure_detail(text)}, ensure_ascii=False))
        return
    if len(sys.argv) != 5 or sys.argv[4] not in ("bundle", "auto"):
        raise SystemExit("usage: claude-cloud.py CLAUDE_BINARY REPOSITORY TASK bundle|auto | parse")
    binary, directory, task, upload = os.path.abspath(sys.argv[1]), sys.argv[2], sys.argv[3], sys.argv[4]
    top = git(directory, "rev-parse", "--show-toplevel")
    if not top:
        print(json.dumps({"ok": False, "code": "NOT_A_REPOSITORY", "error": f"{directory} is not a git repository."}))
        return
    home = os.path.realpath(os.path.expanduser("~"))
    if (home + os.sep).startswith(os.path.realpath(top) + os.sep):
        print(json.dumps({"ok": False, "code": "REPOSITORY_CONTAINS_HOME", "error": f"{top} contains the Claude home {home}; the CLI refuses to upload it. Use a separate clone."}))
        return
    ensure_private_seed_directory(os.path.join(home, ".claude"))
    text = create(binary, top, task, upload == "bundle")
    created = parse_created(text)
    if not created:
        print(json.dumps({"ok": False, "code": "CLOUD_SESSION_NOT_CREATED", "error": failure_detail(text) or "The CLI did not report a cloud session."}, ensure_ascii=False))
        return
    print(json.dumps({
        "ok": True,
        **created,
        "repository": top,
        "remote": git(top, "remote", "get-url", "origin"),
        "branch": git(top, "rev-parse", "--abbrev-ref", "HEAD"),
        "head": git(top, "rev-parse", "HEAD"),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
