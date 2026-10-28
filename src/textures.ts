import * as THREE from 'three';

// Procedural textures, drawn on canvases at startup. Colour maps come with a
// matching normal map built from a height field, so surfaces catch the light.

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Tileable fractal value noise in [0, 1]. */
export function fbm(size: number, seed: number, periods = [4, 8, 16, 32, 64], falloff = 0.55): Float32Array {
  const r = rand(seed);
  const out = new Float32Array(size * size);
  let amp = 1, total = 0;
  for (const p of periods) {
    const lat = new Float32Array(p * p);
    for (let i = 0; i < lat.length; i++) lat[i] = r();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * p, iy = Math.floor(fy), ty = fy - iy;
      const sy = ty * ty * (3 - 2 * ty);
      const y0 = iy % p, y1 = (iy + 1) % p;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * p, ix = Math.floor(fx), tx = fx - ix;
        const sx = tx * tx * (3 - 2 * tx);
        const x0 = ix % p, x1 = (ix + 1) % p;
        const a = lat[y0 * p + x0], b = lat[y0 * p + x1], c = lat[y1 * p + x0], d = lat[y1 * p + x1];
        out[y * size + x] += amp * ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy);
      }
    }
    total += amp;
    amp *= falloff;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function colorTex(c: HTMLCanvasElement, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Normal map from a height field (Sobel), wrapping at the edges. */
function normalTex(h: Float32Array, w: number, hh: number, strength: number) {
  const [c, g] = canvas(w, hh);
  const img = g.createImageData(w, hh);
  const at = (x: number, y: number) => h[((y + hh) % hh) * w + ((x + w) % w)];
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      let nx = -dx * strength, ny = dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function heightFrom(g: CanvasRenderingContext2D, w: number, h: number) {
  const d = g.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] / 255;
  return out;
}

function grain(g: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number, tint = [1, 1, 1]) {
  const r = rand(seed);
  const img = g.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * amount;
    img.data[i] += n * tint[0];
    img.data[i + 1] += n * tint[1];
    img.data[i + 2] += n * tint[2];
  }
  g.putImageData(img, 0, 0);
}

