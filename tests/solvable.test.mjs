// Headless autopilot: every level must be clearable with the real physics, moving discs included.
// The bot looks ahead (the simulation is deterministic), tries a fan of angles x powers and plays the
// best shot: one that sinks, else the one that ends closest to the goal without falling in a hole.
// Run: node --test tests/solvable.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLevel } from '../js/levels.js';
import { PuttWorld } from '../js/physics.js';
import { surfacePhysics } from '../js/config.js';

const DT = 1 / 60;
const ANGLES = 90, POWERS = [0.12, 0.18, 0.24, 0.3, 0.36, 0.42, 0.5, 0.58, 0.68, 0.8, 0.92];

/** Play one shot on a copy; returns how it ended. */
function trial(world, angle, power) {
  const w = world.clone();
  let hits = 0;
  w.shoot(angle, power);
  for (let t = 0; t < 25; t += DT) {
    w.step(DT, { hit: () => hits++ });
    if (w.puck.state !== 'move') break;
  }
  if (w.puck.state === 'sink' || w.puck.state === 'sunk') return { sunk: true, hits, score: -100 + hits };
  if (w.puck.state === 'fall' || w.puck.state === 'fallen') return { fell: true, score: 1e9 };
  return { score: Math.hypot(w.puck.x - w.goal.x, w.puck.z - w.goal.z) + hits * 0.6 };
}

function bestShot(world) {
  let best = null;
  for (let i = 0; i < ANGLES; i++) {
    const angle = (i / ANGLES) * Math.PI * 2;
    for (const power of POWERS) {
      const r = trial(world, angle, power);
      if (!best || r.score < best.score) best = { angle, power, ...r };
      if (r.sunk && !r.hits) return best; // clean sink: no need to look further
    }
  }
  return best;
}

/** Bot plays a level; returns shots used (Infinity if it gives up). */
function autoplay(n, board = 'felt', puck = 'plastic', maxShots = 5) {
  const w = new PuttWorld(buildLevel(n), surfacePhysics(board, puck));
  let falls = 0;
  for (let shot = 1; shot <= maxShots; shot++) {
    const b = bestShot(w);
    w.shoot(b.angle, b.power);
    for (let t = 0; t < 30 && w.puck.state !== 'rest'; t += DT) {
      w.step(DT);
      if (w.sunk) return { shots: shot, falls };
      if (w.fallen) { falls++; w.respawn(); break; }
    }
  }
  return { shots: Infinity, falls };
}

test('the autopilot clears levels 1-30 within 5 shots without falling in a hole', () => {
  const report = [];
  for (let n = 1; n <= 30; n++) {
    const r = autoplay(n);
    report.push(`${n}:${r.shots}`);
    assert.ok(r.shots <= 5, `level ${n} not cleared (${report.join(' ')})`);
    assert.equal(r.falls, 0, `level ${n}: the bot fell in a hole`);
  }
  console.log('shots per level:', report.join(' '));
});

test('extreme board / puck pairings stay playable (levels 1-10)', () => {
  for (const [board, puck] of [['glass', 'rubber'], ['glass', 'steel'], ['neon', 'rubber'], ['wood', 'steel']]) {
    for (let n = 1; n <= 10; n++) {
      const r = autoplay(n, board, puck);
      assert.ok(r.shots <= 5, `${board}+${puck} level ${n} not cleared`);
    }
  }
});
