import * as THREE from 'three';

// Procedural placeholder textures, drawn on canvases at startup.

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, amount: number) {
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function tex(c: HTMLCanvasElement, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

export function wallpaper() {
  const [c, g] = canvas(256, 256);
  g.fillStyle = '#c9b660';
  g.fillRect(0, 0, 256, 256);
  // Faint vertical stripes and a small repeating motif.
  for (let x = 0; x < 256; x += 32) {
    g.fillStyle = 'rgba(120,100,30,0.12)';
    g.fillRect(x, 0, 3, 256);
    g.fillStyle = 'rgba(255,240,170,0.08)';
    g.fillRect(x + 16, 0, 2, 256);
  }
  g.fillStyle = 'rgba(110,90,30,0.18)';
  for (let y = 8; y < 256; y += 24) {
    for (let x = 8; x < 256; x += 32) {
      const ox = (y / 24) % 2 ? 16 : 0;
      g.beginPath();
      g.moveTo(x + ox, y - 4);
      g.lineTo(x + ox + 4, y);
      g.lineTo(x + ox, y + 4);
      g.lineTo(x + ox - 4, y);
      g.fill();
    }
  }
  // Damp stain creeping up from the floor, and a baseboard.
  const grad = g.createLinearGradient(0, 256, 0, 170);
  grad.addColorStop(0, 'rgba(80,60,20,0.45)');
  grad.addColorStop(1, 'rgba(80,60,20,0)');
  g.fillStyle = grad;
  g.fillRect(0, 170, 256, 86);
  g.fillStyle = '#6b5a2e';
  g.fillRect(0, 246, 256, 10);
  noise(g, 256, 256, 18);
  return tex(c);
}

export function carpet() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#8c7a42';
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(60,50,20,0.25)' : 'rgba(170,150,90,0.18)';
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  noise(g, 128, 128, 22);
  return tex(c);
}

export function ceiling() {
  const [c, g] = canvas(128, 128);
  g.fillStyle = '#cfc6a2';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = '#8f8667';
  g.lineWidth = 3;
  for (let i = 0; i <= 128; i += 64) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke();
  }
  noise(g, 128, 128, 14);
  return tex(c);
}

export function exitSign() {
  const [c, g] = canvas(128, 48);
  g.fillStyle = '#0b1a0d';
  g.fillRect(0, 0, 128, 48);
  g.fillStyle = '#5dff7a';
  g.font = 'bold 34px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('EXIT', 64, 26);
  return tex(c, false);
}

export function chalkArrow() {
  const [c, g] = canvas(128, 128);
  g.strokeStyle = 'rgba(245,245,240,0.9)';
  g.lineWidth = 9;
  g.lineCap = 'round';
  // Arrow pointing up (towards -v), rotated in the world later.
  g.beginPath();
  g.moveTo(64, 110); g.lineTo(64, 22);
  g.moveTo(34, 52); g.lineTo(64, 20); g.lineTo(94, 52);
  g.stroke();
  return tex(c, false);
}