/** Mono-yellow wallpaper with a faint embossed motif. Covers one 3 m wall panel. */
export function wallpaper() {
  const S = 512;
  const [c, g] = canvas(S, S);
  const [hc, hg] = canvas(S, S);
  const low = fbm(S, 11, [2, 4, 8]);
  // Base colour with slow blotchy variation (old paper, uneven fading).
  const img = g.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = 0.9 + low[i] * 0.2;
    img.data[i * 4] = 201 * v;
    img.data[i * 4 + 1] = 182 * v;
    img.data[i * 4 + 2] = 98 * v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  hg.fillStyle = '#808080';
  hg.fillRect(0, 0, S, S);

  // Vertical stripes.
  const stripes = 16, sw = S / stripes;
  for (let i = 0; i < stripes; i++) {
    const x = i * sw;
    g.fillStyle = 'rgba(130,108,40,0.10)';
    g.fillRect(x, 0, 2, S);
    g.fillStyle = 'rgba(255,240,180,0.07)';
    g.fillRect(x + sw / 2 - 1, 0, 2, S);
    hg.fillStyle = '#999';
    hg.fillRect(x, 0, 2, S);
  }
  // Staggered motif: small lozenges with a dot, embossed.
  const rows = 14;
  for (let row = 0; row < rows; row++) {
    const y = (row + 0.5) * (S / rows);
    for (let i = 0; i < stripes; i++) {
      const x = (i + (row % 2 ? 0.5 : 0)) * sw;
      for (const [ctx, fill, dot] of [[g, 'rgba(120,95,35,0.09)', 'rgba(120,95,35,0.14)'], [hg, '#a0a0a0', '#acacac']] as const) {
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.moveTo(x, y - 7);
        ctx.quadraticCurveTo(x + 2, y - 2, x + 5, y);
        ctx.quadraticCurveTo(x + 2, y + 2, x, y + 7);
        ctx.quadraticCurveTo(x - 2, y + 2, x - 5, y);
        ctx.quadraticCurveTo(x - 2, y - 2, x, y - 7);
        ctx.fill();
        ctx.fillStyle = dot;
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    }
  }
  grain(g, S, S, 10, 3);
  grain(hg, S, S, 40, 4);
  // Paper seams every 4 stripes, slightly lifted.
  for (let i = 0; i < stripes; i += 4) {
    g.fillStyle = 'rgba(90,70,25,0.18)';
    g.fillRect(i * sw, 0, 1, S);
    hg.fillStyle = '#404040';
    hg.fillRect(i * sw, 0, 1, S);
  }
  return { map: colorTex(c), normal: normalTex(heightFrom(hg, S, S), S, S, 1.6) };
}

/** Damp, worn office carpet. Covers one 3 m cell. */
export function carpet() {
  const S = 512;
  const [c, g] = canvas(S, S);
  const low = fbm(S, 21, [4, 8, 16]);
  const r = rand(22);
  const img = g.createImageData(S, S);
  const height = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) {
    const pile = r();
    const v = 0.78 + low[i] * 0.3 + (pile - 0.5) * 0.22;
    img.data[i * 4] = 146 * v;
    img.data[i * 4 + 1] = 124 * v;
    img.data[i * 4 + 2] = 66 * v;
    img.data[i * 4 + 3] = 255;
    height[i] = pile * 0.7 + low[i] * 0.3;
  }
  g.putImageData(img, 0, 0);
  // Darker stray fibres.
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = r() < 0.5 ? 'rgba(70,55,25,0.35)' : 'rgba(190,165,105,0.25)';
    const x = r() * S, y = r() * S, a = r() * Math.PI;
    g.fillRect(x, y, 1 + Math.cos(a) * 2, 1 + Math.sin(a) * 2);
  }
  return { map: colorTex(c), normal: normalTex(height, S, S, 2.2) };
}

/** Acoustic drop-ceiling tiles in a T-bar grid, 4×4 tiles per cell. */
export function ceiling() {
  const S = 512, N = 4, T = S / N;
  const [c, g] = canvas(S, S);
  const [hc, hg] = canvas(S, S);
  const r = rand(31);
  g.fillStyle = '#d9d1b4';
  g.fillRect(0, 0, S, S);
  hg.fillStyle = '#808080';
  hg.fillRect(0, 0, S, S);
  // Fissured acoustic pits.
  for (let i = 0; i < 5000; i++) {
    const x = r() * S, y = r() * S, l = 1 + r() * 3, a = r() * Math.PI;
    g.strokeStyle = `rgba(110,100,80,${0.08 + r() * 0.14})`;
    hg.strokeStyle = '#606060';
    for (const ctx of [g, hg]) {
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
  }
  // Each tile a touch different.
  for (let ty = 0; ty < N; ty++) {
    for (let tx = 0; tx < N; tx++) {
      g.fillStyle = `rgba(${r() < 0.5 ? '255,250,230' : '150,130,90'},${r() * 0.08})`;
      g.fillRect(tx * T, ty * T, T, T);
    }
  }
  // T-bar grid.
  for (let i = 0; i <= N; i++) {
    for (const ctx of [g, hg]) {
      ctx.fillStyle = ctx === g ? '#c9c4b2' : '#e8e8e8';
      ctx.fillRect(i * T - 3, 0, 6, S);
      ctx.fillRect(0, i * T - 3, S, 6);
      ctx.fillStyle = ctx === g ? 'rgba(80,75,60,0.6)' : '#202020';
      ctx.fillRect(i * T - 5, 0, 1, S);
      ctx.fillRect(i * T + 3, 0, 1, S);
      ctx.fillRect(0, i * T - 5, S, 1);
      ctx.fillRect(0, i * T + 3, S, 1);
    }
  }
  grain(g, S, S, 8, 32);
  return { map: colorTex(c), normal: normalTex(heightFrom(hg, S, S), S, S, 1.2) };
}

/** Fluorescent troffer: aluminium frame around a prismatic diffuser. */
export function panel() {
  const [c, g] = canvas(256, 128);
  g.fillStyle = '#8c8a84';
  g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#ffffff';
  g.fillRect(8, 8, 240, 112);
  g.strokeStyle = 'rgba(200,205,215,0.6)';
  g.lineWidth = 1;
  for (let x = 8; x < 248; x += 4) { g.beginPath(); g.moveTo(x, 8); g.lineTo(x, 120); g.stroke(); }
  for (let y = 8; y < 120; y += 4) { g.beginPath(); g.moveTo(8, y); g.lineTo(248, y); g.stroke(); }
  // Tubes showing faintly through.
  for (const y of [40, 88]) {
    const grad = g.createLinearGradient(0, y - 14, 0, y + 14);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.5, 'rgba(255,255,250,1)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(12, y - 14, 232, 28);
  }
  g.fillStyle = 'rgba(40,30,10,0.35)'; // dead bugs in the corner
  g.fillRect(20, 100, 18, 10);
  return colorTex(c, false);
}

export function vent() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#b9b5a6';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#1b1a17';
  for (let y = 14; y < 114; y += 10) g.fillRect(12, y, 104, 5);
  g.strokeStyle = '#8a8676';
  g.lineWidth = 4;
  g.strokeRect(4, 4, 120, 120);
  grain(g, 128, 128, 20, 41);
  return colorTex(c, false);
}

