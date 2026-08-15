import {describe,expect,it} from "vitest";
import path from "node:path";
import {MAX_CONVERSATION_ATTACHMENTS,conversationAttachmentInstruction,conversationAttachmentPaths,parseConversationAttachments} from "../../src/server/conversation-attachments";
import {isDisplayableImage,parseConversationUserContent} from "../../src/web/conversation-attachments";

const UPLOADS=path.resolve("/data/uploads");
const upload=(name:string)=>path.join(UPLOADS,name);

describe("conversation attachment allowance",()=>{
  it("takes the uploaded files the prompt already carries",()=>{
    const prompt=`살펴봐줘\n\n[첨부 파일]\n- ${upload("a2762249-shot.jpg")} (shot.jpg)\n- ${upload("b1000000-log.txt")} (log.txt)`;
    expect(conversationAttachmentPaths(prompt,UPLOADS)).toEqual([upload("a2762249-shot.jpg"),upload("b1000000-log.txt")]);
  });

  it("ignores paths outside the uploads directory",()=>{
    // A conversation prompt is partly model-authored, so a path that merely
    // mentions the directory must not widen what may be opened.
    const prompt=[
      `- ${path.resolve("/etc/shadow")} (shadow)`,
      `- ${path.resolve("/data/uploads-old/secret.png")} (secret)`,
      `- ${path.join(UPLOADS,"..","..","etc","hosts")} (hosts)`,
      `- ${UPLOADS} (the directory itself)`,
    ].join("\n");
    expect(conversationAttachmentPaths(prompt,UPLOADS)).toEqual([]);
  });

  it("caps the list and never repeats a file",()=>{
    const prompt=Array.from({length:20},(_,index)=>`- ${upload(`0000000${index%10}-file${index}.png`)} (file)`).join("\n");
    const found=conversationAttachmentPaths(prompt,UPLOADS);
    expect(found.length).toBe(MAX_CONVERSATION_ATTACHMENTS);
    expect(new Set(found).size).toBe(found.length);
  });

  it("drops the trailing punctuation of the sentence, not of the name",()=>{
    expect(conversationAttachmentPaths(`see ${upload("aaaaaaaa-shot.png")}.`,UPLOADS)).toEqual([upload("aaaaaaaa-shot.png")]);
  });

  it("names every allowed file in the instruction and stays silent without one",()=>{
    expect(conversationAttachmentInstruction([])).toBe("");
    const instruction=conversationAttachmentInstruction([upload("aaaaaaaa-shot.png")]);
    expect(instruction).toContain(upload("aaaaaaaa-shot.png"));
    expect(instruction).toMatch(/exactly these paths/);
  });

  it("survives a missing or malformed worker environment",()=>{
    expect(parseConversationAttachments(undefined)).toEqual([]);
    expect(parseConversationAttachments("not json")).toEqual([]);
    expect(parseConversationAttachments(JSON.stringify(["/a",7,""]))).toEqual(["/a"]);
  });
});

describe("conversation attachment presentation",()=>{
  it("replaces the model-facing file list with the files themselves",()=>{
    const content=`이 화면 좀 봐줘\n\n[첨부 파일 — 필요 시 파일 도구로 읽어 참고할 것]\n- /volume2/data/uploads/a2762249-shot.jpg (Screenshot.jpg)`;
    const parsed=parseConversationUserContent(content);
    expect(parsed.text).toBe("이 화면 좀 봐줘");
    expect(parsed.attachments).toEqual([{name:"Screenshot.jpg",fileName:"a2762249-shot.jpg",url:"/api/uploads/a2762249-shot.jpg"}]);
  });

  it("keeps a non-image attachment as a labelled reference",()=>{
    const parsed=parseConversationUserContent("- /data/uploads/b1000000-run.log (run.log)");
    expect(parsed.attachments[0].url).toBeNull();
    expect(parsed.attachments[0].name).toBe("run.log");
  });

  it("leaves ordinary list lines in the message alone",()=>{
    const content="정리하면\n- 첫째 (중요)\n- 둘째 (참고)";
    expect(parseConversationUserContent(content)).toEqual({text:content,attachments:[]});
  });

  it("does not build a URL for a path that is not an uploaded file",()=>{
    expect(parseConversationUserContent("- /etc/passwd (passwd)").attachments).toEqual([]);
    expect(parseConversationUserContent("- /data/uploads/../etc/passwd (passwd)").attachments).toEqual([]);
  });

  it("recognises the image extensions the gallery can show",()=>{
    expect(isDisplayableImage("a.PNG")).toBe(true);
    expect(isDisplayableImage("a.webp")).toBe(true);
    expect(isDisplayableImage("a.txt")).toBe(false);
    expect(isDisplayableImage("png")).toBe(false);
  });
});
