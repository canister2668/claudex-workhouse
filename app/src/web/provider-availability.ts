// Connection state — not session history — decides whether a provider may take
// new work. A provider becomes selectable only once the connection snapshot has
// actually loaded and reports "connected"; "disconnected", "unavailable",
// "unknown", and a missing account row all mean a new session would fail, so
// they are never treated as creatable.
//
// Existing sessions are deliberately outside this module's concern: the session
// list, session detail, and history stay reachable for every provider that ever
// ran, including ones that are disconnected today.

export type ProviderConnectionState = "connected" | "disconnected" | "unavailable" | "unknown";
export type ProviderConnectionAccount<P extends string = string> = { provider: P; state?: ProviderConnectionState | string | null };

export type ProviderAvailability<P extends string = string> = {
  /** The connection snapshot has been fetched at least once. */
  loaded: boolean;
  /** Providers that can start new work, in the caller's display order. */
  connected: readonly P[];
};

export type ProviderAvailabilityPhase = "loading" | "none" | "ready";

export function providerAvailability<P extends string>(order:readonly P[],accounts:readonly ProviderConnectionAccount<P>[]|null|undefined,loaded:boolean):ProviderAvailability<P>{
  // Before the first successful load nothing is claimed as connected, but the
  // phase stays "loading" so callers render a checking state instead of the
  // "nothing is connected" guidance.
  if(!loaded)return{loaded:false,connected:[]};
  const connected=new Set((accounts??[]).filter(item=>item&&item.state==="connected").map(item=>item.provider));
  return{loaded:true,connected:order.filter(provider=>connected.has(provider))};
}

export function providerAvailabilityPhase(availability:ProviderAvailability):ProviderAvailabilityPhase{
  if(!availability.loaded)return"loading";
  return availability.connected.length?"ready":"none";
}

export function providerConnected<P extends string>(availability:ProviderAvailability<P>,provider:P):boolean{
  return availability.loaded&&availability.connected.includes(provider);
}

export type CreationKind = "single" | "conversation" | "parallel" | "review";
export type CreationSelection<P extends string = string> = { kind: CreationKind; provider: P; participants: readonly P[] };
export type CreationBlock = "connections-loading" | "provider-not-connected" | "participants-not-connected" | "needs-two-participants";

/**
 * The single invariant every creation path checks — the rendered controls, the
 * submit buttons, and the request functions themselves. Returning a reason
 * rather than a boolean keeps the keyboard and programmatic paths from
 * re-deriving a weaker version of the rule.
 */
export function creationBlockReason<P extends string>(selection:CreationSelection<P>,availability:ProviderAvailability<P>):CreationBlock|null{
  if(!availability.loaded)return"connections-loading";
  if(selection.kind==="single")return providerConnected(availability,selection.provider)?null:"provider-not-connected";
  if(!selection.participants.length)return"participants-not-connected";
  if(selection.participants.some(provider=>!availability.connected.includes(provider)))return"participants-not-connected";
  if(!providerConnected(availability,selection.provider))return"provider-not-connected";
  if(selection.kind!=="conversation"&&selection.participants.length<2)return"needs-two-participants";
  return null;
}

/** Keeps a stored default usable: falls back to the first connected provider. */
export function fallbackProvider<P extends string>(preferred:P,availability:ProviderAvailability<P>):P{
  if(!availability.loaded||availability.connected.includes(preferred))return preferred;
  return availability.connected[0]??preferred;
}

/** Enabled participants restricted to connected providers, order preserved. */
export function participantList<P extends string>(order:readonly P[],enabled:Partial<Record<P,boolean>>,availability:ProviderAvailability<P>):P[]{
  const pool=availability.loaded?order.filter(provider=>availability.connected.includes(provider)):[...order];
  return pool.filter(provider=>enabled[provider]);
}

/**
 * Reconciles a stored participant selection against the connected providers.
 * Disconnected participants are dropped; if that leaves fewer than `minimum`,
 * connected providers are enabled from the front of the display order so the
 * panel never collapses into an unusable empty selection.
 */
export function connectedParticipants<P extends string>(order:readonly P[],enabled:Partial<Record<P,boolean>>,availability:ProviderAvailability<P>,minimum=1):Record<P,boolean>{
  const result=Object.fromEntries(order.map(provider=>[provider,false])) as Record<P,boolean>;
  if(!availability.loaded){for(const provider of order)result[provider]=Boolean(enabled[provider]);return result;}
  for(const provider of availability.connected)if(enabled[provider])result[provider]=true;
  let count=order.filter(provider=>result[provider]).length;
  for(const provider of availability.connected){
    if(count>=minimum)break;
    if(result[provider])continue;
    result[provider]=true;count++;
  }
  return result;
}
