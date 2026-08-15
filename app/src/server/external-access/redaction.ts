import{sanitizeSensitiveText,sanitizeSensitiveValue}from"../sensitive-data.js";
const UUID=/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const EMAIL=/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const HOST=/\b(?:[a-z0-9-]+\.)+(?:ts\.net|com|net|org|io|dev|app)\b/gi;
export function redactExternalAccessText(value:unknown){return sanitizeSensitiveText(String(value??"")).replace(EMAIL,"[EMAIL]").replace(UUID,"[UUID]").replace(HOST,"[HOST]");}
export function redactExternalAccessValue<T>(value:T):T{const safe=sanitizeSensitiveValue(value);const walk=(item:any):any=>typeof item==="string"?redactExternalAccessText(item):Array.isArray(item)?item.map(walk):item&&typeof item==="object"?Object.fromEntries(Object.entries(item).map(([key,nested])=>[key,walk(nested)])):item;return walk(safe) as T;}
