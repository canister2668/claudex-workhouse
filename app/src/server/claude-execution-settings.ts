import {z} from "zod";

export const claudeExecutionSettingsSchema=z.object({
  version:z.literal(1),
  switchModelsOnFlag:z.boolean()
}).strict();

export type ClaudeExecutionSettings=z.infer<typeof claudeExecutionSettingsSchema>;

export const DEFAULT_CLAUDE_EXECUTION_SETTINGS:ClaudeExecutionSettings={
  version:1,
  switchModelsOnFlag:true
};

export function normalizeClaudeExecutionSettings(value:unknown):ClaudeExecutionSettings{
  const parsed=claudeExecutionSettingsSchema.safeParse(value);
  return parsed.success?parsed.data:DEFAULT_CLAUDE_EXECUTION_SETTINGS;
}
