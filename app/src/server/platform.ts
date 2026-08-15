import os from "node:os";
import path from "node:path";

export type WorkhousePlatform="linux"|"darwin"|"win32";

const WINDOWS_DEVICE=/^\\\\[.?]\\|^\/\/[.?]\//;
const WINDOWS_RESERVED=/^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9]|lpt[1-9])(?:\.|$)/i;
const WINDOWS_DRIVE_ABSOLUTE=/^[A-Za-z]:[\\/]/;
const WINDOWS_UNC_ABSOLUTE=/^[\\/]{2}[^\\/]+[\\/]+[^\\/]+(?:[\\/]|$)/;

function pathApi(platform:WorkhousePlatform){return platform==="win32"?path.win32:path.posix;}

export function isAbsoluteHostPath(value:string,platform:WorkhousePlatform=process.platform as WorkhousePlatform){
  if(!value||value.includes("\0"))return false;
  if(platform==="win32"){
    if(WINDOWS_DEVICE.test(value)||(!WINDOWS_DRIVE_ABSOLUTE.test(value)&&!WINDOWS_UNC_ABSOLUTE.test(value)))return false;
    const root=path.win32.parse(value).root,segments=value.slice(root.length).split(/[\\/]+/).filter(Boolean);
    return !segments.some(segment=>segment==="."||segment===".."||WINDOWS_RESERVED.test(segment)||/[ .]$/.test(segment)||/[<>:"|?*\u0000-\u001f]/.test(segment));
  }
  return path.posix.isAbsolute(value);
}

export function sameHostPath(left:string,right:string,platform:WorkhousePlatform=process.platform as WorkhousePlatform){
  const api=pathApi(platform),a=api.resolve(left),b=api.resolve(right);
  return platform==="win32"?a.toLowerCase()===b.toLowerCase():a===b;
}

export function hostPathKey(value:string,platform:WorkhousePlatform=process.platform as WorkhousePlatform){
  const normalized=pathApi(platform).resolve(value);
  return platform==="win32"?normalized.toLowerCase():normalized;
}

export function hostPathInside(root:string,target:string,platform:WorkhousePlatform=process.platform as WorkhousePlatform){
  const api=pathApi(platform),relative=api.relative(api.resolve(root),api.resolve(target));
  return relative===""||(!relative.startsWith(`..${api.sep}`)&&relative!==".."&&!api.isAbsolute(relative));
}

export function resolveWorkhouseRoots(environment:NodeJS.ProcessEnv=process.env,platform:WorkhousePlatform=process.platform as WorkhousePlatform){
  const fallback=platform==="win32"
    ?path.win32.join(environment.LOCALAPPDATA?.trim()||path.win32.join(os.homedir(),"AppData","Local"),"Claudex Workhouse")
    :"/opt/claudex-workhouse";
  const legacy=environment.CLAUDEX_WORKHOUSE_ROOT?.trim()||fallback;
  const appRoot=environment.CLAUDEX_WORKHOUSE_APP_ROOT?.trim()||legacy;
  const dataRoot=environment.CLAUDEX_WORKHOUSE_DATA_ROOT?.trim()||legacy;
  if(!isAbsoluteHostPath(appRoot,platform))throw new Error("CLAUDEX_WORKHOUSE_APP_ROOT must be an absolute host path.");
  if(!isAbsoluteHostPath(dataRoot,platform))throw new Error("CLAUDEX_WORKHOUSE_DATA_ROOT must be an absolute host path.");
  return{appRoot:pathApi(platform).normalize(appRoot),dataRoot:pathApi(platform).normalize(dataRoot),legacyRoot:pathApi(platform).normalize(legacy)};
}

export function localHostDisplayName(hostname=os.hostname()){return hostname.trim()||"This host";}
