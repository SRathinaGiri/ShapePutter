/* ==========================================================================
   3D SHAPE PUTTER - WEB AUDIO SYNTHESIZER (no audio files: fully offline)
   Engine from 3D Labyrinth v1.14.1. Replaces the 2D game's mp3 clips
   (click, clack, swoosh, plonk, life) with synthesised versions whose timbre
   follows the board surface and puck type.
   ========================================================================== */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.lastKnock = 0;
    this.musicTimer = null;
  }

  ensureContext() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { try { this.ctx = new AC(); } catch (e) { console.warn('[Audio] unavailable:', e.message); } }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted) this.stopMusic();
    return this.muted;
  }

  ok() { return !this.muted && this.ensureContext(); }

  tone(freq, dur, { type = 'sine', vol = 0.15, at = 0, slideTo = null } = {}) {
    const c = this.ctx, t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /** Short filtered noise burst: the "whoosh" of a shot or a puck dropping. */
  noise(dur, { vol = 0.12, at = 0, from = 2400, to = 400 } = {}) {
    const c = this.ctx, t = c.currentTime + at, n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = buf; f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(vol, t);
    src.connect(f); f.connect(g); g.connect(c.destination);
    src.start(t);
  }

  setMaterials(board, puck) { this.board = board; this.puck = puck; }

  /** Pick-up click when aiming starts (2D: click.mp3). */
  playAim() {
    if (!this.ok()) return;
    this.tone(1800, 0.03, { type: 'square', vol: 0.04 });
  }

  /** The strike: louder and brighter with power. */
  playShot(power) {
    if (!this.ok()) return;
    const v = 0.08 + power * 0.14;
    this.tone(this.puck === 'steel' ? 900 : this.puck === 'rubber' ? 180 : 520, 0.07, { type: 'triangle', vol: v, slideTo: 200 });
    this.noise(0.12 + power * 0.2, { vol: v * 0.6, from: 1800 + power * 2000, to: 500 });
  }

  /** Cushion knock: volume follows impact speed, timbre follows the materials. Throttled. */
  playRim(speed) {
    if (!this.ok()) return;
    const now = this.ctx.currentTime;
    if (now - this.lastKnock < 0.05) return;
    this.lastKnock = now;
    const v = Math.min(0.26, 0.04 + speed * 0.02);
    const surf = { wood: 1.15, glass: 1.35, neon: 1.1 }[this.board] || 0.85; // felt cushions are dull
    const j = 0.94 + Math.random() * 0.12;
    if (this.puck === 'steel') { this.tone(1500 * surf * j, 0.12, { vol: v * 0.8 }); this.tone(4100 * surf * j, 0.06, { vol: v * 0.3 }); }
    else if (this.puck === 'rubber') this.tone(150 * surf * j, 0.1, { vol: v * 1.1, slideTo: 70 });
    else this.tone(380 * surf * j, 0.06, { type: 'triangle', vol: v });
  }

  /** Penalty hit on a coloured disc (2D: clack.mp3). */
  playClack() {
    if (!this.ok()) return;
    this.tone(1250, 0.05, { type: 'square', vol: 0.09 });
    this.tone(260, 0.16, { type: 'sawtooth', vol: 0.06, at: 0.03, slideTo: 140 });
  }

  /** Two discs knocking together: quiet, so it doesn't sound like a penalty. */
  playKnock(speed) {
    if (!this.ok()) return;
    const now = this.ctx.currentTime;
    if (now - this.lastKnock < 0.08) return;
    this.lastKnock = now;
    this.tone(1400 + Math.random() * 300, 0.04, { type: 'triangle', vol: Math.min(0.06, 0.015 + speed * 0.008) });
  }

  /** Into the goal (2D: swoosh.mp3). */
  playSink() {
    if (!this.ok()) return;
    this.noise(0.45, { vol: 0.14, from: 3000, to: 300 });
    [523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, 0.25, { vol: 0.13, at: 0.25 + i * 0.06 }));
  }

  /** Into a wrong hole (2D: plonk.mp3). */
  playFall() {
    if (!this.ok()) return;
    this.tone(620, 0.55, { vol: 0.22, slideTo: 70 });
    this.tone(90, 0.25, { type: 'triangle', vol: 0.2, at: 0.5 });
  }

  /** A puck lost to the 10-hit rule (2D: life.mp3). */
  playPuckLost() {
    if (!this.ok()) return;
    [440, 349.23, 261.63].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', vol: 0.14, at: i * 0.12 }));
  }

  playBonus() {
    if (!this.ok()) return;
    [784, 988, 1175, 1568].forEach((f, i) => this.tone(f, 0.18, { vol: 0.15, at: 0.6 + i * 0.06 }));
  }

  playLevelComplete() {
    if (!this.ok()) return;
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', vol: 0.16, at: 0.4 + i * 0.09 }));
  }

  /** First time a level is cleared: rising fanfare on top of the clear jingle. */
  playFirstClear() {
    if (!this.ok()) return;
    [659.25, 783.99, 1046.5, 1318.5, 1567.98].forEach((f, i) => this.tone(f, 0.35, { type: 'triangle', vol: 0.12, at: 0.9 + i * 0.07 }));
    this.tone(2093, 0.6, { vol: 0.08, at: 1.3 });
  }

  playGameOver() {
    if (!this.ok()) return;
    [392, 330, 262, 196].forEach((f, i) => this.tone(f, 0.4, { type: 'sawtooth', vol: 0.08, at: i * 0.2 }));
  }

  playTick(urgent) {
    if (!this.ok()) return;
    this.tone(urgent ? 1200 : 900, 0.05, { type: 'square', vol: 0.05 });
  }

  /** Calm ambient pad loop */
  startMusic() {
    if (this.musicTimer || !this.ok()) return;
    const chords = [[261.63, 329.63, 392], [220, 277.18, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66]];
    let i = 0;
    const play = () => {
      if (this.muted || !this.ctx) return;
      chords[i++ % chords.length].forEach(f => this.tone(f, 2.6, { vol: 0.022 }));
    };
    play();
    this.musicTimer = setInterval(play, 2800);
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}

export const soundEngine = new SoundEngine();
