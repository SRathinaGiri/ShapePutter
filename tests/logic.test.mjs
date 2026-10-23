// Pure-logic tests: levels, physics, rules, progress. Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARD, OBSTACLE, PHYS, SCORE, PUCKS, obstacleCounts, surfacePhysics, starsFor, BOARD_SURFACES, PUCK_TYPES } from '../js/config.js';
import { buildLevel, levelShape, shapeOutline, spawnPoint, rng } from '../js/levels.js';
import { PuttWorld, predictPath, collide, shotSpeed } from '../js/physics.js';
import { freshRun, shotPoints, clearLevel, losePuck, discHit, restartFromCheckpoint, checkpointOf } from '../js/rules.js';
import { parseProgress, mergeProgress, saveProgress, loadProgress, recordBest, freshProgress, PROGRESS_KEY } from '../js/progress.js';

const d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const memStore = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k) }; };
/** A world with nothing but the puck (and optionally given holes / discs), puck placed by hand. */
function bare(n = 1, at = { x: -3, z: 0 }, extra = {}) {
  const w = new PuttWorld(buildLevel(n));
  w.holes = extra.holes || []; w.discs = extra.discs || [];
  Object.assign(w.puck, { x: at.x, z: at.z, vx: 0, vz: 0, state: 'rest' });
  return w;
}
const run = (w, secs, ev = {}) => { for (let t = 0; t < secs; t += 1 / 60) w.step(1 / 60, ev); };

/* ------------------------------- Levels ------------------------------- */
test('levels are deterministic: the same number is the same board', () => {
  for (const n of [1, 2, 7, 23]) assert.deepEqual(buildLevel(n), buildLevel(n));
  assert.notDeepEqual(buildLevel(7).holes, buildLevel(8).holes);
});

