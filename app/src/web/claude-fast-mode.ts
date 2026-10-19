// Mirrors server/claude-fast-mode.ts: the speed picker offers fast mode only for
// the models that support it (Opus 5.5, Opus 5, Opus 4.8, and "default").
export function claudeFastModeModel(model:string|null|undefined){
  const value=String(model??"default").trim().toLowerCase().replace(/\[1m\]$/,"");
  return value==="default"||value==="opus"||/^claude-opus-(?:5-5|5|4-8)$/.test(value);
}
