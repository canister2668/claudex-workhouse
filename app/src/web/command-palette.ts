// Command palette (⌘K / Ctrl+K): a flat list of commands with a group, a
// label, optional keywords, and the action. Matching is a case-insensitive
// substring check over label and keywords, with every query word required.
export type PaletteCommand = {
  id: string;
  group: string;
  label: string;
  hint?: string;
  keywords?: string[];
  run: () => void;
};

export function normalizePaletteQuery(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function paletteCommandMatches(command: PaletteCommand, query: string): boolean {
  const words = normalizePaletteQuery(query);
  if (!words.length) return true;
  const haystack = [command.label, command.hint ?? "", ...(command.keywords ?? [])].join("\n").toLowerCase();
  return words.every(word => haystack.includes(word));
}

export function filterPaletteCommands(commands: PaletteCommand[], query: string, limit = 40): PaletteCommand[] {
  const words = normalizePaletteQuery(query);
  const matches = commands.filter(command => paletteCommandMatches(command, query));
  if (!words.length) return matches.slice(0, limit);
  // A label that starts with the query outranks a keyword hit further down.
  const rank = (command: PaletteCommand) => {
    const label = command.label.toLowerCase();
    if (label.startsWith(words[0])) return 0;
    if (label.includes(words[0])) return 1;
    return 2;
  };
  return matches.sort((left, right) => rank(left) - rank(right)).slice(0, limit);
}

export function isPaletteShortcut(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k";
}
