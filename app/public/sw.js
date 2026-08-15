// Push-only service worker. It deliberately has no fetch handler and never
// creates a cache: application HTML, API responses and transcripts always go
// to the network, preserving the stale-shell kill-switch guarantee.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try { const keys = await caches.keys(); await Promise.all(keys.map((key) => caches.delete(key))); } catch {}
    await self.clients.claim();
  })());
});
self.addEventListener("push", (event) => {
  let data={};try{data=event.data?.json()??{};}catch{}
  const allowed=new Set(["approval","user-input","completed","failed","host-offline","handoff","quota-started","quota-cancelled","quota-failed"]);if(!allowed.has(data.kind))return;
  const options={body:String(data.body??"").slice(0,160),tag:String(data.tag??`claudex-workhouse:${data.kind}`).slice(0,120),renotify:data.kind==="approval",data:{deepLink:data.deepLink??{}},icon:"/icons/icon-192.png",badge:"/icons/icon-192.png",vibrate:data.vibrate?[100,80,100]:undefined};
  // Chrome on Android can briefly retain a stale `visible` state after the
  // operator switches to another tab. Only a Workhouse window that actually
  // owns browser focus should suppress the system notification.
  event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});if(windows.some(client=>client.focused===true))return;await self.registration.showNotification(String(data.title??"Claudex Workhouse").slice(0,80),options);})());
});
self.addEventListener("notificationclick",(event)=>{event.notification.close();const d=event.notification.data?.deepLink??{},params=new URLSearchParams();if(typeof d.taskId==="string")params.set("task",d.taskId);if(d.provider==="codex"||d.provider==="claude")params.set("provider",d.provider);if(typeof d.hostId==="string")params.set("host",d.hostId);if(typeof d.eventId==="string")params.set("event",d.eventId);if(typeof d.reservationId==="string")params.set("reservation",d.reservationId);if(["approval","host","session","reservation"].includes(d.view))params.set("view",d.view);const target=`/?${params}`;event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});const existing=windows.find(client=>new URL(client.url).origin===self.location.origin);if(existing){await existing.navigate(target);return existing.focus();}return self.clients.openWindow(target);})());});
