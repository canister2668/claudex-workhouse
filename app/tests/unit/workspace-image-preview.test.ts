import{describe,expect,it}from"vitest";
import{MAX_WORKSPACE_IMAGE_PREVIEW_BYTES,workspaceImageMime}from"../../src/server/workspace-image-preview.js";

describe("workspace image preview",()=>{
  it("recognizes only supported image signatures",()=>{
    expect(workspaceImageMime(Buffer.from("89504e470d0a1a0a","hex"))).toBe("image/png");
    expect(workspaceImageMime(Buffer.from("ffd8ffdb","hex"))).toBe("image/jpeg");
    expect(workspaceImageMime(Buffer.from("GIF89a","ascii"))).toBe("image/gif");
    expect(workspaceImageMime(Buffer.from("524946460000000057454250","hex"))).toBe("image/webp");
    expect(workspaceImageMime(Buffer.from("00000018667479706d6966310000000061766966","hex"))).toBe("image/avif");
    expect(workspaceImageMime(Buffer.from("<svg><script>bad</script></svg>"))).toBeNull();
    expect(workspaceImageMime(Buffer.from("not really a png"))).toBeNull();
  });

  it("keeps inline previews bounded",()=>expect(MAX_WORKSPACE_IMAGE_PREVIEW_BYTES).toBe(20*1024*1024));
});
