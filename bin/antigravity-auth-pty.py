#!/usr/bin/env python3
"""Run the official agy OAuth flow in a PTY and emit only safe state events.

The parent sends JSON lines on stdin:
  {"type":"code","value":"..."} or {"type":"cancel"}

Raw PTY output, OAuth query parameters and submitted codes never leave this
process. The official CLI owns all durable credentials under the supplied HOME.
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

ANSI_RE = re.compile(r"\x1B(?:\][^\x07]*(?:\x07|\x1B\\)|\[[0-?]*[ -/]*[@-~]|[()][A-Z0-9]|[@-_])")
URL_RE = re.compile(r"https://[^\s\x00-\x20<>\"']{1,2048}")
CODE_PROMPT_RE = re.compile(r"(?:paste|enter|input)[^\r\n]{0,100}(?:authorization\s+)?code|(?:authorization\s+)?code[^\r\n]{0,100}(?:paste|enter|input)",re.IGNORECASE)
PROJECT_PROMPT_RE = re.compile(r"(?:enter|select|set)[^\r\n]{0,100}(?:google\s+cloud\s+)?project(?:\s+id)?|project\s+id[^\r\n]{0,100}(?:enter|input)",re.IGNORECASE)
LOCATION_PROMPT_RE = re.compile(r"(?:enter|select|set)[^\r\n]{0,100}(?:google\s+cloud\s+)?location|location[^\r\n]{0,100}(?:enter|input)",re.IGNORECASE)
MAX_OUTPUT = 262144
TIMEOUT_SECONDS = 300

def emit(event, **values):
    print(json.dumps({"event": event, **values}, ensure_ascii=False), flush=True)

def clean(value):
    text=value.decode("utf-8","replace").replace("\r","\n")
    text=ANSI_RE.sub("",text).replace("\x0f","")
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]","",text)

def parent_death_signal():
    if sys.platform.startswith("linux"):
        try: ctypes.CDLL(None).prctl(1,signal.SIGTERM)
        except Exception: pass

def terminate(pid):
    try: os.killpg(pid,signal.SIGTERM)
    except (ProcessLookupError,PermissionError):
        try: os.kill(pid,signal.SIGTERM)
        except (ProcessLookupError,PermissionError): return
    deadline=time.monotonic()+1.5
    while time.monotonic()<deadline:
        try:
            result,_=os.waitpid(pid,os.WNOHANG)
            if result==pid:return
        except ChildProcessError:return
        time.sleep(0.05)
    try: os.killpg(pid,signal.SIGKILL)
    except (ProcessLookupError,PermissionError): pass

def main():
    if len(sys.argv) not in (6,9): raise SystemExit("usage: antigravity-auth-pty.py BINARY CWD HOME ATTEMPT_ID MARKER [METHOD PROJECT LOCATION]")
    binary,cwd,home,attempt_id,marker=sys.argv[1:6]
    method,project,location=(sys.argv[6:9] if len(sys.argv)==9 else ("google-oauth","","global"))
    if method not in ("google-oauth","google-cloud") or method=="google-cloud" and (not re.fullmatch(r"[a-z][a-z0-9-]{4,61}[a-z0-9]",project) or not re.fullmatch(r"[a-z0-9-]+",location)): raise SystemExit("invalid authentication profile")
    if not os.path.isabs(binary) or not os.path.isdir(cwd) or not os.path.isabs(home): raise SystemExit("invalid runtime or directory")
    parent_death_signal()
    pid,fd=pty.fork()
    if pid==0:
        parent_death_signal();os.chdir(cwd);env=dict(os.environ)
        env.update({"HOME":home,"AGY_CLI_DISABLE_AUTO_UPDATE":"true","NO_COLOR":"1","TERM":"xterm-256color"})
        if sys.platform.startswith("win"):env["USERPROFILE"]=home
        args=[binary,"--print","Reply exactly AUTHENTICATION_OK.","--output-format","json","--mode","plan","--sandbox","--print-timeout","2m","--log-file",os.devnull]
        os.execve(binary,args,env)

    cancelled=False;child_done=False
    def request_cancel(_signum=None,_frame=None):
        nonlocal cancelled;cancelled=True
    signal.signal(signal.SIGTERM,request_cancel);signal.signal(signal.SIGINT,request_cancel)
    emit("helper/start",attemptId=attempt_id,marker=marker,uid=os.getuid(),gid=os.getgid(),home=home)
    output=bytearray();total=0;seen_urls=set();code_required=False;code_submitted=False;login_selected=False;cloud_method_selected=False;project_submitted=False;location_submitted=False;started=time.monotonic();exit_code=None;failure=None
    try:
        while not child_done:
            if cancelled:terminate(pid);emit("helper/cancelled");return
            if time.monotonic()-started>=TIMEOUT_SECONDS:terminate(pid);emit("helper/timeout");return
            readable,_,_=select.select([fd,sys.stdin.fileno()],[],[],0.2)
            if fd in readable:
                try:chunk=os.read(fd,65536)
                except OSError:chunk=b""
                if chunk:
                    total+=len(chunk)
                    if total>MAX_OUTPUT:failure="output_limit";terminate(pid);break
                    output.extend(chunk);fresh=clean(chunk);text=clean(bytes(output))
                    if method=="google-cloud" and not login_selected and "Select login method:" in text:
                        os.write(fd,b"\x1b[B\r");login_selected=True
                    if method=="google-cloud" and login_selected and not cloud_method_selected and "Google Cloud sign-in method:" in text:
                        os.write(fd,b"\r");cloud_method_selected=True
                    for candidate in URL_RE.findall(text):
                        candidate=candidate.rstrip(".,);]")
                        if candidate not in seen_urls:seen_urls.add(candidate);emit("helper/url",url=candidate)
                    if not code_required and CODE_PROMPT_RE.search(text):code_required=True;emit("helper/code-required")
                    if method=="google-cloud" and code_submitted and not project_submitted and PROJECT_PROMPT_RE.search(fresh):
                        os.write(fd,project.encode("utf-8")+b"\r");project_submitted=True
                    if method=="google-cloud" and code_submitted and project_submitted and not location_submitted and LOCATION_PROMPT_RE.search(fresh):
                        os.write(fd,location.encode("utf-8")+b"\r");location_submitted=True
                    if len(output)>65536:del output[:-65536]
                else:child_done=True
            if sys.stdin.fileno() in readable:
                line=sys.stdin.readline(4096)
                if not line:cancelled=True;continue
                try:message=json.loads(line)
                except Exception:continue
                if message.get("type")=="cancel":cancelled=True
                elif message.get("type")=="code" and not code_submitted:
                    value=message.get("value")
                    if isinstance(value,str) and 1<=len(value)<=512 and re.fullmatch(r"[A-Za-z0-9._~+/=:#-]+",value):
                        os.write(fd,value.encode("utf-8")+b"\r");code_submitted=True;value="";message.clear();emit("helper/verifying")
            try:
                result,status=os.waitpid(pid,os.WNOHANG)
                if result==pid:
                    child_done=True
                    exit_code=os.WEXITSTATUS(status) if os.WIFEXITED(status) else 128+os.WTERMSIG(status) if os.WIFSIGNALED(status) else 1
            except ChildProcessError:child_done=True;exit_code=0
    finally:
        try:os.close(fd)
        except OSError:pass
    if failure:emit("helper/failed",category=failure)
    else:emit("helper/exit",exitCode=exit_code if isinstance(exit_code,int) else 1)

if __name__=="__main__":main()
