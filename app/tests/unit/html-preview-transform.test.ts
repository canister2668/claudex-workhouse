// @vitest-environment happy-dom
import {describe,expect,it} from "vitest";
import {buildHtmlPreview} from "../../src/web/html-preview-compatibility";
import {previewCsp} from "../../src/web/html-preview-security";

const fixture=`<!doctype html>
<html><head>
  <base href="https://evil.example/">
  <meta http-equiv="refresh" content="0;url=https://evil.example/">
  <link rel="stylesheet">
  <style>@import "https://evil.example/b.css"; .card{color:red;background:url(https://evil.example/a.png)}</style>
</head><body>
  <script>parent.document.body.textContent='owned'</script>
  <div id="hero" class="custom" onclick="alert(1)" style="display:flex;gap:12px;color:rgb(255, 0, 0);background-image:url(https://evil.example/bg.png)">
    <pre>display:flex; gap:12px; &lt;script&gt; is example text</pre>
    <a href="javascript:alert(1)" target="_top">link</a>
    <img class="custom fr-dib" src="//images.example.com/a.png" srcset="https://images.example.com/a2.png 2x">
    <img src="https://127.0.0.1/private.png">
  </div>
</body></html>`;

describe("HTML preview security and compatibility",()=>{
  it("removes executable behavior and network resources without changing code text",()=>{
    const result=buildHtmlPreview(fixture,{mode:"safe",allowExternalImages:false});
    expect(result.srcdoc).not.toContain("<script");
    expect(result.srcdoc).not.toContain("<iframe");
    expect(result.srcdoc).not.toContain("onclick=");
    expect(result.srcdoc).not.toContain("evil.example");
    expect(result.srcdoc).toContain('<meta name="referrer" content="no-referrer">');
    expect(result.srcdoc).toContain("display:flex; gap:12px; &lt;script&gt; is example text");
    expect(result.srcdoc).toContain("color: rgb(255, 0, 0)");
    expect(result.diagnostics.some(item=>item.name==="url()")).toBe(true);
    expect(result.counts.resources).toBeGreaterThan(0);
  });

  it("allows only public HTTPS image requests when explicitly enabled",()=>{
    const result=buildHtmlPreview(fixture,{mode:"safe",allowExternalImages:true});
    expect(result.srcdoc).toContain("https://images.example.com/a.png");
    expect(result.srcdoc).not.toContain("https://127.0.0.1/private.png");
    expect(result.srcdoc).not.toContain("srcset=");
    expect(result.srcdoc).not.toContain("background-image: url");
    expect(result.diagnostics).toContainEqual(expect.objectContaining({action:"normalized",name:"src"}));
  });

});
