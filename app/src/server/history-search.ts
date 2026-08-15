export type HistoryMatchField="title"|"prompt"|"result"|"error";
export type HistorySearchResult={
  id:string;
  source:"workhouse"|"codex";
  provider:"codex"|"claude";
  taskId:string|null;
  threadId:string|null;
  projectId:string|null;
  workspaceId:string|null;
  title:string;
  status:string;
  updatedAt:string;
  matchField:HistoryMatchField|"provider";
  snippet:string;
  before:string;
  match:string;
  after:string;
};
