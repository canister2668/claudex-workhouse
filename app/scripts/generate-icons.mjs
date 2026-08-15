import crypto from "node:crypto";
import fs from "node:fs";
import { PNG } from "pngjs";

// The mark is a bold "W" whose middle upstroke is lifted and coloured green:
// the Workhouse initial, read as a rising progress line. Everything is defined in
// a 32-unit square so the same geometry drives the SVG and every PNG size.
const colors = { bg: [18, 23, 19, 255], green: [90, 211, 138, 255], text: [237, 244, 238, 255] };
const W = [[6, 8.5], [11, 23.5], [16, 10.5], [21, 23.5], [26, 8.5]];
const ACCENT = [[11, 23.5], [16, 10.5]];
const STROKE = 3.6;
const RADIUS = 7;
// maskable icons are cropped to a centre circle, so the mark shrinks inside a full-bleed square
const MASK_SCALE = 0.74;

const distToSeg = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

// round caps and round joins are just the union of capsules over consecutive points
const stroke = (points, width, color) => ({ color, hit: (px, py) =>
  points.slice(1).some((p, i) => distToSeg(px, py, points[i], p) <= width / 2) });

const roundRect = (x, y, w, h, r, color) => ({ color, hit: (px, py) => {
  if (px < x || py < y || px > x + w || py > y + h) return false;
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
} });

const scalePoints = (points, k) => points.map(([x, y]) => [16 + (x - 16) * k, 16 + (y - 16) * k]);

function shapes({ maskable = false } = {}) {
  const k = maskable ? MASK_SCALE : 1;
  return [
    roundRect(0, 0, 32, 32, maskable ? 0 : RADIUS, colors.bg),
    stroke(scalePoints(W, k), STROKE * k, colors.text),
    stroke(scalePoints(ACCENT, k), STROKE * k, colors.green),
  ];
}

const SS = 4; // subsamples per axis; the old renderer had no anti-aliasing at all

function icon(size, options) {
  const png = new PNG({ width: size, height: size });
  const list = shapes(options);
  const unit = 32 / size;
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    let r = 0, g = 0, b = 0, hits = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const ux = (px + (sx + 0.5) / SS) * unit;
      const uy = (py + (sy + 0.5) / SS) * unit;
      let color = null;
      for (const shape of list) if (shape.hit(ux, uy)) color = shape.color;
      if (color) { r += color[0]; g += color[1]; b += color[2]; hits++; }
    }
    const n = SS * SS;
    const i = (py * size + px) * 4;
    png.data[i] = hits ? r / hits : 0;
    png.data[i + 1] = hits ? g / hits : 0;
    png.data[i + 2] = hits ? b / hits : 0;
    png.data[i + 3] = (hits / n) * 255;
  }
  return png;
}

const hex = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
const path = (points) => points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <rect width="32" height="32" rx="${RADIUS}" fill="${hex(colors.bg)}"/>
  <g fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-width="${STROKE}">
    <path d="${path(W)}" stroke="${hex(colors.text)}"/>
    <path d="${path(ACCENT)}" stroke="${hex(colors.green)}"/>
  </g>
</svg>
`;

const out = (name) => new URL(`../public/icons/${name}`, import.meta.url);
const written = [];
const emit = (name, bytes) => { fs.writeFileSync(out(name), bytes); written.push(bytes); };
emit("favicon.svg", svg);
for (const size of [32, 180, 192, 512]) emit(`icon-${size}.png`, PNG.sync.write(icon(size)));
emit("icon-maskable-512.png", PNG.sync.write(icon(512, { maskable: true })));

// Icon file names are fixed because sw.js points notifications at icon-192.png, so a
// redesign would otherwise keep serving the old art from a browser's favicon store or
// an intermediate cache. Stamping the content hash onto every /icons/ reference in the
// shell and the manifest changes the URL whenever the artwork does.
const version = crypto.createHash("sha256").update(Buffer.concat(written.map((item) => Buffer.from(item)))).digest("hex").slice(0, 8);
for (const target of ["../index.html", "../public/manifest.webmanifest"]) {
  const file = new URL(target, import.meta.url);
  const source = fs.readFileSync(file, "utf8");
  const next = source.replace(/(\/icons\/[A-Za-z0-9._-]+)(\?v=[a-z0-9]+)?/g, `$1?v=${version}`);
  if (next !== source) fs.writeFileSync(file, next);
}
console.log(`icons written · version ${version}`);
