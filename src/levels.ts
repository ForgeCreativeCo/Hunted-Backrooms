import { RNG } from './rng';

/**
 * What one level of the Backrooms is: how the generator lays it out, how it
 * looks and sounds, how it bends the rules, and the line players remember it
 * by. Every level of a run is one of these, picked from the run's seed and the
 * depth, so the server and every client agree on it without being told.
 */
export interface LevelDef {
  id: 'level0' | 'level1' | 'level2' | 'level3' | 'level4' | 'level5' | 'level6' | 'poolrooms' | 'street';
  /** As the HUD and end screen name it. */
  name: string;
  /** Shown as players arrive. */
  signature: string;
  /** A side level: reached only now and then, through an ordinary-looking exit. */
  rare: boolean;
  gen: {
    /**
     * Office rooms of odd sizes; a warehouse of huge concrete halls; narrow
     * service tunnels; machinery halls with catwalks; open-plan floors of
     * cubicles; or a hotel's long corridors of numbered rooms.
     */
    rooms: 'office' | 'warehouse' | 'tunnels' | 'station' | 'openplan' | 'hotel';
    /** Is there power? 'none': every light in the level is dead. */
    power: 'on' | 'none';
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
    /** Supply crates left by someone who came through before. */
    supplies: number;
    /** Puddles on the floor: they splash like the Poolrooms' water. */
    puddles: number;
    /** Pipes along the walls. */
    pipes: boolean;
    /** Steam vents that hiss now and then, hiding every sound nearby. */
    vents: number;
    /** At most this many real exits, whatever the depth allows. */
    maxExits?: number;
    /** Fake exits on top of the depth's own. */
    extraFakes?: number;
  };
  look: {
    /** The air's colour where the lights are on. */
    fog: number;
    /** How thick the air is (0.042 = Level 0's murk). */
    fogDensity: number;
    /** The colour of the light bouncing off walls and floor. */
    ambient: number;
    /** How loud the lights hum, 1 = Level 0's buzz. */
    hum: number;
    /** Wallpaper, carpet and ceiling tile; bare concrete; a hotel's stripes and red carpet; or grey office. */
    surface: 'office' | 'concrete' | 'hotel' | 'grey';
  };
  rules: {
    /** How fast the dark frightens people, 1 = Level 0. */
    darkFear: number;
    /** How far wanderers can see, and spot an exit from, 1 = Level 0. */
    view: number;
    /** How hard the heat makes breathing: sprinting drains this much faster, and breath comes back this much slower. */
    heat: number;
    /** What a Blackout costs, as a share of its usual price. */
    blackoutCost?: number;
    /** Dark circuits spark now and then, lit for a moment. */
    sparks?: boolean;
  };
}

const YELLOW = { fog: 0x3a321a, fogDensity: 0.042, ambient: 0xffeab0, hum: 1, surface: 'office' as const };
const OFFICE = { rooms: 'office' as const, power: 'on' as const, supplies: 0, puddles: 0, pipes: false, vents: 0 };
const NORMAL = { darkFear: 1, view: 1, heat: 1 };

export const LEVEL0: LevelDef = {
  id: 'level0',
  name: 'Level 0',
  signature: 'The same yellow rooms. The same hum.',
  rare: false,
  gen: { ...OFFICE, manila: true, dark: 1, pitfalls: true, furnished: 3, pool: 'none', street: false },
  look: YELLOW,
  rules: NORMAL,
};

export const LEVEL1: LevelDef = {
  id: 'level1',
  name: 'Level 1',
  signature: 'Concrete, fog and dripping water. Somebody left supplies down here.',
  rare: false,
  gen: {
    rooms: 'warehouse', power: 'on', manila: false, dark: 1, pitfalls: false, furnished: 0, pool: 'none', street: false,
    supplies: 8, puddles: 30, pipes: false, vents: 0,
  },
  look: { fog: 0x3d4140, fogDensity: 0.075, ambient: 0xdde4e4, hum: 0.6, surface: 'concrete' },
  // The fog hides an exit until you're nearly on it.
  rules: { darkFear: 1, view: 0.5, heat: 1 },
};

export const LEVEL2: LevelDef = {
  id: 'level2',
  name: 'Level 2',
  signature: 'Hot, narrow tunnels and hissing pipes. When the steam goes, you can\'t hear a thing.',
  rare: false,
  gen: {
    rooms: 'tunnels', power: 'on', manila: false, dark: 1, pitfalls: false, furnished: 0, pool: 'none', street: false,
    supplies: 0, puddles: 10, pipes: true, vents: 16,
  },
  look: { fog: 0x3b2919, fogDensity: 0.05, ambient: 0xffc48a, hum: 0.5, surface: 'concrete' },
  rules: { darkFear: 1, view: 1, heat: 1.5 },
};

export const LEVEL3: LevelDef = {
  id: 'level3',
  name: 'Level 3',
  signature: 'Machinery halls and catwalks. Everything hums, sparks, and drowns out what\'s coming.',
  rare: false,
  gen: {
    rooms: 'station', power: 'on', manila: false, dark: 2, pitfalls: false, furnished: 0, pool: 'none', street: false,
    supplies: 0, puddles: 6, pipes: false, vents: 0,
  },
  look: { fog: 0x22282e, fogDensity: 0.05, ambient: 0xcfe0ff, hum: 1.7, surface: 'concrete' },
  rules: { darkFear: 1, view: 1, heat: 1, blackoutCost: 0.5, sparks: true },
};

