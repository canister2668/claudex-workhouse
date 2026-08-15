import DOMPurify from "dompurify";
import { marked, Renderer, Tokenizer } from "marked";
import type { AgentEvent } from "./events";
import { translate } from "./i18n";
import { workspaceFilePreviewHref } from "./workspace-viewer-state";

const markdownOptions = {
  async: false as const,
  breaks: true,
  gfm: true
};

// Marked accepts a single tilde as GFM deletion markup. That turns ordinary
// Korean range notation such as `30~200ms, cold 100~700ms` into one long
// strike-through. Keep deletion support, but require the standard `~~pair~~`.
class DoubleTildeTokenizer extends Tokenizer {
  override del(src:string,maskedSrc:string,prevChar?:string){
    if(!src.startsWith("~~"))return;
    const token=super.del(src,maskedSrc,prevChar);
    return token?.raw.startsWith("~~")?token:undefined;
  }
}

const escapeHtml=(value:string)=>value.replace(/[&<>"']/g,character=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]!));

export type MarkdownLinkContext = {
  workspaceId?: string | null;
  workspacePath?: string | null;
  executionHostId?: string | null;
  workspaces?: Array<{id:string;canonicalPath:string;hostId:string}>;
  inlineImages?: boolean;
};

const sanitizeOptions = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ["style"],
  FORBID_ATTR: ["style"],
  ADD_ATTR: ["target", "loading", "decoding"],
  ALLOW_UNKNOWN_PROTOCOLS: false
};

export function isMarkdownEvent(event: AgentEvent) {
  return event.type === "message_completed"
    || event.type === "message_delta"
    || (event.type === "message" && event.metadata?.role !== "user");
}

function slashPath(value: string) {
  return value.replace(/\\/g, "/").replace(/\/+$/, "");
}

// Keep reviewable output in the workspace viewer, whose toolbar already offers
// an explicit download action. Only artifacts whose primary purpose is
// installation, extraction, or binary distribution bypass the viewer.
const directDownloadExtensions=new Set([
  "7z","apk","appimage","bin","bz2","cab","deb","dmg","exe","gz","iso","msi","msix","pkg","rar","risum","rpm","tar","tgz","txz","xz","zip","zst"
]);
const previewableImageExtensions=new Set(["avif","gif","jpeg","jpg","png","webp"]);
const MAX_INLINE_LINKED_IMAGES=12;

function workspaceFileTarget(href:string,context:MarkdownLinkContext){
  if(context.executionHostId&&context.executionHostId!=="local")return null;
  let forceDownload=false;
  try{const query=new URL(href,"http://claudex-workhouse.local").searchParams;forceDownload=query.get("download")==="1"||query.get("download")==="true";}catch{}
  const withoutQuery=href.split(/[?#]/,1)[0]??href;
  if(!withoutQuery.startsWith("/")||withoutQuery.startsWith("//"))return null;
  let decoded:string;
  try{decoded=decodeURI(withoutQuery);}catch{return null;}
  const lineMatch=decoded.match(/:(\d+)(?::\d+)?$/),line=lineMatch?Number(lineMatch[1]):null;
  if(lineMatch)decoded=decoded.slice(0,-lineMatch[0].length);
  const target=slashPath(decoded),candidates=[
    ...(context.workspaceId&&context.workspacePath?[{id:context.workspaceId,canonicalPath:context.workspacePath,hostId:context.executionHostId??"local"}]:[]),
    ...(context.workspaces??[]),
  ].filter(item=>item.hostId==="local").map(item=>({...item,root:slashPath(item.canonicalPath)}))
    .filter(item=>item.root.startsWith("/")&&target!==item.root&&target.startsWith(`${item.root}/`))
    .sort((left,right)=>right.root.length-left.root.length);
  const owner=candidates[0];
  if(!owner)return null;
  const relative=target.slice(owner.root.length+1);
  if(!relative||relative.includes("\0")||relative.split("/").some(part=>part===".."))return null;
  return{workspaceId:owner.id,relative,line:typeof line==="number"&&Number.isSafeInteger(line)&&line>0?line:null,forceDownload};
}

function downloadCandidate(relative:string){
  const name=relative.split("/").at(-1)?.toLocaleLowerCase()??"",extension=name.split(".").at(-1)??"";
  return directDownloadExtensions.has(extension);
}

function promotableImageLink(href:string,context:MarkdownLinkContext){
  if(!context.inlineImages)return null;
  const target=workspaceFileTarget(href,context);
  if(!target||target.forceDownload)return null;
  const extension=target.relative.split("/").at(-1)?.toLocaleLowerCase().split(".").at(-1)??"";
  if(!previewableImageExtensions.has(extension))return null;
  const source=workspaceFilePreviewHref(target.workspaceId,target.relative,"workspace");
  return source?{source,path:target.relative}:null;
}

function externalWebsiteLink(href:string){
  return /^https?:\/\//i.test(href);
}

function unresolvedLocalFileLink(href:string){
  if(!href.startsWith("/")||href.startsWith("//"))return false;
  let url:URL;
  try{url=new URL(href,"http://claudex-workhouse.local");}catch{return false;}
  if(url.searchParams.get("download")==="1"||url.searchParams.get("download")==="true")return true;
  const segments=url.pathname.split("/").filter(Boolean),last=segments.at(-1)??"";
  return segments.length>=2&&last.includes(".");
}

export function workspaceDownloadHref(href: string, context: MarkdownLinkContext = {}) {
  const target=workspaceFileTarget(href,context);
  if(!target)return href;
  const action=target.forceDownload||downloadCandidate(target.relative)?"download":"view",params=new URLSearchParams({path:target.relative});
  if(action==="view"&&target.line)params.set("line",String(target.line));
  if(action==="download")return `/api/workspaces/${encodeURIComponent(target.workspaceId)}/files/download?${params}`;
  params.set("workspace",target.workspaceId);
  params.set("view","file");
  return `/open-file?${params}`;
}

// Markdown images point at real paths on the execution host, so `<img src>` has
// to be rewritten to the workspace preview route the same way links are. Without
// this an absolute path renders as a broken image with no way to recover it.
export function workspaceImageHref(href:string,context:MarkdownLinkContext={}){
  const target=workspaceFileTarget(href,context);
  return target?workspaceFilePreviewHref(target.workspaceId,target.relative,"workspace"):null;
}

export function workspaceViewTarget(href:string){
  let url:URL;
  try{url=new URL(href,"http://claudex-workhouse.local");}catch{return null;}
  let workspaceId:string;
  const legacy=url.pathname.match(/^\/api\/workspaces\/([^/]+)\/files\/view$/);
  if(legacy){
    try{workspaceId=decodeURIComponent(legacy[1]!);}catch{return null;}
  }else{
    if(!["/","/open-file"].includes(url.pathname)||url.searchParams.get("view")!=="file")return null;
    workspaceId=url.searchParams.get("workspace")??"";
  }
  const path=url.searchParams.get("path")??"",line=Number(url.searchParams.get("line"));
  if(!workspaceId||!path||path.includes("\0")||path.startsWith("/")||path.split("/").some(part=>part===".."))return null;
  return{workspaceId,path,line:Number.isSafeInteger(line)&&line>0?line:null};
}

export function parseMarkdown(source: string, context: MarkdownLinkContext = {}) {
  const renderer=new Renderer(),renderLink=renderer.link.bind(renderer),renderCode=renderer.code.bind(renderer),unresolvedLocalFiles=new WeakSet<object>(),unresolvedLocalImages=new WeakSet<object>(),promotedImages=new WeakMap<object,{source:string;path:string}>();
  const imageFigure=(source:string,alt:string,caption:string)=>{
    const safeSource=escapeHtml(source),safeAlt=escapeHtml(alt),safeCaption=escapeHtml(caption),open=escapeHtml(translate("workspace.openFile"));
    return `<figure class="markdown-image"><a href="${safeSource}" target="_blank" rel="noopener noreferrer" title="${open}"><img src="${safeSource}" alt="${safeAlt}" loading="lazy" decoding="async"></a>${safeCaption?`<figcaption>${safeCaption}</figcaption>`:""}</figure>`;
  };
  renderer.link=(token)=>{
    const promoted=promotedImages.get(token);
    if(promoted)return imageFigure(promoted.source,token.text||promoted.path,token.text||promoted.path);
    if(unresolvedLocalFiles.has(token))return`<code>${escapeHtml(token.href)}</code>`;
    const html=renderLink(token);
    return externalWebsiteLink(token.href)
      ?html.replace("<a ", '<a target="_blank" rel="noopener noreferrer" ')
      :html;
  };
  renderer.image=(token)=>{
    if(unresolvedLocalImages.has(token))return`<code>${escapeHtml(token.href)}</code>`;
    return imageFigure(token.href,token.text??"",token.title??"");
  };
  renderer.code=(token)=>{
    const language=String(token.lang??"").trim().split(/\s+/,1)[0]??"";
    const copy=escapeHtml(translate("common.copy"));
    return `<div class="markdown-code-block"><div class="markdown-code-toolbar"><span>${escapeHtml(language)}</span><button type="button" data-copy-code aria-label="${copy}" title="${copy}"><i aria-hidden="true"></i><b data-copy-label>${copy}</b></button></div>${renderCode(token)}</div>`;
  };
  let promotedImageCount=0;
  return marked.parse(source, {
    ...markdownOptions,
    renderer,
    tokenizer:new DoubleTildeTokenizer(),
    walkTokens(token) {
      if (token.type === "image") {
        const preview = workspaceImageHref(token.href, context);
        if (preview) token.href = preview;
        else if (unresolvedLocalFileLink(token.href)) unresolvedLocalImages.add(token);
        return;
      }
      if (token.type !== "link") return;
      const promoted=promotedImageCount<MAX_INLINE_LINKED_IMAGES?promotableImageLink(token.href,context):null;
      if(promoted){promotedImages.set(token,promoted);promotedImageCount++;return;}
      const next = workspaceDownloadHref(token.href, context);
      if (next === token.href) {
        if(unresolvedLocalFileLink(token.href))unresolvedLocalFiles.add(token);
        return;
      }
      token.href = next;
      token.title ??= workspaceViewTarget(next)?translate("workspace.openFile"):translate("attachment.download");
    }
  }) as string;
}

export function renderMarkdown(source: string, context: MarkdownLinkContext = {}) {
  return DOMPurify.sanitize(parseMarkdown(source, context), sanitizeOptions);
}
