import path from "node:path";

const POSIX_PATH=/(^|[\s("'=:])\/(?!\/)(?:[^\s<>:"'|?*()[\]{}]+\/)*[^\s<>:"'|?*()[\]{}]*/g;
const WINDOWS_PATH=/(^|[\s("'=:])[A-Za-z]:\\(?:[^\s<>:"|?*]+\\)*[^\s<>:"|?*]*/g;

function shortPath(value:string){const normalized=value.replace(/[.,;]+$/,""),suffix=value.slice(normalized.length),name=normalized.includes("\\")?normalized.split("\\").filter(Boolean).at(-1):path.posix.basename(normalized);return`…/${name||"local"}${suffix}`;}
export function maskLocalPaths(value:string){
  return value.replace(POSIX_PATH,(match,prefix)=>`${prefix}${shortPath(match.slice(prefix.length))}`).replace(WINDOWS_PATH,(match,prefix)=>`${prefix}${shortPath(match.slice(prefix.length))}`);
}
export function applyPathDisplayPolicy<T>(value:T,hideLocalPaths:boolean):T{
  if(!hideLocalPaths)return value;
  if(typeof value==="string")return maskLocalPaths(value) as T;
  if(Array.isArray(value))return value.map(item=>applyPathDisplayPolicy(item,true)) as T;
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([key,item])=>[key,applyPathDisplayPolicy(item,true)])) as T;
  return value;
}
