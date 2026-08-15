import { z } from "zod";

export const WORKER_PROTOCOL_VERSION = 1;
export const WORKER_UPDATER_PROTOCOL_VERSION = 1;
export const WORKER_MAX_MESSAGE_BYTES = 1024 * 1024;
export const WORKER_COMMANDS = [
  "host.capabilities.read","host.diagnostics.read","host.credential.rotate","host.update.apply","provider.status.read","provider.binary.select","provider.sessions.list","provider.capabilities.read","provider.thread.command",
  "provider.task.start","provider.task.stop","provider.task.status","provider.session.resume","provider.session.fork","provider.session.compact","provider.session.delete","provider.userInput.list","provider.userInput.respond",
  "provider.approvals.list","provider.approval.respond","provider.session.control",
  "task.image-output.prepare","task.image-output.chunk","task.image-output.cancel",
  "git.host.status","git.host.identity","git.github.repositories",
  "workspace.list","workspace.browse","workspace.create","workspace.register","workspace.update","workspace.git.clone","workspace.git.worktree","workspace.git.status","workspace.git.diff","workspace.git.diff-path","workspace.git.operation","workspace.git.log","workspace.git.branches","workspace.github.pr.preview","workspace.github.pr.create","workspace.files.browse","workspace.files.resolve","workspace.files.edit.read","workspace.files.write","workspace.files.read","workspace.files.download.prepare","workspace.files.download.chunk","workspace.files.download.cancel","workspace.unregister","workspace.delete",
  "handoff.receive","handoff.receive.begin","handoff.receive.chunk","handoff.receive.complete","handoff.patch.prepare","handoff.patch.chunk"
] as const;
export type WorkerCommand = typeof WORKER_COMMANDS[number];

const id = z.string().uuid();
export const workerHelloSchema = z.object({type:z.literal("auth.response"),hostId:z.union([z.string().uuid(),z.literal("local")]),challengeId:id,response:z.string().regex(/^[a-f0-9]{64}$/),sequence:z.literal(1),workerVersion:z.string().trim().min(1).max(40),packageSha256:z.string().regex(/^[a-f0-9]{64}$/).nullable(),updaterProtocolVersion:z.number().int().min(1).max(1_000_000)}).strict();
export const workerMessageSchema = z.discriminatedUnion("type",[
  z.object({type:z.literal("heartbeat"),generation:id,sequence:z.number().int().positive(),sentAt:z.string().datetime(),snapshot:z.record(z.string(),z.unknown()).optional()}).strict(),
  z.object({type:z.literal("response"),generation:id,sequence:z.number().int().positive(),requestId:id,ok:z.boolean(),result:z.unknown().optional(),error:z.object({code:z.string().max(80),message:z.string().max(500)}).optional()}).strict(),
  z.object({type:z.literal("event"),generation:id,sequence:z.number().int().positive(),eventId:z.string().min(1).max(200),taskId:z.string().min(1).max(200),event:z.record(z.string(),z.unknown())}).strict(),
  z.object({type:z.literal("snapshot"),generation:id,sequence:z.number().int().positive(),tasks:z.array(z.record(z.string(),z.unknown())).max(1000),capabilities:z.record(z.string(),z.unknown())}).strict()
]);

export interface WorkerRequestMessage {type:"request";generation:string;sequence:number;requestId:string;command:WorkerCommand;payload:unknown;idempotencyKey:string;}

export function safeWorkerError(error:unknown) {
  const text=error instanceof Error?error.message:String(error);
  if(/timeout/i.test(text))return{code:"WORKER_TIMEOUT",message:"The worker response timed out."};
  if(/offline|closed|socket/i.test(text))return{code:"HOST_OFFLINE",message:"The target host is offline."};
  return{code:"WORKER_COMMAND_FAILED",message:"The worker command could not be completed."};
}
