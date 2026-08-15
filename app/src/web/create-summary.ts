// The create panel states its configuration as one sentence whose values are
// themselves the controls. Templates live in the locale files so each language
// keeps its own word order; Korean additionally needs the particle after a
// value to agree with that value's final consonant, so templates mark those
// positions with [이가] style tokens instead of writing a fixed particle.

export type SaySlot = { kind: "slot"; name: string; value: string };
export type SayPart = { kind: "text"; value: string } | SaySlot;

const PARTICLES: Record<string, [string, string]> = {
  "이가": ["이", "가"],
  "은는": ["은", "는"],
  "을를": ["을", "를"],
  // Listed consonant-form first, like the others: 과 follows a final consonant.
  "와과": ["과", "와"],
  "으로": ["으로", "로"]
};

// A final consonant (jongseong) selects the first form. Hangul syllables are a
// contiguous block; anything else (latin, digits, punctuation) falls back to
// the vowel form, which reads correctly for model ids like "gpt-5.4".
export function endsWithConsonant(value: string) {
  const text = value.trim();
  const code = text.codePointAt(text.length - 1);
  if (code === undefined) return false;
  if (code < 0xac00 || code > 0xd7a3) return false;
  const jong = (code - 0xac00) % 28;
  // 로/으로 treats ㄹ as if it had no final consonant.
  return jong !== 0;
}

export function particle(value: string, marker: string) {
  const forms = PARTICLES[marker];
  if (!forms) return marker;
  const text = value.trim();
  const code = text.codePointAt(text.length - 1) ?? 0;
  const jong = code >= 0xac00 && code <= 0xd7a3 ? (code - 0xac00) % 28 : 0;
  if (marker === "으로") return jong === 0 || jong === 8 ? forms[1] : forms[0];
  return endsWithConsonant(text) ? forms[0] : forms[1];
}

// Splits "{provider}[이가] {workspace}에서" into rendered text and slots. A slot
// with no value is dropped together with the particle that follows it, so a
// template can carry an optional participant list without leaving debris.
export function buildSay(template: string, values: Record<string, string>): SayPart[] {
  const parts: SayPart[] = [];
  const pattern = /\{([a-zA-Z]+)\}|\[([가-힣]+)\]/g;
  let cursor = 0, last = "";
  let match: RegExpExecArray | null;
  const pushText = (value: string) => {
    if (!value) return;
    const previous = parts.at(-1);
    if (previous?.kind === "text") previous.value += value;
    else parts.push({ kind: "text", value });
  };
  while ((match = pattern.exec(template))) {
    pushText(template.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    if (match[1] !== undefined) {
      const value = (values[match[1]] ?? "").trim();
      if (!value) { last = ""; continue; }
      last = value;
      parts.push({ kind: "slot", name: match[1], value });
      continue;
    }
    const marker = match[2]!;
    if (!last) continue;
    pushText(particle(last, marker));
  }
  pushText(template.slice(cursor));
  // Collapse the whitespace an omitted slot leaves behind.
  for (const part of parts) if (part.kind === "text") part.value = part.value.replace(/\s{2,}/g, " ");
  const first = parts[0];
  if (first?.kind === "text") first.value = first.value.replace(/^\s+/, "");
  const tail = parts.at(-1);
  if (tail?.kind === "text") tail.value = tail.value.replace(/\s+$/, "");
  return parts.filter((part) => part.kind !== "text" || part.value !== "");
}
