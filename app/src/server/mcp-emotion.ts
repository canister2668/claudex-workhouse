import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { EmotionWatcher } from "./emotion.js";
import { isLoopbackAddress } from "./security/auth.js";
import {EMOTION_MCP_POLICIES,EMOTION_MCP_PROFILE_HEADER,emotionMcpPolicy,validEmotionTaskId,type EmotionMcpProvider} from "./emotion-mcp-policy.js";

// The claude-chan emotion MCP, absorbed into Claudex Workhouse so the separate
// docker container (port 3100) is no longer needed. Tool behavior is a 1:1
// port of mcp-emoticon/server.js v2.1 (express_emotion / set_emotion /
// set_outfit / get_emotion / list_emotions); state writes go through the
// shared flock-based EmotionWatcher so provider workers, the VS Code panel and the
// deck avatar all stay coherent.

const EMOTIONS = [
  "neutral", "happy", "embarrassed", "sad", "angry", "surprised",
  "love", "smug", "confused", "crying", "excited", "proud",
  "scared", "sleepy", "thinking", "thinking_2", "thinking_3",
  "tired", "dead", "disappointed", "disgusted", "facepalm",
  "laughing", "nervous", "pout", "speechless", "wink", "chu",
  "gift", "execute",
  "coding", "coding_2", "coding_3",
  "building", "building_2", "building_3",
  "reading", "reading_2", "reading_3",
  "searching", "searching_2", "searching_3"
] as const;
const EXTS = [".webp", ".png", ".gif"];
const EXPRESSION_HOLD_MS = 120000;

