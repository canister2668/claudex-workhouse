// Minimal supersampling rasterizer for the favicon candidates.
// The icons only use rounded rects, capsules (round-cap strokes), circles and
// polygons, so a coverage test per primitive is enough -- no SVG engine needed.
import fs from "node:fs";
import { createRequire } from "node:module";
// pngjs lives in app/node_modules; resolve from there so this script can run from anywhere
const { PNG } = createRequire(new URL("../../app/package.json", import.meta.url))("pngjs");

const BG = [0x12, 0x17, 0x13, 255];
const TEXT = [0xed, 0xf4, 0xee, 255];
const GREEN = [0x5a, 0xd3, 0x8a, 255];
const CYAN = [0x62, 0xc9, 0xd8, 255];
const AMBER = [0xef, 0xbd, 0x58, 255];

const roundRect = (x, y, w, h, r, color) => ({ color, hit: (px, py) => {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
} });

const distToSeg = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

// round caps + round joins == union of capsules over consecutive points
const stroke = (points, width, color, close = false) => {
  const segs = [];
  for (let i = 0; i + 1 < points.length; i++) segs.push([points[i], points[i + 1]]);
  if (close) segs.push([points[points.length - 1], points[0]]);
  return { color, hit: (px, py) => segs.some((s) => distToSeg(px, py, s[0], s[1]) <= width / 2) };
};

const circle = (cx, cy, r, color) => ({ color, hit: (px, py) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r });

const polygon = (pts, color) => ({ color, hit: (px, py) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
} });

const frame = () => roundRect(0, 0, 32, 32, 7, BG);

// the shipping icon, re-expressed in the same 32-unit space (generate-icons.mjs / 512)
const LINE = [0x34, 0x40, 0x39, 255], PANEL = [0x1b, 0x24, 0x1e, 255], CARD = [0x26, 0x34, 0x2b, 255];
const current = () => {
  const s = 1 / 16;
  const rows = [[142, GREEN], [225, CYAN], [308, AMBER]].flatMap(([y, accent]) => [
    roundRect(142 * s, y * s, 228 * s, 62 * s, 10 * s, accent),
    roundRect(151 * s, (y + 9) * s, 210 * s, 44 * s, 7 * s, CARD),
    roundRect(167 * s, (y + 20) * s, 24 * s, 24 * s, 12 * s, accent),
    roundRect(211 * s, (y + 25) * s, 118 * s, 13 * s, 5 * s, TEXT),
  ]);
  return [
    roundRect(0, 0, 32, 32, 0, BG),
    roundRect(76 * s, 76 * s, 360 * s, 360 * s, 54 * s, LINE),
    roundRect(88 * s, 88 * s, 336 * s, 336 * s, 46 * s, PANEL),
    ...rows,
  ];
};

const ICONS = {
  "00-current": current(),
  "01-workbench-w": [
    frame(),
    stroke([[6, 8.5], [11, 23.5], [16, 10.5], [21, 23.5], [26, 8.5]], 3.6, TEXT),
    stroke([[11, 23.5], [16, 10.5]], 3.6, GREEN),
  ],
  "02-triple-track": [
    frame(),
    stroke([[6.5, 23], [11.5, 9]], 4, GREEN),
    stroke([[13.5, 23], [18.5, 9]], 4, CYAN),
    stroke([[20.5, 23], [25.5, 9]], 4, AMBER),
  ],
  "03-workhouse": [
    frame(),
    polygon([[16, 4.5], [29, 15], [26, 15], [26, 27], [6, 27], [6, 15], [3, 15]], TEXT),
    roundRect(12.5, 17, 7, 10, 1.5, GREEN),
  ],
  "04-bracket-core": [
    frame(),
    stroke([[11.5, 6.5], [6.5, 6.5], [6.5, 25.5], [11.5, 25.5]], 3.4, TEXT),
    stroke([[20.5, 6.5], [25.5, 6.5], [25.5, 25.5], [20.5, 25.5]], 3.4, TEXT),
    circle(16, 16, 4.6, GREEN),
  ],
  "05-hex-slash": [
    frame(),
    stroke([[16, 4.5], [26, 10.25], [26, 21.75], [16, 27.5], [6, 21.75], [6, 10.25]], 3, TEXT, true),
    stroke([[12, 21], [20, 11]], 3.6, GREEN),
  ],
};

const SS = 8; // subsamples per axis

function render(shapes, size) {
  const png = new PNG({ width: size, height: size });
  const unit = 32 / size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const ux = (px + (sx + 0.5) / SS) * unit;
          const uy = (py + (sy + 0.5) / SS) * unit;
          let color = null;
          for (const shape of shapes) if (shape.hit(ux, uy)) color = shape.color;
          if (color) { r += color[0]; g += color[1]; b += color[2]; a += 255; }
        }
      }
      const n = SS * SS;
      const i = (py * size + px) * 4;
      const cov = a / (n * 255);
      png.data[i] = cov ? r / (n * cov) : 0;
      png.data[i + 1] = cov ? g / (n * cov) : 0;
      png.data[i + 2] = cov ? b / (n * cov) : 0;
      png.data[i + 3] = a / n;
    }
  }
  return png;
}

