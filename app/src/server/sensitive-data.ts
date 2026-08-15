export const REDACTED = "[REDACTED]";
export const SANITIZATION_FAILED = "[Output omitted because sensitive-data sanitization failed]";

const SENSITIVE_KEY = /^(?:authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|password|passwd|secret|client[-_]?secret|token|claim[-_]?token|pairing[-_]?code|access[-_]?token|refresh[-_]?token|id[-_]?token|session[-_]?token|api[-_]?key|apikey|private[-_]?key|credential|credentials|owner[-_]?credential|credential[-_]?hash|environment|env)$/i;

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key.trim());
}

export type SanitizeSensitiveOptions = {
  maxDepth?: number;
  maxEntries?: number;
  maxStringLength?: number;
  /**
   * Provider output can legitimately contain source such as
   * `token = process.env.TOKEN`. Keep identifiers/type declarations intact
   * while still redacting structured, quoted and high-entropy secret values.
   * Security logs and relay artifacts deliberately use the stricter default.
   */
  preserveSourceIdentifiers?: boolean;
};

function redactText(value: string, preserveSourceIdentifiers = false): string {
  const structured = value
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, REDACTED)
    .replace(/\b(Authorization\s*:\s*Bearer\s+)[^\s,;]+/gi, `$1${REDACTED}`)
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, `$1${REDACTED}`)
    .replace(/(["'])(authorization|proxy[-_]?authorization|cookie|set[-_]?cookie|password|passwd|secret|client[-_]?secret|token|access[-_]?token|refresh[-_]?token|id[-_]?token|session[-_]?token|api[-_]?key|apikey|private[-_]?key|credential|credentials)\1(\s*:\s*)(["'])([\s\S]*?)\4/gi, (_match, quote, key, separator) => `${quote}${key}${quote}${separator}"${REDACTED}"`)
    .replace(/(\b(?:ANTHROPIC_API_KEY|OPENAI_API_KEY|GITHUB_TOKEN|GH_TOKEN|WORKER_TOKEN|AUTHORIZATION|PASSWORD|PASSWD|CLIENT_SECRET|ACCESS_TOKEN|REFRESH_TOKEN|ID_TOKEN|SESSION_TOKEN|API_KEY|TOKEN|SECRET)\b\s*=\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s\r\n]+)/g, `$1${REDACTED}`)
    .replace(/(\bAuthorization\s*:\s*)(?!Bearer\b|\[REDACTED\])([^\s,;&]+)/gi, `$1${REDACTED}`);
  const assignments = preserveSourceIdentifiers
    ? structured
      .replace(/(\b(?:proxy[-_]?authorization|cookie|set[-_]?cookie|password|passwd|secret|client[-_]?secret|token|access[-_]?token|refresh[-_]?token|id[-_]?token|session[-_]?token|api[-_]?key|apikey|private[-_]?key|credential|credentials)\b\s*[:=]\s*)(["'])([^"'\r\n]*)\2/gi, (_match, prefix, quote) => `${prefix}${quote}${REDACTED}${quote}`)
      .replace(/(\b(?:proxy[-_]?authorization|cookie|set[-_]?cookie|password|passwd|secret|client[-_]?secret|token|access[-_]?token|refresh[-_]?token|id[-_]?token|session[-_]?token|api[-_]?key|apikey|private[-_]?key|credential|credentials)\b\s*[:=]\s*)(?!\[REDACTED\])([A-Za-z0-9+/=_-]{8,})/gi, (match, prefix, candidate) => /[0-9+/=]/.test(candidate) ? `${prefix}${REDACTED}` : match)
    : structured.replace(/(\b(?:proxy[-_]?authorization|cookie|set[-_]?cookie|password|passwd|secret|client[-_]?secret|token|access[-_]?token|refresh[-_]?token|id[-_]?token|session[-_]?token|api[-_]?key|apikey|private[-_]?key|credential|credentials)\b\s*[:=]\s*)(?!\[REDACTED\])([^\s,;&]+)/gi, `$1${REDACTED}`);
  return assignments
    .replace(/([?&](?:authorization|password|secret|client_secret|access_token|refresh_token|id_token|session_token|api_key|apikey|token|code|device_code|user_code|state)=)[^&#\s]*/gi, `$1${REDACTED}`)
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(/\b(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, REDACTED);
}

export function sanitizeSensitiveText(value: unknown, options:Pick<SanitizeSensitiveOptions,"preserveSourceIdentifiers"> = {}): string {
  try {
    return redactText(
      typeof value === "string" ? value : String(value ?? ""),
      options.preserveSourceIdentifiers === true
    );
  } catch {
    return SANITIZATION_FAILED;
  }
}

export function sanitizeSensitiveValue(value: unknown, options: SanitizeSensitiveOptions = {}): unknown {
  const maxDepth = options.maxDepth ?? 12;
  const maxEntries = options.maxEntries ?? 1000;
  const maxStringLength = options.maxStringLength ?? 1_000_000;
  const seen = new WeakSet<object>();
  let entries = 0;
  const visit = (item: unknown, key: string, depth: number): unknown => {
    if (isSensitiveKey(key)) return REDACTED;
    if (item === null || typeof item === "boolean" || typeof item === "number") return item;
    if (typeof item === "string") return sanitizeSensitiveText(item, options).slice(0, maxStringLength);
    if (typeof item === "bigint") return item.toString();
    if (typeof item === "undefined") return undefined;
    if (typeof item === "symbol" || typeof item === "function") return sanitizeSensitiveText(String(item), options).slice(0, maxStringLength);
    if (depth > maxDepth) return "[TRUNCATED]";
    if (!item || typeof item !== "object") return sanitizeSensitiveText(item, options).slice(0, maxStringLength);
    if (seen.has(item)) return "[Circular]";
    seen.add(item);
    try {
      if (Buffer.isBuffer(item)) return sanitizeSensitiveText(item.toString("utf8"), options).slice(0, maxStringLength);
      if (item instanceof Date) return item.toISOString();
      if (item instanceof Error) {
        const errorValue: Record<string, unknown> = {
          name: item.name,
          message: sanitizeSensitiveText(item.message).slice(0, maxStringLength)
        };
        if (item.stack) errorValue.stack = sanitizeSensitiveText(item.stack).slice(0, maxStringLength);
        for (const childKey of ["code", "statusCode", "provider", "retryable", "method", "exitCode"]) {
          const child = (item as unknown as Record<string, unknown>)[childKey];
          if (child !== undefined) errorValue[childKey] = visit(child, childKey, depth + 1);
        }
        return errorValue;
      }
      if (Array.isArray(item)) {
        const output: unknown[] = [];
        for (const child of item) {
          if (++entries > maxEntries) { output.push("[TRUNCATED]"); break; }
          output.push(visit(child, "", depth + 1));
        }
        return output;
      }
      const output: Record<string, unknown> = {};
      for (const [childKey, child] of Object.entries(item)) {
        if (++entries > maxEntries) { output.truncated = true; break; }
        output[childKey] = visit(child, childKey, depth + 1);
      }
      return output;
    } finally {
      seen.delete(item);
    }
  };
  try {
    return visit(value, "", 0);
  } catch {
    return SANITIZATION_FAILED;
  }
}

export function sanitizeSensitiveObject<T>(value: T, options?: SanitizeSensitiveOptions): T {
  return sanitizeSensitiveValue(value, options) as T;
}
