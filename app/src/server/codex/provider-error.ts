import { sanitizeSensitiveText } from "../sensitive-data.js";

export type CodexProviderError = {
  codexErrorCode?: string;
  upstreamHttpStatus?: number;
  additionalDetails?: string;
};

// Keep the protocol's diagnostic fields, not an arbitrary provider payload.
// A server-overloaded response alone does not establish why it was overloaded.
export function codexProviderError(value: unknown): CodexProviderError {
  if (!value || typeof value !== "object") return {};
  const error = value as Record<string, unknown>;
  const info = error.codexErrorInfo ?? error.codex_error_info;
  let code: unknown = info;
  let status: unknown;
  if (info && typeof info === "object" && !Array.isArray(info)) {
    const entries = Object.entries(info);
    if (entries.length === 1) {
      const [variant, details] = entries[0];
      code = variant;
      if (details && typeof details === "object") status = (details as Record<string, unknown>).httpStatusCode;
    }
  }
  const diagnostic: CodexProviderError = {};
  if (typeof code === "string" && /^[a-zA-Z][a-zA-Z0-9_]{0,79}$/.test(code)) diagnostic.codexErrorCode = code;
  if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) diagnostic.upstreamHttpStatus = status;
  if (typeof error.additionalDetails === "string" && error.additionalDetails.trim()) diagnostic.additionalDetails = sanitizeSensitiveText(error.additionalDetails).slice(0,2000);
  return diagnostic;
}

export function codexTurnError(value: unknown, fallback = "Codex turn failed.") {
  const error = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.assign(new Error(typeof error.message === "string" ? sanitizeSensitiveText(error.message) : fallback), { providerError: codexProviderError(value) });
}
