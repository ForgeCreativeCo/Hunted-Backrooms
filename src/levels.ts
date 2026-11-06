import { RNG } from './rng';

/**
 * What one level of the Backrooms is: how the generator lays it out, how it
 * looks and sounds, and the line players remember it by. Every level of a run
 * is one of these, picked from the run's seed and the depth, so the server and
 * every client agree on it without being told.
 */
export interface LevelDef {
  id: 'level0' | 'poolrooms' | 'street';
  /** As the HUD and end screen name it. */
  name: string;
  /** Shown as players arrive. */
  signature: string;
  /** A side level: reached only now and then, through an ordinary-looking exit. */
  rare: boolean;
  gen: {
    /** One room walled in and gone red. */
    manila: boolean;
    /** Light circuits that never had power. */
    dark: number;
    /** A circuit of soaked carpet with holes in the floor. */
    pitfalls: boolean;
    /** Circuits where the furniture gathers. */
    furnished: number;
    /** White tile and water: in one circuit, or the whole level. */
    pool: 'none' | 'region' | 'all';
    /** A suburban street built inside a long hall. */
    street: boolean;
  };
  look: {
    /** The air's colour where the lights are on. */
    fog: number;
    /** The colour of the light bouncing off walls and floor. */
    ambient: number;
    /** How loud the lights hum, 1 = Level 0's buzz. */
    hum: number;
  };
}

const YELLOW = { fog: 0x3a321a, ambient: 0xffeab0, hum: 1 };

export const LEVEL0: LevelDef = {
  id: 'level0',
  name: 'Level 0',
  signature: 'The same yellow rooms. The same hum.',
  rare: false,
  gen: { manila: true, dark: 1, pitfalls: true, furnished: 3, pool: 'none', street: false },
  look: YELLOW,
};

export const POOLROOMS: LevelDef = {
  id: 'poolrooms',
  name: 'The Poolrooms',
  signature: 'Tile and water, as far as you can see. Every step splashes.',
  rare: true,
  gen: { manila: false, dark: 1, pitfalls: false, furnished: 0, pool: 'all', street: false },
  look: { fog: 0x6f8f8c, ambient: 0xe4f6f3, hum: 0.25 },
};

export const STREET: LevelDef = {
  id: 'street',
  name: 'The Street',
  signature: 'Somebody built a neighbourhood in here. One house still has its door open.',
  rare: true,
  gen: { manila: false, dark: 1, pitfalls: false, furnished: 2, pool: 'none', street: true },
  look: YELLOW,
};

/** The main way down, in order. Below its end it comes round again. Only Level 0 exists so far. */
const MAIN: LevelDef[] = [LEVEL0];
const RARE: LevelDef[] = [POOLROOMS, STREET];
/** Chance that any exit below the first level leads to a side level instead. */
const RARE_CHANCE = 0.2;

function isRare(seed: string, depth: number): boolean {
  if (depth <= 1) return false;
  // A side level is a one-level detour: never two in a row.
  if (isRare(seed, depth - 1)) return false;
  return new RNG(`${seed}:rare${depth}`).chance(RARE_CHANCE);
}

/** Which level a run reaches at this depth (1 = the first). */
export function levelFor(seed: string, depth: number): LevelDef {
  if (isRare(seed, depth)) return new RNG(`${seed}:side${depth}`).pick(RARE);
  // Side levels don't count towards the main way down.
  let step = 0;
  for (let d = 1; d < depth; d++) if (!isRare(seed, d)) step++;
  return MAIN[step % MAIN.length];
}

/** A level as the end screen and logs name it: "Level 0, depth 3". */
export function placeName(seed: string, depth: number) {
  return `${levelFor(seed, depth).name}, depth ${depth}`;
}
