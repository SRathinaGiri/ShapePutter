/* ==========================================================================
   3D SHAPE PUTTER - PHYSICS (pure: no THREE / DOM, unit-tested in Node)
   Board plane x/z. One player puck, coloured discs that cruise around and
   bounce off everything, holes (some moving) and the shaped goal.
   Collisions use circles of the shape's outer radius, as the 2D game did.
   ========================================================================== */

import { BOARD, PHYS, OBSTACLE, DEFAULT_LOOK, surfacePhysics } from './config.js';
import { rng, spawnPoint } from './levels.js';

const hyp = Math.hypot;

/** Bounce a moving circle off the inside of the square frame. Returns the normal speed of the hit (0 = none). */
function rimBounce(o, r, restitution) {
  const lim = BOARD.HALF - r;
  let hit = 0;
  if (o.x > lim) { o.x = lim; if (o.vx > 0) { hit = Math.max(hit, o.vx); o.vx = -o.vx * restitution; } }
  else if (o.x < -lim) { o.x = -lim; if (o.vx < 0) { hit = Math.max(hit, -o.vx); o.vx = -o.vx * restitution; } }
  if (o.z > lim) { o.z = lim; if (o.vz > 0) { hit = Math.max(hit, o.vz); o.vz = -o.vz * restitution; } }
  else if (o.z < -lim) { o.z = -lim; if (o.vz < 0) { hit = Math.max(hit, -o.vz); o.vz = -o.vz * restitution; } }
  return hit;
}

/** Keep circle `o` (radius r) outside a fixed circle c at distance >= minD, reflecting its velocity. */
function keepOut(o, c, minD) {
  const dx = o.x - c.x, dz = o.z - c.z, d = hyp(dx, dz);
  if (d >= minD) return false;
  const nx = d > 1e-9 ? dx / d : 1, nz = d > 1e-9 ? dz / d : 0;
  o.x = c.x + nx * minD; o.z = c.z + nz * minD;
  const vn = o.vx * nx + o.vz * nz;
  if (vn < 0) { o.vx -= 2 * vn * nx; o.vz -= 2 * vn * nz; }
  return true;
}

/**
 * Elastic-ish collision of two circles with masses (the 2D game's 1-D momentum exchange along the
 * normal, plus restitution). Returns the closing speed, or 0 when they don't touch.
 */
export function collide(a, ra, ma, b, rb, mb, e = PHYS.DISC_RESTITUTION) {
  const dx = b.x - a.x, dz = b.z - a.z, d = hyp(dx, dz), min = ra + rb;
  if (d >= min) return 0;
  const nx = d > 1e-9 ? dx / d : 1, nz = d > 1e-9 ? dz / d : 0;
  // Separate by inverse mass so a heavy puck is pushed less
  const overlap = min - d, wa = mb / (ma + mb), wb = ma / (ma + mb);
  a.x -= nx * overlap * wa; a.z -= nz * overlap * wa;
  b.x += nx * overlap * wb; b.z += nz * overlap * wb;
  const rel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz; // > 0 = closing
  if (rel <= 0) return 0.0001; // touching but already separating: still a contact
  const j = (1 + e) * rel / (1 / ma + 1 / mb);
  a.vx -= (j / ma) * nx; a.vz -= (j / ma) * nz;
  b.vx += (j / mb) * nx; b.vz += (j / mb) * nz;
  return rel;
}

/** Friction for one substep: proportional damping plus a constant rolling drag. */
function rub(o, surf, h) {
  const s = hyp(o.vx, o.vz);
  if (s === 0) return 0;
  const ns = Math.max(0, s - (s * surf.damping + surf.rollDrag) * h);
  o.vx *= ns / s; o.vz *= ns / s;
  return ns;
}

export class PuttWorld {
  /**
   * @param level from buildLevel()
   * @param surf  from surfacePhysics()
   * @param seed  spawn randomness (defaults to the level seed, so a level always starts the same way)
   */
  constructor(level, surf = surfacePhysics(DEFAULT_LOOK.board, DEFAULT_LOOK.puck), seed = level.seed) {
    this.level = level;
    this.surf = surf;
    this.rand = rng(seed ^ 0x5bd1e995);
    this.goal = { ...level.goal };
    this.holes = level.holes.map(h => ({ ...h }));
    this.discs = level.discs.map(d => ({ ...d, cool: 0 }));
    // Masses as in the 2D game (proportional to size), times the puck type
    this.puck = { x: 0, z: 0, y: 0, vx: 0, vz: 0, r: level.puckR, mass: level.puckR * surf.mass, state: 'rest', t: 0, hole: null };
    this.time = 0;
    this.respawn();
  }

