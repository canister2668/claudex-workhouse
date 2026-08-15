#!/usr/bin/env python3
"""Read subscription usage through Grok CLI's official /usage screen."""

import fcntl
import json
import os
import pty
import re
import select
import signal
import struct
import sys
import termios
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote


SESSION_ID_RE = re.compile(
    r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
)


class TerminalScreen:
    """Small VT screen model for the cursor-addressed Grok/Ratatui output."""

    def __init__(self, width=100, height=40):
        self.width, self.height = width, height
        self.rows = [[" "] * width for _ in range(height)]
        self.row = self.col = 0
        self.saved = (0, 0)

    def _clamp(self):
        self.row = max(0, min(self.height - 1, self.row))
        self.col = max(0, min(self.width - 1, self.col))

    def _csi(self, params, command):
        values = [int(value) if value.isdigit() else 0 for value in params.lstrip("?").split(";")]
        first = values[0] if values and values[0] else 1
        if command in "Hf":
            self.row = (values[0] if values and values[0] else 1) - 1
            self.col = (values[1] if len(values) > 1 and values[1] else 1) - 1
        elif command == "A": self.row -= first
        elif command == "B": self.row += first
        elif command == "C": self.col += first
        elif command == "D": self.col -= first
        elif command == "G": self.col = first - 1
        elif command == "d": self.row = first - 1
        elif command == "J":
            mode = values[0] if values else 0
            if mode in (2, 3):
                self.rows = [[" "] * self.width for _ in range(self.height)]
                self.row = self.col = 0
            elif mode == 0:
                self.rows[self.row][self.col:] = [" "] * (self.width - self.col)
                for row in range(self.row + 1, self.height): self.rows[row] = [" "] * self.width
            elif mode == 1:
                for row in range(self.row): self.rows[row] = [" "] * self.width
                self.rows[self.row][:self.col + 1] = [" "] * (self.col + 1)
        elif command == "K":
            mode = values[0] if values else 0
            start, end = (0, self.width) if mode == 2 else ((0, self.col + 1) if mode == 1 else (self.col, self.width))
            self.rows[self.row][start:end] = [" "] * (end - start)
        elif command == "S":
            count = min(first, self.height)
            self.rows = self.rows[count:] + [[" "] * self.width for _ in range(count)]
        elif command == "T":
            count = min(first, self.height)
            self.rows = [[" "] * self.width for _ in range(count)] + self.rows[:-count]
        elif command == "s": self.saved = (self.row, self.col)
        elif command == "u": self.row, self.col = self.saved
        self._clamp()

    def feed(self, value: bytes):
        text = value.decode("utf-8", "replace")
        index = 0
        while index < len(text):
            char = text[index]
            if char == "\x1b":
                if index + 1 < len(text) and text[index + 1] == "[":
                    match = re.match(r"\x1b\[([0-?]*)([ -/]*)([@-~])", text[index:])
                    if match:
                        self._csi(match.group(1), match.group(3)); index += len(match.group(0)); continue
                if index + 1 < len(text) and text[index + 1] == "]":
                    end_bel, end_st = text.find("\x07", index + 2), text.find("\x1b\\", index + 2)
                    ends = [end for end in (end_bel, end_st) if end >= 0]
                    if ends:
                        end = min(ends); index = end + (2 if text.startswith("\x1b\\", end) else 1); continue
                index += 2; continue
            if char == "\r": self.col = 0
            elif char == "\n": self.row = min(self.height - 1, self.row + 1)
            elif char == "\b": self.col = max(0, self.col - 1)
            elif char >= " " and char != "\x7f":
                width = 0 if unicodedata.combining(char) else (2 if unicodedata.east_asian_width(char) in "WF" else 1)
                if width:
                    self.rows[self.row][self.col] = char
                    if width == 2 and self.col + 1 < self.width: self.rows[self.row][self.col + 1] = " "
                    self.col = min(self.width - 1, self.col + width)
            index += 1

    def text(self):
        return "\n".join("".join(row).rstrip() for row in self.rows).rstrip()


