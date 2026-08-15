import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import webpush from "web-push";
import type { DeckDatabase } from "./db/client.js";
import { readStreamEvents } from "./stream-events.js";
import type { DeckTask, StreamEvent } from "./types.js";
import type { PushKind } from "./push-kinds.js";
import { normalizeStoredLocale, type SupportedLocale } from "./ui-locale.js";

type PushTask=Pick<DeckTask,"id"|"provider"|"status"|"executionHostId">;

export interface PushPreferences { approvals:boolean; userInput:boolean; completed:boolean; failed:boolean; hostOffline:boolean; handoff:boolean; vibration:boolean; quietStart:string|null; quietEnd:string|null; }
const defaults:PushPreferences={approvals:true,userInput:true,completed:true,failed:true,hostOffline:false,handoff:true,vibration:false,quietStart:null,quietEnd:null};
const preferenceForKind:Record<PushKind,keyof Pick<PushPreferences,"approvals"|"userInput"|"completed"|"failed"|"hostOffline"|"handoff">>={approval:"approvals","user-input":"userInput",completed:"completed",failed:"failed","host-offline":"hostOffline",handoff:"handoff","quota-started":"completed","quota-cancelled":"failed","quota-failed":"failed"};
// Notifications are rendered by the browser, not by the app shell, so the copy has
// to be resolved here against the stored UI language instead of a dictionary key.
type PushCopy={title:Record<PushKind,string>;body:Partial<Record<PushKind,string>>;quota:Record<"started"|"cancelled"|"failed",{title:string;body:string}>};
const PUSH_COPY:Record<SupportedLocale,PushCopy>={
  ko:{
    title:{approval:"승인이 필요합니다","user-input":"사용자 답변이 필요합니다",completed:"작업이 완료되었습니다",failed:"작업을 확인해 주세요","host-offline":"실행 호스트 연결을 확인해 주세요",handoff:"작업 인계 결과가 도착했습니다","quota-started":"예약 작업을 시작했습니다","quota-cancelled":"예약 작업이 취소되었습니다","quota-failed":"예약 작업을 시작하지 못했습니다"},
    body:{approval:"Claudex Workhouse에서 요청 내용을 확인하세요.","user-input":"세션에서 질문에 답하면 작업이 계속됩니다.",failed:"세션에서 안전한 오류 요약을 확인하세요."},
    quota:{started:{title:"예약 작업을 시작했습니다",body:"세션을 열어 진행 상황을 확인하세요."},cancelled:{title:"예약 작업이 취소되었습니다",body:"한도 회복 대기 예약이 취소되었습니다."},failed:{title:"예약 작업을 시작하지 못했습니다",body:"예약 카드에서 안전한 오류 요약을 확인하세요."}}
  },
  en:{
    title:{approval:"Approval needed","user-input":"Your answer is needed",completed:"Task completed",failed:"Please check the task","host-offline":"Check the execution host connection",handoff:"Handoff result received","quota-started":"Scheduled task started","quota-cancelled":"Scheduled task cancelled","quota-failed":"Scheduled task could not start"},
    body:{approval:"Review the request in Claudex Workhouse.","user-input":"Answer the question in the session to continue.",failed:"Check the redacted error summary in the session."},
    quota:{started:{title:"Scheduled task started",body:"Open the session to follow its progress."},cancelled:{title:"Scheduled task cancelled",body:"The quota-recovery reservation was cancelled."},failed:{title:"Scheduled task could not start",body:"Check the redacted error summary on the reservation card."}}
  },
  ja:{
    title:{approval:"承認が必要です","user-input":"回答が必要です",completed:"タスクが完了しました",failed:"タスクを確認してください","host-offline":"実行ホストの接続を確認してください",handoff:"引き継ぎ結果が届きました","quota-started":"予約タスクを開始しました","quota-cancelled":"予約タスクを取り消しました","quota-failed":"予約タスクを開始できませんでした"},
    body:{approval:"Claudex Workhouseでリクエスト内容を確認してください。","user-input":"セッションで質問に答えるとタスクが続行します。",failed:"セッションで安全なエラー要約を確認してください。"},
    quota:{started:{title:"予約タスクを開始しました",body:"セッションを開いて進行状況を確認してください。"},cancelled:{title:"予約タスクを取り消しました",body:"上限回復待ちの予約を取り消しました。"},failed:{title:"予約タスクを開始できませんでした",body:"予約カードで安全なエラー要約を確認してください。"}}
  }
};
const viewForKind:Record<PushKind,"approval"|"host"|"session"|"reservation">={approval:"approval","user-input":"session",completed:"session",failed:"session","host-offline":"host",handoff:"session","quota-started":"session","quota-cancelled":"reservation","quota-failed":"reservation"};
type Secret={publicKey:string;privateKey:string;encryptionKey:string};
type Subscription={endpoint:string;expirationTime?:number|null;keys:{p256dh:string;auth:string}};
export function pushKindForEvent(type:string){return type==="approval_required"?"approval":type==="user_input_required"?"user-input":type==="task_completed"?"completed":type==="task_failed"?"failed":null;}
function secretFile(root:string){return path.join(root,"data","secrets","push.json");}
function loadSecret(root:string):Secret{const file=secretFile(root);try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{const vapid=webpush.generateVAPIDKeys(),value={...vapid,encryptionKey:crypto.randomBytes(32).toString("base64url")};fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,`${JSON.stringify(value)}\n`,{encoding:"utf8",mode:0o600,flag:"wx"});return value;}}
function encrypt(secret:Secret,value:unknown){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv("aes-256-gcm",Buffer.from(secret.encryptionKey,"base64url"),iv),body=Buffer.concat([cipher.update(JSON.stringify(value),"utf8"),cipher.final()]);return [iv,cipher.getAuthTag(),body].map(item=>item.toString("base64url")).join(".");}
function decrypt(secret:Secret,value:string):Subscription{const [iv,tag,body]=value.split(".").map(item=>Buffer.from(item,"base64url")),decipher=crypto.createDecipheriv("aes-256-gcm",Buffer.from(secret.encryptionKey,"base64url"),iv);decipher.setAuthTag(tag);return JSON.parse(Buffer.concat([decipher.update(body),decipher.final()]).toString("utf8"));}
function endpointHash(endpoint:string){return crypto.createHash("sha256").update(endpoint).digest("hex");}

