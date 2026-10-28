// Seeded random numbers (mulberry32), so a seed always rebuilds the same night.
export class RNG {
  private s: number;

  constructor(seed: string | number) {
    this.s = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
  }

  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Integer in [lo, hi). With one argument, [0, lo). */
  int(lo: number, hi?: number): number {
    if (hi === undefined) [lo, hi] = [0, lo];
    return lo + Math.floor(this.next() * (hi - lo));
  }

  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

export function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function randomSeed(): string {
  const words = ['damp', 'hum', 'yellow', 'moist', 'buzz', 'carpet', 'void', 'pale', 'lobby', 'static', 'mono', 'drip'];
  const w = words[Math.floor(Math.random() * words.length)];
  return `${w}-${Math.floor(Math.random() * 9000 + 1000)}`;
}