// nearest-neighbour blow-up so the true 16px pixels stay inspectable
function zoom(png, factor) {
  const out = new PNG({ width: png.width * factor, height: png.height * factor });
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const si = (Math.floor(y / factor) * png.width + Math.floor(x / factor)) * 4;
      out.data.set(png.data.subarray(si, si + 4), (y * out.width + x) * 4);
    }
  }
  return out;
}

const LABELS = {
  "00-current": ["현재 아이콘", "3줄 카드 리스트"],
  "01-workbench-w": ["1. 워크벤치 W", "01-workbench-w"],
  "02-triple-track": ["2. 3-트랙", "02-triple-track"],
  "03-workhouse": ["3. 워크하우스", "03-workhouse"],
  "04-bracket-core": ["4. 대괄호 코어", "04-bracket-core"],
  "05-hex-slash": ["5. 육각 슬래시", "05-hex-slash"],
};

const outDir = new URL("./preview/", import.meta.url);
fs.mkdirSync(outDir, { recursive: true });

const uri = (png) => `data:image/png;base64,${PNG.sync.write(png).toString("base64")}`;
const rows = [];

for (const [name, shapes] of Object.entries(ICONS)) {
  const at = {};
  for (const size of [16, 32, 64, 256]) {
    const png = render(shapes, size);
    at[size] = png;
    fs.writeFileSync(new URL(`${name}-${size}.png`, outDir), PNG.sync.write(png));
  }
  const zoomed = zoom(at[16], 12);
  fs.writeFileSync(new URL(`${name}-16-zoom.png`, outDir), PNG.sync.write(zoomed));

  // the page is inlined as data URIs and inline styles so it renders standalone,
  // even in viewers that block relative asset loads or external stylesheets
  const [title, sub] = LABELS[name] ?? [name, ""];
  const tab = (bg, fg) =>
    `<span style="display:inline-flex;align-items:center;gap:8px;padding:5px 10px;border-radius:7px;background:${bg}">` +
    `<img src="${uri(at[16])}" width="16" height="16" alt="" style="display:block">` +
    `<span style="font-size:11px;color:${fg}">Workhouse</span></span>`;
  const cell = "padding:14px 12px;border-bottom:1px solid #26342b;vertical-align:middle";
  rows.push(
    `<tr${name === "00-current" ? ' style="opacity:.75"' : ""}>` +
      `<td style="${cell};white-space:nowrap"><b style="display:block;font-size:15px">${title}</b>` +
      `<span style="color:#9bb0a2;font-size:12px">${sub}</span></td>` +
      `<td style="${cell}">${tab("#202324", "#8b9196")}<div style="height:6px"></div>${tab("#dee1e6", "#5f6368")}</td>` +
      `<td style="${cell}"><img src="${uri(zoomed)}" width="96" height="96" alt="" style="display:block;image-rendering:pixelated"></td>` +
      `<td style="${cell}"><img src="${uri(at[32])}" width="32" height="32" alt="" style="display:block"></td>` +
      `<td style="${cell}"><img src="${uri(at[64])}" width="64" height="64" alt="" style="display:block"></td>` +
    `</tr>`,
  );
}

const th = "padding:14px 12px;border-bottom:1px solid #26342b;text-align:left;font-size:12px;" +
  "letter-spacing:.06em;color:#9bb0a2;font-weight:600";
const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Claudex Workhouse — 파비콘 후보</title></head>
<body style="margin:0;padding:32px;background:#0d110e;color:#edf4ee;font:14px/1.6 ui-sans-serif,system-ui,'Apple SD Gothic Neo',sans-serif">
<h1 style="font-size:20px;margin:0 0 4px">Claudex Workhouse — 파비콘 후보</h1>
<p style="color:#9bb0a2;margin:0 0 28px;max-width:820px">
브라우저 탭은 실질적으로 16&times;16입니다. &ldquo;탭 실측&rdquo; 칸이 실제로 보이게 될 크기이고,
&ldquo;16px 확대&rdquo;는 그 픽셀을 12배로 늘려 확인용으로만 붙인 것입니다.</p>
<table style="border-collapse:collapse;width:100%;max-width:900px"><thead><tr>
<th style="${th}">후보</th><th style="${th}">탭 실측 (16px)</th><th style="${th}">16px 확대</th>
<th style="${th}">32px</th><th style="${th}">64px</th></tr></thead>
<tbody>${rows.join("")}</tbody></table>
<p style="max-width:900px;margin-top:28px;color:#9bb0a2">원본은 같은 폴더의
<code style="color:#5ad38a">0*.svg</code>, 생성기는
<code style="color:#5ad38a">node docs/favicon-candidates/render.mjs</code>입니다.</p>
</body></html>
`;
fs.writeFileSync(new URL("./index.html", import.meta.url), html);
console.log("rendered", Object.keys(ICONS).length, "icons + index.html");