export class PushManager{
  readonly publicKey:string;private secret:Secret;private sequences=new Map<string,number>();private terminalNotified=new Set<string>();private presence=new Map<string,number>();private timer:NodeJS.Timeout;private starting=true;private stopped=false;private inflight:Promise<void>|null=null;
  constructor(private root:string,private db:DeckDatabase,subject="mailto:claudex-workhouse@example.invalid"){
    this.secret=loadSecret(root);this.publicKey=this.secret.publicKey;webpush.setVapidDetails(subject,this.secret.publicKey,this.secret.privateKey);
    this.timer=setInterval(()=>this.tick(),1000);this.timer.unref?.();this.tick();
  }
  private tick(){if(this.stopped||this.inflight)return;this.inflight=this.poll().then(()=>{this.starting=false;},()=>{/* Keep startup replay suppression until the first successful DB poll. */}).finally(()=>{this.inflight=null;});}
  async preferences(){const stored=await this.db.getSystemSetting("push.preferences");return{...defaults,...(stored?.value??{})} as PushPreferences;}
  async savePreferences(value:Partial<PushPreferences>){const next={...(await this.preferences()),...value};await this.db.putSystemSetting("push.preferences",next,new Date().toISOString());return next;}
  markForeground(browserId:string,visible:boolean){if(!/^[0-9a-f-]{36}$/i.test(browserId))return;if(visible)this.presence.set(browserId,Date.now());else this.presence.delete(browserId);}
  async subscribe(subscription:Subscription,browserLabel:string){const url=new URL(subscription.endpoint);if(url.protocol!=="https:"||subscription.endpoint.length>4096||!subscription.keys?.p256dh||!subscription.keys?.auth)throw Object.assign(new Error("Invalid push subscription."),{statusCode:400});const timestamp=new Date().toISOString();await this.db.upsertPushSubscription({id:crypto.randomUUID(),endpointHash:endpointHash(subscription.endpoint),encryptedJson:encrypt(this.secret,subscription),browserLabel:browserLabel.replace(/[\u0000-\u001f]/g,"").slice(0,80),createdAt:timestamp,lastUsedAt:timestamp});return{enabled:true};}
  async unsubscribe(endpoint:string){await this.db.disablePushSubscription({endpointHash:endpointHash(endpoint),disabledAt:new Date().toISOString()});return{enabled:false};}
  async unsubscribeAll(){await this.db.disableAllPushSubscriptions(new Date().toISOString());return{enabled:false};}
  private quiet(preferences:PushPreferences){if(!preferences.quietStart||!preferences.quietEnd)return false;const now=new Date(),value=`${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;return preferences.quietStart<=preferences.quietEnd?value>=preferences.quietStart&&value<preferences.quietEnd:value>=preferences.quietStart||value<preferences.quietEnd;}
  private async copyFor(){return PUSH_COPY[normalizeStoredLocale((await this.db.getSystemSetting("ui.locale").catch(()=>null))?.value)??"ko"];}
  async send(kind:PushKind,task?:PushTask,event?:StreamEvent,hostId?:string,copy?:{title:string;body:string;tag?:string;reservationId?:string}){const preferences=await this.preferences(),enabled=preferences[preferenceForKind[kind]];if(!enabled||this.quiet(preferences))return;
    const localized=await this.copyFor();
    const title=copy?.title??localized.title[kind];
    const payload=JSON.stringify({kind,title,body:copy?.body??localized.body[kind]??title,tag:copy?.tag??`claudex-workhouse:${kind}:${task?.id??hostId??"system"}`,vibrate:preferences.vibration,deepLink:{taskId:task?.id??null,provider:task?.provider??null,hostId:task?.executionHostId??hostId??null,eventId:event?.eventId??null,reservationId:copy?.reservationId??null,view:viewForKind[kind]}});
    for(const row of await this.db.listPushSubscriptions()){try{await webpush.sendNotification(decrypt(this.secret,row.encryptedJson),payload,{TTL:300,urgency:kind==="approval"||kind==="failed"||kind==="quota-failed"?"high":"normal",topic:crypto.createHash("sha256").update(`${kind}:${task?.id??copy?.reservationId??"system"}`).digest("base64url").slice(0,32)});}catch(error:any){if(error?.statusCode===404||error?.statusCode===410)await this.db.disablePushSubscription({id:row.id,disabledAt:new Date().toISOString()});}}
  }
  async notifyHandoff(task:DeckTask){return this.send("handoff",task);}
  async notifyHostOffline(hostId:string){return this.send("host-offline",undefined,undefined,hostId);}
  async notifyQuotaReservation(state:"started"|"cancelled"|"failed",reservationId:string,task?:DeckTask){
    const kind=state==="started"?"quota-started":state==="cancelled"?"quota-cancelled":"quota-failed";
    const {title,body}=(await this.copyFor()).quota[state];
    return this.send(kind,task,undefined,undefined,{title,body,tag:`claudex-workhouse:quota-reservation:${reservationId}`,reservationId});
  }
  private async poll(){
    if(this.stopped)return;
    const tasks=await this.db.listPushTasks([...this.sequences.keys()]),returned=new Set(tasks.map(task=>task.id));
    for(const task of tasks){
      if(this.stopped)return;
      const replay=readStreamEvents(this.root,task.id,this.sequences.get(task.id)??0,200);
      if(!this.sequences.has(task.id)&&this.starting){this.sequences.set(task.id,replay.latestSequence);continue;}
      for(const event of replay.events){
        if(this.stopped)return;
        const kind=pushKindForEvent(event.type);
        if(kind==="approval"||kind==="user-input")await this.send(kind,task,event);
        else if(kind==="completed"){await this.send("completed",task,event);this.terminalNotified.add(task.id);}
        else if(kind==="failed"){await this.send("failed",task,event);this.terminalNotified.add(task.id);}
        else if(event.type==="task_stopped")this.terminalNotified.add(task.id);
        this.sequences.set(task.id,event.sequence);
      }
      if(replay.replayMissed)this.sequences.set(task.id,replay.latestSequence);
      if(["completed","failed","stopped"].includes(task.status)){
        if(!this.terminalNotified.has(task.id)){if(task.status==="completed")await this.send("completed",task);else if(task.status==="failed")await this.send("failed",task);}
        this.sequences.delete(task.id);this.terminalNotified.delete(task.id);
      }
    }
    for(const taskId of [...this.sequences.keys()])if(!returned.has(taskId)){this.sequences.delete(taskId);this.terminalNotified.delete(taskId);}
  }
  async close(){this.stopped=true;clearInterval(this.timer);await this.inflight?.catch(()=>{});}
}
