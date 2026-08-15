export type WindowsBootstrapStageState="pending"|"running"|"ready"|"attention"|"failed";
export type WindowsBootstrapStage={id:"payload"|"data"|"database"|"server"|"worker"|"provider"|"workspace";state:WindowsBootstrapStageState;detail:string;remediation:null|"retry"|"open-provider-guide"|"open-workspace-settings"};

export function buildWindowsBootstrapStatus(input:{
  payloadReady:boolean;
  dataReady:boolean;
  databaseReady:boolean;
  serverReady:boolean;
  workerStatus:"connecting"|"online"|"offline"|"failed";
  providers:Partial<Record<"codex"|"claude","not-found"|"login-required"|"diagnostic-required"|"ready">>;
  workspaceCount:number;
  internalUrl:string;
  externalUrl:string|null;
}){
  const providerStates=Object.values(input.providers),providerReady=providerStates.some(value=>value==="ready"),providerKnown=providerStates.length>0;
  const stages:WindowsBootstrapStage[]=[
    {id:"payload",state:input.payloadReady?"ready":"failed",detail:input.payloadReady?"payload-verified":"payload-unavailable",remediation:input.payloadReady?null:"retry"},
    {id:"data",state:input.dataReady?"ready":"failed",detail:input.dataReady?"data-protected":"data-unavailable",remediation:input.dataReady?null:"retry"},
    {id:"database",state:input.databaseReady?"ready":"failed",detail:input.databaseReady?"database-ready":"database-unavailable",remediation:input.databaseReady?null:"retry"},
    {id:"server",state:input.serverReady?"ready":"running",detail:input.serverReady?"loopback-ready":"server-starting",remediation:null},
    {id:"worker",state:input.workerStatus==="online"?"ready":input.workerStatus==="connecting"?"running":"failed",detail:`worker-${input.workerStatus}`,remediation:input.workerStatus==="offline"||input.workerStatus==="failed"?"retry":null},
    {id:"provider",state:providerReady?"ready":providerKnown?"attention":"pending",detail:providerReady?"provider-ready":providerKnown?"provider-action-required":"provider-check-pending",remediation:providerReady?null:"open-provider-guide"},
    {id:"workspace",state:input.workspaceCount>0?"ready":"attention",detail:input.workspaceCount>0?"workspace-ready":"workspace-required",remediation:input.workspaceCount>0?null:"open-workspace-settings"}
  ];
  const failed=stages.some(item=>item.state==="failed"),running=stages.some(item=>item.state==="running"||item.state==="pending"),attention=stages.some(item=>item.state==="attention");
  return{
    schemaVersion:1,
    overall:failed?"failed":running?"starting":attention?"attention":"ready",
    stages,
    links:{
      internal:input.internalUrl,
      external:input.externalUrl,
      providers:{
        codex:"/?new=1&provider=codex&host=local",
        claude:"/?new=1&provider=claude&host=local"
      }
    }
  };
}
