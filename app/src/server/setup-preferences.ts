export type SetupPreferences={version:1;showOnStartup:boolean};

export const DEFAULT_SETUP_PREFERENCES:SetupPreferences={version:1,showOnStartup:true};

export function normalizeSetupPreferences(value:unknown):SetupPreferences{
  const candidate=value as Partial<SetupPreferences>|null;
  return{version:1,showOnStartup:candidate?.showOnStartup!==false};
}

export function setupPanelRequired(progress:unknown,preferences:SetupPreferences){
  return preferences.showOnStartup&&(progress as any)?.completed!==true;
}
