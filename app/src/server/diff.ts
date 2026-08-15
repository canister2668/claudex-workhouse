import path from "node:path";

export type FileEventPathBase="task-cwd"|"unresolved";

export function relativePathInfo(p:unknown,cwd?:string|null):{path:string;pathBase:FileEventPathBase}{
  try{
    if(typeof p!=="string"||!p)return{path:String(p??""),pathBase:"unresolved"};
    if(!path.isAbsolute(p))return{path:p,pathBase:"task-cwd"};
    if(cwd){const relative=path.relative(cwd,p);if(relative&&!relative.startsWith("..")&&!path.isAbsolute(relative))return{path:relative,pathBase:"task-cwd"};}
    return{path:path.basename(p),pathBase:"unresolved"};
  }catch{return{path:String(p??""),pathBase:"unresolved"};}
}

// Project-relative path so it survives the absolute-path redaction in events.ts.
export function relativePath(p: unknown, cwd?: string | null): string {
  return relativePathInfo(p,cwd).path;
}

// Compact LCS line diff -> unified "+/-/ " text plus add/del counts.
export function unifiedLineDiff(oldStr: unknown, newStr: unknown) {
  const a = String(oldStr ?? "").split("\n"), b = String(newStr ?? "").split("\n");
  const N = a.length, M = b.length;
  if (N * M > 250000) { const text = [...a.map((l) => `- ${l}`), ...b.map((l) => `+ ${l}`)].slice(0, 600).join("\n"); return { text, additions: M, deletions: N }; }
  const dp = Array.from({ length: N + 1 }, () => new Uint32Array(M + 1));
  for (let i = N - 1; i >= 0; i--) for (let j = M - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: string[] = []; let i = 0, j = 0, add = 0, del = 0;
  while (i < N && j < M) { if (a[i] === b[j]) { out.push(`  ${a[i]}`); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push(`- ${a[i]}`); del++; i++; } else { out.push(`+ ${b[j]}`); add++; j++; } }
  while (i < N) { out.push(`- ${a[i++]}`); del++; }
  while (j < M) { out.push(`+ ${b[j++]}`); add++; }
  return { text: out.slice(0, 600).join("\n"), additions: add, deletions: del };
}

// Codex app-server fileChange -> the same "+/-/ " display shape as Claude edits.
// change = { path, kind:{type:"add"|"modify"|"delete"|...}, diff:string }
// For add/delete the diff field is raw content; for modify it is a unified patch.
export function normalizeCodexChange(change: any, cwd?: string | null) {
  const resolved = relativePathInfo(change?.path,cwd),rel=resolved.path;
  const kind = String(change?.kind?.type ?? change?.kind ?? "modify");
  const raw = typeof change?.diff === "string" ? change.diff : change?.diff != null ? JSON.stringify(change.diff) : "";
  const looksUnified = /(^|\n)@@/.test(raw) || /(^|\n)[+-][^+-]/.test(raw);
  const out: string[] = []; let add = 0, del = 0;
  if (!looksUnified && kind === "add") { for (const l of raw.split("\n")) { out.push(`+ ${l}`); add++; } }
  else if (!looksUnified && (kind === "delete" || kind === "remove")) { for (const l of raw.split("\n")) { out.push(`- ${l}`); del++; } }
  else {
    for (const l of raw.split("\n")) {
      if (/^(\+\+\+|---|diff |index )/.test(l)) continue;
      if (l.startsWith("@@")) { out.push(`  ${l}`); continue; }
      if (l.startsWith("+")) { out.push(`+ ${l.slice(1)}`); add++; }
      else if (l.startsWith("-")) { out.push(`- ${l.slice(1)}`); del++; }
      else out.push(`  ${l.startsWith(" ") ? l.slice(1) : l}`);
    }
  }
  return { path: rel, pathBase:resolved.pathBase, text: out.slice(0, 600).join("\n"), additions: add, deletions: del, kind };
}
