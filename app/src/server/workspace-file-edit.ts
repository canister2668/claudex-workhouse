import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const MAX_EDITABLE_WORKSPACE_FILE_BYTES = 256 * 1024;

export type EditableTextSnapshot = {
  content: string;
  byteLength: number;
  revision: string;
  lineEnding: "lf" | "crlf";
  hasUtf8Bom: boolean;
  endsWithNewline: boolean;
};

function fileError(message:string,statusCode:number,code:string){return Object.assign(new Error(message),{statusCode,code});}
function revision(value:Buffer){return crypto.createHash("sha256").update(value).digest("hex");}
function inside(root:string,target:string){const relative=path.relative(root,target);return relative===""||(!relative.startsWith(`..${path.sep}`)&&relative!==".."&&!path.isAbsolute(relative));}

export function isGitMetadataPath(relativePath:string){return relativePath.split(/[\\/]+/).some(part=>part.toLowerCase()===".git");}

export function resolveWorkspaceTextPath(rootPath:string,basePath:string,requestedPath:string){
  const requested=String(requestedPath??"").trim();
  if(!requested||requested.includes("\0")||path.isAbsolute(requested))throw fileError("A relative workspace file path is required.",400,"INVALID_WORKSPACE_FILE_PATH");
  const root=path.resolve(rootPath),base=path.resolve(basePath);
  if(!inside(root,base))throw fileError("File path base is outside the workspace.",403,"WORKSPACE_FILE_PATH_ESCAPE");
  const lexical=path.resolve(base,requested);
  if(!inside(root,lexical))throw fileError("Workspace file path escape rejected.",403,"WORKSPACE_FILE_PATH_ESCAPE");
  const relative=path.relative(root,lexical)||".";
  if(isGitMetadataPath(relative))throw fileError("Git metadata files cannot be edited.",403,"GIT_METADATA_EDIT_BLOCKED");
  let cursor=root;
  try{
    for(const part of relative.split(path.sep).filter(part=>part&&part!==".")){
      cursor=path.join(cursor,part);
      if(fs.lstatSync(cursor).isSymbolicLink())throw fileError("Symbolic links are not editable.",403,"SYMLINK_EDIT_BLOCKED");
    }
    const real=fs.realpathSync(lexical),stat=fs.statSync(real);
    if(!inside(root,real))throw fileError("Workspace file path escape rejected.",403,"WORKSPACE_FILE_PATH_ESCAPE");
    if(!stat.isFile())throw fileError("File expected.",400,"WORKSPACE_FILE_EXPECTED");
    return{real,relative:path.relative(root,real)||path.basename(real),stat};
  }catch(error){
    if((error as any)?.statusCode)throw error;
    if((error as NodeJS.ErrnoException)?.code==="ENOENT")throw fileError("Workspace file not found.",404,"WORKSPACE_FILE_NOT_FOUND");
    throw error;
  }
}

export function decodeEditableText(value:Buffer):EditableTextSnapshot{
  if(value.length>MAX_EDITABLE_WORKSPACE_FILE_BYTES)throw fileError("File exceeds the 256 KiB editor limit.",413,"WORKSPACE_FILE_EDIT_TOO_LARGE");
  const hasUtf8Bom=value.length>=3&&value[0]===0xef&&value[1]===0xbb&&value[2]===0xbf,body=hasUtf8Bom?value.subarray(3):value;
  let raw:string;
  try{raw=new TextDecoder("utf-8",{fatal:true}).decode(body);}catch{throw fileError("Only valid UTF-8 text files can be edited.",415,"WORKSPACE_FILE_INVALID_UTF8");}
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw))throw fileError("Control-character files are read-only.",415,"WORKSPACE_FILE_CONTROL_CHARACTERS");
  const hasCrLf=/\r\n/.test(raw),withoutCrLf=raw.replace(/\r\n/g,""),hasLoneLf=/\n/.test(withoutCrLf),hasLoneCr=/\r/.test(withoutCrLf);
  if((hasCrLf&&(hasLoneLf||hasLoneCr))||hasLoneCr)throw fileError("Mixed or legacy line endings are read-only.",415,"WORKSPACE_FILE_MIXED_LINE_ENDINGS");
  const lineEnding=hasCrLf?"crlf":"lf",endsWithNewline=lineEnding==="crlf"?raw.endsWith("\r\n"):raw.endsWith("\n");
  return{content:lineEnding==="crlf"?raw.replace(/\r\n/g,"\n"):raw,byteLength:value.length,revision:revision(value),lineEnding,hasUtf8Bom,endsWithNewline};
}

function encodeLikeCurrent(content:string,current:EditableTextSnapshot){
  let normalized=String(content).replace(/\r\n?/g,"\n");
  if(current.endsWithNewline&&!normalized.endsWith("\n"))normalized+="\n";
  if(!current.endsWithNewline&&normalized.endsWith("\n"))normalized=normalized.slice(0,-1);
  const text=current.lineEnding==="crlf"?normalized.replace(/\n/g,"\r\n"):normalized;
  const encoded=Buffer.from(text,"utf8"),value=current.hasUtf8Bom?Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),encoded]):encoded;
  if(value.length>MAX_EDITABLE_WORKSPACE_FILE_BYTES)throw fileError("Edited file exceeds the 256 KiB limit.",413,"WORKSPACE_FILE_EDIT_TOO_LARGE");
  return value;
}

export function writeEditableTextFile(target:string,content:string,expectedRevision:string,expectedCurrentRevision?:string){
  const initialLink=fs.lstatSync(target);
  if(initialLink.isSymbolicLink()||!initialLink.isFile())throw fileError("Only regular workspace files can be edited.",403,"WORKSPACE_FILE_NOT_EDITABLE");
  const currentBytes=fs.readFileSync(target),current=decodeEditableText(currentBytes),expected=expectedCurrentRevision??expectedRevision;
  if(current.revision!==expected)throw fileError("The file changed after editing began.",409,"FILE_VERSION_CONFLICT");
  const nextBytes=encodeLikeCurrent(content,current),nextRevision=revision(nextBytes);
  if(nextRevision===current.revision)return{relativeChanged:false,previousRevision:current.revision,revision:nextRevision,byteLength:nextBytes.length,modifiedAt:initialLink.mtime.toISOString()};
  const directory=path.dirname(target),temporary=path.join(directory,`.claudex-workhouse-${path.basename(target)}-${crypto.randomUUID()}.tmp`);
  let descriptor:number|null=null;
  try{
    descriptor=fs.openSync(temporary,"wx",initialLink.mode&0o777);
    fs.writeFileSync(descriptor,nextBytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);descriptor=null;
    const finalLink=fs.lstatSync(target),finalBytes=fs.readFileSync(target);
    if(finalLink.isSymbolicLink()||!finalLink.isFile()||finalLink.dev!==initialLink.dev||finalLink.ino!==initialLink.ino||revision(finalBytes)!==current.revision)throw fileError("The file changed during save.",409,"FILE_VERSION_CONFLICT");
    fs.renameSync(temporary,target);
    const saved=fs.statSync(target);
    return{relativeChanged:true,previousRevision:current.revision,revision:nextRevision,byteLength:nextBytes.length,modifiedAt:saved.mtime.toISOString()};
  }finally{
    if(descriptor!==null)try{fs.closeSync(descriptor);}catch{}
    if(fs.existsSync(temporary))try{fs.unlinkSync(temporary);}catch{}
  }
}
