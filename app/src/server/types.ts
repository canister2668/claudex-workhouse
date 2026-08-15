export type ProviderId = "codex" | "claude" | "deepseek" | "ollama" | "antigravity" | "grok";
export type TargetExecutionSelection={provider:ProviderId;model?:string|null;reasoningEffort?:string|null;serviceTier?:"priority"|null};
export type HostProviderCapability={provider:ProviderId;create:boolean;resume:boolean;managedSource:boolean;reason:string|null};
export type UnifiedStatus = "pending" | "queued" | "running" | "waiting" | "completed" | "failed" | "stopped" | "unknown";
export type Ownership = "claudex-workhouse" | "external-cx" | "external" | "unknown";
export type SessionSource = "claudex-workhouse" | "cx" | "cli" | "vscode" | "exec" | "appServer" | "unknown";
export type ExecutionHostType = "local" | "worker";
export type ExecutionHostStatus = "online" | "offline" | "connecting" | "degraded" | "disabled" | "unknown";
export type WorkspaceState = "ready" | "unavailable" | "host-offline" | "path-missing" | "permission-denied" | "git-conflict" | "invalid";
export type AgentEventKind = "task_started" | "turn_started" | "message_delta" | "message_completed" | "command_started" | "command_output" | "command_completed" | "file_change_started" | "file_change_completed" | "tool_started" | "tool_progress" | "tool_completed" | "agent_started" | "agent_progress" | "agent_completed" | "agent_failed" | "approval_required" | "approval_resolved" | "user_input_required" | "user_input_resolved" | "context_compaction" | "task_completed" | "task_failed" | "task_stopped" | "message" | "command" | "file_read" | "file_write" | "error" | "mcp_tool_call" | "mcp_tool_result" | "unknown";

