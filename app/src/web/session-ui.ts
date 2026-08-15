import { currentLocale, formatRelativeTime, translate } from "./i18n";
import{normalizeTimestamp}from"./task-time";

export type SessionStatus = "pending"|"queued"|"running"|"waiting"|"completed"|"failed"|"stopped"|"unknown"|string;

const SOURCE_LABELS:Record<string,string>={"claudex-workhouse":"Claudex Workhouse",cx:"cx",cli:"CLI",vscode:"VS Code",appServer:"app-server"};

export const statusLabel=(value:SessionStatus)=>translate(`task.status.${value}`);
export const sourceLabel=(value:string|null|undefined)=>value==="exec"?translate("session.source.direct"):SOURCE_LABELS[value??""]??value??translate("session.source.unknown");
export const ownershipLabel=(value:string|null|undefined)=>value==="claudex-workhouse"?translate("session.ownership.claudexWorkhouse"):value==="external-cx"?translate("session.ownership.externalCx"):value==="external"?translate("session.ownership.external"):translate("session.ownership.unknown");
export const permissionLabel=(value:string|null|undefined)=>value===":read-only"?translate("permission.readOnly"):value===":workspace"?translate("session.permission.workspace"):value===":workspace-write"?translate("session.permission.workspaceWrite"):value===":danger-full-access"?translate("permission.fullAccess"):value??translate("session.permission.unknown");
export const effortLabel=(value:string|null|undefined)=>value?translate(`session.effort.${value}`):translate("common.unknown");
// Model names are proper nouns except the runtime's "default" placeholder, which is
// the one entry that has to follow the UI language.
export const modelLabel=(item:{id?:string;displayName?:string}|null|undefined)=>
  item?.id==="default"?translate("model.runtimeDefault"):item?.displayName??translate("common.unknown");
export const liveLabel=(value:string)=>value==="Live"?translate("session.live"):value==="Delayed"?translate("session.delayed"):value==="History"?translate("session.history"):value;
export const shortId=(value:string|null|undefined)=>value?`${value.slice(0,8)}…${value.slice(-4)}`:translate("session.idPending");
export const relativeTime=(value:string|number|null|undefined)=>{
  const timestamp=normalizeTimestamp(value);
  if(timestamp===undefined)return translate("session.timeUnknown");
  return formatRelativeTime(new Date(timestamp).toISOString(),currentLocale());
};
