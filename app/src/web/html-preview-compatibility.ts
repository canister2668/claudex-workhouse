import {cssPropertyNames,htmlElementPath,secureHtmlDocument,serializeSecurePreview} from "./html-preview-security";
import type {HtmlDiagnostic,HtmlPreviewMode,HtmlPreviewResult} from "./html-preview-types";


export function buildHtmlPreview(source:string,options:{mode:HtmlPreviewMode;allowExternalImages:boolean}):HtmlPreviewResult{
  const secured=secureHtmlDocument(source,options.allowExternalImages);
  return serializeSecurePreview(secured.document,secured.diagnostics,options.allowExternalImages);
}
