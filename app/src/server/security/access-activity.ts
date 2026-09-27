import { isIP } from "node:net";
import type { FastifyInstance, FastifyRequest } from "fastify";

const WINDOW_MS = 5 * 60_000;
const MAX_ENTRIES = 500;
type Entry = { actor:string; peerIp:string; reportedIp:string|null; source:string|null; userAgent:string; firstSeenAt:number; lastSeenAt:number };

// Activity is deliberately not a login/session inventory. Never retain credentials.
export class AccessActivity {
  private entries = new Map<string, Entry>();
  constructor(private now = Date.now) {}
  private prune() {
    for (const [key, entry] of this.entries) if (this.now() - entry.lastSeenAt >= WINDOW_MS) this.entries.delete(key);
  }
  private identity(request: FastifyRequest, actor:string) {
    const peerIp = request.raw.socket.remoteAddress || request.ip;
    let reportedIp:string|null = null, source:string|null = null;
    // These headers are display-only, not verified identity or authorization input.
    for (const name of ["cf-connecting-ip", "x-forwarded-for", "x-real-ip"]) {
      const value = request.headers[name];
      const candidate = typeof value === "string" ? value.split(",")[0].trim() : "";
      if (isIP(candidate)) { reportedIp = candidate; source = name; break; }
    }
    const userAgent = String(request.headers["user-agent"] ?? "").slice(0, 300);
    return {actor, peerIp, reportedIp, source, userAgent};
  }
  observe(request: FastifyRequest, actor:string) {
    this.prune();
    const identity = this.identity(request, actor), key = JSON.stringify(identity), now = this.now();
    const previous = this.entries.get(key);
    this.entries.delete(key);
    this.entries.set(key, {...identity, firstSeenAt:previous?.firstSeenAt ?? now, lastSeenAt:now});
    if (this.entries.size > MAX_ENTRIES) this.entries.delete(this.entries.keys().next().value!);
  }
  snapshot(request:FastifyRequest, actor:string) {
    this.prune();
    const current = JSON.stringify(this.identity(request, actor));
    return {windowSeconds:WINDOW_MS / 1000, entries:[...this.entries].reverse().map(([key, entry]) => ({
      ...entry, firstSeenAt:new Date(entry.firstSeenAt).toISOString(), lastSeenAt:new Date(entry.lastSeenAt).toISOString(), current:key === current
    }))};
  }
}

export function registerAccessActivity(app:FastifyInstance) {
  const activity = new AccessActivity();
  // Registered after authentication; rejected/public requests have no actor.
  app.addHook("onRequest", async request => {
    const actor = (request as FastifyRequest & {actor?:string}).actor;
    if (actor) activity.observe(request, actor);
  });
  app.get("/api/security/access-activity", async (request, reply) => {
    const actor = (request as FastifyRequest & {actor?:string}).actor;
    if (!actor) return reply.code(403).send({error:"Authentication required"});
    reply.header("Cache-Control", "no-store");
    return activity.snapshot(request, actor);
  });
}
