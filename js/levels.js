/* ==========================================================================
   3D SHAPE PUTTER - LEVEL GENERATOR (pure)
   Shapes and obstacle counts follow the 2D game. Each level number is a fixed
   seed, so "Level 7" is the same board for everyone, every time.
   ========================================================================== */

import { PX, BOARD, OBSTACLE, obstacleCounts } from './config.js';

/** mulberry32: small, fast, deterministic. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Puck + goal shape for a level (the 2D game's table: circle, square, triangle, diamond, then stars). */
export function levelShape(n) {
  switch (n) {
    case 1: return { type: 'circle', sides: 0, puckR: 15 * PX, goalR: 25 * PX, rotation: 0 };
    case 2: return { type: 'polygon', sides: 4, puckR: 20 * PX, goalR: 30 * PX, rotation: Math.PI / 4 };
    case 3: return { type: 'polygon', sides: 3, puckR: 20 * PX, goalR: 30 * PX, rotation: 0 };
    case 4: return { type: 'polygon', sides: 4, puckR: 20 * PX, goalR: 30 * PX, rotation: 0 };
    default: return { type: 'star', sides: n, puckR: 20 * PX, goalR: 30 * PX, rotation: 0 };
  }
}

export function shapeName(shape) {
  if (shape.type === 'circle') return 'Circle';
  if (shape.type === 'star') return `${shape.sides}-point star`;
  if (shape.sides === 3) return 'Triangle';
  return shape.rotation ? 'Square' : 'Diamond';
}

/**
 * Outline of a shape with outer radius r as [x, z] points (board plane, -z = up on the 2D canvas).
 * Same vertex maths as the 2D drawShape(), so the 3D pieces match the original shapes exactly.
 */
export function shapeOutline(shape, r, segments = 48) {
  const pts = [];
  if (shape.type === 'star') {
    const step = Math.PI / shape.sides;
    for (let i = 0; i < 2 * shape.sides; i++) {
      const rad = i % 2 === 0 ? r : r / 2;
      const a = (shape.rotation || 0) + i * step - Math.PI / 2;
      pts.push([rad * Math.cos(a), rad * Math.sin(a)]);
    }
  } else if (shape.type === 'circle' || !shape.sides) {
    for (let i = 0; i < segments; i++) { const a = (i / segments) * Math.PI * 2; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
  } else {
    const step = (Math.PI * 2) / shape.sides;
    for (let i = 0; i < shape.sides; i++) { const a = (shape.rotation || 0) + i * step; pts.push([r * Math.cos(a), r * Math.sin(a)]); }
  }
  return pts;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Random point inside the board, `pad` from the frame. */
function inside(rand, pad) {
  const span = 2 * (BOARD.HALF - pad);
  return { x: -BOARD.HALF + pad + rand() * span, z: -BOARD.HALF + pad + rand() * span };
}

/**
 * Build a level: shape, goal at the centre, obstacles placed so they never overlap each other or crowd
 * the goal. Unlike the 2D game's endless retry loop, placement gives up after MAX_TRIES (only matters on
 * very high levels, where the board is simply full).
 */
export function buildLevel(n) {
  const L = Math.max(1, Math.floor(n));
  const rand = rng(L * 7919 + 13);
  const shape = levelShape(L);
  const goal = { x: 0, z: 0, r: shape.goalR };
  const counts = obstacleCounts(L);
  const placed = [];
  const holes = [], discs = [];
  const place = (r, make) => {
    for (let t = 0; t < OBSTACLE.MAX_TRIES; t++) {
      const p = inside(rand, OBSTACLE.EDGE_PAD);
      if (dist(p, goal) < OBSTACLE.GOAL_CLEAR) continue;
      if (placed.some(o => dist(p, o) < r + o.r + OBSTACLE.GAP)) continue;
      const o = make(p);
      placed.push(o);
      return o;
    }
    return null;
  };
  for (let i = 0; i < counts.staticHoles; i++) {
    const h = place(OBSTACLE.HOLE_R, p => ({ ...p, r: OBSTACLE.HOLE_R, vx: 0, vz: 0, moving: false }));
    if (h) holes.push(h);
  }
  for (let i = 0; i < counts.movingHoles; i++) {
    const h = place(OBSTACLE.HOLE_R, p => ({
      ...p, r: OBSTACLE.HOLE_R, moving: true,
      vx: (rand() - 0.5) * 2 * OBSTACLE.HOLE_SPEED, vz: (rand() - 0.5) * 2 * OBSTACLE.HOLE_SPEED
    }));
    if (h) holes.push(h);
  }
  for (let i = 0; i < counts.discs; i++) {
    const d = place(OBSTACLE.DISC_R, p => {
      const [lo, hi] = OBSTACLE.DISC_SPEED;
      const speed = lo + rand() * (hi - lo), a = rand() * Math.PI * 2;
      return { ...p, r: OBSTACLE.DISC_R, vx: Math.cos(a) * speed, vz: Math.sin(a) * speed, cruise: speed, hue: Math.floor(rand() * 360) };
    });
    if (d) discs.push(d);
  }
  return { n: L, shape, goal, puckR: shape.puckR, holes, discs, seed: L * 7919 + 13 };
}

/**
 * A safe spot for the player puck: clear of the goal and of every hole and disc (the 2D game's
 * resetPuckPosition, with its distance typo fixed). Falls back to the safest point found.
 */
export function spawnPoint(level, rand, holes = level.holes, discs = level.discs) {
  const r = level.puckR, clear = OBSTACLE.PUCK_CLEAR;
  let best = null, bestGap = -Infinity;
  for (let t = 0; t < 600; t++) {
    const p = inside(rand, 1);
    let gap = dist(p, level.goal) - (level.goal.r + clear);
    for (const o of [...holes, ...discs]) gap = Math.min(gap, dist(p, o) - (o.r + r + clear));
    if (gap >= 0) return p;
    if (gap > bestGap) { bestGap = gap; best = p; }
  }
  return best;
}
