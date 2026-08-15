export function newestSessionItems<T extends {updatedAt:string;kind:string;id:string}>(items:T[]):T[]{
  return [...items].sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id));
}
