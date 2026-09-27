#!/usr/bin/env python3
"""Read the authenticated Claude Code model picker without sending a prompt."""

import json
import mmap
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
# Claude Code 2.1.278 renamed the screen-reader picker footer from
# "Enter selection [1-5]" to "Select with numbers [1-5]. Then Enter to submit".
# Accept both so the probe keeps working across CLI versions.
PICKER_END_RE = re.compile(r"(?:Enter selection|Select with numbers)\s*\[(\d+)-(\d+)\]")
# A CLI older than a model's minimum build still lists that model, greyed out as
# "Fable 5.1 (disabled) — Update to 2.1.255+ to use Fable 5.1". Selecting it would
# fail at launch, so it must not reach the catalog.
DISABLED_RE = re.compile(r"\(disabled\)|\bUpdate to [\d.]+\+? to use\b", re.IGNORECASE)


def clean_terminal(value: bytes) -> str:
    text = value.decode("utf-8", "replace").replace("\r", "\n")
    text = ANSI_RE.sub("", text).replace("\x0f", "")
    return re.sub(r"\n{3,}", "\n\n", text)


def model_id(family: str, version: str, wide_context: bool = False) -> str:
    # The CLI itself stores the wide-context rows with a "[1m]" suffix
    # (additionalModelOptionsCache), and --model rejects an id it cannot map.
    return f"claude-{family.lower()}-{version.replace('.', '-')}{'[1m]' if wide_context else ''}"


# The CLI bundle embeds its model registry as object literals such as
# {id:"claude-opus-5-5",family:"opus",display_name:"Opus 5.5",...}. Mapping picker
# rows through it instead of guessing "<Family> <version>" wording survives both
# picker copy changes and families this script has never heard of.
REGISTRY_RE = re.compile(rb'\{id:"(claude-[a-z0-9-]{1,60})",family:"([a-z]{1,20})",display_name:"([^"\\]{1,40})"')
KNOWN_FAMILIES = ("opus", "sonnet", "haiku", "fable", "mythos")


def read_registry(binary, cache_dir=None):
    try:
        real = os.path.realpath(binary)
        stat = os.stat(real)
    except OSError:
        return []
    key = f"{real}:{stat.st_size}:{stat.st_mtime_ns}"
    cache_file = os.path.join(cache_dir, "registry.json") if cache_dir else None
    if cache_file:
        try:
            with open(cache_file, encoding="utf-8") as handle:
                cached = json.load(handle)
            if cached.get("key") == key and isinstance(cached.get("models"), list):
                return cached["models"]
        except (OSError, ValueError):
            pass
    models, seen = [], set()
    try:
        with open(real, "rb") as handle, mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ) as data:
            for match in REGISTRY_RE.finditer(data):
                model = match.group(1).decode()
                if model in seen:
                    continue
                seen.add(model)
                models.append({"id": model, "family": match.group(2).decode(), "displayName": match.group(3).decode()})
    except (OSError, ValueError):
        return []
    if cache_file and models:
        try:
            temporary = f"{cache_file}.{os.getpid()}.tmp"
            with open(temporary, "w", encoding="utf-8") as handle:
                json.dump({"key": key, "models": models}, handle)
            os.replace(temporary, cache_file)
        except OSError:
            pass
    return models


def registry_match(text: str, registry):
    # Longest names first, and never let "Opus 5" claim the text "Opus 5.5".
    for entry in sorted(registry, key=lambda item: len(item["displayName"]), reverse=True):
        if re.search(rf"(?<![\w.]){re.escape(entry['displayName'])}(?!\w|\.\d)", text, re.IGNORECASE):
            return entry
    return None


def row_model(text: str, registry):
    entry = registry_match(text, registry)
    if entry:
        return entry["id"], entry["displayName"]
    families = sorted({*KNOWN_FAMILIES, *(item["family"] for item in registry)}, key=len, reverse=True)
    match = re.search(rf"\b({'|'.join(map(re.escape, families))})\s+(\d+(?:\.\d+)*)\b", text, re.IGNORECASE)
    if not match:
        return None
    family, version = match.group(1).title(), match.group(2)
    return model_id(family, version), f"{family} {version}"


def parse_picker(text: str, registry=None):
    """Return the newest complete render and whether every row was understood."""
    registry = registry or []
    picker = text.rsplit("Select model", 1)[-1]
    # The picker first renders the CLI's cached model options and then repaints
    # the freshly fetched list, so the buffer can hold several renders. Use the
    # newest one that still parses; an older render would resurrect retired ids.
    footers = list(PICKER_END_RE.finditer(picker))
    # Only a render that already printed its footer is complete; a repaint still
    # in flight would otherwise truncate the catalog.
    starts = [0] + [footer.end() for footer in footers]
    renders = [(picker[starts[index] : footer.start()], int(footer.group(2))) for index, footer in enumerate(footers)]
    if not renders:
        renders = [(picker, None)]
    parsed = None
    for render, expected in reversed(renders):
        parsed = {**parse_render(render, registry), "expected": expected}
        if parsed["models"]:
            break
    parsed["complete"] = bool(parsed["models"]) and not parsed["unmapped"] and (
        parsed["expected"] is None or parsed["rows"] == parsed["expected"]
    )
    return parsed


