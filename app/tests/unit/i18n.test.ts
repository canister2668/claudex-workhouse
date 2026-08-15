import { describe, expect, it } from "vitest";
import { dictionaryKeyCount, translateFor, validateDictionaries } from "../../src/web/i18n/index.js";
import { detectBrowserLocale, mapBrowserLocale } from "../../src/web/i18n/locale-store.js";
import { formatCardDateTime, formatDateTime, formatFileSize, formatNumber, formatQuotaPercentage } from "../../src/web/i18n/formatters.js";
import { en } from "../../src/web/i18n/en.js";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { parse } from "svelte/compiler";

describe("i18n", () => {
  it("maps supported browser language tags and falls back to English", () => {
    expect(mapBrowserLocale("ko-KR")).toBe("ko");
    expect(mapBrowserLocale("ja-JP")).toBe("ja");
    expect(mapBrowserLocale("en-GB")).toBe("en");
    expect(mapBrowserLocale("zh-CN")).toBe("en");
    expect(detectBrowserLocale(["fr-FR", "ja-JP"], "en-US")).toBe("ja");
  });

  it("keeps all dictionary structures and interpolation variables aligned", () => {
    expect(dictionaryKeyCount()).toBeGreaterThan(100);
    expect(validateDictionaries()).toEqual([]);
  });

  it("localizes every numbered worker emotion line and status",()=>{
    const emotions=["thinking","thinking_2","thinking_3","coding","coding_2","coding_3","building","building_2","building_3","reading","reading_2","reading_3","searching","searching_2","searching_3"];
    for(const emotion of emotions){
      for(const language of ["ko","en","ja"] as const){
        const lineKey=`avatar.line.${emotion}`,statusKey=`avatar.status.${emotion}`;
        expect(translateFor(language,lineKey),`${language}:${lineKey}`).not.toBe(lineKey);
        expect(translateFor(language,statusKey),`${language}:${statusKey}`).not.toBe(statusKey);
      }
    }
    expect(translateFor("en","avatar.line.coding_2")).toBe("Writing away…!");
    expect(translateFor("ja","avatar.line.coding_3")).toBe("修正内容を再確認中です");
  });

  it("interpolates and safely falls back", () => {
    expect(translateFor("ja", "conversation.addRounds", { count:5 })).toBe("5ターン追加");
    expect(translateFor("ko", "language.label")).toBe("Language");
    expect(translateFor("ja", "language.label")).toBe("Language");
    expect(translateFor("en", "assist.sessionTitle", { title:"Audit" })).toBe("Audit · Auxiliary review");
    expect(translateFor("ko", "not.a.real.key")).toContain("not.a.real.key");
  });

  it("localizes dates, numbers and file sizes", () => {
    const timestamp = "2026-07-17T12:30:00.000Z";
    expect(formatDateTime(timestamp, "ko")).not.toBe(formatDateTime(timestamp, "en"));
    expect(formatCardDateTime(timestamp, "ko")).not.toMatch(/\b2026\b|\b26\b/);
    expect(formatCardDateTime(timestamp, "ko")).toMatch(/7.+17.+\d{2}:\d{2}/);
    expect(formatNumber(1234567.8, "en")).toContain("1,234,567");
    expect(formatQuotaPercentage(0.20000000000000004,"en")).toBe("0.2");
    expect(formatQuotaPercentage(42,"ko")).toBe("42");
    expect(formatFileSize(1536, "ja")).toContain("1.5 KB");
  });

  it("keeps literal central translation calls backed by the schema", () => {
    const root = join(process.cwd(), "src/web");
    const files: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes:true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if ([".ts", ".svelte"].includes(extname(path))) files.push(path);
      }
    };
    visit(root);
    const missing: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/(?:\$t|\$i18n|translate)\(\s*["']([^"']+)["']/g)) {
        if (!Object.hasOwn(en, match[1])) missing.push(`${file.slice(root.length + 1)}:${match[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("covers every dynamic status and execution-backend translation family", () => {
    const serverTypes = readFileSync(join(process.cwd(), "src/server/types.ts"), "utf8");
    const executionPolicy = readFileSync(join(process.cwd(), "src/server/execution-policy.ts"), "utf8");
    const members = (source: string, typeName: string) => {
      const declaration = source.match(new RegExp(`export\\s+type\\s+${typeName}\\s*=([\\s\\S]*?);`))?.[1] ?? "";
      return [...declaration.matchAll(/"([^"]+)"/g)].map(match => match[1]);
    };
    const unified = members(serverTypes, "UnifiedStatus");
    const host = members(serverTypes, "ExecutionHostStatus");
    const collaboration = members(serverTypes, "CollaborationStatus");
    const runs = members(serverTypes, "CollaborationRunStatus");
    const backends = members(executionPolicy, "ExecutionBackend");
    expect([unified, host, collaboration, runs, backends].every(values => values.length > 0)).toBe(true);
    const expected = [
      ...backends.map(value => `execution.${value}`),
      ...host.map(value => `status.${value}`),
      ...[...new Set([...collaboration, ...runs])].flatMap(value => [
        `collaboration.${value}`,
        `task.status.${value}`
      ]),
      ...unified.map(value => `task.status.${value}`)
    ];
    expect(expected.filter(key => !Object.hasOwn(en, key))).toEqual([]);
  });

  it("does not expose untranslated prose in Svelte markup", () => {
    const root = join(process.cwd(), "src/web");
    const files: string[] = [];
    const visit = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes:true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) visit(path);
        else if (extname(path) === ".svelte") files.push(path);
      }
    };
    visit(root);
    const allowedTechnicalText = new Set([
      "Claudex Workhouse", "cx", "CLI", "VS Code", "app-server", "SHA", "Codex", "Claude",
      "Codex → Claude", "Claude → Codex", "Gpt-Codex", "Gpt-Sol", "Git", "GitHub",
      "claude-opus-4-6[1m]", "Opus 4.6 (1M)", "https://github.com/owner/repository.git",
      "https://github.com/owner/repo.git", "origin", "Cloudflare Tunnel"
    ]);
    const untranslated: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const ast = parse(source) as any;
      const seen = new Set<object>();
      const walk = (node: any, parent: any = null) => {
        if (!node || typeof node !== "object" || seen.has(node)) return;
        seen.add(node);
        if (node.type === "Text") {
          const text = String(node.data ?? node.raw ?? "").replace(/\s+/g, " ").trim();
          const translatedAttribute = parent?.type === "Attribute"
            && ["aria-label", "title", "placeholder", "alt"].includes(parent.name);
          const visibleText = parent?.type !== "Attribute" || translatedAttribute;
          if (visibleText && /[A-Za-z가-힣ぁ-んァ-ン一-龯]/.test(text) && !allowedTechnicalText.has(text)) {
            const line = source.slice(0, node.start).split("\n").length;
            untranslated.push(`${file.slice(root.length + 1)}:${line}:${text}`);
          }
        }
        for (const [key, value] of Object.entries(node)) {
          if (["loc", "start", "end"].includes(key)) continue;
          if (Array.isArray(value)) value.forEach(child => walk(child, node));
          else walk(value, node);
        }
      };
      walk(ast.html);
    }
    expect(untranslated).toEqual([]);
  }, 15_000);
});
