export type RefreshProvider="codex"|"claude"|"antigravity"|"deepseek"|"ollama"|"grok";

export function shouldApplyProviderSnapshot(partial:boolean,incomingCount:number,currentCount:number){
  return !partial||incomingCount>0||currentCount===0;
}

export function createProviderRefreshCoordinator(){
  const requested:Record<RefreshProvider,number>={codex:0,claude:0,grok:0,antigravity:0,deepseek:0,ollama:0};
  const applied:Record<RefreshProvider,number>={codex:0,claude:0,grok:0,antigravity:0,deepseek:0,ollama:0};
  return{
    reserve(providers:RefreshProvider[]){
      const ticket={} as Record<RefreshProvider,number>;
      for(const provider of providers)ticket[provider]=++requested[provider];
      return ticket;
    },
    apply(provider:RefreshProvider,ticket:number,write:()=>void){
      if(!Number.isFinite(ticket)||ticket<applied[provider])return false;
      write();applied[provider]=ticket;return true;
    },
    state(){return{requested:{...requested},applied:{...applied}};}
  };
}
