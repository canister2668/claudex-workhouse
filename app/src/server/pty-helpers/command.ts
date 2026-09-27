import path from"node:path";

export type ScreenHelper="claude-usage"|"claude-models"|"claude-cloud"|"claude-auth-pty";

/** How to run one of the terminal-screen helpers.
 *
 * Linux and macOS keep the long-standing python3 helpers in bin/, which use
 * the POSIX pty module. Windows has no such module, so it runs the Node port
 * (app/dist-server/pty-helpers/cli.js) over the bundled ConPTY bridge; no
 * Python is needed or installed. Both take the same arguments and print the
 * same JSON. */
export function screenHelperCommand(appRoot:string,helper:ScreenHelper,args:string[],platform:NodeJS.Platform=process.platform){
  if(platform==="win32")return{command:process.execPath,args:[path.join(appRoot,"app","dist-server","pty-helpers","cli.js"),helper,...args]};
  return{command:"python3",args:[path.join(appRoot,"bin",`${helper}.py`),...args]};
}
