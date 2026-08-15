import { writable } from "svelte/store";
import type { SupportedLocale } from "./i18n/types";

export type AvatarDisplay="character"|"name-mark";
export type MarkProvider="all"|"codex"|"claude"|"deepseek"|"ollama"|"antigravity"|"grok";

export const avatarDisplayMode=writable<AvatarDisplay>("character");

const MARKS:Record<SupportedLocale,Record<MarkProvider,string>>={
  ko:{all:"AI",codex:"코",claude:"클",deepseek:"딥",ollama:"올",antigravity:"젬",grok:"그"},
  en:{all:"AI",codex:"CX",claude:"CL",deepseek:"DS",ollama:"OL",antigravity:"GM",grok:"GR"},
  ja:{all:"AI",codex:"コ",claude:"ク",deepseek:"デ",ollama:"オ",antigravity:"ジ",grok:"グ"}
};

export function providerNameMark(provider:MarkProvider,locale:SupportedLocale){return MARKS[locale][provider];}
