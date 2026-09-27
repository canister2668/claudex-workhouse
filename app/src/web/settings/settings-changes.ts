// The save bar shows how many settings differ from the last saved state. The
// baselines are JSON signatures of the editable state; counting changed keys
// (one level into plain objects) gives a number that matches what the person
// actually touched instead of a bare "dirty" flag.
function parse(value: string | undefined): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function countSignatureChanges(baseline: string | undefined, current: string | undefined): number {
  if (baseline === current) return 0;
  const before = parse(baseline), after = parse(current);
  if (!before || !after) return baseline === undefined || current === undefined ? 0 : 1;
  let count = 0;
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const left = before[key], right = after[key];
    if (JSON.stringify(left) === JSON.stringify(right)) continue;
    if (isPlainObject(left) && isPlainObject(right)) {
      const nested = new Set([...Object.keys(left), ...Object.keys(right)]).size ? [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(inner => JSON.stringify(left[inner]) !== JSON.stringify(right[inner])).length : 1;
      count += Math.max(1, nested);
    } else count += 1;
  }
  return count;
}

export function countSettingChanges(baseline: Record<string, string>, current: Record<string, string>): number {
  let total = 0;
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(current)])) total += countSignatureChanges(baseline[key], current[key]);
  return total;
}