export const LEVEL4: LevelDef = {
  id: 'level4',
  name: 'Level 4',
  signature: 'An empty office, every light on. It\'s quiet. Only one of these exits is real.',
  rare: false,
  gen: {
    rooms: 'openplan', power: 'on', manila: false, dark: 0, pitfalls: false, furnished: 0, pool: 'none', street: false,
    supplies: 0, puddles: 0, pipes: false, vents: 0, maxExits: 1, extraFakes: 2,
  },
  look: { fog: 0x34373a, fogDensity: 0.034, ambient: 0xf0f3f6, hum: 0.3, surface: 'grey' },
  rules: NORMAL,
};

export const LEVEL5: LevelDef = {
  id: 'level5',
  name: 'Level 5',
  signature: 'A hotel. Long corridors, numbered doors. Step into a room and it locks behind you, for a while.',
  rare: false,
  gen: {
    rooms: 'hotel', power: 'on', manila: false, dark: 1, pitfalls: false, furnished: 0, pool: 'none', street: false,
    supplies: 0, puddles: 0, pipes: false, vents: 0,
  },
  look: { fog: 0x2e1d14, fogDensity: 0.045, ambient: 0xffd9a8, hum: 0.5, surface: 'hotel' },
  // The corridors run long and straight, and everyone in them is easy to see.
  rules: { darkFear: 1, view: 1.25, heat: 1 },
};

export const LEVEL6: LevelDef = {
  id: 'level6',
  name: 'Level 6',
  signature: 'No power. No hum. Nothing but your light, and whatever is left in it.',
  rare: false,
  gen: { ...OFFICE, power: 'none', manila: false, dark: 0, pitfalls: false, furnished: 2, pool: 'none', street: false },
  look: { ...YELLOW, hum: 0 },
  // The whole level is dark, so the dark gets to you more slowly than one dead room
  // would; but nowhere is lit, so nowhere calms you down.
  rules: { darkFear: 0.5, view: 1, heat: 1 },
};

export const POOLROOMS: LevelDef = {
  id: 'poolrooms',
  name: 'The Poolrooms',
  signature: 'Tile and water, as far as you can see. Every step splashes.',
  rare: true,
  gen: { ...OFFICE, manila: false, dark: 1, pitfalls: false, furnished: 0, pool: 'all', street: false },
  look: { fog: 0x6f8f8c, fogDensity: 0.042, ambient: 0xe4f6f3, hum: 0.25, surface: 'office' },
  rules: NORMAL,
};

export const STREET: LevelDef = {
  id: 'street',
  name: 'The Street',
  signature: 'Somebody built a neighbourhood in here. One house still has its door open.',
  rare: true,
  gen: { ...OFFICE, manila: false, dark: 1, pitfalls: false, furnished: 2, pool: 'none', street: true },
  look: YELLOW,
  rules: NORMAL,
};

export const LEVELS: LevelDef[] = [LEVEL0, LEVEL1, LEVEL2, LEVEL3, LEVEL4, LEVEL5, LEVEL6, POOLROOMS, STREET];

/**
 * The main way down, in order. Below its end it comes round again, darker and
 * with fewer exits each time (see the dials).
 */
const MAIN: LevelDef[] = [LEVEL0, LEVEL1, LEVEL2, LEVEL3, LEVEL4, LEVEL5, LEVEL6];
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

/**
 * What tightens with depth, under whatever level it is. Starting guesses for
 * playtesting, not tuned numbers.
 */
export interface Dials {
  /** Real exits. */
  exits: number;
  /** Exits that look and glow real, but open onto brick. */
  fakeExits: number;
  /** Share of light circuits with power (the rest are dead from the start). */
  lit: number;
  /** The monster's dread as it arrives. */
  dread: number;
  /** Fear the monster must harvest for the level to count as its win. */
  quota: number;
  /** Seconds from the first one out until the exits close. */
  exitClose: number;
}

// depth, exits, fake exits, lit, dread, quota, countdown. Between these depths
// the dials move in a straight line; below the last they stay put.
const DIALS: number[][] = [
  [1, 2, 0, 1, 40, 120, 45],
  [4, 2, 1, 0.85, 55, 100, 40],
  [8, 1, 2, 0.65, 70, 80, 30],
  [12, 1, 3, 0.5, 80, 60, 25],
];

export function dialsFor(depth: number): Dials {
  const d = Math.max(1, depth);
  let i = 0;
  while (i < DIALS.length - 2 && d > DIALS[i + 1][0]) i++;
  const [a, b] = [DIALS[i], DIALS[i + 1]];
  const k = Math.min(1, (d - a[0]) / (b[0] - a[0]));
  const at = (j: number) => a[j] + (b[j] - a[j]) * k;
  return {
    exits: Math.round(at(1)),
    fakeExits: Math.round(at(2)),
    lit: at(3),
    dread: Math.round(at(4)),
    quota: Math.round(at(5) / 5) * 5,
    exitClose: Math.round(at(6)),
  };
}

/** A level as the end screen and logs name it: "Level 0, depth 3". */
export function placeName(seed: string, depth: number) {
  return `${levelFor(seed, depth).name}, depth ${depth}`;
}
