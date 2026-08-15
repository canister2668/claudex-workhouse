#!/usr/bin/env python3
"""Read the authenticated Claude Code model picker without sending a prompt."""

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


def clean_terminal(value: bytes) -> str:
    text = value.decode("utf-8", "replace").replace("\r", "\n")
    text = ANSI_RE.sub("", text).replace("\x0f", "")
    return re.sub(r"\n{3,}", "\n\n", text)


def model_id(family: str, version: str) -> str:
    return f"claude-{family.lower()}-{version.replace('.', '-')}"


def parse_models(text: str):
    picker = text.rsplit("Select model", 1)[-1]
    picker = picker.split("Enter selection", 1)[0]
    starts = list(re.finditer(r"(?m)^\s*\d+\.\s+(?:\(selected\)\s+)?", picker))
    models = []
    for index, start in enumerate(starts):
        finish = starts[index + 1].start() if index + 1 < len(starts) else len(picker)
        item = re.sub(r"\s+", " ", picker[start.end() : finish]).strip()
        label, _, description = item.partition(" — ")
        if re.match(r"^default\b", label, re.IGNORECASE):
            models.append({"id": "default", "displayName": "기본값", "description": description or label})
            continue
        match = re.search(r"\b(Opus|Sonnet|Haiku|Fable)\s+(\d+(?:\.\d+)*)\b", description or label, re.IGNORECASE)
        if not match:
            continue
        family, version = match.group(1).title(), match.group(2)
        context = " · 1M" if re.search(r"\b1M\s+context\b", description, re.IGNORECASE) else ""
        models.append({"id": model_id(family, version), "displayName": f"{family} {version}{context}", "description": description})
    unique = []
    seen = set()
    for model in models:
        if model["id"] not in seen:
            unique.append(model)
            seen.add(model["id"])
    return unique


def terminate_child(pid: int, grace_seconds: float = 1.0):
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    deadline = time.monotonic() + grace_seconds
    while time.monotonic() < deadline:
        try:
            child, _ = os.waitpid(pid, os.WNOHANG)
            if child == pid:
                return
        except ChildProcessError:
            return
        time.sleep(0.05)
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass


def probe(binary: str, cwd: str):
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(cwd)
        env = dict(os.environ)
        env.update({"DISABLE_AUTOUPDATER": "1", "NO_COLOR": "1", "TERM": "xterm-256color", "COLUMNS": "110", "LINES": "44"})
        os.execvpe(binary, [binary, "--ax-screen-reader", "--safe-mode", "--no-chrome", "--permission-mode", "plan"], env)

    output = bytearray()
    started = time.monotonic()
    trusted = False
    picker_sent = False
    result = None
    previous_sigterm = signal.getsignal(signal.SIGTERM)

    def interrupted(_signum, _frame):
        raise SystemExit(143)

    signal.signal(signal.SIGTERM, interrupted)
    try:
        while time.monotonic() - started < 25:
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
            if not trusted and "Quick safety check" in text and "Enter y/n" in text:
                os.write(fd, b"y\r")
                trusted = True
                started = time.monotonic()
                continue
            if not picker_sent and time.monotonic() - started > 1.25 and ("plan mode on" in text or "manual mode on" in text):
                os.write(fd, b"/model\r")
                picker_sent = True
            if picker_sent and "Enter selection" in text:
                models = parse_models(text)
                if models:
                    result = {"ok": True, "source": "claude-cli-model-picker", "models": models}
                    os.write(fd, b"\x1b")
                    time.sleep(0.1)
                    os.write(fd, b"/exit\r")
                    break
    finally:
        terminate_child(pid)
        signal.signal(signal.SIGTERM, previous_sigterm)
        try:
            os.close(fd)
        except OSError:
            pass
    return result or {"ok": False, "source": "claude-cli-model-picker", "error": "unavailable", "models": []}


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "parse":
        print(json.dumps({"ok": True, "models": parse_models(sys.stdin.read())}, ensure_ascii=False))
        return
    if len(sys.argv) != 3:
        raise SystemExit("usage: claude-models.py CLAUDE_BINARY PROBE_DIRECTORY | parse")
    os.makedirs(sys.argv[2], mode=0o700, exist_ok=True)
    print(json.dumps(probe(os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])), ensure_ascii=False))


if __name__ == "__main__":
    main()
