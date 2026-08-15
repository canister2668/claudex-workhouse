#!/usr/bin/env python3
"""Read plan usage through Claude Code's official /usage screen."""

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


def percentage(section: str):
    match = re.search(r"((?:\d{1,3}%\s+)+)used\b", section, re.IGNORECASE)
    if not match:
        return None
    values = [int(value) for value in re.findall(r"(\d{1,3})%", match.group(1))]
    return max(0, min(100, values[-1])) if values else None


def reset_label(section: str):
    match = re.search(
        r"Resets\s+((?:[A-Z][a-z]{2}\s+\d{1,2},\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm))\s+\(([^)]+)\)",
        section,
        re.IGNORECASE,
    )
    if not match:
        return None
    return f"{match.group(1)} ({match.group(2)})"


def section(text: str, start: str, ends):
    match = re.search(start, text, re.IGNORECASE)
    if not match:
        return ""
    finish = len(text)
    for end in ends:
        candidate = re.search(end, text[match.end() :], re.IGNORECASE)
        if candidate:
            finish = min(finish, match.end() + candidate.start())
    return text[match.end() : finish]


def parse_usage(text: str):
    current = section(text, r"Current session\b", [r"Current week\b"])
    weekly = section(
        text,
        r"Current week\s*\(all models\)",
        [r"Current week\s*\((?!all models)[^)]+\)", r"What's contributing", r"Usage credits"],
    )
    current_pct = percentage(current)
    weekly_pct = percentage(weekly)
    plan_match = re.search(r"\bClaude\s+(Free|Pro|Max|Team|Enterprise)\b", text)
    return {
        "ok": current_pct is not None or weekly_pct is not None,
        "source": "claude-cli-usage",
        "plan": plan_match.group(1) if plan_match else None,
        "five_hour": None
        if current_pct is None
        else {"utilization": current_pct, "resets_at": None, "reset_label": reset_label(current)},
        "seven_day": None
        if weekly_pct is None
        else {"utilization": weekly_pct, "resets_at": None, "reset_label": reset_label(weekly)},
    }


def probe(binary: str, cwd: str):
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(cwd)
        env = dict(os.environ)
        env.update(
            {
                "DISABLE_AUTOUPDATER": "1",
                "NO_COLOR": "1",
                "TERM": "xterm-256color",
                "COLUMNS": "100",
                "LINES": "40",
            }
        )
        # The launcher points CLAUDE_CONFIG_DIR at the default ~/.claude path.
        # Claude Code 2.1.229 then looks for onboarding state inside that
        # directory instead of the normal ~/.claude.json and opens first-run
        # setup, even though the existing subscription is authenticated.
        # Let the CLI use its default path resolution for this isolated probe.
        env.pop("CLAUDE_CONFIG_DIR", None)
        os.execvpe(
            binary,
            [
                binary,
                "--ax-screen-reader",
                "--safe-mode",
                "--no-chrome",
                "--permission-mode",
                "plan",
            ],
            env,
        )

    output = bytearray()
    started = time.monotonic()
    trusted = False
    external_imports_answered = False
    usage_sent = False
    exit_sent = False
    result = None
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
            if not trusted and "Quick safety check" in text and (
                "Enter y/n" in text or "Enter to confirm" in text
            ):
                # Claudex Workhouse owns this empty probe directory. Safe mode prevents
                # repository hooks or settings from loading during the probe.
                os.write(fd, b"y\r")
                trusted = True
                started = time.monotonic()
                continue

            if (
                not external_imports_answered
                and "Allow external CLAUDE.md file imports?" in text
                and ("Enter y/n" in text or "Enter to confirm" in text)
            ):
                # The usage probe never needs repository instructions. Refuse imports
                # outside its empty working directory instead of loading project text.
                os.write(fd, b"n\r")
                external_imports_answered = True
                started = time.monotonic()
                continue

            if not usage_sent and time.monotonic() - started > 1.5 and (
                "plan mode on" in text or "manual mode on" in text
            ):
                os.write(fd, b"/usage\r")
                usage_sent = True

            if usage_sent:
                candidate = parse_usage(text)
                if candidate["ok"]:
                    result = candidate
                    if not exit_sent:
                        os.write(fd, b"\x1b")
                        time.sleep(0.15)
                        os.write(fd, b"/exit\r")
                        exit_sent = True
                if exit_sent and time.monotonic() - started > 2:
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

    return result or {"ok": False, "source": "claude-cli-usage", "error": "unavailable"}


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "parse":
        print(json.dumps(parse_usage(sys.stdin.read()), ensure_ascii=False))
        return
    if len(sys.argv) != 3:
        raise SystemExit("usage: claude-usage.py CLAUDE_BINARY PROBE_DIRECTORY | parse")
    os.makedirs(sys.argv[2], mode=0o700, exist_ok=True)
    print(
        json.dumps(
            probe(os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])),
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
