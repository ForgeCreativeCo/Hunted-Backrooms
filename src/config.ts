// Tuning values. Everything here is a first guess for the prototype.
export const CFG = {
  // Level
  W: 24,
  H: 24,
  CS: 3, // cell size in metres
  WALL_H: 2.7,
  CIRCUITS: 12,
  EXITS: 2,

  // Night
  NIGHT_SECONDS: 480,

  // The descent: what happens between levels
  EXIT_CLOSE: 45, // seconds from the first wanderer getting out until the exits close
  FEAR_CARRY: 0.7, // fear eases this much on the way down (0.7 = 30% off)
  DREAD_CARRY: 0.5, // the monster keeps half its dread, never less than it starts a level with
  CHALK: 12, // chalk arrows each wanderer can draw in a whole run
  // Supply crates (Level 1)
  SUPPLY_BATTERY: 45, // battery a pack of batteries puts back
  SUPPLY_CHALK: 4, // chalk arrows in a box of chalk
  SUPPLY_CALM: 40, // fear a bottle of almond water takes away
  SUPPLY_REACH: 1.2, // metres from a crate a player can take what's in it
  QUOTA: 120,
  STARS: [120, 180, 240],
  WANDERER_ENTRY: [0, 25, 50], // seconds after dusk each wanderer noclips in

  // Monster
  MONSTER_SPEED: 2.7,
  MONSTER_RADIUS: 0.35,
  EYE_HEIGHT: 1.9,
  CATCH_REACH: 2.0,
  SEEP_SPEED: 0.9,
  SEEP_DURATION: 4,
  SEEP_COOLDOWN: 8,

  // Dread
  DREAD_START: 40,
  DREAD_MAX: 100,
  DREAD_BASE: 0.2, // per second
  DREAD_PER_FEAR: 0.008, // per second, per point of total fear

  // Abilities
  BLACKOUT_COST: 20,
  BLACKOUT_TIME: 20,
  SHIFT_COST: 15,

  // Wanderers
  VIEW_LIT: 6.5, // cells
  VIEW_DARK: 1.3, // cells
  EXIT_VIEW: 7, // cells; exit signs glow even in the dark
  NOTICE_RANGE: 2.4, // metres; senses something right behind them
  WALK: { panicker: 1.7, mapper: 1.35 },
  SPRINT: 4.0,
  EXHAUSTED: 1.0,
  STAMINA_DRAIN: 14,
  STAMINA_REGEN: 8,
  FEAR_MULT: { panicker: 1.4, mapper: 0.85 },
  SPLASH: 1.7, // footsteps in the Poolrooms' water carry this much further
  // Steam vents (Level 2)
  VENT_PERIOD: 11, // seconds from one burst of steam to the next
  VENT_ON: 4.5, // seconds each burst lasts
  VENT_RADIUS: 5, // metres: within this of a hissing vent, nothing is heard

  // Human players
  MAX_HUMANS: 4,
  HUMAN_WALK: 1.9,
  HUMAN_CROUCH: 1.0,
  HUMAN_RADIUS: 0.3,
  HUMAN_EYE: 1.62,
  CROUCH_EYE: 1.05,
  BATTERY_DRAIN: 1.1, // per second: about 90 s of light
  BEAM_RANGE: 10, // metres
  BEAM_COS: 0.93, // half-angle of about 21°
};

export type Kind = 'panicker' | 'mapper';
