/* ==========================================================================
   3D SHAPE PUTTER - GAME CONSTANTS & RULES
   Every tunable lives here so balancing never means hunting through modules.
   Pure module (no THREE / DOM) so it can be unit-tested in Node.
   Sizes come from the original 2D game (600 x 600 px canvas) at PX world
   units per pixel, so the 3D board plays like the 2D one.
   ========================================================================== */

export const VERSION = '2.0.0';

export const PX = 1 / 50; // 2D pixels -> world units (the 600 px board is 12 x 12)

// Board geometry (world units). Board-local frame: +x right, -z away from the player, y up.
export const BOARD = {
  HALF: 300 * PX,     // inner playing area is 2*HALF square
  RIM_W: 0.55,        // wooden frame width
  RIM_H: 0.36,        // frame height above the floor
  FLOOR_T: 0.3,       // floor slab thickness
  PUCK_H: 0.16,       // player puck thickness
  DISC_H: 0.13,       // moving obstacle puck thickness
  PIT_DEPTH: 2.2,     // obstacle holes
  GOAL_DEPTH: 1.1     // goal cup (the puck rests on its bottom)
};

// Obstacles, sized as in the 2D game
export const OBSTACLE = {
  HOLE_R: 25 * PX,
  DISC_R: 12 * PX,
  EDGE_PAD: 50 * PX,          // keep spawns this far from the frame
  GOAL_CLEAR: 150 * PX,       // obstacles spawn at least this far from the goal
  GAP: 15 * PX,               // spacing between obstacles at spawn
  HOLE_SPEED: 1 * 60 * PX,    // moving hole: up to 1 px/frame per axis at 60 fps
  DISC_SPEED: [1 * 60 * PX, 2.5 * 60 * PX], // cruise speed range
  PUCK_CLEAR: 50 * PX,        // the player puck spawns this far from hole edges
  MAX_TRIES: 400              // placement attempts before an obstacle is skipped (very high levels)
};

/** Obstacle counts per level (2D rules: more every 5 levels). */
export function obstacleCounts(n) {
  if (n <= 1) return { staticHoles: 0, movingHoles: 0, discs: 0 };
  const sets = Math.floor((n - 1) / 5);
  return { staticHoles: 2 + sets * 2, movingHoles: 1, discs: 3 + sets * 2 };
}

/*
 * Puck physics. DAMPING reproduces the 2D game's 0.99-per-frame friction at 60 fps
 * (-60 ln 0.99 ~ 0.6 /s); ROLL_DRAG adds a small constant drag so a slow puck stops
 * instead of creeping for ever.
 */
export const PHYS = {
  STEP: 1 / 240,           // fixed substep: max travel per step (22/240 ~ 0.09) << puck radius, no tunnelling
  DAMPING: 0.6,
  ROLL_DRAG: 0.35,
  STOP_SPEED: 0.06,
  MIN_SHOT: 0.6,           // speed of the weakest shot
  MAX_SHOT: 22,            // speed of a full-power shot
  POWER_CURVE: 1.7,        // speed grows with power^1.7
  MIN_POWER: 0.04,         // below this a release / OK does not shoot
  RIM_RESTITUTION: 0.8,
  DISC_RESTITUTION: 0.92,  // puck <-> disc and disc <-> disc
  CRUISE_EASE: 0.8,        // discs drift back to their cruise speed (1/s) so one hard hit can't send one flying for ever
  // A puck crossing a hole too fast skims over it, like a putt that lips out (the 2D game's
  // frame-by-frame check let fast pucks jump holes in the same way)
  SINK_SPEED: 8,           // goal: centre within (goal.r - puck.r) and slower than this
  SKIM_SPEED: 11,          // obstacle holes: centre over the hole and slower than this
  HIT_COOLDOWN: 0.2,       // one penalty per contact, not per substep
  SINK_TIME: 0.8,
  FALL_TIME: 0.75
};

// Scoring and pucks (lives): the 2D game's rules
export const SCORE = { BASE: 6000, PER_SHOT: 1000, HIT_PENALTY: 500, HITS_PER_PUCK: 10 };
export const PUCKS = { START: 5, BONUS_EVERY: 5, CHECKPOINT_EVERY: 5, MAX: 99 };

