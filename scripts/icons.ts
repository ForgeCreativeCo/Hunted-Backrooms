// Draws the app icons into public/icons: `npx tsx scripts/icons.ts`.
// No image libraries: the art is procedural and the PNGs are written by hand.
// A buzzing fluorescent panel over "HUM" in camcorder pixel letters, on stained
// wallpaper. Everything sits inside the maskable safe zone, so one image serves
// as both the normal and the maskable icon.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public', 'icons');

const GLYPHS: Record<string, string[]> = {
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  M: ['10001', '11011', '10101', '10001', '10001', '10001', '10001'],
};

type RGB = [number, number, number];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Text: 3 glyphs of 5x7 cells with 1-cell gaps = 17 cells across.
const TEXT_X0 = 0.22, TEXT_Y0 = 0.5, CELL = 0.56 / 17;
function inText(x: number, y: number) {
  const cx = Math.floor((x - TEXT_X0) / CELL), cy = Math.floor((y - TEXT_Y0) / CELL);
  if (cy < 0 || cy >= 7 || cx < 0 || cx >= 17) return false;
  const g = Math.floor(cx / 6), col = cx % 6;
  if (col === 5) return false;
  return GLYPHS['HUM'[g]][cy][col] === '1';
}

// The light panel, and how far a point is from it (for the glow).
const PX0 = 0.27, PX1 = 0.73, PY0 = 0.24, PY1 = 0.32;
function panelDist(x: number, y: number) {
  const dx = Math.max(PX0 - x, 0, x - PX1), dy = Math.max(PY0 - y, 0, y - PY1);
  return Math.hypot(dx, dy);
}

function shade(x: number, y: number): RGB {
  // Wallpaper: dim mustard, darker toward the floor, with faint vertical stripes.
  const stripe = Math.floor(x * 14) % 2 ? 1 : 0.9;
  let c: RGB = mix([62, 54, 22], [14, 12, 5], Math.min(1, y * 1.1));
  c = [c[0] * stripe, c[1] * stripe, c[2] * stripe];
  // A water stain, low and to the left.
  const stain = Math.max(0, 1 - Math.hypot(x - 0.2, y - 0.86) / 0.22);
  c = mix(c, [24, 18, 6], stain * 0.6);
  // Glow from the panel.
  const d = panelDist(x, y);
  c = mix(c, [255, 236, 150], Math.exp(-d * 9) * 0.55);
  if (d === 0) {
    // The panel's own face, a touch brighter in the middle, with a ballast line.
    const mid = 1 - Math.abs((x - (PX0 + PX1) / 2) / ((PX1 - PX0) / 2)) * 0.15;
    c = mix([255, 248, 210], [255, 255, 240], mid);
    if (Math.abs(y - (PY0 + PY1) / 2) < 0.004) c = mix(c, [210, 196, 140], 0.6);
  }
  if (inText(x, y)) c = [232, 223, 192];
  return c;
}

function render(size: number) {
  const SS = 4; // supersamples per axis
  const rows: Buffer[] = [];
  for (let py = 0; py < size; py++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = shade((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const n = SS * SS, o = 1 + px * 4;
      row[o] = Math.round(r / n);
      row[o + 1] = Math.round(g / n);
      row[o + 2] = Math.round(b / n);
      row[o + 3] = 255;
    }
    rows.push(row);
  }
  return png(size, size, Buffer.concat(rows));
}

// ---- PNG ----

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w: number, h: number, raw: Buffer) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180], ['favicon-32.png', 32]] as const) {
  writeFileSync(join(OUT, name), render(size));
  console.log(`wrote public/icons/${name}`);
}