type EmotionTarget=EmotionMcpProvider;
type EmotionScope={taskId?:string;sessionId?:string};
export const emotionExpressionHoldUntil=(now=Date.now())=>now+EXPRESSION_HOLD_MS;
export function emotionScopeFromHeaders(target:EmotionTarget,headers:Record<string,unknown>):EmotionScope{
  const value=(name:string,maximum:number)=>typeof headers[name]==="string"?String(headers[name]).trim().slice(0,maximum):"";
  const taskId=value("x-claudex-workhouse-task-id",160),sessionId=value("x-claudex-workhouse-session-id",100);
  const scopedTask=validEmotionTaskId(target,taskId);
  const scopedSession=/^[a-zA-Z0-9:._-]{1,100}$/.test(sessionId)?sessionId:"";
  return scopedTask?{taskId:scopedTask,sessionId:scopedSession}:scopedSession?{sessionId:scopedSession}:{};
}
// An emotion write must never inherit the ids sitting in the shared provider
// state. An unscoped call -- every interactive Claude session, which reaches
// /mcp without the task headers -- would otherwise be filed under
// whichever task happened to own the global file, stamping a still-running
// task's snapshot with this call's face. The avatar trusts an MCP source over
// its own active status, so that stray "완료" is what the session badge then
// contradicts. Writing the ids explicitly keeps an unscoped call anonymous.
export const emotionScopePatch=(scope:EmotionScope)=>({taskId:scope.taskId??"",sessionId:scope.sessionId??""});
export function registerEmotionMcp(app: FastifyInstance, options: { watcher: EmotionWatcher; codexWatcher?: EmotionWatcher; deepseekWatcher?:EmotionWatcher; ollamaWatcher?:EmotionWatcher; antigravityWatcher?:EmotionWatcher;grokWatcher?:EmotionWatcher; stateFile: string; assetsDir: string; baseUrl: string; selectOutfit?:(provider:EmotionTarget,outfit:string)=>Promise<unknown> }) {
  const { watcher, codexWatcher, deepseekWatcher, ollamaWatcher, antigravityWatcher,grokWatcher, assetsDir, baseUrl,selectOutfit } = options;

  const discoverOutfits = () => {
    try { return fs.readdirSync(assetsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(); }
    catch { return ["normal"]; }
  };
  const defaultOutfit = (outfits: string[]) => outfits.includes("normal") ? "normal" : outfits[0] ?? "normal";
  const resolveFile = (outfit: string, emotion: string) => {
    const names = emotion === "chu" ? ["chu", "chu~"]
      : emotion === "execute" && !outfit.startsWith("Gpt-") ? ["execute", "building"]
      : [emotion];
    for (const name of names) {
      for (const ext of EXTS) {
        const files = outfit.startsWith("Gpt-") ? [`${outfit}_${name}${ext}`, `${name}${ext}`] : [`${name}${ext}`];
        for (const file of files) if (fs.existsSync(path.join(assetsDir, outfit, file))) return file;
      }
    }
    return null;
  };
  // fallback chain: <outfit>/<emotion> → <other>/<emotion> → <outfit>/neutral → default/neutral
  const resolveAsset = (outfit: string, emotion: string) => {
    const outfits = discoverOutfits();
    const fallback = defaultOutfit(outfits);
    const safe = outfits.includes(outfit) ? outfit : fallback;
    const ordered = [safe, ...outfits.filter((outfit) => outfit !== safe)];
    const attempts: Array<[string, string]> = [
      ...ordered.map((outfit) => [outfit, emotion] as [string, string]),
      ...ordered.map((outfit) => [outfit, "neutral"] as [string, string])
    ];
    for (const [o, e] of attempts) { const file = resolveFile(o, e); if (file) return { outfit: o, file }; }
    return { outfit: fallback, file: "neutral.webp" };
  };

  const targetDefault=(target:EmotionTarget)=>target==="codex"?"Gpt-Sol":target==="deepseek"?"DeepSeek":target==="ollama"?"Ollama":target==="antigravity"?"Antigravity":target==="grok"?"Grok":"normal";
  const targetSource=(target:EmotionTarget)=>emotionMcpPolicy(target).source;
  function buildServer(targetWatcher: EmotionWatcher, target: EmotionTarget, scope:EmotionScope={},conversationOnly=false) {
    const outfits = discoverOutfits();
    const server = new McpServer({ name: "claude-chan-emoticon", version: "2.2.0-claudex-workhouse" });

    if(!conversationOnly)server.tool("express_emotion", "사용자가 답변 본문에 감정 이미지를 명시적으로 요청할 때만 호출합니다. 플로팅 아바타만 갱신하는 MCP 감정 모드에서는 set_emotion을 사용하세요. 반환된 마크다운은 답변 텍스트에 그대로 포함합니다.",
      { emotion: z.enum(EMOTIONS).describe(`최종 답변 화자가 직접 표현하는 감정. 사용자·인용문의 감정은 선택하지 않습니다. 사용 가능: ${EMOTIONS.join(", ")}`), description: z.string().optional().describe("감정에 대한 부가 설명 (선택사항)") },
      async ({ emotion, description }) => {
        const current = targetWatcher.get();
        const resolved = resolveAsset(current.outfit || targetDefault(target), emotion);
        const markdown = `![${emotion}](${baseUrl}/emoticons/${resolved.outfit}/${encodeURIComponent(resolved.file)})`;
        try {
          await targetWatcher.setState({
            emotion, line: description ?? "", statusLine: "", source: targetSource(target),
            ...emotionScopePatch(scope),
            holdUntil: emotionExpressionHoldUntil()
          });
        } catch { /* display-only failure is fine */ }
        return { content: [{ type: "text" as const, text: description ? `${markdown}\n*${description}*` : markdown }] };
      });

    server.tool("set_emotion", "MCP 감정 모드 지시가 있는 대화에서는 최종 답변 직전에 정확히 한 번 호출합니다. 자신의 최종 답변에서 직접 표현하는 주된 감정으로 플로팅 아바타를 갱신하며, 사용자나 인용문의 감정을 대신 선택하지 않습니다.",
      { emotion: z.enum(EMOTIONS).describe(`최종 답변 화자의 주된 감정. 명확한 감정이 없으면 neutral을 사용합니다. 사용 가능: ${EMOTIONS.join(", ")}`), line: z.string().optional().describe("아바타에 표시할 짧은 대사 (선택사항)") },
      async ({ emotion, line }) => {
        try {
          await targetWatcher.setState({
            emotion, line: line ?? "", statusLine: "", source: targetSource(target),
            ...emotionScopePatch(scope),
            holdUntil: emotionExpressionHoldUntil()
          });
          return { content: [{ type: "text" as const, text: line ? `(${emotion}) ${line}` : `(${emotion})` }] };
        } catch (error) { return { content: [{ type: "text" as const, text: `state.json 쓰기 실패: ${error instanceof Error ? error.message : error}` }], isError: true }; }
      });

    if(!conversationOnly)server.tool("set_outfit", "현재 제공자 아바타의 의상(outfit)을 변경합니다. 다음 express_emotion 호출부터 새 의상으로 렌더링됩니다.",
      { outfit: z.enum(outfits.length ? outfits as [string, ...string[]] : ["normal"]).describe(`변경할 의상. 사용 가능: ${outfits.join(", ")}`) },
      async ({ outfit }) => {
        try {
          if(selectOutfit)await selectOutfit(target,outfit);else await targetWatcher.setOutfit(outfit);
          return { content: [{ type: "text" as const, text: `(outfit=${outfit})` }] };
        } catch (error) { return { content: [{ type: "text" as const, text: `state.json 쓰기 실패: ${error instanceof Error ? error.message : error}` }], isError: true }; }
      });

    if(!conversationOnly)server.tool("get_emotion", "현재 감정 상태를 state.json에서 읽어 반환합니다.", {}, async () => {
      try { return { content: [{ type: "text" as const, text: JSON.stringify(targetWatcher.get()) }] }; }
      catch { return { content: [{ type: "text" as const, text: JSON.stringify({ emotion: null, line: "", outfit: defaultOutfit(discoverOutfits()), timestamp: null }) }] }; }
    });

    if(!conversationOnly)server.tool("list_emotions", "사용 가능한 감정 목록과 outfit 목록을 반환합니다.", {}, async () => {
      const currentOutfits = discoverOutfits();
      const coverage: Record<string, string[]> = {};
      for (const outfit of currentOutfits) coverage[outfit] = EMOTIONS.filter((emotion) => resolveFile(outfit, emotion));
      return { content: [{ type: "text" as const, text: JSON.stringify({ emotions: EMOTIONS, outfits: currentOutfits, coverage }, null, 2) }] };
    });

    return server;
  }

  // Host is caller-controlled. Fastify's peer address is the actual local-only
  // boundary; cf-ray remains a cheap defense-in-depth signal for proxied calls.
  const assertLocal = (ip: string | undefined, headers: Record<string, unknown>) => {
    if (headers["cf-ray"] || !isLoopbackAddress(ip)) {
      throw Object.assign(new Error("The MCP endpoint is local-only."), { statusCode: 403 });
    }
  };

  const registerEndpoint = (route: string, targetWatcher: EmotionWatcher, target: EmotionTarget) => {
    app.post(route, async (request, reply) => {
      assertLocal(request.ip, request.headers as Record<string, unknown>);
      const scope=emotionScopeFromHeaders(target,request.headers as Record<string,unknown>);
      if(!emotionMcpPolicy(target).allowAnonymous&&!scope.taskId)throw Object.assign(new Error("A task-scoped emotion MCP header is required."),{statusCode:403});
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      const server = buildServer(targetWatcher, target,scope,request.headers[EMOTION_MCP_PROFILE_HEADER.toLowerCase()] === "conversation");
      await server.connect(transport);
      reply.hijack();
      await transport.handleRequest(request.raw, reply.raw, request.body);
      reply.raw.on("close", () => { void transport.close(); void server.close(); });
    });
    app.get(route, async (request, reply) => { assertLocal(request.ip, request.headers as Record<string, unknown>); return reply.code(405).send({ error: "Method Not Allowed. Use POST." }); });
  };

  const watchers:Partial<Record<EmotionTarget,EmotionWatcher>>={claude:watcher,codex:codexWatcher,deepseek:deepseekWatcher,ollama:ollamaWatcher,antigravity:antigravityWatcher,grok:grokWatcher};
  for(const policy of EMOTION_MCP_POLICIES){const targetWatcher=watchers[policy.provider];if(targetWatcher)registerEndpoint(policy.path,targetWatcher,policy.provider);}
}