/** Stars for a cleared level: one-shot ace = 3, two or three shots = 2. The aim guide caps it at 2. */
export function starsFor(shots, guideUsed = false) {
  const s = shots <= 1 ? 3 : shots <= 3 ? 2 : 1;
  return guideUsed ? Math.min(2, s) : s;
}

/*
 * Board surfaces x puck types.
 *   grip   multiplies PHYS.DAMPING and ROLL_DRAG (higher = the puck stops sooner)
 *   bounce multiplies PHYS.RIM_RESTITUTION
 *   mass   multiplies the puck's mass in collisions (a steel puck barely deflects off the coloured discs)
 */
export const BOARD_SURFACES = {
  felt:  { name: 'Felt',  icon: '🟩', grip: 1.0, bounce: 1.0,  desc: 'Classic green baize, the original 2D look' },
  wood:  { name: 'Carrom', icon: '🪵', grip: 0.7, bounce: 0.85, desc: 'Polished, powdered carrom board: quick, soft cushions' },
  glass: { name: 'Glass', icon: '🧊', grip: 0.4, bounce: 1.1,  desc: 'Slippery: the puck glides a long way, pits show through' },
  neon:  { name: 'Neon',  icon: '💠', grip: 1.15, bounce: 1.05, desc: 'Arcade board, a little grippy, colour changes every 5 levels' }
};

export const PUCK_TYPES = {
  plastic: { name: 'Plastic', icon: '⚪', grip: 1.0, bounce: 1.0,  mass: 1.0, desc: 'Balanced all-rounder' },
  steel:   { name: 'Steel',   icon: '⚙️', grip: 0.75, bounce: 0.6, mass: 2.2, desc: 'Heavy: ploughs through discs, dead cushions' },
  rubber:  { name: 'Rubber',  icon: '🔴', grip: 1.35, bounce: 1.3, mass: 0.8, desc: 'Grippy and springy: big cushion bounces' }
};

export const DEFAULT_LOOK = { board: 'felt', puck: 'plastic' };

/** Effective physics for a board/puck pairing. */
export function surfacePhysics(boardId = DEFAULT_LOOK.board, puckId = DEFAULT_LOOK.puck) {
  const s = BOARD_SURFACES[boardId] || BOARD_SURFACES.felt;
  const p = PUCK_TYPES[puckId] || PUCK_TYPES.plastic;
  return {
    damping: PHYS.DAMPING * s.grip * p.grip,
    rollDrag: PHYS.ROLL_DRAG * s.grip * p.grip,
    rimRestitution: Math.min(0.95, PHYS.RIM_RESTITUTION * s.bounce * p.bounce),
    mass: p.mass
  };
}

// Camera views. OVERVIEW = whole board at an angle, TOP = almost straight down (closest to the 2D game),
// BEHIND = golf-style camera behind the puck looking along the aim.
export const VIEWS = ['OVERVIEW', 'TOP', 'BEHIND'];
export const CAMERA = { OVERVIEW_PITCH: 58, TOP_PITCH: 84, FOV: 50 };
export const BEHIND_VIEW = { BACK: 3.4, HEIGHT: 1.7, LOOK_AHEAD: 3.2, FOV: 62, YAW_EASE: 5 };

// Aiming (analog sources: gamepad, Quest thumbstick, phone tilt, phone controller)
export const AIM = {
  DEADZONE: 0.14,
  KEY_TURN: 1.6,    // rad/s with the arrow keys
  KEY_POWER: 0.85,  // power/s with the arrow keys
  RELEASE_RATE: 4   // stick magnitude falling faster than this (1/s) = the stick was let go: keep the aim
};

// WebXR (Quest): the board is placed relative to the player's head when VR starts (and on Recenter). Metres.
export const VR = {
  TABLE: { SIZE: 0.8, BELOW_EYES: 0.55, NEAR_EDGE: 0.15, TILT_DEG: 20 },
  FLOOR: { SIZE: 3.2, NEAR_EDGE: 0.4, STAND_EYE: 1.5 },
  HUD: { DIST: 1.1, FOV: 30, ASPECT: 1.6 }
};
