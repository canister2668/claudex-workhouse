import type{ProviderId}from"./types.js";

export function persistProviderSystemEvent(provider:ProviderId,subtype:unknown){
  // Compatible endpoints can surface one system event for every thinking token.
  // The content-block path already records one useful "is thinking" summary.
  return provider==="claude"||subtype!=="thinking_tokens";
}
