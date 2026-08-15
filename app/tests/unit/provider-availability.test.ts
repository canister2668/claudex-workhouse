import { describe, expect, it } from "vitest";
import { connectedParticipants, creationBlockReason, fallbackProvider, participantList, providerAvailability, providerAvailabilityPhase, providerConnected } from "../../src/web/provider-availability.js";

type Provider = "codex" | "claude" | "grok" | "antigravity" | "deepseek" | "ollama";
const ORDER: Provider[] = ["codex", "claude", "grok", "antigravity", "deepseek", "ollama"];
const account = (provider: Provider, state: string) => ({ provider, state });

describe("provider availability", () => {
  it("only treats a loaded connected account as creatable", () => {
    const accounts = [account("codex","connected"),account("claude","disconnected"),account("grok","unavailable"),account("antigravity","unknown")];
    const availability = providerAvailability(ORDER, accounts, true);
    expect(availability.connected).toEqual(["codex"]);
    expect(providerConnected(availability,"codex")).toBe(true);
    for(const provider of ["claude","grok","antigravity","deepseek","ollama"] as Provider[])expect(providerConnected(availability,provider)).toBe(false);
  });

  it("treats a missing account row as not creatable", () => {
    expect(providerAvailability(ORDER,[account("codex","connected")],true).connected).toEqual(["codex"]);
  });

  it("keeps display order regardless of account order", () => {
    const accounts = [account("ollama","connected"),account("codex","connected"),account("grok","connected")];
    expect(providerAvailability(ORDER,accounts,true).connected).toEqual(["codex","grok","ollama"]);
  });

  it("reports a loading phase before the first snapshot instead of an empty one", () => {
    const loading = providerAvailability(ORDER,[],false);
    expect(providerAvailabilityPhase(loading)).toBe("loading");
    expect(providerConnected(loading,"codex")).toBe(false);
    expect(providerAvailabilityPhase(providerAvailability(ORDER,[account("codex","disconnected")],true))).toBe("none");
    expect(providerAvailabilityPhase(providerAvailability(ORDER,[account("codex","connected")],true))).toBe("ready");
  });

  it("falls back to a connected provider when the stored default disconnected", () => {
    const availability = providerAvailability(ORDER,[account("claude","connected"),account("codex","disconnected")],true);
    expect(fallbackProvider("codex" as Provider,availability)).toBe("claude");
    expect(fallbackProvider("claude" as Provider,availability)).toBe("claude");
  });

  it("keeps the requested provider while the snapshot is still loading", () => {
    expect(fallbackProvider("codex" as Provider,providerAvailability(ORDER,[],false))).toBe("codex");
  });

  it("keeps the requested provider when nothing is connected so the disabled UI stays stable", () => {
    expect(fallbackProvider("codex" as Provider,providerAvailability(ORDER,[account("codex","disconnected")],true))).toBe("codex");
  });

  it("blocks every creation kind until the connection snapshot loads", () => {
    const loading = providerAvailability(ORDER,[],false);
    expect(creationBlockReason({kind:"single",provider:"codex" as Provider,participants:["codex" as Provider]},loading)).toBe("connections-loading");
    expect(creationBlockReason({kind:"conversation",provider:"codex" as Provider,participants:["codex" as Provider,"claude" as Provider]},loading)).toBe("connections-loading");
  });

  it("blocks a single session on a provider that is not connected", () => {
    const availability = providerAvailability(ORDER,[account("codex","connected"),account("claude","unavailable")],true);
    expect(creationBlockReason({kind:"single",provider:"codex" as Provider,participants:["codex" as Provider]},availability)).toBeNull();
    expect(creationBlockReason({kind:"single",provider:"claude" as Provider,participants:["claude" as Provider]},availability)).toBe("provider-not-connected");
  });

  it("blocks a conversation whose participants or first responder went offline", () => {
    const availability = providerAvailability(ORDER,[account("codex","connected"),account("grok","connected")],true);
    expect(creationBlockReason({kind:"conversation",provider:"codex" as Provider,participants:["codex" as Provider,"grok" as Provider]},availability)).toBeNull();
    expect(creationBlockReason({kind:"conversation",provider:"codex" as Provider,participants:["codex" as Provider,"claude" as Provider]},availability)).toBe("participants-not-connected");
    expect(creationBlockReason({kind:"conversation",provider:"claude" as Provider,participants:["codex" as Provider]},availability)).toBe("provider-not-connected");
    expect(creationBlockReason({kind:"conversation",provider:"codex" as Provider,participants:[]},availability)).toBe("participants-not-connected");
  });

  it("requires two connected participants for parallel and cross review", () => {
    const availability = providerAvailability(ORDER,[account("codex","connected"),account("grok","connected")],true);
    expect(creationBlockReason({kind:"review",provider:"codex" as Provider,participants:["codex" as Provider,"grok" as Provider]},availability)).toBeNull();
    expect(creationBlockReason({kind:"parallel",provider:"codex" as Provider,participants:["codex" as Provider]},availability)).toBe("needs-two-participants");
    expect(creationBlockReason({kind:"conversation",provider:"codex" as Provider,participants:["codex" as Provider]},availability)).toBeNull();
  });

  it("drops disconnected participants from an enabled selection", () => {
    const availability = providerAvailability(ORDER,[account("codex","connected"),account("ollama","connected")],true);
    expect(participantList(ORDER,{codex:true,claude:true,ollama:true},availability)).toEqual(["codex","ollama"]);
  });

  it("shows every enabled participant while the snapshot loads", () => {
    expect(participantList(ORDER,{codex:true,claude:true},providerAvailability(ORDER,[],false))).toEqual(["codex","claude"]);
  });

  it("refills a stored participant set that lost its providers", () => {
    const availability = providerAvailability(ORDER,[account("grok","connected"),account("ollama","connected")],true);
    const next = connectedParticipants(ORDER,{codex:true,claude:true},availability,2);
    expect(next).toEqual({codex:false,claude:false,grok:true,antigravity:false,deepseek:false,ollama:true});
  });

  it("keeps a still-connected participant and tops the rest up to the minimum", () => {
    const availability = providerAvailability(ORDER,[account("claude","connected"),account("grok","connected")],true);
    expect(connectedParticipants(ORDER,{codex:true,claude:true},availability,2)).toMatchObject({claude:true,grok:true,codex:false});
  });

  it("cannot invent participants beyond the connected providers", () => {
    const availability = providerAvailability(ORDER,[account("claude","connected")],true);
    expect(connectedParticipants(ORDER,{codex:true},availability,2)).toMatchObject({claude:true,codex:false});
    expect(participantList(ORDER,connectedParticipants(ORDER,{codex:true},availability,2),availability)).toEqual(["claude"]);
  });

  it("leaves the stored selection untouched while loading", () => {
    expect(connectedParticipants(ORDER,{codex:true,claude:true},providerAvailability(ORDER,[],false),2)).toMatchObject({codex:true,claude:true,grok:false});
  });
});