export function outlet() {
  const [c, g] = canvas(64, 96);
  g.fillStyle = '#e9e4d2';
  g.fillRect(0, 0, 64, 96);
  g.fillStyle = '#2a2722';
  for (const y of [22, 60]) {
    g.fillRect(22, y, 5, 13);
    g.fillRect(37, y, 5, 13);
    g.beginPath();
    g.arc(32, y + 21, 3, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#9a9483';
  g.beginPath();
  g.arc(32, 48, 3, 0, Math.PI * 2);
  g.fill();
  return colorTex(c, false);
}

/** World-space grime: R = big damp patches, G = finer mottling, B = vertical drip streaks. */
export function grime() {
  const S = 256;
  const a = fbm(S, 51, [2, 4, 8, 16]);
  const b = fbm(S, 52, [8, 16, 32, 64]);
  const col = fbm(S, 53, [16, 32, 64]); // only rows matter: stretched into streaks
  const [c, g] = canvas(S, S);
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      img.data[i * 4] = a[i] * 255;
      img.data[i * 4 + 1] = b[i] * 255;
      img.data[i * 4 + 2] = col[x] * 255;
      img.data[i * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function exitSign() {
  const [c, g] = canvas(256, 96);
  g.fillStyle = '#0b1a0d';
  g.fillRect(0, 0, 256, 96);
  g.strokeStyle = '#2b3a2d';
  g.lineWidth = 6;
  g.strokeRect(3, 3, 250, 90);
  g.fillStyle = '#6dff86';
  g.font = 'bold 64px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('EXIT', 128, 52);
  return colorTex(c, false);
}

export function chalkArrow() {
  const [c, g] = canvas(128, 128);
  const r = rand(61);
  g.lineCap = 'round';
  // Several rough passes, like real chalk on carpet.
  for (let pass = 0; pass < 4; pass++) {
    g.strokeStyle = `rgba(245,245,238,${0.35 + r() * 0.25})`;
    g.lineWidth = 5 + r() * 4;
    const j = () => (r() - 0.5) * 5;
    g.beginPath();
    g.moveTo(64 + j(), 112 + j()); g.lineTo(64 + j(), 22 + j());
    g.moveTo(32 + j(), 54 + j()); g.lineTo(64 + j(), 18 + j()); g.lineTo(96 + j(), 54 + j());
    g.stroke();
  }
  return colorTex(c, false);
}

export function blobShadow() {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.3)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export function dustSprite() {
  const [c, g] = canvas(32, 32);
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,245,220,1)');
  grad.addColorStop(1, 'rgba(255,245,220,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}
