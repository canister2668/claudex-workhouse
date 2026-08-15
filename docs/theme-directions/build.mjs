// Builds self-contained comparison pages. Images are inlined as data URIs and all
// styling is inline, because the app's file viewer does not resolve relative asset
// paths or external stylesheets.
//
// The build reports each page against the in-app HTML preview ceiling
// (MAX_HTML_PREVIEW_BYTES in app/src/server/workspace-limits.ts).
import fs from "node:fs";

// Mirrors MAX_HTML_PREVIEW_BYTES so a page that will not open in the app is caught
// at build time rather than when someone clicks the link.
const LIMIT = 5 * 1024 * 1024;

const PAGES = [
  {
    file: "index.html",
    title: "테마 방향 A / B / C",
    shots: [
      { file: "shot-now-light.png", title: "현재 · 라이트", note: "지금 배포된 상태. 흰 카드가 반복되고 코드 블록이 가장 무겁습니다." },
      { file: "shot-a-light.png", title: "A · 라이트 다듬기", note: "코드 블록을 밝은 표면으로, 카드에 역할별 은은한 틴트. 터미널 스킨은 그대로 둡니다." },
      { file: "shot-a-dark.png", title: "A · 다크", note: "A는 다크를 손대지 않습니다. 현재 상태와 동일합니다." },
      { file: "shot-b-light.png", title: "B · A + 스킨 개성 강화 · 라이트", note: "elevated는 부드러운 그림자, outline은 선만, compact는 행, flat은 테두리 없음, terminal은 콘솔 유지." },
      { file: "shot-b-dark.png", title: "B · 다크", note: "다크에서도 여섯 스킨이 확실히 갈립니다." },
      { file: "shot-c-light.png", title: "C · 전면 재설계 · 라이트", note: "하나의 시스템으로 통일. 차분하지만 스킨끼리 서로 비슷해집니다." },
      { file: "shot-c-dark.png", title: "C · 다크", note: "터미널도 더는 콘솔이 아닙니다." }
    ]
  }
];

const uri = (file) => `data:image/png;base64,${fs.readFileSync(new URL(file, import.meta.url)).toString("base64")}`;

for (const page of PAGES) {
  const available = page.shots.filter((shot) => fs.existsSync(new URL(shot.file, import.meta.url)));
  const sections = available.map((shot) => `
<section style="margin:0 0 36px">
  <h2 style="margin:0 0 4px;font-size:17px">${shot.title}</h2>
  <p style="margin:0 0 10px;color:#5f6874;font-size:13px;line-height:1.6;max-width:900px">${shot.note}</p>
  <img src="${uri(shot.file)}" alt="${shot.title}" style="display:block;width:100%;max-width:1320px;border:1px solid #d9dde2;border-radius:10px">
</section>`).join("");

  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${page.title}</title></head>
<body style="margin:0;padding:28px;background:#fbfcfc;color:#1b241e;font:14px/1.6 ui-sans-serif,system-ui,'Apple SD Gothic Neo',sans-serif">
<h1 style="font-size:21px;margin:0 0 6px">${page.title}</h1>
<p style="margin:0 0 26px;color:#5f6874;max-width:900px">
각 장면은 같은 대화를 6개 스킨(soft · elevated · outline · compact · terminal · flat)으로 렌더링한 것입니다.
프로토타입은 <code>dir-a.css</code> · <code>dir-b.css</code> · <code>dir-c.css</code> 오버레이로만 만들었고,
실제 <code>styles.css</code>는 수정하지 않았습니다. B는 A 위에 얹힙니다.</p>
${sections}
<p style="color:#5f6874;margin-top:30px">
다시 만들기: <code>node docs/theme-directions/render.mjs</code> → <code>node docs/theme-directions/build.mjs</code></p>
</body></html>
`;

  fs.writeFileSync(new URL(`./${page.file}`, import.meta.url), html);
  const bytes = Buffer.byteLength(html);
  const state = bytes > LIMIT ? "OVER PREVIEW LIMIT" : "ok";
  console.log(`${page.file} · ${available.length} shots · ${(bytes / 1024).toFixed(0)} KiB · ${state}`);
}