def render_terminal(value: bytes) -> str:
    screen = TerminalScreen()
    screen.feed(value)
    return screen.text()


def session_root(cwd: str) -> Path:
    grok_home = Path(os.environ.get("GROK_HOME", Path.home() / ".grok"))
    return grok_home / "sessions" / quote(cwd, safe="")


def reusable_session(cwd: str):
    pointer = Path(cwd) / ".grok-usage-session"
    root = session_root(cwd)
    try:
        candidate = pointer.read_text().strip()
    except OSError:
        candidate = ""
    if SESSION_ID_RE.fullmatch(candidate) and (root / candidate).is_dir():
        return candidate
    try:
        sessions = [entry for entry in root.iterdir() if entry.is_dir() and SESSION_ID_RE.fullmatch(entry.name)]
    except OSError:
        sessions = []
    if not sessions:
        return None
    candidate = max(sessions, key=lambda entry: entry.stat().st_mtime).name
    pointer.write_text(candidate + "\n")
    os.chmod(pointer, 0o600)
    return candidate


def bounded_percent(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not (number == number and abs(number) != float("inf")):
        return None
    return max(0, min(100, number))


def named_number(text: str, names):
    for name in names:
        match = re.search(
            rf'["\']?{name}["\']?\s*(?::|=)\s*["\']?(-?\d+(?:\.\d+)?)',
            text,
            re.IGNORECASE,
        )
        if match:
            return float(match.group(1))
    return None


def named_string(text: str, names):
    for name in names:
        match = re.search(
            rf'["\']?{name}["\']?\s*(?::|=)\s*["\']([^"\'\r\n]+)["\']',
            text,
            re.IGNORECASE,
        )
        if match:
            return match.group(1).strip()
    return None


def reset_values(text: str):
    raw = named_string(text, ["billingPeriodEnd", "billing_period_end"])
    if raw is None:
        numeric = named_number(text, ["billingPeriodEnd", "billing_period_end"])
        if numeric is not None:
            # Accept seconds or milliseconds without guessing from locale text.
            seconds = numeric / 1000 if numeric >= 10_000_000_000 else numeric
            try:
                raw = datetime.fromtimestamp(seconds, timezone.utc).isoformat().replace("+00:00", "Z")
            except (OverflowError, OSError, ValueError):
                raw = None

    label_match = re.search(r"(?:Next\s+reset|Resets?)\s*:\s*([^\r\n]+)", text, re.IGNORECASE)
    label = label_match.group(1).strip() if label_match else None
    if raw and re.fullmatch(r"\d{4}-\d{2}-\d{2}T[^\s]+", raw):
        return raw, label
    return None, label or raw


def parse_usage(text: str):
    utilization = named_number(text, ["creditUsagePercent", "credit_usage_percent"])
    if utilization is None:
        match = re.search(
            r"(?:Credits|Weekly\s+limit)[^\r\n%]{0,48}?(\d{1,3}(?:\.\d+)?)\s*%\s*(?:used)?",
            text,
            re.IGNORECASE,
        )
        utilization = float(match.group(1)) if match else None
    utilization = bounded_percent(utilization)

    prepaid_balance = named_number(text, ["prepaidBalance", "prepaid_balance"])
    if prepaid_balance is None:
        match = re.search(
            r"(?:Credits\s+left|Pay-as-you-go\s+limit\s+left)\s*:\s*\$\s*(\d+(?:\.\d+)?)",
            text,
            re.IGNORECASE,
        )
        prepaid_balance = float(match.group(1)) if match else None
    if prepaid_balance is not None:
        prepaid_balance = max(0, prepaid_balance)

    plan = named_string(text, ["subscription_tier", "subscriptionTier"])
    if plan is None:
        match = re.search(r"\bTier\s*:\s*([A-Za-z][A-Za-z0-9 _-]{0,31})", text)
        plan = match.group(1).strip() if match else None
    if plan is not None and not re.fullmatch(r"[A-Za-z0-9 _-]{1,32}", plan):
        plan = None

    resets_at, reset_label = reset_values(text)
    auth_required = bool(
        re.search(
            r"(?:Authentication|grok\.com auth)\s+required|not authenticated|Run `?grok login`?|"
            r"Approve[\s\S]{0,160}?browser[\s\S]{0,160}?signing[\s\S]{0,40}?in|"
            r"Waiting[\s\S]{0,80}?approval",
            text,
            re.IGNORECASE,
        )
    )
    ok = utilization is not None or prepaid_balance is not None
    result = {
        "ok": ok,
        "source": "grok-cli-usage",
        "plan": plan,
        "seven_day": None
        if utilization is None
        else {
            "utilization": utilization,
            "resets_at": resets_at,
            "reset_label": reset_label,
        },
        "prepaid_balance": prepaid_balance,
    }
    if not ok:
        result["error"] = "authentication_required" if auth_required else "unavailable"
    return result


def probe(binary: str, cwd: str):
    session_id = reusable_session(cwd)
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(cwd)
        env = dict(os.environ)
        env.update(
            {
                "GROK_DISABLE_AUTOUPDATER": "1",
                "NO_COLOR": "1",
                "TERM": "xterm-256color",
                "COLUMNS": "100",
                "LINES": "40",
            }
        )
        os.execvpe(
            binary,
            [
                binary,
                *(["--resume", session_id] if session_id else []),
                "--no-alt-screen",
                "--no-auto-update",
                "--no-memory",
                "--no-subagents",
                "--disable-web-search",
                "--permission-mode",
                "plan",
                "--cwd",
                cwd,
            ],
            env,
        )

    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 100, 0, 0))

    output = bytearray()
    started = time.monotonic()
    trusted = False
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
                # Ratatui asks the terminal for its cursor position before the
                # first frame. A raw PTY has no terminal emulator to answer, so
                # acknowledge the query or the CLI stays frozen before /usage.
                if b"\x1b[6n" in chunk:
                    time.sleep(0.1)
                    os.write(fd, b"\x1b[1;1R")
                if len(output) > 262144:
                    del output[:-262144]

            text = render_terminal(bytes(output))
            if not trusted and "Do you trust the contents of this directory?" in text:
                # The caller supplies a private, empty probe directory. No project
                # instructions or hooks are needed for the billing-only command.
                os.write(fd, b"y\r")
                trusted = True
                started = time.monotonic()
                continue

            ready = "❯" in text and not re.search(r"Loading session|Starting session", text, re.IGNORECASE)
            # A fresh Grok profile has no resumable session. Let the CLI create
            # exactly one, then the next refresh will discover and resume it;
            # sending /usage on the welcome screen would submit it as a prompt.
            if not session_id and reusable_session(cwd):
                break
            if session_id and not usage_sent and ready:
                os.write(fd, b"/usage\r")
                usage_sent = True

            if usage_sent:
                candidate = parse_usage(text)
                if candidate["ok"] or candidate.get("error") == "authentication_required":
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

    rendered = render_terminal(bytes(output))
    if os.environ.get("GROK_USAGE_DEBUG") == "1":
        print(rendered, file=sys.stderr)
    return result or parse_usage(rendered)


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "parse":
        print(json.dumps(parse_usage(sys.stdin.read()), ensure_ascii=False))
        return
    if len(sys.argv) != 3:
        raise SystemExit("usage: grok-usage.py GROK_BINARY PROBE_DIRECTORY | parse")
    os.makedirs(sys.argv[2], mode=0o700, exist_ok=True)
    lock_path = os.path.join(sys.argv[2], ".grok-usage.lock")
    with open(lock_path, "a", encoding="utf-8") as lock:
        os.chmod(lock_path, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        print(
            json.dumps(
                probe(os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])),
                ensure_ascii=False,
            )
        )


if __name__ == "__main__":
    main()
