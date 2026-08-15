import { describe, expect, it } from "vitest";
import { normalizeTimestamp, timestampAge } from "../../src/web/task-time";

describe("task time",()=>{
  const now=1_785_418_000_000;

  it("normalizes Unix seconds and milliseconds to milliseconds",()=>{
    expect(normalizeTimestamp(1_785_417_976,now)).toBe(1_785_417_976_000);
    expect(normalizeTimestamp(1_785_417_976_000,now)).toBe(1_785_417_976_000);
    expect(normalizeTimestamp("1785417976",now)).toBe(1_785_417_976_000);
  });

  it("clamps small clock skew and rejects invalid dates",()=>{
    expect(normalizeTimestamp(now+1_000,now)).toBe(now);
    expect(normalizeTimestamp(now+600_000,now)).toBeUndefined();
    expect(normalizeTimestamp(1,now)).toBeUndefined();
    expect(normalizeTimestamp("not-a-date",now)).toBeUndefined();
  });

  it("calculates a non-negative age",()=>{
    expect(timestampAge(1_785_417_976,now)).toBe(24_000);
    expect(timestampAge(now+1_000,now)).toBe(0);
  });
});