test('shapes follow the 2D table: circle, square, triangle, diamond, then n-point stars', () => {
  assert.equal(levelShape(1).type, 'circle');
  assert.deepEqual([levelShape(2).sides, levelShape(2).rotation], [4, Math.PI / 4]);
  assert.equal(levelShape(3).sides, 3);
  assert.deepEqual([levelShape(4).sides, levelShape(4).rotation], [4, 0]);
  for (const n of [5, 9, 30]) assert.deepEqual([levelShape(n).type, levelShape(n).sides], ['star', n]);
  // Sizes from the 2D game (px / 50)
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} vs ${b}`);
  near(levelShape(1).puckR, 0.3); near(levelShape(1).goalR, 0.5);
  near(levelShape(6).puckR, 0.4); near(levelShape(6).goalR, 0.6);
});

test('shape outlines have the right vertex count and outer radius', () => {
  assert.equal(shapeOutline(levelShape(3), 1).length, 3);
  assert.equal(shapeOutline(levelShape(7), 1).length, 14);
  for (const n of [1, 2, 3, 4, 5, 12]) {
    const pts = shapeOutline(levelShape(n), 2);
    const max = Math.max(...pts.map(([x, z]) => Math.hypot(x, z)));
    assert.ok(Math.abs(max - 2) < 1e-9, `level ${n} outer radius`);
  }
  // Star points: the first one points up (-z), inner radius is half the outer
  const star = shapeOutline(levelShape(5), 1);
  assert.ok(Math.abs(star[0][0]) < 1e-9 && Math.abs(star[0][1] + 1) < 1e-9);
  assert.ok(Math.abs(Math.hypot(...star[1]) - 0.5) < 1e-9);
});

test('obstacle counts follow the 2D rules (more every 5 levels) and placement is clean', () => {
  assert.deepEqual(obstacleCounts(1), { staticHoles: 0, movingHoles: 0, discs: 0 });
  assert.deepEqual(obstacleCounts(2), { staticHoles: 2, movingHoles: 1, discs: 3 });
  assert.deepEqual(obstacleCounts(6), { staticHoles: 4, movingHoles: 1, discs: 5 });
  assert.deepEqual(obstacleCounts(11), { staticHoles: 6, movingHoles: 1, discs: 7 });
  for (let n = 1; n <= 40; n++) {
    const L = buildLevel(n), c = obstacleCounts(n);
    assert.equal(L.holes.filter(h => !h.moving).length, c.staticHoles, `level ${n} static holes`);
    assert.equal(L.holes.filter(h => h.moving).length, c.movingHoles, `level ${n} moving holes`);
    assert.equal(L.discs.length, c.discs, `level ${n} discs`);
    const all = [...L.holes, ...L.discs];
    for (const o of all) {
      assert.ok(Math.abs(o.x) <= BOARD.HALF - OBSTACLE.EDGE_PAD + 1e-9 && Math.abs(o.z) <= BOARD.HALF - OBSTACLE.EDGE_PAD + 1e-9, `level ${n} inside`);
      assert.ok(d(o, L.goal) >= OBSTACLE.GOAL_CLEAR, `level ${n} goal clearance`);
    }
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      assert.ok(d(all[i], all[j]) >= all[i].r + all[j].r + OBSTACLE.GAP - 1e-9, `level ${n} obstacles overlap`);
    }
  }
});

test('very high levels never hang: placement gives up when the board is full', () => {
  const t = Date.now();
  const L = buildLevel(400);
  assert.ok(Date.now() - t < 2000);
  assert.ok(L.holes.length > 10 && L.holes.length < obstacleCounts(400).staticHoles + 1);
});

test('the puck spawns clear of the goal, holes and discs', () => {
  for (let n = 1; n <= 40; n++) {
    const L = buildLevel(n), r = rng(n);
    for (let k = 0; k < 5; k++) {
      const p = spawnPoint(L, r);
      assert.ok(d(p, L.goal) >= L.goal.r + OBSTACLE.PUCK_CLEAR, `level ${n} too close to the goal`);
      for (const o of [...L.holes, ...L.discs]) assert.ok(d(p, o) >= o.r + L.puckR + OBSTACLE.PUCK_CLEAR - 1e-9, `level ${n} spawn on an obstacle`);
    }
  }
});

/* ------------------------------- Physics ------------------------------- */
test('friction matches the 2D game: about 0.99 per frame at 60 fps', () => {
  const s = surfacePhysics('felt', 'plastic');
  assert.ok(Math.abs(Math.exp(-s.damping / 60) - 0.99) < 0.0005);
});

test('a shot speeds up with power and the puck comes to rest', () => {
  assert.ok(shotSpeed(0) === PHYS.MIN_SHOT && shotSpeed(1) === PHYS.MAX_SHOT && shotSpeed(0.5) > shotSpeed(0.3));
  const w = bare();
  assert.equal(w.shoot(Math.PI / 2, 0.01), false, 'below MIN_POWER does not shoot');
  assert.ok(w.shoot(0, 0.5));
  assert.equal(w.ready, false);
  assert.equal(w.shoot(0, 0.5), false, 'cannot shoot a rolling puck');
  run(w, 20);
  assert.equal(w.puck.state, 'rest');
  assert.ok(w.ready);
});

test('the puck never leaves the board, even at full power', () => {
  for (let a = 0; a < Math.PI * 2; a += 0.37) {
    const w = bare(6, { x: 1, z: 2 });
    w.shoot(a, 1);
    for (let t = 0; t < 8; t += 1 / 60) {
      w.step(1 / 60);
      const lim = BOARD.HALF - w.puck.r + 1e-9;
      assert.ok(Math.abs(w.puck.x) <= lim && Math.abs(w.puck.z) <= lim, `escaped at angle ${a}`);
    }
  }
});

test('a full-power shot cannot tunnel through a disc', () => {
  const disc = { x: 0, z: 0, r: OBSTACLE.DISC_R, vx: 0, vz: 0, cruise: 0, hue: 0, cool: 0 };
  const w = bare(6, { x: -4, z: 0 }, { discs: [disc] });
  w.goal = { x: 99, z: 99, r: 0.6 };
  let hits = 0;
  w.shoot(Math.PI / 2, 1); // east, straight at the disc
  run(w, 0.5, { hit: () => hits++ });
  assert.equal(hits, 1);
  assert.ok(Math.abs(disc.vx) > 5, 'disc was knocked away');
});

test('collisions conserve momentum; equal masses swap velocities', () => {
  const a = { x: 0, z: 0, vx: 3, vz: 0 }, b = { x: 0.59, z: 0, vx: 0, vz: 0 };
  collide(a, 0.3, 1, b, 0.3, 1, 1);
  assert.ok(Math.abs(a.vx) < 1e-9 && Math.abs(b.vx - 3) < 1e-9);
  const c = { x: 0, z: 0, vx: 2, vz: 1 }, e = { x: 0.3, z: 0.2, vx: -1, vz: 0 };
  const before = [2 * 2 + 0.5 * -1, 2 * 1 + 0];
  collide(c, 0.3, 2, e, 0.24, 0.5);
  assert.ok(Math.abs(2 * c.vx + 0.5 * e.vx - before[0]) < 1e-9 && Math.abs(2 * c.vz + 0.5 * e.vz - before[1]) < 1e-9);
});

test('a heavy steel puck is deflected less by a disc than a light rubber one', () => {
  const deflect = puck => {
    const w = new PuttWorld(buildLevel(6), surfacePhysics('felt', puck));
    w.holes = []; w.goal = { x: 99, z: 99, r: 0.6 };
    w.discs = [{ x: 0, z: 0, r: OBSTACLE.DISC_R, vx: 0, vz: 0, cruise: 0, hue: 0, cool: 0 }];
    Object.assign(w.puck, { x: -2, z: 0.2, state: 'rest' });
    w.shoot(Math.PI / 2, 0.5);
    run(w, 0.4);
    return Math.abs(Math.atan2(w.puck.vz, w.puck.vx));
  };
  assert.ok(deflect('steel') < deflect('rubber'));
});

test('goal: a slow puck sinks, a fast one skims over (lips out)', () => {
  for (const [power, expect] of [[0.36, 'sunk'], [1, 'not']]) {
    const w = bare(6, { x: -3, z: 0 });
    w.shoot(Math.PI / 2, power);
    let sank = false;
    for (let t = 0; t < 0.6; t += 1 / 60) { w.step(1 / 60, { sink: () => { sank = true; } }); }
    if (expect === 'sunk') { run(w, 2); assert.equal(w.puck.state, 'sunk'); assert.ok(w.puck.y < -1); }
    else assert.equal(sank, false, `skim at ${shotSpeed(power).toFixed(1)} u/s`);
  }
  assert.ok(shotSpeed(1) > PHYS.SINK_SPEED);
});

test('goal capture needs the centre within (goal.r - puck.r), as in 2D', () => {
  const w = bare(6, { x: -3, z: 0.25 }); // 0.25 off the goal centre line > 0.6 - 0.4
  w.shoot(Math.PI / 2, 0.3);
  run(w, 4);
  assert.notEqual(w.puck.state, 'sunk');
});

test('wrong hole: the puck falls, ends "fallen" and can respawn somewhere safe', () => {
  const hole = { x: 0, z: -3, r: OBSTACLE.HOLE_R, vx: 0, vz: 0, moving: false };
  const w = bare(6, { x: -3, z: -3 }, { holes: [hole] });
  let fell = 0;
  w.shoot(Math.PI / 2, 0.3);
  run(w, 3, { fall: () => fell++ });
  assert.equal(fell, 1);
  assert.equal(w.puck.state, 'fallen');
  w.respawn();
  assert.equal(w.puck.state, 'rest');
  assert.ok(d(w.puck, hole) > hole.r + w.puck.r);
});

test('a moving hole never swallows a puck that is waiting to be shot', () => {
  const hole = { x: 3, z: 0, r: OBSTACLE.HOLE_R, vx: -1.2, vz: 0, moving: true };
  const w = bare(6, { x: 0, z: 0 }, { holes: [hole] });
  w.goal = { x: 99, z: 99, r: 0.6 };
  run(w, 10);
  assert.equal(w.puck.state, 'rest');
  assert.ok(d(w.puck, hole) >= hole.r + w.puck.r - 1e-6);
});

test('moving holes keep the goal open; discs skate round every pit and keep cruising', () => {
  for (const n of [2, 6, 13, 21]) {
    const w = new PuttWorld(buildLevel(n));
    w.puck.state = 'gone'; // take the puck out: watch the obstacles only
    for (let t = 0; t < 60; t += 1 / 60) {
      w.step(1 / 60);
      for (const h of w.holes) if (h.moving) assert.ok(d(h, w.goal) >= w.goal.r + h.r + 0.6 - 1e-6, `level ${n}: moving hole over the goal`);
      for (const dk of w.discs) {
        for (const h of w.holes) assert.ok(d(dk, h) >= h.r + dk.r * 0.5 - 0.02, `level ${n}: disc over a hole`);
        assert.ok(Math.abs(dk.x) <= BOARD.HALF - dk.r + 1e-9 && Math.abs(dk.z) <= BOARD.HALF - dk.r + 1e-9);
      }
    }
    // Collisions nudge speeds, but every disc drifts back to its own cruise speed
    const dev = w.discs.map(dk => Math.abs(Math.hypot(dk.vx, dk.vz) - dk.cruise));
    assert.ok(dev.reduce((a, b) => a + b, 0) / dev.length < 0.3, `level ${n}: discs not back at cruise speed`);
    for (const dk of w.discs) assert.ok(Math.hypot(dk.vx, dk.vz) < dk.cruise * 3 + 2, `level ${n}: runaway disc`);
  }
});

test('one penalty per contact, not one per substep', () => {
  const disc = { x: 0, z: 0, r: OBSTACLE.DISC_R, vx: 0, vz: 0, cruise: 0, hue: 0, cool: 0 };
  const w = bare(6, { x: -1, z: 0 }, { discs: [disc] });
  w.goal = { x: 99, z: 99, r: 0.6 };
  let hits = 0;
  w.shoot(Math.PI / 2, 0.15);
  run(w, 3, { hit: () => hits++ });
  assert.equal(hits, 1);
});

test('aim guide: predicts the goal, matches the real roll without discs', () => {
  const w = bare(6, { x: -3, z: 0 });
  assert.equal(predictPath(w, Math.PI / 2, 0.36).end, 'goal');
  const w2 = bare(6, { x: -3, z: 2 });
  w2.goal = { x: 99, z: 99, r: 0.6 };
  const p = predictPath(w2, 0.7, 0.65, 99);
  w2.shoot(0.7, 0.65);
  run(w2, 30);
  const end = p.points[p.points.length - 1];
  assert.ok(d(end, w2.puck) < 0.1, `prediction off by ${d(end, w2.puck).toFixed(3)}`);
  assert.ok(p.bounces >= 1);
});

test('surface and puck tables give sane physics', () => {
  for (const b of Object.keys(BOARD_SURFACES)) for (const p of Object.keys(PUCK_TYPES)) {
    const s = surfacePhysics(b, p);
    assert.ok(s.damping > 0 && s.rollDrag > 0 && s.rimRestitution > 0.3 && s.rimRestitution <= 0.95 && s.mass > 0);
  }
  assert.ok(surfacePhysics('glass').damping < surfacePhysics('felt').damping);
});

/* ------------------------------- Rules ------------------------------- */
test('points per shot: 5000, 4000 ... 1000, then 0 (2D rule)', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map(shotPoints), [5000, 4000, 3000, 2000, 1000, 0, 0]);
});

test('stars: hole in one = 3, two or three shots = 2; the aim guide caps at 2', () => {
  assert.deepEqual([1, 2, 3, 4, 8].map(s => starsFor(s)), [3, 2, 2, 1, 1]);
  assert.equal(starsFor(1, true), 2);
});

test('clearing levels: score, bonus puck on reaching every 5th level, checkpoints at 6, 11 ...', () => {
  let r = freshRun();
  const bonusAt = [], cpAt = [];
  for (let i = 0; i < 12; i++) {
    const res = clearLevel(r, 1);
    if (res.bonus) bonusAt.push(res.run.level);
    if (res.checkpoint) cpAt.push(res.run.level);
    r = res.run;
  }
  assert.equal(r.level, 13);
  assert.equal(r.score, 12 * 5000);
  assert.deepEqual(bonusAt, [5, 10]);
  assert.deepEqual(cpAt, [6, 11]);
  assert.equal(r.pucks, PUCKS.START + 2);
  assert.equal(r.checkpoint, 11);
  assert.equal(r.checkpointScore, 10 * 5000);
  assert.deepEqual([1, 5, 6, 10, 11, 14].map(checkpointOf), [1, 1, 6, 6, 11, 11]);
});

test('losing pucks: you play on at 0 and the game is over below it', () => {
  let r = { ...freshRun(), pucks: 1 };
  let res = losePuck(r);
  assert.deepEqual([res.run.pucks, res.gameOver], [0, false]);
  res = losePuck(res.run);
  assert.equal(res.gameOver, true);
  const back = restartFromCheckpoint({ ...res.run, level: 9, score: 41000, checkpoint: 6, checkpointScore: 25000 });
  assert.deepEqual([back.level, back.score, back.pucks], [6, 25000, PUCKS.START]);
});

test('disc hits: -500 each, the 10th in a level also costs a puck', () => {
  let r = freshRun(), hits = 0, lost = 0;
  for (let i = 0; i < 10; i++) { const res = discHit(r, hits); r = res.run; hits = res.hits; if (res.lostPuck) lost++; }
  assert.equal(r.score, -10 * SCORE.HIT_PENALTY);
  assert.equal(lost, 1);
  assert.equal(hits, 0);
  assert.equal(r.pucks, PUCKS.START - 1);
});

/* ------------------------------- Progress ------------------------------- */
test('progress round-trips through storage and survives junk', () => {
  const s = memStore();
  assert.deepEqual(loadProgress(s), freshProgress());
  let p = recordBest(freshProgress(), 1, { stars: 3, points: 5000, shots: 1 });
  p.run = { ...p.run, level: 2, score: 5000 };
  saveProgress(p, s);
  const back = loadProgress(s);
  assert.equal(back.maxLevel, 2);
  assert.equal(back.run.level, 2);
  assert.deepEqual(back.best[1], { stars: 3, points: 5000, shots: 1 });
  s.setItem(PROGRESS_KEY, '{nope');
  assert.deepEqual(loadProgress(s), freshProgress());
  assert.equal(parseProgress(JSON.stringify({ maxLevel: 3, run: { level: 'x', pucks: -4 } })).run.pucks, 0);
});

test('a stale copy of the game never rolls back bests, the furthest level or the high score', () => {
  const s = memStore();
  let fresh = recordBest(freshProgress(), 5, { stars: 3, points: 5000, shots: 1 });
  fresh = { ...fresh, maxLevel: 9, highScore: 40000 };
  saveProgress(fresh, s);
  const stale = recordBest(freshProgress(), 5, { stars: 1, points: 1000, shots: 5 }); // older copy, worse result
  const merged = saveProgress(stale, s);
  assert.equal(merged.maxLevel, 9);
  assert.equal(merged.highScore, 40000);
  assert.deepEqual(merged.best[5], { stars: 3, points: 5000, shots: 1 });
  // The run itself comes from the copy that saved (Game Over legitimately moves it back)
  assert.equal(mergeProgress({ ...fresh, run: { ...fresh.run, level: 6 } }, { ...fresh, run: { ...fresh.run, level: 9 } }).run.level, 6);
});
