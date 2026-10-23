/* ==========================================================================
   3D SHAPE PUTTER - RUN RULES (pure)
   The 2D game's scoring and pucks, plus checkpoints: Game Over sends you back
   to the last checkpoint level (1, 6, 11 ...) with the score you had there,
   instead of all the way to level 1.
   ========================================================================== */

import { SCORE, PUCKS } from './config.js';

// shots / hits = counters of the level in progress, saved so leaving to the menu doesn't reset them
export const freshRun = () => ({ level: 1, score: 0, pucks: PUCKS.START, checkpoint: 1, checkpointScore: 0, shots: 0, hits: 0 });

/** Points for sinking the puck: 5000 on the 1st shot, 4000 on the 2nd ... 0 from the 6th (2D rule). */
export function shotPoints(shots) { return Math.max(0, SCORE.BASE - shots * SCORE.PER_SHOT); }

export const checkpointOf = level => 1 + Math.floor((level - 1) / PUCKS.CHECKPOINT_EVERY) * PUCKS.CHECKPOINT_EVERY;

/** Level cleared in `shots` shots. Bonus puck on reaching every 5th level (2D: level % 5 === 0). */
export function clearLevel(run, shots) {
  const points = shotPoints(shots);
  const next = { ...run, score: run.score + points, level: run.level + 1 };
  const bonus = next.level % PUCKS.BONUS_EVERY === 0;
  if (bonus) next.pucks = Math.min(PUCKS.MAX, next.pucks + 1);
  const checkpoint = checkpointOf(next.level) === next.level;
  if (checkpoint) { next.checkpoint = next.level; next.checkpointScore = next.score; }
  return { run: next, points, bonus, checkpoint };
}

/** Spend one puck. The game is over when the count goes below zero (2D rule: you play your last puck at 0). */
export function losePuck(run) {
  const next = { ...run, pucks: run.pucks - 1 };
  return { run: next, gameOver: next.pucks < 0 };
}

/** Back to the last checkpoint with a full set of pucks. */
export function restartFromCheckpoint(run) {
  return { ...run, level: run.checkpoint, score: run.checkpointScore, pucks: PUCKS.START };
}

/** Hit a moving disc: -500 points; every 10th hit in a level also costs a puck. */
export function discHit(run, hits) {
  const h = hits + 1;
  const next = { ...run, score: run.score - SCORE.HIT_PENALTY };
  if (h >= SCORE.HITS_PER_PUCK) {
    const r = losePuck(next);
    return { run: r.run, hits: 0, lostPuck: true, gameOver: r.gameOver };
  }
  return { run: next, hits: h, lostPuck: false, gameOver: false };
}
