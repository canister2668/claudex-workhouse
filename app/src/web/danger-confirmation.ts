import { translate } from "./i18n";

const STORAGE_KEY="deck-danger-full-access-confirmed-v1";
export const DANGER_FULL_ACCESS_WARNING=translate("permission.fullAccessConfirm");

type ConfirmationStorage=Pick<Storage,"getItem"|"setItem">;

function browserStorage():ConfirmationStorage|null{
  return typeof localStorage==="undefined"?null:localStorage;
}

export function dangerFullAccessAcknowledged(storage:ConfirmationStorage|null=browserStorage()){
  try{return storage?.getItem(STORAGE_KEY)==="1";}catch{return false;}
}

export function acknowledgeDangerFullAccess(storage:ConfirmationStorage|null=browserStorage()){
  try{storage?.setItem(STORAGE_KEY,"1");}catch{}
}

export function requestDangerFullAccessAcknowledgement(ask:(message:string)=>boolean=(message)=>confirm(message),storage:ConfirmationStorage|null=browserStorage()){
  if(dangerFullAccessAcknowledged(storage))return true;
  if(!ask(translate("permission.fullAccessConfirm")))return false;
  acknowledgeDangerFullAccess(storage);
  return true;
}