def parse_models(text: str, registry=None):
    return parse_picker(text, registry)["models"]


def parse_render(picker: str, registry=None):
    registry = registry or []
    starts = list(re.finditer(r"(?m)^\s*\d+\.\s+(?:\(selected\)\s+)?", picker))
    models, unmapped = [], []
    for index, start in enumerate(starts):
        finish = starts[index + 1].start() if index + 1 < len(starts) else len(picker)
        item = re.sub(r"\s+", " ", picker[start.end() : finish]).strip()
        label, _, description = item.partition(" — ")
        if DISABLED_RE.search(item):
            continue
        if re.match(r"^default\b", label, re.IGNORECASE):
            models.append({"id": "default", "displayName": "기본값", "description": description or label})
            continue
        # The row that names the model has moved between CLI releases: up to
        # 2.1.278 it was "Opus (1M context) — Opus 5 with 1M context · ...", and
        # 2.1.282 writes "Opus 5.5 — Most capable for ambitious work". Prefer the
        # label, which describes this row, and fall back to the description.
        found = row_model(label, registry) or row_model(description, registry)
        if not found:
            # Never drop a row silently: the caller treats this render as
            # unreadable and keeps the last good catalog instead.
            unmapped.append(item[:120])
            continue
        model, name = found
        wide = bool(re.search(r"\b1M\s+context\b", item, re.IGNORECASE))
        models.append({"id": f"{model}[1m]" if wide else model, "displayName": f"{name} · 1M" if wide else name, "description": description})
    unique = []
    seen = set()
    for model in models:
        if model["id"] not in seen:
            unique.append(model)
            seen.add(model["id"])
    return {"models": unique, "unmapped": unmapped, "rows": len(starts)}


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
    registry = read_registry(binary, cwd)
    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(cwd)
        env = dict(os.environ)
        env.update({"DISABLE_AUTOUPDATER": "1", "NO_COLOR": "1", "TERM": "xterm-256color", "COLUMNS": "110", "LINES": "44"})
        # The launcher points CLAUDE_CONFIG_DIR at the default ~/.claude path.
        # Claude Code then reads onboarding state from that directory instead of
        # ~/.claude.json and opens first-run setup, which this probe can never
        # answer. bin/claude-usage.py drops the variable for the same reason.
        env.pop("CLAUDE_CONFIG_DIR", None)
        os.execvpe(binary, [binary, "--ax-screen-reader", "--safe-mode", "--no-chrome", "--permission-mode", "plan"], env)

    output = bytearray()
    started = time.monotonic()
    trusted = False
    external_imports_answered = False
    picker_sent = False
    result = None
    incomplete = None
    footer_seen_at = None
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
            if not trusted and "Quick safety check" in text and (
                "Enter y/n" in text or "Enter to confirm" in text
            ):
                # Claudex Workhouse owns this empty probe directory, and safe mode
                # keeps repository hooks and settings out of the probe.
                os.write(fd, b"y\r")
                trusted = True
                started = time.monotonic()
                continue

            if (
                not external_imports_answered
                and "Allow external CLAUDE.md file imports?" in text
                and ("Enter y/n" in text or "Enter to confirm" in text)
            ):
                # Reading the model picker never needs repository instructions.
                os.write(fd, b"n\r")
                external_imports_answered = True
                started = time.monotonic()
                continue
            if not picker_sent and time.monotonic() - started > 1.25 and ("plan mode on" in text or "manual mode on" in text):
                os.write(fd, b"/model\r")
                picker_sent = True
            if picker_sent and "Select model" in text and PICKER_END_RE.search(text.rsplit("Select model", 1)[-1]):
                parsed = parse_picker(text, registry)
                footer_seen_at = footer_seen_at or time.monotonic()
                # A render with a row we cannot map is reported as a failure, never
                # as a shorter catalog. Give an in-flight repaint a moment first.
                if parsed["complete"] or time.monotonic() - footer_seen_at > 3:
                    if parsed["complete"]:
                        result = {"ok": True, "source": "claude-cli-model-picker", "models": parsed["models"], "registrySize": len(registry)}
                    else:
                        incomplete = parsed
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
    if result:
        return result
    if incomplete:
        return {"ok": False, "source": "claude-cli-model-picker", "error": "picker-parse-incomplete", "expectedRows": incomplete["expected"], "rows": incomplete["rows"], "unmapped": incomplete["unmapped"], "models": incomplete["models"]}
    return {"ok": False, "source": "claude-cli-model-picker", "error": "unavailable", "models": []}


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "parse":
        # Optional second argument: a Claude binary (or any file) to read the model
        # registry from, so fixtures can exercise registry mapping.
        registry = read_registry(sys.argv[2]) if len(sys.argv) >= 3 else []
        parsed = parse_picker(sys.stdin.read(), registry)
        print(json.dumps({"ok": parsed["complete"], **parsed}, ensure_ascii=False))
        return
    if len(sys.argv) != 3:
        raise SystemExit("usage: claude-models.py CLAUDE_BINARY PROBE_DIRECTORY | parse [CLAUDE_BINARY]")
    os.makedirs(sys.argv[2], mode=0o700, exist_ok=True)
    print(json.dumps(probe(os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])), ensure_ascii=False))


if __name__ == "__main__":
    main()
