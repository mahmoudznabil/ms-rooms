/**
 * Generates the PNG app icons (Phase F1).
 *
 * iOS ignores SVG for apple-touch-icon, and Android wants real 192/512 PNGs in
 * the manifest — so the previous manifest pointed at .svg files that no launcher
 * would render. This script rasterises a simplified mark (the detailed neon SVG
 * does not survive at 60px) and writes true PNGs.
 *
 * No image library is available in this repo, so it rasterises into an RGBA
 * buffer and encodes the PNG by hand: signature + IHDR + IDAT (zlib) + IEND,
 * with CRC32 per chunk. Deterministic — no clock, no randomness.
 *
 * Usage: node scripts/generate-icons.mjs
 */

import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ------------------------------------------------------------------ PNG ---- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // One filter byte (0 = None) per scanline.
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------- raster ---- */

/** Brand palette, matching the CSS tokens (globals.css). */
const BRAND = [139, 92, 246]; // --arc violet
const LIVE = [255, 45, 120]; // --live pink
const INK = [7, 7, 11]; // --ink

function makeCanvas(size) {
  return { size, data: Buffer.alloc(size * size * 4) };
}

function blend(c, x, y, [r, g, b], a) {
  if (a <= 0) return;
  const i = (y * c.size + x) * 4;
  const sa = Math.min(1, a);
  const da = c.data[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa <= 0) return;
  c.data[i] = Math.round((r * sa + c.data[i] * da * (1 - sa)) / oa);
  c.data[i + 1] = Math.round((g * sa + c.data[i + 1] * da * (1 - sa)) / oa);
  c.data[i + 2] = Math.round((b * sa + c.data[i + 2] * da * (1 - sa)) / oa);
  c.data[i + 3] = Math.round(oa * 255);
}

/** Signed distance to a rounded rect centred at (cx,cy). */
function sdRoundRect(px, py, cx, cy, halfW, halfH, r) {
  const dx = Math.abs(px - cx) - (halfW - r);
  const dy = Math.abs(py - cy) - (halfH - r);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.min(Math.max(dx, dy), 0) + Math.sqrt(ax * ax + ay * ay) - r;
}

/** Signed distance to a circle. */
const sdCircle = (px, py, cx, cy, r) => Math.hypot(px - cx, py - cy) - r;

/** Signed distance to a line segment with round caps. */
function sdSegment(px, py, ax, ay, bx, by, halfWidth) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)));
  return Math.hypot(wx - vx * t, wy - vy * t) - halfWidth;
}

/** Antialiased coverage from a signed distance (1px feather). */
const cover = (d) => Math.max(0, Math.min(1, 0.5 - d));

/**
 * The icon: a rounded-square badge with a vertical brand gradient, a thin live
 * ring, and a microphone glyph. Reads at 60px and at 512px.
 */
function draw(size) {
  const c = makeCanvas(size);
  const u = size / 512; // design units are a 512 grid
  const badge = sdRoundRect(size / 2, size / 2, size / 2, size / 2, size * 0.5, size * 0.5, size * 0.225);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5;
      const py = y + 0.5;

      // Badge fill: diagonal violet → pink, matching the logo's gradient.
      const t = (px + py) / (size * 2);
      const fill = [
        Math.round(BRAND[0] + (LIVE[0] - BRAND[0]) * t),
        Math.round(BRAND[1] + (LIVE[1] - BRAND[1]) * t),
        Math.round(BRAND[2] + (LIVE[2] - BRAND[2]) * t),
      ];
      blend(c, x, y, fill, cover(badge));

      // Subtle inner darkening at the edges so the glyph pops.
      const edge = cover(badge + size * 0.045) * 0.28;
      blend(c, x, y, INK, edge);

      // Ring: a bright arc around the glyph.
      const ring = Math.abs(sdCircle(px, py, size / 2, size * 0.47, size * 0.3)) - size * 0.011;
      blend(c, x, y, [255, 255, 255], cover(ring) * 0.5);

      // Microphone capsule.
      const mic = sdRoundRect(px, py, size / 2, size * 0.44, size * 0.105, size * 0.165, size * 0.105);
      blend(c, x, y, [255, 255, 255], cover(mic) * 0.96);

      // Mic stand: the U-shaped cradle.
      const cradleA = sdSegment(px, py, size * 0.325, size * 0.47, size * 0.325, size * 0.55, size * 0.026);
      const cradleB = sdSegment(px, py, size * 0.675, size * 0.47, size * 0.675, size * 0.55, size * 0.026);
      const cradleC = sdSegment(px, py, size * 0.325, size * 0.55, size * 0.675, size * 0.55, size * 0.026);
      const stem = sdSegment(px, py, size * 0.5, size * 0.55, size * 0.5, size * 0.655, size * 0.026);
      const base = sdSegment(px, py, size * 0.395, size * 0.665, size * 0.605, size * 0.665, size * 0.03);
      const stand = Math.min(cradleA, cradleB, cradleC, stem, base);
      blend(c, x, y, [255, 255, 255], cover(stand) * 0.92);

      // Two sound waves flanking the mic.
      for (const [sx, h] of [
        [0.215, 0.045],
        [0.155, 0.072],
      ]) {
        const d = sdSegment(px, py, size * sx, size * 0.445 - size * h, size * sx, size * 0.445 + size * h, size * 0.019);
        blend(c, x, y, [255, 255, 255], cover(d) * 0.75);
      }
      for (const [sx, h] of [
        [0.785, 0.045],
        [0.845, 0.072],
      ]) {
        const d = sdSegment(px, py, size * sx, size * 0.445 - size * h, size * sx, size * 0.445 + size * h, size * 0.019);
        blend(c, x, y, [255, 255, 255], cover(d) * 0.75);
      }

      void u;
    }
  }
  return c;
}

/* ------------------------------------------------------------------ run ---- */

const TARGETS = [
  { file: "icon-512.png", size: 512 },
  { file: "icon-192.png", size: 192 },
  { file: "apple-touch-icon.png", size: 180 },
  { file: "favicon-32.png", size: 32 },
];

for (const { file, size } of TARGETS) {
  const c = draw(size);
  const png = encodePng(c.size, c.size, c.data);
  writeFileSync(join(ROOT, "public", file), png);
  console.log(`wrote public/${file} (${size}x${size}, ${png.length} bytes)`);
}