  /** Independent copy of the current state (look-ahead for the autopilot test; shares the spawn RNG). */
  clone() {
    const w = Object.create(PuttWorld.prototype);
    Object.assign(w, this);
    w.goal = { ...this.goal };
    w.holes = this.holes.map(h => ({ ...h }));
    w.discs = this.discs.map(d => ({ ...d }));
    w.puck = { ...this.puck, hole: null };
    return w;
  }

  /** Puck still and on the board: it may be shot. */
  get ready() { return this.puck.state === 'rest'; }
  get sunk() { return this.puck.state === 'sunk'; }
  get fallen() { return this.puck.state === 'fallen'; }

  respawn() {
    const p = this.puck;
    const at = spawnPoint(this.level, this.rand, this.holes, this.discs);
    Object.assign(p, { x: at.x, z: at.z, y: 0, vx: 0, vz: 0, state: 'rest', t: 0, hole: null });
  }

  /** angle: direction of travel, (sin a, -cos a) on the board (0 = away from the player). power 0..1. */
  shoot(angle, power) {
    if (!this.ready || power < PHYS.MIN_POWER) return false;
    const v = shotSpeed(power);
    this.puck.vx = Math.sin(angle) * v;
    this.puck.vz = -Math.cos(angle) * v;
    this.puck.state = 'move';
    return true;
  }

  /**
   * Advance by dt. ev callbacks (all optional): rim(speed), hit(disc, speed) = player puck touched a disc
   * (penalty), knock(speed) = disc-disc, sink(), fall(hole).
   */
  step(dt, ev = {}) {
    const n = Math.max(1, Math.ceil(dt / PHYS.STEP - 1e-9)), h = dt / n;
    for (let i = 0; i < n; i++) this.substep(h, ev);
  }

  substep(h, ev) {
    this.time += h;
    const p = this.puck, surf = this.surf;

    // Moving holes drift and bounce off the frame, the static holes, the goal (it always stays open)
    // and a puck at rest (so a hole never swallows a puck that is waiting to be shot)
    for (const hole of this.holes) {
      if (!hole.moving) continue;
      hole.x += hole.vx * h; hole.z += hole.vz * h;
      keepOut(hole, this.goal, this.goal.r + hole.r + 0.6);
      for (const o of this.holes) if (o !== hole) keepOut(hole, o, o.r + hole.r + 0.1);
      if (p.state === 'rest') keepOut(hole, p, p.r + hole.r);
      rimBounce(hole, OBSTACLE.EDGE_PAD, 1); // as far from the frame as at spawn: a disc always fits between
    }

    // Discs cruise without friction (2D rules) but drift back to their own speed after a hit
    for (const d of this.discs) {
      d.cool = Math.max(0, d.cool - h);
      const s = hyp(d.vx, d.vz);
      const ns = s + (d.cruise - s) * Math.min(1, PHYS.CRUISE_EASE * h);
      if (s > 1e-6) { d.vx *= ns / s; d.vz *= ns / s; } else { d.vx = ns; d.vz = 0; }
      d.x += d.vx * h; d.z += d.vz * h;
      // They skate around the pits instead of floating over them; the frame wins last
      for (const hole of this.holes) keepOut(d, hole, hole.r + d.r * 0.5);
      keepOut(d, this.goal, this.goal.r + d.r * 0.5);
      rimBounce(d, d.r, 1);
    }
    for (let i = 0; i < this.discs.length; i++) {
      for (let j = i + 1; j < this.discs.length; j++) {
        const a = this.discs[i], b = this.discs[j];
        const s = collide(a, a.r, a.r, b, b.r, b.r);
        if (s > 0.5 && ev.knock) ev.knock(s);
      }
    }

    if (p.state === 'sink' || p.state === 'fall') { this.updateDrop(h, ev); return; }
    if (p.state !== 'rest' && p.state !== 'move') return;

    // Player puck
    p.x += p.vx * h; p.z += p.vz * h;
    rub(p, surf, h);
    const rim = rimBounce(p, p.r, surf.rimRestitution);
    if (rim > 0.3 && ev.rim) ev.rim(rim);
    for (const d of this.discs) {
      const s = collide(p, p.r, p.mass, d, d.r, d.r);
      if (s > 0 && d.cool <= 0) { d.cool = PHYS.HIT_COOLDOWN; if (ev.hit) ev.hit(d, s); }
      else if (s > 0) d.cool = PHYS.HIT_COOLDOWN; // still the same contact
    }
    const sp = hyp(p.vx, p.vz);
    if (p.state === 'rest' && sp > PHYS.STOP_SPEED) p.state = 'move'; // knocked by a disc
    if (p.state === 'move' && sp <= PHYS.STOP_SPEED) { p.vx = p.vz = 0; p.state = 'rest'; }

    // Holes first, then the goal (2D order). Too fast and the puck skims over.
    for (const hole of this.holes) {
      if (hyp(p.x - hole.x, p.z - hole.z) < hole.r && sp < PHYS.SKIM_SPEED) {
        Object.assign(p, { state: 'fall', t: 0, hole, vx: 0, vz: 0 });
        if (ev.fall) ev.fall(hole);
        return;
      }
    }
    if (hyp(p.x - this.goal.x, p.z - this.goal.z) < this.goal.r - p.r && sp < PHYS.SINK_SPEED) {
      Object.assign(p, { state: 'sink', t: 0, hole: this.goal, vx: 0, vz: 0 });
      if (ev.sink) ev.sink();
    }
  }

