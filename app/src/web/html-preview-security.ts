import type {HtmlDiagnostic,HtmlDiagnosticCounts,HtmlPreviewResult} from "./html-preview-types";

const EXECUTABLE_TAGS=["script","iframe","frame","frameset","object","embed","portal"];
const URL_ATTRIBUTES=["href","src","poster","action","formaction","xlink:href"];

export function htmlElementPath(element:Element){
  const parts:string[]=[];
  let current:Element|null=element;
  while(current&&parts.length<5){
    const tag=current.tagName.toLowerCase();
    if(tag==="html")break;
    let part=tag;
    const parent:Element|null=current.parentElement;
    if(parent){
      const siblings=[...parent.children].filter(item=>item.tagName===current!.tagName);
      if(siblings.length>1)part+=`:nth-of-type(${siblings.indexOf(current)+1})`;
    }
    parts.unshift(part);
    if(tag==="body")break;
    current=parent;
  }
  return parts.join(" > ")||"document";
}

export function diagnosticCounts(diagnostics:HtmlDiagnostic[]):HtmlDiagnosticCounts{
  return{
    tags:diagnostics.filter(item=>item.category==="tag").length,
    attributes:diagnostics.filter(item=>item.category==="attribute").length,
    css:diagnostics.filter(item=>item.category==="css").length,
    resources:diagnostics.filter(item=>item.category==="resource").length,
    warnings:diagnostics.filter(item=>item.category==="warning").length,
  };
}

function diagnostic(category:HtmlDiagnostic["category"],action:HtmlDiagnostic["action"],target:string,name:string,detail:string):HtmlDiagnostic{
  return{category,action,target,name,detail};
}

function privateNetworkHost(hostname:string){
  const host=hostname.toLowerCase().replace(/^\[|\]$/g,"");
  if(host==="localhost"||host.endsWith(".localhost")||host.endsWith(".local")||host==="::1"||host.startsWith("fe80:")||host.startsWith("fc")||host.startsWith("fd"))return true;
  const parts=host.split(".").map(Number);
  if(parts.length!==4||parts.some(item=>!Number.isInteger(item)||item<0||item>255))return false;
  return parts[0]===10||parts[0]===127||parts[0]===0||parts[0]===169&&parts[1]===254||parts[0]===172&&parts[1]>=16&&parts[1]<=31||parts[0]===192&&parts[1]===168;
}

function visualUrl(value:string,allowExternalImages:boolean){
  const raw=value.trim();
  if(!raw)return{url:null,detail:"empty resource"};
  if(/^data:/i.test(raw))return{url:raw,detail:"embedded image"};
  if(/^blob:/i.test(raw))return{url:raw,detail:"blob image"};
  if(raw.startsWith("//")){
    if(!allowExternalImages)return{url:null,detail:"external image disabled"};
    const normalized=`https:${raw}`;
    try{const parsed=new URL(normalized);return privateNetworkHost(parsed.hostname)?{url:null,detail:"local network image blocked"}:{url:normalized,detail:"protocol-relative image normalized"};}catch{return{url:null,detail:"invalid image URL"};}
  }
  try{
    const parsed=new URL(raw);
    if(parsed.protocol!=="https:")return{url:null,detail:"non-HTTPS image blocked"};
    if(!allowExternalImages)return{url:null,detail:"external image disabled"};
    if(privateNetworkHost(parsed.hostname))return{url:null,detail:"local network image blocked"};
    return{url:parsed.href,detail:"external HTTPS image allowed"};
  }catch{return{url:null,detail:"relative workspace resource unavailable"};}
}

function sanitizeCssText(value:string,target:string,diagnostics:HtmlDiagnostic[]){
  let next=value.replace(/@import[\s\S]*?(?:;|$)/gi,match=>{diagnostics.push(diagnostic("resource","blocked",target,"@import","external CSS import blocked"));return"";});
  next=next.replace(/url\s*\(\s*[^)]*\)/gi,match=>{diagnostics.push(diagnostic("css","removed",target,"url()","CSS resource URL removed"));return"none";});
  return next;
}

export function cssPropertyNames(style:CSSStyleDeclaration){
  const names:string[]=[];
  for(let index=0;index<style.length;index++){const name=style.item(index);if(name)names.push(name);}
  return names;
}

