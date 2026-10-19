import { describe, expect, it } from "vitest";
import { codexProviderError, codexTurnError } from "../../src/server/codex/provider-error.js";

describe("Codex provider error diagnostics", () => {
  it.each(["serverOverloaded","server_overloaded","contextWindowExceeded","usageLimitExceeded"])("retains the supplied code %s without inferring a different cause", code => {
    expect(codexProviderError({codexErrorInfo:code})).toEqual({codexErrorCode:code});
  });
  it("supports the persisted native error spelling", () => {
    expect(codexProviderError({codex_error_info:"server_overloaded"})).toEqual({codexErrorCode:"server_overloaded"});
  });
  it("preserves upstream HTTP status from structured protocol variants", () => {
    expect(codexProviderError({codexErrorInfo:{responseStreamDisconnected:{httpStatusCode:502}}})).toEqual({codexErrorCode:"responseStreamDisconnected",upstreamHttpStatus:502});
  });
  it("does not guess capacity or context exhaustion from message text", () => {
    expect(codexProviderError({message:"Selected model is at capacity."})).toEqual({});
  });
  it("excludes arbitrary payload fields and invalid status values", () => {
    expect(codexProviderError({codexErrorInfo:{httpConnectionFailed:{httpStatusCode:900,token:"private"}},headers:{Authorization:"private"}})).toEqual({codexErrorCode:"httpConnectionFailed"});
  });
  it("redacts and bounds additional diagnostics and the thrown message", () => {
    const value={message:"Bearer sk-testsecret12345678901234567890",additionalDetails:"Bearer sk-testsecret12345678901234567890 "+"x".repeat(3000)};
    const error=codexTurnError(value);
    expect(error.message).not.toContain("sk-testsecret12345678901234567890");
    expect(error.providerError.additionalDetails).not.toContain("sk-testsecret12345678901234567890");
    expect(error.providerError.additionalDetails!.length).toBeLessThanOrEqual(2000);
  });
});