  /** The puck slides to the hole centre and drops (it follows a moving hole). */
  updateDrop(h, ev) {
    const p = this.puck, hole = p.hole, sink = p.state === 'sink';
    const T = sink ? PHYS.SINK_TIME : PHYS.FALL_TIME;
    p.t += h;
    const k = Math.min(1, p.t / T);
    p.x += (hole.x - p.x) * Math.min(1, 10 * h);
    p.z += (hole.z - p.z) * Math.min(1, 10 * h);
    const depth = sink ? BOARD.GOAL_DEPTH + BOARD.FLOOR_T - BOARD.PUCK_H * 0.5 : BOARD.PIT_DEPTH;
    p.y = -depth * (sink ? 1 - Math.pow(1 - k, 2.2) : k * k);
    if (k >= 1) { p.state = sink ? 'sunk' : 'fallen'; if (ev.dropped) ev.dropped(sink); }
  }
}

/** Launch speed for a power in 0..1. Curved, so short putts get most of the control range. */
export function shotSpeed(power) {
  const p = Math.max(0, Math.min(1, power));
  return PHYS.MIN_SHOT + (PHYS.MAX_SHOT - PHYS.MIN_SHOT) * Math.pow(p, PHYS.POWER_CURVE);
}

/**
 * Aim guide: where a shot would go with only the frame, holes and goal (moving discs are not predicted).
 * Returns { points: [{x,z}], end: 'rest' | 'goal' | 'hole' | 'skim', bounces }.
 */
export function predictPath(world, angle, power, maxBounces = 3) {
  const p = { x: world.puck.x, z: world.puck.z, vx: 0, vz: 0 }, r = world.puck.r, surf = world.surf;
  const v = shotSpeed(power);
  p.vx = Math.sin(angle) * v; p.vz = -Math.cos(angle) * v;
  const points = [{ x: p.x, z: p.z }];
  let bounces = 0, since = 0, end = 'rest';
  const h = 1 / 120;
  for (let i = 0; i < 120 * 30; i++) {
    const ox = p.x, oz = p.z;
    p.x += p.vx * h; p.z += p.vz * h;
    const sp = rub(p, surf, h);
    if (rimBounce(p, r, surf.rimRestitution) > 0) bounces++;
    since += hyp(p.x - ox, p.z - oz);
    if (since >= 0.22) { points.push({ x: p.x, z: p.z }); since = 0; }
    if (world.holes.some(o => hyp(p.x - o.x, p.z - o.z) < o.r && sp < PHYS.SKIM_SPEED)) { end = 'hole'; break; }
    if (hyp(p.x - world.goal.x, p.z - world.goal.z) < world.goal.r - r && sp < PHYS.SINK_SPEED) { end = 'goal'; break; }
    if (sp <= PHYS.STOP_SPEED) break;
    if (bounces > maxBounces) { end = 'more'; break; }
  }
  points.push({ x: p.x, z: p.z });
  return { points, end, bounces };
}
