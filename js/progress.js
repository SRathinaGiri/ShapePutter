/* ==========================================================================
   3D SHAPE PUTTER - SAVED PROGRESS (localStorage)
   The game can be open twice on one device (installed app + browser tab), so
   every save MERGES with what is stored: the furthest level, best results
   and the high score only ever grow (pattern from 3D Labyrinth).
   Pure module (storage is passed in) so it can be unit-tested in Node.
   ========================================================================== */

import { PUCKS } from './config.js';
import { freshRun } from './rules.js';

export const PROGRESS_KEY = '3d_shapeputter_progress';

export const freshProgress = () => ({ run: freshRun(), maxLevel: 1, best: {}, highScore: 0 });

const int = (v, d) => (Number.isInteger(v) ? v : d);

/** Stored JSON -> clean progress record (null when nothing usable is stored). */
export function parseProgress(json) {
  try {
    const p = JSON.parse(json || 'null');
    if (!p || !(p.maxLevel >= 1)) return null;
    const r = p.run || {};
    const level = Math.max(1, int(r.level, 1));
    const run = {
      level,
      score: int(r.score, 0),
      pucks: Math.min(PUCKS.MAX, Math.max(0, int(r.pucks, PUCKS.START))),
      checkpoint: Math.max(1, Math.min(level, int(r.checkpoint, 1))),
      checkpointScore: int(r.checkpointScore, 0),
      shots: Math.max(0, int(r.shots, 0)),
      hits: Math.max(0, int(r.hits, 0))
    };
    return { run, maxLevel: Math.max(p.maxLevel | 0, level), best: p.best || {}, highScore: int(p.highScore, 0) };
  } catch (_) { return null; } // corrupt: treat as nothing stored
}

/**
 * Combine two records. Achievements never go backwards: furthest level, most stars / points and fewest
 * shots per level, highest score. The run can legitimately go back (Game Over), so it comes from `primary`.
 */
export function mergeProgress(primary, other) {
  if (!other) return primary;
  const best = { ...other.best };
  for (const [n, b] of Object.entries(primary.best)) {
    const o = best[n];
    best[n] = o ? { stars: Math.max(o.stars, b.stars), points: Math.max(o.points, b.points), shots: Math.min(o.shots, b.shots) } : b;
  }
  return {
    run: primary.run,
    maxLevel: Math.max(primary.maxLevel, other.maxLevel),
    best,
    highScore: Math.max(primary.highScore, other.highScore)
  };
}

export function loadProgress(storage = globalThis.localStorage) {
  try { return parseProgress(storage.getItem(PROGRESS_KEY)) || freshProgress(); } catch (_) { return freshProgress(); } // storage blocked
}

/** Merge `mine` into what is stored, write it back, and return the merged record to keep in memory. */
export function saveProgress(mine, storage = globalThis.localStorage) {
  try {
    const merged = mergeProgress(mine, parseProgress(storage.getItem(PROGRESS_KEY)));
    storage.setItem(PROGRESS_KEY, JSON.stringify(merged));
    return merged;
  } catch (_) { return mine; } // private mode / storage blocked: keep playing from memory
}

/** Record a cleared level's result (run or practice). */
export function recordBest(progress, n, { stars, points, shots }) {
  const prev = progress.best[n];
  const best = { ...progress.best };
  best[n] = prev
    ? { stars: Math.max(prev.stars, stars), points: Math.max(prev.points, points), shots: Math.min(prev.shots, shots) }
    : { stars, points, shots };
  return { ...progress, best, maxLevel: Math.max(progress.maxLevel, n + 1) };
}
