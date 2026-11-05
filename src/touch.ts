// Touch controls for phones and tablets: a floating stick on the left half of the
// screen, drag to look on the right, and buttons for everything the keys do.

const STICK_R = 56; // px the knob can travel from where the thumb landed
const TAP_MS = 260;
const TAP_PX = 12;

interface Drag {
  kind: 'stick' | 'look';
  x0: number;
  y0: number;
  x: number;
  y: number;
  t0: number;
  moved: number;
}

export class TouchControls {
  /** Stick direction: x right, y forward, length 0..1. */
  move = { x: 0, y: 0 };
  /** Pushed to the rim of the stick: sprint. */
  sprint = false;
  onLook: (dx: number, dy: number) => void = () => {};
  /** A quick tap anywhere on the play area, in client pixels. */
  onTap: (x: number, y: number) => void = () => {};

  private drags = new Map<number, Drag>();
  private active = false;

  constructor(private pad: HTMLElement, private base: HTMLElement, private knob: HTMLElement) {
    pad.addEventListener('pointerdown', (e) => this.down(e));
    pad.addEventListener('pointermove', (e) => this.moveTo(e));
    pad.addEventListener('pointerup', (e) => this.up(e));
    pad.addEventListener('pointercancel', (e) => this.up(e, true));
    // No long-press menu or text selection on the play area.
    pad.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** Shown only while playing; hiding drops any held stick. */
  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    this.pad.hidden = !on;
    if (!on) this.reset();
  }

  reset() {
    this.drags.clear();
    this.move = { x: 0, y: 0 };
    this.sprint = false;
    this.base.hidden = true;
  }

  private down(e: PointerEvent) {
    e.preventDefault();
    try { this.pad.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    const left = e.clientX < window.innerWidth * 0.45;
    const stickTaken = [...this.drags.values()].some((d) => d.kind === 'stick');
    const kind = left && !stickTaken ? 'stick' : 'look';
    this.drags.set(e.pointerId, { kind, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), moved: 0 });
    if (kind === 'stick') {
      this.base.hidden = false;
      this.base.style.left = `${e.clientX}px`;
      this.base.style.top = `${e.clientY}px`;
      this.knob.style.transform = 'translate(-50%, -50%)';
    }
  }

  private moveTo(e: PointerEvent) {
    const d = this.drags.get(e.pointerId);
    if (!d) return;
    e.preventDefault();
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    d.moved = Math.max(d.moved, Math.hypot(d.x - d.x0, d.y - d.y0));
    if (d.kind === 'look') {
      this.onLook(dx, dy);
      return;
    }
    let ox = d.x - d.x0, oy = d.y - d.y0;
    const len = Math.hypot(ox, oy);
    if (len > STICK_R) { ox *= STICK_R / len; oy *= STICK_R / len; }
    this.knob.style.transform = `translate(calc(-50% + ${ox}px), calc(-50% + ${oy}px))`;
    const k = Math.min(1, len / STICK_R);
    const dead = 0.18;
    if (k < dead) this.move = { x: 0, y: 0 };
    else this.move = { x: ox / STICK_R, y: -oy / STICK_R };
    this.sprint = k > 0.95;
    this.base.classList.toggle('rim', this.sprint);
  }

  private up(e: PointerEvent, cancelled = false) {
    const d = this.drags.get(e.pointerId);
    if (!d) return;
    this.drags.delete(e.pointerId);
    if (d.kind === 'stick') {
      this.move = { x: 0, y: 0 };
      this.sprint = false;
      this.base.hidden = true;
      this.base.classList.remove('rim');
    }
    if (!cancelled && d.moved < TAP_PX && performance.now() - d.t0 < TAP_MS) this.onTap(d.x0, d.y0);
  }
}

/** Phones and tablets: no hover and a coarse pointer. Hybrids switch on their first touch. */
export function isTouchDevice() {
  return matchMedia('(hover: none) and (pointer: coarse)').matches;
}
