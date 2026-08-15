import { currentLocale, translateFor } from "./i18n";
import type { SupportedLocale } from "./i18n";

export type GitLocale=SupportedLocale;
export type GitMessageKey=string;

export const GIT_TRANSLATION_KEYS=["git.title","git.connected","git.notConnected","git.repository","git.branch","git.remote","git.fetch","git.pull","git.push","git.commit","git.clone","git.changes","git.staged","git.untracked","git.conflicts","git.ahead","git.behind","git.connectGitHub","git.disconnectGitHub","git.createBranch","git.switchBranch","git.publishBranch"] as const;
type GitTranslationKey=(typeof GIT_TRANSLATION_KEYS)[number];

export const GIT_TRANSLATIONS=Object.fromEntries((["ko","en","ja"] as const).map((language)=>[
  language,
  Object.fromEntries(GIT_TRANSLATION_KEYS.map((key)=>[key,translateFor(language,key)])) as Record<GitTranslationKey,string>
])) as Record<GitLocale,Record<GitTranslationKey,string>>;

export function currentGitLocale():GitLocale{return currentLocale();}
export function gitText(locale:GitLocale,key:GitMessageKey){return translateFor(locale,`git.${key}`);}
