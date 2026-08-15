import path from "node:path";
import { z } from "zod";

export const protonDriveSettingsSchema=z.object({
  version:z.literal(1).default(1),
  enabled:z.boolean().default(false),
  remoteRoot:z.string().trim().min(1).max(1024).default("/my-files/Claudex-Workhouse"),
  conflictStrategy:z.literal("skip").default("skip"),
  verifyAfterUpload:z.boolean().default(true),
  maxUploadBytes:z.number().int().min(1).max(20*1024*1024*1024).default(5*1024*1024*1024)
}).superRefine((value,context)=>{
  if(!value.remoteRoot.startsWith("/my-files/")||value.remoteRoot.includes("\0")||value.remoteRoot.split("/").some(segment=>segment===".."||segment==="."))context.addIssue({code:z.ZodIssueCode.custom,path:["remoteRoot"],message:"Proton Drive root must be below /my-files."});
});

export type ProtonDriveSettings=z.infer<typeof protonDriveSettingsSchema>;
export const DEFAULT_PROTON_DRIVE_SETTINGS:ProtonDriveSettings={version:1,enabled:false,remoteRoot:"/my-files/Claudex-Workhouse",conflictStrategy:"skip",verifyAfterUpload:true,maxUploadBytes:5*1024*1024*1024};

export function normalizeProtonDriveSettings(value:unknown):ProtonDriveSettings{
  const parsed=protonDriveSettingsSchema.safeParse(value);
  return parsed.success?parsed.data:DEFAULT_PROTON_DRIVE_SETTINGS;
}

export function protonRemotePath(settings:ProtonDriveSettings,workspaceName:string,fileName:string,sha256:string){
  const safe=(value:string,fallback:string)=>value.normalize("NFKC").replace(/[\\/\u0000-\u001f]/g,"-").replace(/\s+/g," ").trim().slice(0,120)||fallback;
  const ext=path.extname(fileName).slice(0,32),base=safe(path.basename(fileName,ext),"artifact"),workspace=safe(workspaceName,"workspace"),name=`${base}--${sha256.slice(0,8)}${ext}`.slice(0,255);
  return `${settings.remoteRoot.replace(/\/+$/g,"")}/${workspace}/${name}`;
}
