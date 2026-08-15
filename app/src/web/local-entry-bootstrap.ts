export function localEntryTokenFromHash(hash:string){
  const params=new URLSearchParams(hash.startsWith("#")?hash.slice(1):hash),token=params.get("entry");
  return token&&(/^[0-9a-f]{64}$/i.test(token)||/^[A-Za-z0-9_-]{43}$/.test(token))?token:null;
}
export async function exchangeLocalEntryFragment(location:Pick<Location,"hash"|"pathname"|"search">,history:Pick<History,"replaceState">,request:typeof fetch=fetch){
  const token=localEntryTokenFromHash(location.hash);if(!token)return false;
  const response=await request("/api/local-entry/exchange",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({token})});
  if(!response.ok){
    if([400,403,409].includes(response.status))history.replaceState(null,"",`${location.pathname}${location.search}`);
    throw Object.assign(new Error(`Local entry exchange failed (${response.status}).`),{status:response.status});
  }
  history.replaceState(null,"",`${location.pathname}${location.search}`);
  return true;
}
