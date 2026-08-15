import { spawn } from "node:child_process";

export interface CommandResult {
  exitCode: number;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  overflow: boolean;
}

export async function runCommand(command: string, args: string[], options: { cwd: string; timeoutMs: number; outputLimit: number; env?: NodeJS.ProcessEnv; input?: string | Buffer }): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, shell: false, windowsHide:true, env: options.env ?? process.env, stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    let stdout = Buffer.alloc(0);
    let stderr = Buffer.alloc(0);
    let overflow = false;
    let timedOut = false;
    const append = (current: Buffer, chunk: Buffer) => {
      const next = Buffer.concat([current, chunk]);
      if (next.length <= options.outputLimit) return next;
      overflow = true;
      return next.subarray(0, options.outputLimit);
    };
    child.stdout?.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
    if (child.stdin) {
      child.stdin.on("error", () => {});
      child.stdin.end(options.input);
    }
    child.once("error", reject);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 1500).unref();
    }, options.timeoutMs);
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, signal, stdout: stdout.toString("utf8"), stderr: stderr.toString("utf8"), timedOut, overflow });
    });
  });
}

export function stripAnsi(value: string): string {
  return value.replace(/[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g, "");
}
