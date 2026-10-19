// Claude Code fast mode: the same Opus model served faster at a higher token
// price. It is chosen per session like the Codex speed tier: a task whose
// requestedServiceTier is "priority" runs with `--settings {"fastMode":true}`
// (Claude Code 2.1.205+). On a subscription it is billed to usage credits,
// never to the plan's included usage; with an API key it is billed to the
// Console organization, which needs fast mode access provisioned.

/**
 * Fast mode exists only on Opus 5.5, Opus 5, and Opus 4.8. "default" and the
 * bare "opus" alias resolve to the CLI's current Opus, which supports it.
 * Anything else (Sonnet, Haiku, Opus 4.7, Fable) runs at standard speed, so
 * the flag is not passed rather than letting the CLI switch the model.
 */
export function claudeModelSupportsFastMode(model:string|null|undefined){
  const value=String(model??"default").trim().toLowerCase().replace(/\[1m\]$/,"");
  return value==="default"||value==="opus"||/^claude-opus-(?:5-5|5|4-8)$/.test(value);
}
