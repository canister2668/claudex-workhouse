import Fastify from "fastify";
import {it,expect} from "vitest";
import {AccessActivity,registerAccessActivity} from "../../src/server/security/access-activity.js";
const request=(headers:Record<string,string>={})=>({ip:"127.0.0.1",raw:{socket:{remoteAddress:"127.0.0.1"}},headers}) as any;
it("groups activity, expires idle clients and excludes credentials",()=>{
 let now=0;const activity=new AccessActivity(()=>now),req=request({cookie:"secret"});
 activity.observe(req,"owner");now=1000;activity.observe(req,"owner");
 const result=activity.snapshot(req,"owner");expect(result.entries).toHaveLength(1);expect(result.entries[0].current).toBe(true);expect(result.entries[0].firstSeenAt).toBe(new Date(0).toISOString());expect(JSON.stringify(result)).not.toContain("secret");now+=300000;expect(activity.snapshot(req,"owner").entries).toHaveLength(0);
});
it("preserves socket evidence and validates unverified header addresses",()=>{
 const activity=new AccessActivity(),req=request({'cf-connecting-ip':'2001:db8::1'});activity.observe(req,"owner");
 expect(activity.snapshot(req,"owner").entries[0]).toMatchObject({peerIp:"127.0.0.1",reportedIp:"2001:db8::1",source:"cf-connecting-ip"});
 activity.observe(request({'cf-connecting-ip':'invalid'}),"owner");expect(activity.snapshot(req,"owner").entries[0].reportedIp).toBeNull();
});
it("bounds groups",()=>{const activity=new AccessActivity();for(let i=0;i<510;i++)activity.observe(request({'user-agent':String(i)}),"owner");expect(activity.snapshot(request(),"owner").entries).toHaveLength(500);});
it("requires authentication and prevents caching",async()=>{
 const app=Fastify();app.addHook("onRequest",async(req,reply)=>{if(req.headers.authorization!=="test")return reply.code(403).send();(req as any).actor="owner";});registerAccessActivity(app);
 try{expect((await app.inject('/api/security/access-activity')).statusCode).toBe(403);const response=await app.inject({url:'/api/security/access-activity',headers:{authorization:'test'}});expect(response.statusCode).toBe(200);expect(response.headers['cache-control']).toBe('no-store');expect(response.json().entries).toHaveLength(1);}finally{await app.close();}
});