export interface AgentEvent {
  type: AgentEventKind;
  content: string;
  provider?: ProviderId;
  serverName?: string;
  toolName?: string;
  status?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

export interface StreamEvent extends AgentEvent {
  sequence: number;
  eventId: string;
  taskId: string;
  threadId: string | null;
  turnId: string | null;
  itemId: string | null;
  terminal: boolean;
}

export interface ProviderCapabilities {
  supportsMcpEvents: boolean;
  supportsEmotionRendering: boolean;
}

export interface ProjectConfig {
  id: string;
  name: string;
  path: string;
  realPath: string;
  enabled: boolean;
  error: string | null;
}

export interface DeckTask {
  id: string;
  provider: ProviderId;
  nativeId: string;
  threadId: string | null;
  projectId: string;
  title: string;
  prompt: string;
  status: UnifiedStatus;
  createdAt: string;
  updatedAt: string;
  result: string | null;
  error: string | null;
  log: string;
  owned: boolean;
  pid: number | null;
  pgid: number | null;
  processStart: string | null;
  commandMarker: string | null;
  parentThreadId: string | null;
  executionHostId?: string | null;
  workspaceId?: string | null;
  remoteWorkerId?: string | null;
  hostTaskId?: string | null;
  providerSessionId?: string | null;
  sourceSessionId?: string | null;
  workChainId?: string | null;
  ownership?: Ownership;
  source?: SessionSource;
  jobId?: string | null;
  cwd?: string | null;
  lastSeenAt?: string | null;
  requestedModel?: string | null;
  effectiveModel?: string | null;
  requestedReasoningEffort?: string | null;
  effectiveReasoningEffort?: string | null;
  requestedServiceTier?: string | null;
  effectiveServiceTier?: string | null;
  permissionProfile?: string | null;
  settingsUpdatedAt?: string | null;
  metadata?: Record<string, unknown>;
  events?: AgentEvent[];
}

export interface CreateTaskInput {
  project: ProjectConfig;
  prompt: string;
  title?: string;
  model?: string | null;
  reasoningEffort?: string | null;
  serviceTier?: string | null;
  permissionProfile?: string | null;
  workMode?: "default" | "plan" | null;
  runtimeProfile?: "default" | "conversation" | "browser" | null;
  automationLevel?: "full" | "auto" | "confirm" | "read" | null;
  executionHostId?: string | null;
  workspaceId?: string | null;
  requestedNativeId?: string | null;
  googleSearchMode?: "off" | "auto" | "always";
  workChainId?: string | null;
  boardRole?: "implementer" | "revision" | null;
}

export interface ExecutionHost {
  id: string;
  type: ExecutionHostType;
  name: string;
  displayName: string;
  platform: string;
  architecture: string;
  operatingSystemVersion: string | null;
  workerVersion: string | null;
  status: ExecutionHostStatus;
  capabilities: Record<string, unknown>;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
  disabledAt: string | null;
  revokedAt: string | null;
}

export interface WorkspaceRoot {
  id: string;
  hostId: string;
  displayName: string;
  canonicalPath: string;
  allowCreate: boolean;
  allowRegister: boolean;
  allowClone: boolean;
  allowDelete: boolean;
  createdAt: string;
  verifiedAt: string | null;
  disabledAt: string | null;
}

export interface LogicalProject {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  defaultProvider: ProviderId | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface Workspace {
  id: string;
  projectId: string;
  hostId: string;
  rootId: string;
  relativePath: string;
  canonicalPath: string;
  displayName: string;
  workspaceType: "existing" | "empty" | "git-init" | "git-clone" | "git-worktree";
  gitRemote: string | null;
  defaultBranch: string | null;
  lastKnownCommit: string | null;
  lastGitStatus: Record<string, unknown> | null;
  state?: WorkspaceState;
  lastVerifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export type CollaborationBoardStatus = "queued" | "in_progress" | "review" | "approval" | "completed";
export type CollaborationBoardPriority = "low" | "normal" | "high" | "urgent";
export type CollaborationBoardRole = {
  provider: ProviderId;
  model?: string | null;
  reasoningEffort?: string | null;
  serviceTier?: string | null;
  permissionProfile?: string | null;
  workMode?: "default" | "plan";
  automationLevel?: "full" | "auto" | "confirm" | "read";
  googleSearchMode?: "off" | "auto" | "always";
};
export type CollaborationBoardRoles = {
  implementer?: CollaborationBoardRole;
  reviewer?: CollaborationBoardRole;
  secondaryReviewer?: CollaborationBoardRole;
};
export type CollaborationBoardAutomationStage = "work" | "review" | "revision" | "approval";
export type CollaborationBoardAutomation = {
  mode: "manual" | "auto";
  state: "idle" | "running" | "stopping" | "paused" | "blocked";
  stage: CollaborationBoardAutomationStage | null;
  stopAfter: "work" | "review" | null;
  round: number;
  approvedProviders: ProviderId[];
  fullAccessAcknowledged: boolean;
  pauseReason: string | null;
  lastSessionId: string | null;
  startedAt: string | null;
};

export interface WorkChain {
  id: string;
  projectId: string;
  title: string;
  rootSessionId: string | null;
  activeSessionId: string | null;
  boardVisible: boolean;
  description: string;
  boardStatus: CollaborationBoardStatus;
  priority: CollaborationBoardPriority;
  workspaceId: string | null;
  targetBranch: string | null;
  roles: CollaborationBoardRoles;
  automation: CollaborationBoardAutomation;
  lastActivityAt: string | null;
  completedAt: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface WorkChainEvent {
  id: string;
  chainId: string;
  eventType: string;
  taskId: string | null;
  collaborationSessionId: string | null;
  actorType: string;
  actorId: string | null;
  dedupeKey: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface AgentProvider {
  readonly id: ProviderId;
  readonly capabilities: ProviderCapabilities;
  listTasks(scope?: "all"): Promise<DeckTask[]>;
  getTask(task: DeckTask): Promise<DeckTask>;
  createTask(input: CreateTaskInput): Promise<DeckTask>;
  sendMessage(task: DeckTask, prompt: string): Promise<DeckTask>;
  compactThread(task: DeckTask): Promise<DeckTask>;
  forkThread(task: DeckTask): Promise<DeckTask>;
  stopTask(task: DeckTask): Promise<DeckTask>;
  deleteSession(task:DeckTask):Promise<{threadId:string;deleted:boolean;deletedTasks:number}>;
  healthCheck(): Promise<{ ok: boolean; detail: unknown }>;
}

export type CollaborationMode = "parallel" | "review" | "assist" | "debate";
export type CollaborationStatus = "draft" | "starting" | "running" | "waiting-user" | "partial" | "completed" | "failed" | "cancel-requested" | "cancelled" | "stop-unconfirmed" | "archived";
export type CollaborationRunStatus = "queued" | "starting" | "running" | "waiting-user" | "waiting-approval" | "completed" | "failed" | "timed-out" | "cancel-requested" | "cancelled" | "stop-unconfirmed";
export type CollaborationPermissionMode = "read" | "plan" | "write";

export interface CollaborationSession {
  id: string; projectId: string; title: string; mode: CollaborationMode;
  status: CollaborationStatus; outcome: string | null; primaryParticipantId: string | null;
  maxCalls: number; currentCallCount: number; currentStep: string; timeoutAt: string;
  maxTurnsPerParticipant: number | null; currentTurnCounts: Record<ProviderId,number>;
  controllerGeneration: number; workChainId: string | null; sourceTaskId: string | null;
  createdAt: string; updatedAt: string; completedAt: string | null; cancelledAt: string | null;
  archivedAt: string | null; metadata: Record<string, unknown>; revision: number;
}

export interface CollaborationParticipant {
  id: string; collaborationSessionId: string; provider: ProviderId;
  role: "primary" | "reviewer" | "assistant" | "debater"; executionHostId: string; workspaceId: string;
  providerSessionId: string | null; sourceTaskId: string | null; permissionMode: CollaborationPermissionMode;
  status: string; sessionGeneration: number; capabilitySnapshot: Record<string, unknown>;
  createdAt: string; updatedAt: string; archivedAt: string | null;
}

export interface CollaborationRun {
  id: string; collaborationSessionId: string; participantId: string; round: number; sequence: number;
  attempt: number; purpose: string; sourceParticipantId: string | null; targetParticipantId: string | null;
  providerTaskId: string | null; status: CollaborationRunStatus; deadlineAt: string; inputChecksum: string;
  relayArtifactId: string | null; generation: number; lastEventSequence: number; errorCategory: string | null;
  startedAt: string | null; completedAt: string | null; failedAt: string | null; cancelledAt: string | null;
  createdAt: string; updatedAt: string;
}

export interface CollaborationMessage {
  id: string; collaborationSessionId: string; participantId: string | null; runId: string | null;
  round: number; messageType: string; sourceMessageId: string | null; providerMessageId: string | null;
  providerTaskId: string | null; contentKind: string; contentRef: string; checksum: string;
  status: string; createdAt: string;
}

export interface RelayArtifact {
  id: string; collaborationSessionId: string; sourceParticipantId: string | null; targetParticipantId: string;
  sourceRunId: string | null; sourceProvider: ProviderId | "user"; targetProvider: ProviderId;
  sourceSessionId: string | null; sourceTaskId: string | null; sourceCommit: string | null;
  sourceBranch: string | null; dirty: boolean; changedFiles: string[]; diffChecksum: string | null;
  permissionMode: CollaborationPermissionMode; path: string; checksum: string; sizeBytes: number;
  schemaVersion: number; status: string; createdAt: string; deliveredAt: string | null; expiresAt: string;
}

export interface CollaborationAvatarState {
  collaborationSessionId: string; participantId: string; sourceRunId: string; generation: number;
  utteranceType: string; line: string; emotion: string; activity: string; source: "server-state";
  priority: number; version: number; createdAt: string; expiresAt: string | null;
}
