export function htmlPreviewImageReferences(content:string){
  const doc=new DOMParser().parseFromString(content,"text/html");
  return [...new Set([...doc.querySelectorAll("img[src],video[poster]")].map(element=>element.getAttribute(element.tagName.toLowerCase()==="img"?"src":"poster")??"").filter(value=>value&&!/^(?:[a-z][a-z\d+.-]*:|[/\\#])/i.test(value)))].slice(0,200);
}
export function embedHtmlPreviewImages(content:string,images:Record<string,string>={}){
  const doc=new DOMParser().parseFromString(content,"text/html");
  for(const element of doc.querySelectorAll("img[src],video[poster]")){
    const attr=element.tagName.toLowerCase()==="img"?"src":"poster",ref=element.getAttribute(attr)??"";
    if(Object.hasOwn(images,ref)&&/^data:image\/(png|jpeg|gif|webp|avif);base64,/.test(images[ref]!))element.setAttribute(attr,images[ref]!);
  }
  return `<!doctype html>\n${doc.documentElement.outerHTML}`;
}
