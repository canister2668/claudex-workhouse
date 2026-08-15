import { translate } from "./i18n";

export type VscodeDiagnostic={severity:"error"|"warning"|"information"|"hint";message:string;line:number;column:number};
export type VscodeContext={
  version:1;
  workspacePath:string;
  filePath:string;
  languageId:string;
  startLine:number;
  startColumn:number;
  endLine:number;
  endColumn:number;
  selectedText:string;
  diagnostics:VscodeDiagnostic[];
  request:string;
};

const MAX_FRAGMENT_LENGTH=48_000;
const MAX_SELECTION_LENGTH=20_000;

function text(value:unknown,max:number){return typeof value==="string"?value.replace(/\u0000/g,"").slice(0,max):"";}
function integer(value:unknown){const parsed=Number(value);return Number.isSafeInteger(parsed)&&parsed>=0?parsed:0;}
function decodeBase64Url(value:string){
  const normalized=value.replace(/-/g,"+").replace(/_/g,"/");
  const binary=atob(normalized.padEnd(Math.ceil(normalized.length/4)*4,"="));
  return new TextDecoder().decode(Uint8Array.from(binary,character=>character.charCodeAt(0)));
}

export function vscodeContextFromLocation(location:Pick<Location,"hash">):VscodeContext|null{
  const prefix="#vscode-context=",hash=location.hash;
  if(!hash.startsWith(prefix)||hash.length>MAX_FRAGMENT_LENGTH)return null;
  try{
    const raw=JSON.parse(decodeBase64Url(hash.slice(prefix.length)));
    if(raw?.version!==1)return null;
    const workspacePath=text(raw.workspacePath,4096),filePath=text(raw.filePath,4096);
    if(!workspacePath||!filePath)return null;
    const severities=new Set(["error","warning","information","hint"]);
    const diagnostics=(Array.isArray(raw.diagnostics)?raw.diagnostics:[]).slice(0,20).flatMap((item:unknown)=>{
      if(!item||typeof item!=="object")return[];
      const value=item as Record<string,unknown>,severity=String(value.severity);
      if(!severities.has(severity))return[];
      const message=text(value.message,1000);if(!message)return[];
      return[{severity:severity as VscodeDiagnostic["severity"],message,line:integer(value.line),column:integer(value.column)}];
    });
    return{version:1,workspacePath,filePath,languageId:text(raw.languageId,100),startLine:integer(raw.startLine),startColumn:integer(raw.startColumn),endLine:integer(raw.endLine),endColumn:integer(raw.endColumn),selectedText:text(raw.selectedText,MAX_SELECTION_LENGTH),diagnostics,request:text(raw.request,4000)};
  }catch{return null;}
}

export function vscodeContextPrompt(context:VscodeContext){
  const range=`${context.startLine+1}:${context.startColumn+1}-${context.endLine+1}:${context.endColumn+1}`;
  // The prompt goes to the provider but the user edits it first, so it is written in
  // the UI language like the built-in request presets.
  const diagnostics=context.diagnostics.length?context.diagnostics.map(item=>`- ${item.severity.toUpperCase()} ${item.line+1}:${item.column+1} ${item.message}`).join("\n"):`- ${translate("vscode.none")}`;
  const selection=context.selectedText?`\n\n${translate("vscode.selectedCode")}:\n\`\`\`${context.languageId}\n${context.selectedText}\n\`\`\``:"";
  return`${context.request.trim()||translate("vscode.defaultRequest")}\n\n${translate("vscode.context")}:\n- ${translate("vscode.file")}: ${context.filePath}\n- ${translate("vscode.range")}: ${range}\n- ${translate("vscode.language")}: ${context.languageId||"unknown"}\n- ${translate("vscode.diagnostics")}:\n${diagnostics}${selection}`;
}

export function matchingVscodeWorkspace<T extends {canonicalPath:string}>(context:VscodeContext,workspaces:T[]){
  const normalize=(value:string)=>value.replace(/\\/g,"/").replace(/\/+$/,"");
  const target=normalize(context.workspacePath);
  return workspaces.find(workspace=>normalize(workspace.canonicalPath)===target)??null;
}
