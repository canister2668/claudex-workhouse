import fs from"node:fs";
import os from"node:os";
export type DeploymentKind="synology"|"docker"|"windows-portable"|"macos"|"linux";
export function detectDeployment(input:{platform?:NodeJS.Platform;docker?:boolean;synology?:boolean;windowsPortable?:boolean}={}){
 const platform=input.platform??process.platform,docker=input.docker??(fs.existsSync("/.dockerenv")||fs.existsSync("/run/.containerenv"));
 const synology=input.synology??(fs.existsSync("/etc.defaults/VERSION")&&fs.existsSync("/usr/syno"));
 const kind:DeploymentKind=input.windowsPortable||platform==="win32"?"windows-portable":docker?"docker":synology?"synology":platform==="darwin"?"macos":"linux";
 return{kind,platform,architecture:os.arch(),container:docker,hostCommandVisibility:!docker,privilegedHelperSupported:kind==="linux"||kind==="macos",serviceManager:kind==="synology"?"dsm":kind==="linux"?"systemd":kind==="macos"?"launchd":kind==="windows-portable"?"windows-service":"external"};
}
