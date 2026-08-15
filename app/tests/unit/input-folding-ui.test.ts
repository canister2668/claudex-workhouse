import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const web=(file:string)=>fs.readFileSync(path.join(process.cwd(),"src","web",file),"utf8");

describe("input folding UI",()=>{
  it("measures and folds user inputs at five rendered lines",()=>{
    const conversation=web("Conversation.svelte");
    const styles=web("styles.css");
    expect(conversation).toContain("measureInputFold");
    expect(conversation).toContain('class="input-fold-toggle"');
    expect(styles).toContain("pre.user-input-content.folded{max-height:7.75em");
    expect(styles).toContain(".markdown-body.user-input-content.folded{max-height:8.5em");
  });

  it("shows queued inputs as one line until individually expanded",()=>{
    const queue=web("MessageQueue.svelte");
    expect(queue).toContain("measureQueuePrompt");
    expect(queue).toContain("update(next:");
    expect(queue).toContain("prompt:item.prompt");
    expect(queue).toContain("white-space:nowrap");
    expect(queue).toContain("p.expanded");
    expect(queue).toContain('class="queue-fold-toggle"');
    expect(queue).toContain('class="queue-prompt-row"');
    expect(queue).toContain('class="queue-actions"');
    expect(queue).toContain("max-height:min(40vh,360px)");
    expect(queue).toContain("overscroll-behavior:contain");
  });
});