export function secureHtmlDocument(source:string,allowExternalImages:boolean){
  const document=new DOMParser().parseFromString(source,"text/html"),diagnostics:HtmlDiagnostic[]=[];
  for(const element of [...document.querySelectorAll(EXECUTABLE_TAGS.join(","))]){
    diagnostics.push(diagnostic("tag","removed",htmlElementPath(element),element.tagName.toLowerCase(),"executable or embedded content removed"));
    element.remove();
  }
  for(const element of [...document.querySelectorAll("base,link[rel~='stylesheet'],link[rel~='preload'],link[rel~='modulepreload']")]){
    diagnostics.push(diagnostic(element.tagName.toLowerCase()==="base"?"tag":"resource","removed",htmlElementPath(element),element.tagName.toLowerCase(),"base or external stylesheet removed"));
    element.remove();
  }
  for(const element of [...document.querySelectorAll("meta[http-equiv]")]){
    const value=element.getAttribute("http-equiv")?.toLowerCase()??"";
    if(value==="refresh"||value==="content-security-policy"){
      diagnostics.push(diagnostic("tag","removed",htmlElementPath(element),`meta[http-equiv=${value}]`,"active meta directive removed"));
      element.remove();
    }
  }
  for(const style of [...document.querySelectorAll("style")])style.textContent=sanitizeCssText(style.textContent??"",htmlElementPath(style),diagnostics);
  for(const element of [...document.querySelectorAll("*")]){
    const target=htmlElementPath(element);
    for(const attribute of [...element.attributes]){
      const name=attribute.name.toLowerCase();
      if(name.startsWith("on")){
        element.removeAttribute(attribute.name);
        diagnostics.push(diagnostic("attribute","removed",target,name,"event handler removed"));
      }
    }
    const inline=(element as HTMLElement).style;
    if(inline)for(const property of cssPropertyNames(inline)){
      const value=inline.getPropertyValue(property);
      if(/url\s*\(/i.test(value)){
        inline.removeProperty(property);
        diagnostics.push(diagnostic("css","removed",target,property,"CSS resource URL removed"));
      }
    }
    if(element.matches("a,area")){
      for(const name of ["href","target","download","ping"])if(element.hasAttribute(name)){element.removeAttribute(name);diagnostics.push(diagnostic("attribute","removed",target,name,"navigation disabled"));}
    }
    if(element.matches("form")){
      for(const name of ["action","method","target"])if(element.hasAttribute(name)){element.removeAttribute(name);diagnostics.push(diagnostic("attribute","removed",target,name,"form submission disabled"));}
    }
    if(element.matches("input[type=file],button,select,textarea"))element.setAttribute("disabled","");
    for(const name of ["srcset","imagesrcset"])if(element.hasAttribute(name)){element.removeAttribute(name);diagnostics.push(diagnostic("resource","blocked",target,name,"multi-source resource blocked"));}
    for(const name of URL_ATTRIBUTES){
      if(!element.hasAttribute(name)||element.matches("a,area")&&name==="href"||element.matches("form")&&name==="action")continue;
      const raw=element.getAttribute(name)??"";
      if((element.matches("img")&&name==="src")||(element.matches("video")&&name==="poster")){
        const result=visualUrl(raw,allowExternalImages);
        if(result.url){
          if(result.url!==raw){element.setAttribute(name,result.url);diagnostics.push(diagnostic("resource","normalized",target,name,result.detail));}
        }else{element.removeAttribute(name);diagnostics.push(diagnostic("resource","blocked",target,name,result.detail));}
      }else{
        element.removeAttribute(name);
        diagnostics.push(diagnostic("resource","blocked",target,name,"network or navigation resource blocked"));
      }
    }
  }
  return{document,diagnostics};
}

export function previewCsp(allowExternalImages:boolean){
  return`default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:${allowExternalImages?" https:":""}; font-src data:; media-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none';`;
}

export function serializeSecurePreview(document:Document,diagnostics:HtmlDiagnostic[],allowExternalImages:boolean,profileId:string|null=null,profileVersion:string|null=null):HtmlPreviewResult{
  const referrer=document.createElement("meta");
  referrer.setAttribute("name","referrer");
  referrer.setAttribute("content","no-referrer");
  const meta=document.createElement("meta");
  meta.setAttribute("http-equiv","Content-Security-Policy");
  meta.setAttribute("content",previewCsp(allowExternalImages));
  document.head.prepend(meta,referrer);
  return{srcdoc:`<!doctype html>\n${document.documentElement.outerHTML}`,diagnostics,counts:diagnosticCounts(diagnostics),profileId,profileVersion};
}
