export type HtmlPreviewMode=string;
export type HtmlPreviewViewport="desktop"|"mobile";
export type HtmlPreviewCanvas="light"|"dark";
export type HtmlDiagnosticCategory="tag"|"attribute"|"css"|"resource"|"warning";
export type HtmlDiagnosticAction="removed"|"blocked"|"normalized";

export type HtmlDiagnostic={
  category:HtmlDiagnosticCategory;
  action:HtmlDiagnosticAction;
  target:string;
  name:string;
  detail:string;
};

export type HtmlDiagnosticCounts={
  tags:number;
  attributes:number;
  css:number;
  resources:number;
  warnings:number;
};

export type HtmlPreviewResult={
  srcdoc:string;
  diagnostics:HtmlDiagnostic[];
  counts:HtmlDiagnosticCounts;
  profileId:string|null;
  profileVersion:string|null;
};

export type HtmlPreviewReadResponse={
  fileId:string;
  relativePath:string;
  content:string;
  byteLength:number;
  modifiedAt:string;
  revision:string;
};
