import fs from "node:fs";
import path from "node:path";
import {describe,expect,it}from"vitest";

const queue=fs.readFileSync(path.join(process.cwd(),"src","web","MessageQueue.svelte"),"utf8");
const rule=queue.slice(queue.indexOf(".message-queue{"),queue.indexOf("}",queue.indexOf(".message-queue{")));

describe("queued messages keep their own height",()=>{
  it("does not let the fixed-height detail column squeeze the queue",()=>{
    // overflow:auto drops a flex item's automatic minimum size to zero, so
    // without flex:none a single folded row scrolls and its buttons are cut off.
    expect(rule).toContain("flex:none");
    expect(rule).toContain("overflow:auto");
  });

  it("keeps a cap for long queues without taking most of a phone screen",()=>{
    expect(rule).toContain("max-height:min(68vh,640px)");
    expect(queue).toContain("max-height:min(44vh,380px)");
    expect(queue).not.toContain("max-height:62vh");
  });

  it("collapses the whole queue on mobile and shows the item count badge",()=>{
    expect(queue).toContain('matchMedia("(max-width: 640px)").matches');
    expect(queue).toContain('class="queue-collapse-toggle"');
    expect(queue).toContain('class="queue-count-badge"');
    expect(queue).toContain("{items.length}");
    expect(queue).toContain('localStorage.setItem("ui.messageQueueCollapsed"');
  });
});
