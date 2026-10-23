/* ==========================================================================
   3D SHAPE PUTTER - MAIN APPLICATION (game loop, aiming, cameras, levels)
   Structure, stereo pipeline, VR, phone link and PWA handling come from
   3D Labyrinth v1.14.1; the gameplay is the 2D Shape Putter's.
   ========================================================================== */

import { VERSION, BOARD, PHYS, SCORE, AIM, CAMERA, BEHIND_VIEW, VR, VIEWS, DEFAULT_LOOK, surfacePhysics, starsFor } from './config.js';
import { buildLevel, shapeName } from './levels.js';
import { PuttWorld, predictPath } from './physics.js';
import { StereoRenderEngine } from './renderer.js';
import { BoardView } from './board.js';
import { ControlsHandler } from './controls.js';
import { HUD3D } from './hud3d.js';
import { soundEngine } from './audio.js';
import { UIManager } from './ui.js';
import { TVLink } from './link.js';
import { shotPoints, clearLevel, losePuck, discHit, restartFromCheckpoint } from './rules.js';
import { PROGRESS_KEY, loadProgress, saveProgress, parseProgress, mergeProgress, freshProgress, recordBest } from './progress.js';

// Buttons the phone controller may press (anything else on the data channel is ignored)
const REMOTE_ACTIONS = new Set(['confirm', 'pause', 'focusPrev', 'focusNext', 'view', 'restart', 'guide']);

const DEG = Math.PI / 180;
const STEREO_RATIO = 0.035; // eye separation as a fraction of viewing distance at Depth = 1.0
const TAP_PX = 12;          // a press that moves less than this is a tap, not a slingshot pull
const fmt = n => n.toLocaleString('en-IN');
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

class GameApp {
  constructor() {
    this.version = VERSION;
    this.state = 'MENU'; // MENU, PLAYING, PAUSED, COMPLETE, OVER
    this.mode = 'run';   // 'run' (score, pucks, checkpoints) | 'practice' (replay any reached level)
    this.viewMode = 'OVERVIEW';
    this.depth = 1.0;
    this.focusOffset = 0;
    this.progress = loadProgress();
    this.look = { ...DEFAULT_LOOK };
    this.aim = { angle: 0, power: 0, lastPower: 0.35 };
    this.stickYaw = null; this.dragYaw = null; this.lastStickMag = 0;
    this.behind = { yaw: 0, eye: new THREE.Vector3(), ready: false };
    this.mapMode = 'small'; // board map in the Behind view: 'off' | 'small' | 'large'
    this.vr = { mode: 'table', pending: false, frames: 0, head: null, fwd: null, yaw: 0 };
    this.vrHud = new THREE.Group();

    this.scene = new THREE.Scene();
    const canvas = document.getElementById('gameCanvas');
    this.renderer = new StereoRenderEngine(canvas);
    this.scene.add(this.renderer.cameraGroup);
    this.scene.add(this.vrHud);
    this.board = new BoardView(this.scene, this.renderer.renderer);
    this.controls = new ControlsHandler();
    this.controls.gyroWanted = false; // tilt-to-aim is opt-in here: the slingshot drag is the main control
    this.hud = new HUD3D(this.renderer.mainCamera);
    this.audio = soundEngine;

    this.cam = { target: new THREE.Vector3(), dist: 20, ready: false };
    this.renderer.onBeforeEyes = aspect => this.hud.layout(this.renderer.focalLength, this.renderer.fov, aspect);

    this.ui = new UIManager(this);
    this.controls.bindDragJoystick(document.getElementById('viewportFrame'), document.getElementById('joystick'));
    this.controls.onAction = a => this.handleAction(a);
    this.controls.onDragEnd = d => this.onDragEnd(d);
    this.bindDialogPointer();

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && this.state === 'PLAYING') this.togglePause();
      if (document.visibilityState === 'visible') this.syncProgress();
    });
    // Another copy of the game (tab / installed app) saved: adopt its progress, or its reset
    window.addEventListener('storage', e => {
      if (e.key !== PROGRESS_KEY && e.key !== null) return;
      if (e.newValue === null) { this.progress = freshProgress(); if (this.state === 'MENU') this.ui.renderLevelGrid(); }
      else this.syncProgress();
    });
    const resize = () => { this.renderer.handleResize(); this.sizeSlingshot(); };
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 250));
    this.sizeSlingshot();

    this.setupWebXR();
    this.registerServiceWorker();
    this.ui.showMenuPage();
    this.animate = this.animate.bind(this);
    this.renderer.renderer.setAnimationLoop(this.animate);
    console.log(`[3D Shape Putter v${VERSION}] ready`);
  }

  /** Full slingshot pull = about a quarter of the short screen side (finger-friendly on phones). */
  sizeSlingshot() {
    this.controls.dragRadius = Math.round(Math.max(90, Math.min(170, 0.28 * Math.min(innerWidth, innerHeight))));
  }

  get run() { return this.progress.run; }
  get practice() { return this.mode === 'practice'; }

  /* ------------------------------ Level lifecycle ------------------------------ */
  loadLevel(n) {
    this.level = buildLevel(n);
    const surf = surfacePhysics(this.look.board, this.look.puck);
    this.world = new PuttWorld(this.level, surf);
    this.board.build(this.level, this.look, this.world);
    this.hud.setMap(this.level, this.world);
    this.audio.setMaterials(this.look.board, this.look.puck);
    // A run resumes the shots / hits already taken on this level (quitting to the menu must not reset them)
    this.shots = this.practice ? 0 : (this.run.shots || 0);
    this.hits = this.practice ? 0 : (this.run.hits || 0);
    this.guideUsed = !!this.guideOn;
    this.pathKey = '';
    this.aimAtGoal();
    this.behind.yaw = this.aim.angle; this.behind.ready = false;
    if (this.inVR) this.applyVR();
    this.cam.ready = false;
  }

  /** Point the (hidden) aim at the goal: the Behind camera starts looking at it, keys start from there. */
  aimAtGoal() {
    const p = this.world.puck, g = this.world.goal;
    this.aim.angle = Math.atan2(g.x - p.x, -(g.z - p.z));
    this.aim.power = 0;
    this.stickYaw = this.dragYaw = null;
  }

  startRun() { this.startLevel(this.run.level, 'run'); }
  startPractice(n) { this.startLevel(n, 'practice'); }

  /** Call from a user gesture: it may trigger the iOS motion-permission prompt. */
  startLevel(n, mode = this.mode) {
    this.audio.ensureContext();
    if (this.controls.gyroWanted && !this.controls.gyroEnabled) {
      this.controls.enableGyro().then(on => this.ui.syncGyro(on));
    }
    this.mode = mode;
    this.closeDialog();
    this.lockOrientation();
    this.syncProgress(); // the run may have moved on in another copy of the game
    if (mode === 'run') n = this.run.level;
    this.loadLevel(n);
    this.ui.showGamePage();
    this.renderer.handleResize();
    this.controls.resetManual();
    this.controls.requestWakeLock();
    this.controls.calibrate(); // tilt-aim: however the phone is held now is "flat"
    this.audio.startMusic();
    this.state = 'PLAYING';
    const sub = `${shapeName(this.level.shape)}` + (this.level.holes.length ? ' · holes' : '') + (this.level.discs.length ? ' · moving pucks' : '');
    this.hud.showBanner(`${this.practice ? 'PRACTICE ' : 'LEVEL '}${n}`, sub, '#00f0ff', 1.8);
  }

  togglePause() {
    if (this.state === 'PLAYING') {
      this.state = 'PAUSED';
      this.controls.resetManual();
      this.audio.stopMusic();
      this.controls.releaseWakeLock();
      this.openPauseDialog();
    } else if (this.state === 'PAUSED') {
      this.state = 'PLAYING';
      this.closeDialog();
      this.ui.hideModals();
      this.audio.startMusic();
      this.controls.requestWakeLock();
    }
  }

  /** Pause panel (redrawn in place when its 🎯 Guide button is pressed). */
  openPauseDialog(focus = 0) {
    const guide = { id: 'guide', label: this.guideOn ? '🎯 Guide ✓' : '🎯 Guide' };
    const info = this.practice ? `Practice · level ${this.level.n}` : `Level ${this.level.n} · ${fmt(this.run.score)} · ${this.run.pucks} ${this.run.pucks === 1 ? 'puck' : 'pucks'} left`;
    const restart = this.practice ? [{ id: 'restart', label: '↻ Restart' }] : [];
    if (this.inVR) {
      this.openDialog({
        title: 'PAUSED', color: '#00f0ff', focus,
        lines: [info, 'Thumbstick to choose · trigger or A to select'],
        buttons: [{ id: 'resume', label: '▶ Resume' }, ...restart, guide, { id: 'recenter', label: '🎯 Recenter' },
          { id: 'vrsize', label: this.vr.mode === 'table' ? '🟫 Floor' : '🪑 Table' }, { id: 'exitvr', label: '⏏ Exit VR' }]
      });
      return;
    }
    this.openDialog({
      title: 'PAUSED', color: '#00f0ff', focus,
      lines: [info, this.orientStatus].filter(Boolean),
      buttons: [{ id: 'resume', label: '▶ Resume' }, ...restart, guide, { id: 'settings', label: '⚙ 3D' }, { id: 'menu', label: '☰ Menu' }]
    });
  }

  /** 🎯 Aim guide (optional assist): dotted path of the shot with cushion bounces. Using it caps the level at ★★. */
  toggleGuide() {
    this.guideOn = !this.guideOn;
    this.pathKey = '';
    if (this.guideOn && this.state !== 'MENU' && this.level) this.guideUsed = true;
    if (this.state !== 'MENU') this.hud.showBanner(this.guideOn ? '🎯 GUIDE ON' : '🎯 GUIDE OFF', this.guideOn ? 'Shows the path · max ★★ while used' : '', '#34ff9a', 1.4);
    this.ui.syncGuide();
    this.ui.saveSettings();
  }

  stopGame() {
    this.unlockOrientation();
    this.state = 'MENU';
    this.closeDialog();
    this.audio.stopMusic();
    this.controls.releaseWakeLock();
    this.hud.hideBanner();
    this.ui.showMenuPage();
  }

  /**
   * Phones: side-by-side 3D (cardboard, smart glasses) is viewed in landscape, so those modes lock
   * landscape; 2D/anaglyph lock whatever the player is holding (tilt-aim must not flip the screen).
   * Must run inside a tap. Android allows it only full-screen; iOS Safari has no lock API, so a failure
   * is reported on the pause panel instead of failing silently. (From 3D Labyrinth.)
   */
  lockOrientation() {
    if (this.inVR) { this.orientStatus = ''; this.orientProblem = false; return; }
    const so = screen.orientation;
    if (!matchMedia('(pointer: coarse)').matches) { this.orientStatus = ''; return; } // desktop: nothing to lock
    if (!so || typeof so.lock !== 'function') { this.orientFailed('not supported by this browser'); return; }
    const want = this.renderer.isDualView ? 'landscape' : (so.type && so.type.startsWith('landscape') ? 'landscape' : 'portrait');
    const ok = () => { this.orientStatus = `🔒 Rotation locked: ${want}`; this.orientProblem = false; };
    const lock = (retry) => so.lock(want).then(ok, err => {
      if (retry && document.fullscreenElement) setTimeout(() => lock(false), 300);
      else this.orientFailed((err && err.name) || 'refused');
    });
    if (document.fullscreenEnabled && !document.fullscreenElement) {
      document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => lock(true), () => lock(false));
    } else lock(true);
  }

  orientFailed(why) {
    this.orientProblem = true;
    this.orientStatus = `⚠ Rotation lock unavailable (${why})`;
    console.warn('[Orientation] lock failed:', why);
  }

  unlockOrientation() {
    try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (_) { /* not locked */ }
  }

  saveProgress() { this.progress = saveProgress(this.progress); } // merges: never rolls back another copy's bests

  /** Pick up what another copy of the game saved (the stored run is the newest: every change is saved at once). */
  syncProgress() {
    let stored = null;
    try { stored = parseProgress(localStorage.getItem(PROGRESS_KEY)); } catch (_) { /* storage blocked */ }
    if (!stored) return;
    this.progress = mergeProgress(stored, this.progress);
    if (this.state === 'MENU') this.ui.renderLevelGrid();
  }

  /** Keep the run's in-level counters saved, so leaving mid-level resumes them. */
  saveRunCounters() {
    if (this.practice) return;
    this.progress.run = { ...this.run, shots: this.shots, hits: this.hits };
    this.saveProgress();
  }

  /* ------------------------------ Gameplay events ------------------------------ */
  shoot() {
    const a = this.aim;
    if (this.state !== 'PLAYING' || !this.world.ready || a.power < PHYS.MIN_POWER) return false;
    this.world.shoot(a.angle, a.power);
    this.shots++;
    this.saveRunCounters();
    this.audio.playShot(a.power);
    this.vibrate(12);
    a.lastPower = a.power; a.power = 0;
    this.stickYaw = this.dragYaw = null;
    return true;
  }

  onDiscHit() {
    this.audio.playClack();
    this.vibrate(25);
    if (this.practice) { this.hits = (this.hits + 1) % SCORE.HITS_PER_PUCK; return; }
    const r = discHit(this.run, this.hits);
    this.progress.run = r.run; this.hits = r.hits;
    if (r.lostPuck) {
      this.audio.playPuckLost();
      this.vibrate([60, 40, 60]);
      if (!r.gameOver) this.hud.showBanner(`💥 ${SCORE.HITS_PER_PUCK} HITS`, `−1 puck · ${this.run.pucks} left`, '#ff3b5c', 1.4);
      else this.pendingOver = true;
    }
    this.saveRunCounters();
  }

  /** The puck finished falling into a wrong hole. */
  onFallen() {
    if (this.practice) { this.world.respawn(); this.aimAtGoal(); this.behind.ready = false; return; }
    const r = losePuck(this.run);
    this.progress.run = r.run;
    this.saveRunCounters();
    if (r.gameOver) { this.gameOver(); return; }
    this.world.respawn();
    this.aimAtGoal();
    this.behind.ready = false;
    this.hud.showBanner('PLONK!', `−1 puck · ${this.run.pucks} left`, '#ff3b5c', 1.3);
  }

  levelComplete() {
    this.state = 'COMPLETE';
    const n = this.level.n, shots = this.shots;
    const stars = starsFor(shots, this.guideUsed);
    const points = shotPoints(shots);
    const firstClear = n >= this.progress.maxLevel;
    const lines = [`${shots} ${shots === 1 ? 'shot' : 'shots'}${this.practice ? '' : ` · +${fmt(points)}`}`];
    let buttons;
    if (this.practice) {
      buttons = [{ id: 'replay', label: '↻ Replay' }, { id: 'nextPractice', label: 'Next ▶' }, { id: 'menu', label: this.inVR ? '⏏ Exit VR' : '☰ Menu' }];
    } else {
      const res = clearLevel(this.run, shots);
      this.progress.run = { ...res.run, shots: 0, hits: 0 };
      this.progress.highScore = Math.max(this.progress.highScore, this.run.score);
      lines.push(`Score ${fmt(this.run.score)} · ${this.run.pucks} ${this.run.pucks === 1 ? 'puck' : 'pucks'}`);
      if (res.bonus) lines.push('🎁 Bonus puck!');
      if (res.checkpoint) lines.push(`🚩 Checkpoint: level ${res.run.level}`);
      if (res.bonus) this.audio.playBonus();
      buttons = [{ id: 'next', label: 'Next ▶' }, { id: 'menu', label: this.inVR ? '⏏ Exit VR' : '☰ Menu' }];
    }
    this.progress = recordBest(this.progress, n, { stars, points, shots });
    if (firstClear) lines.push(`🔓 Level ${n + 1} unlocked!`);
    if (this.guideUsed) lines.push('🎯 Aim guide used (max ★★)');
    this.saveProgress();
    this.audio.playLevelComplete();
    if (firstClear) { this.board.celebrate(this.level.goal); this.audio.playFirstClear(); }
    this.vibrate([40, 60, 40]);
    this.controls.releaseWakeLock();
    this.openDialog({
      title: stars === 3 && shots === 1 ? 'HOLE IN ONE!' : `LEVEL ${n} CLEAR!`, color: '#34ff9a',
      big: '★'.repeat(stars) + '☆'.repeat(3 - stars), lines, buttons
    });
  }

  gameOver() {
    this.state = 'OVER';
    this.pendingOver = false;
    const final = this.run.score;
    this.progress.highScore = Math.max(this.progress.highScore, final);
    this.progress.run = { ...restartFromCheckpoint(this.run), shots: 0, hits: 0 };
    this.saveProgress();
    this.audio.playGameOver();
    this.vibrate(220);
    this.controls.releaseWakeLock();
    const cp = this.run.level;
    this.openDialog({
      title: 'GAME OVER', color: '#ff3b5c',
      lines: [`Final score ${fmt(final)}`, `High score ${fmt(this.progress.highScore)}`, `Back to checkpoint: level ${cp} (score ${fmt(this.run.score)})`],
      buttons: [{ id: 'next', label: `↻ Level ${cp}` }, { id: 'menu', label: this.inVR ? '⏏ Exit VR' : '☰ Menu' }]
    });
  }

  /* ------------------------------ 3D dialogs ------------------------------ */
  openDialog(spec) {
    this.hud.showDialog(spec);
    this.controls.menuMode = true;
    this.controls.resetManual();
    this.aim.power = 0;
  }

  closeDialog() {
    this.hud.hideDialog();
    this.controls.menuMode = false;
  }

  /** Taps on the canvas while a dialog is open: map to eye-local NDC (works in both SBS halves). */
  bindDialogPointer() {
    const canvas = this.renderer.renderer.domElement;
    const toNdc = e => {
      const r = canvas.getBoundingClientRect();
      let u = (e.clientX - r.left) / r.width;
      const v = (e.clientY - r.top) / r.height;
      if (this.renderer.isDualView) u = (u % 0.5) * 2; // either eye's half maps to the same panel
      return [u * 2 - 1, 1 - v * 2];
    };
    this.controls.blockDrag = e => {
      if (!this.hud.dialogVisible) {
        // 🗺 icon tap toggles the map and must not start a slingshot pull
        if (this.hud.hitMapButton(...toNdc(e))) { this.toggleMap(); return true; }
        if (this.state === 'PLAYING' && this.world.ready) this.audio.playAim();
        return false;
      }
      const i = this.hud.hitIndex(...toNdc(e));
      if (i >= 0) { this.hud.setFocus(i); this.dialogAction(this.hud.focusedAction()); }
      return true;
    };
    canvas.addEventListener('pointermove', e => {
      if (e.pointerType === 'mouse' && this.hud.dialogVisible) this.hud.setFocus(this.hud.hitIndex(...toNdc(e)));
    });
  }

  dialogAction(id) {
    this.audio.ensureContext();
    switch (id) {
      case 'resume': this.togglePause(); break;
      case 'restart': case 'replay': this.startLevel(this.level.n, 'practice'); break;
      case 'next': this.startRun(); break;
      case 'nextPractice': this.startLevel(this.level.n + 1, 'practice'); break;
      case 'menu': if (this.inVR) this.exitVR(); this.stopGame(); break;
      case 'recenter': this.placeVR(); this.togglePause(); break;
      case 'vrsize': this.vr.mode = this.vr.mode === 'table' ? 'floor' : 'table'; this.placeVR(); this.togglePause(); break;
      case 'exitvr': this.exitVR(); break;
      case 'settings': this.ui.showModal('pauseScreen'); break; // sliders need a real 2D form
      case 'guide': {
        const focus = this.hud.dialogSpec ? this.hud.dialogSpec.focus : 0;
        this.toggleGuide();
        this.openPauseDialog(focus);
        break;
      }
    }
  }

  handleAction(a) {
    const inGame = this.state !== 'MENU';
    const settingsOpen = !document.getElementById('pauseScreen').classList.contains('hidden');
    if (this.hud.dialogVisible && !settingsOpen) {
      if (a === 'focusPrev') return this.hud.moveFocus(-1);
      if (a === 'focusNext') return this.hud.moveFocus(1);
      if (a === 'confirm') return this.dialogAction(this.hud.focusedAction());
    }
    switch (a) {
      case 'pause':
        if (settingsOpen) this.ui.hideModals();
        else if (this.state === 'PLAYING' || this.state === 'PAUSED') this.togglePause();
        break;
      // Restarting a level mid-run would wipe its shot count, so it is a practice-only button
      case 'restart': if (inGame && this.practice) { this.ui.hideModals(); this.startLevel(this.level.n, 'practice'); } break;
      case 'calibrate': this.calibrate(); break;
      case 'view': if (!this.inVR) this.ui.setViewMode(this.cycleViewMode()); break;
      case 'mute': this.ui.toggleMute(); break;
      case 'map': if (this.hud.mapBtn.mesh.visible) this.toggleMap(); break;
      case 'guide': this.toggleGuide(); break;
      case 'confirm':
        if (this.state === 'MENU') this.startRun();
        else if (this.state === 'PLAYING') this.shoot();
        break;
    }
  }

  calibrate() {
    this.controls.calibrate();
    if (this.state !== 'MENU') this.hud.showBanner('LEVELLED', 'Current hold = no aim', '#00f0ff', 1.0);
  }

  cycleViewMode() { return VIEWS[(VIEWS.indexOf(this.viewMode) + 1) % VIEWS.length]; }

  /** 🗺 / N cycles the board map (Behind view): Off -> Small -> Large -> Off. */
  toggleMap() {
    this.mapMode = { off: 'small', small: 'large', large: 'off' }[this.mapMode] || 'small';
    this.hud.setMapLarge(this.mapMode === 'large');
    this.audio.playTick(false);
    this.ui.saveSettings();
  }

  get mapOn() { return this.mapMode !== 'off'; }

  vibrate(p) { if (navigator.vibrate) { try { navigator.vibrate(p); } catch (_) { /* unsupported */ } } }

  /* ------------------------------ Aiming ------------------------------ */
  /** Yaw the controls are relative to: the Behind camera's heading, else north-up (0). */
  camYaw() { return this.viewMode === 'BEHIND' && !this.inVR ? this.behind.yaw : 0; }

  /**
   * Turn the current input into aim.angle / aim.power.
   * - Drag (touch / mouse) is a slingshot: pull back, the puck goes the other way, release to shoot.
   * - Arrow keys / WASD turn the aim and set the power; Space or Enter shoots.
   * - Sticks and tilt (gamepad, Quest thumbstick, phone controller, gyro) point the way; length = power;
   *   A / trigger / OK / a tap shoots. Letting a stick spring back keeps the aim.
   * Directions are taken relative to the camera heading frozen when the gesture began, so in the
   * Behind view the camera can swing round to the new aim without feeding back into it.
   */
  updateAim(dt) {
    const c = this.controls, a = this.aim, t = c.tilt;
    if (c.drag) {
      if (this.dragYaw === null) this.dragYaw = this.camYaw();
      const R = c.dragRadius, dx = c.drag.x - c.drag.x0, dy = c.drag.y - c.drag.y0;
      if (Math.hypot(dx, dy) >= TAP_PX) {
        a.angle = this.dragYaw + Math.atan2(-dx, dy); // opposite of the pull
        a.power = Math.min(1, Math.hypot(dx, dy) / R);
      }
      return;
    }
    this.dragYaw = null;
    if (c.source === 'keys') {
      const kx = (c.keys.right ? 1 : 0) - (c.keys.left ? 1 : 0), ky = (c.keys.up ? 1 : 0) - (c.keys.down ? 1 : 0);
      if ((kx || ky) && a.power < PHYS.MIN_POWER) a.power = a.lastPower; // first key press shows the last power
      a.angle = wrap(a.angle + kx * AIM.KEY_TURN * dt);
      if (ky) a.power = Math.max(PHYS.MIN_POWER, Math.min(1, a.power + ky * AIM.KEY_POWER * dt));
      return;
    }
    if (['pad', 'vr', 'remote', 'gyro'].includes(c.source)) {
      const m = Math.hypot(t.x, t.y);
      const released = (this.lastStickMag - m) / Math.max(dt, 1e-3) > AIM.RELEASE_RATE;
      this.lastStickMag = m;
      if (m <= AIM.DEADZONE) { this.stickYaw = null; return; }
      if (released) return;
      if (this.stickYaw === null) this.stickYaw = this.camYaw();
      a.angle = this.stickYaw + Math.atan2(t.x, t.y);
      a.power = Math.min(1, (m - AIM.DEADZONE) / (1 - AIM.DEADZONE));
    }
  }

  /** Slingshot release: shoot along the pull. A tap (no pull) shoots the stick / tilt aim instead. */
  onDragEnd({ dx, dy, cancelled }) {
    if (this.state !== 'PLAYING' || this.hud.dialogVisible) return;
    if (Math.hypot(dx, dy) < TAP_PX) {
      if (this.controls.gyroEnabled) this.shoot(); // tilt-aim players tap to shoot
      return;
    }
    if (cancelled) { this.aim.power = 0; return; }
    if (!this.shoot()) this.aim.power = 0; // released while the puck was still rolling: no shot
  }

  /* ------------------------------ Per-frame ------------------------------ */
  updatePlay(dt) {
    const playing = this.state === 'PLAYING';
    if (playing) this.updateAim(dt);
    if (playing || this.state === 'COMPLETE' || this.state === 'OVER') {
      this.world.step(dt, playing ? {
        rim: s => { this.audio.playRim(s); if (s > 8) this.vibrate(10); },
        hit: () => this.onDiscHit(),
        knock: s => this.audio.playKnock(s),
        sink: () => { this.audio.playSink(); this.vibrate(30); },
        fall: () => { this.audio.playFall(); this.vibrate(80); }
      } : {});
    }
    if (playing) {
      if (this.pendingOver) this.gameOver();
      else if (this.world.sunk) this.levelComplete();
      else if (this.world.fallen) this.onFallen();
    }

    const ready = this.state === 'PLAYING' && this.world.ready;
    const aim = ready && this.aim.power >= PHYS.MIN_POWER ? this.aim : null;
    let path = null;
    if (aim && this.guideOn) {
      const key = `${aim.angle.toFixed(3)}|${aim.power.toFixed(3)}|${this.world.puck.x.toFixed(2)}|${this.world.puck.z.toFixed(2)}`;
      if (key !== this.pathKey) { this.pathKey = key; this.path = predictPath(this.world, aim.angle, aim.power); }
      path = this.path;
    }
    this.board.setAim(this.world.puck, aim, path);
    this.board.update(this.world, dt);
    this.hud.setStatus({
      level: this.level.n, score: this.run.score, pucks: this.run.pucks, shots: this.shots,
      hits: this.hits, hitsMax: SCORE.HITS_PER_PUCK, source: this.controls.source, practice: this.practice
    });
  }

  updateCamera(dt) {
    const r = this.renderer;
    if (r.renderer.xr.isPresenting) return;
    const behind = this.viewMode === 'BEHIND';
    r.fov += ((behind ? BEHIND_VIEW.FOV : CAMERA.FOV) - r.fov) * Math.min(1, 4 * dt);
    if (behind) { this.updateBehindCamera(dt); return; }
    this.hud.setMapVisible(false);
    this.hud.setMapButton(false);
    this.behind.ready = false;

    const pitch = (this.viewMode === 'TOP' ? CAMERA.TOP_PITCH : CAMERA.OVERVIEW_PITCH) * DEG;
    const { dist, tz } = this.fitBoard(pitch, r.eyeAspect(), r.fov);
    const target = new THREE.Vector3(0, 0, tz);
    const k = this.cam.ready ? Math.min(1, 3 * dt) : 1;
    this.cam.target.lerp(target, k);
    this.cam.dist += (dist - this.cam.dist) * k;
    this.cam.pitch = this.cam.ready ? this.cam.pitch + (pitch - this.cam.pitch) * k : pitch;
    this.cam.ready = true;
    const pos = new THREE.Vector3(0, Math.sin(this.cam.pitch), Math.cos(this.cam.pitch)).multiplyScalar(this.cam.dist).add(this.cam.target);
    r.cameraGroup.position.copy(pos);
    r.cameraGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), this.cam.target.clone().sub(pos).normalize());
    // Stereo follows the viewing distance so depth feels the same whatever the screen
    r.setFocalLength(this.cam.dist * (1 + this.focusOffset));
    r.setEyeDistance(this.depth * this.cam.dist * STEREO_RATIO);
  }

  /**
   * Closest camera that shows the whole board, frame included, below the HUD bar. Perspective makes the
   * near edge look bigger than the far one, so the corners are projected and the distance found by
   * bisection (for a few aim points along the board) instead of a closed-form guess. Cached per view.
   */
  fitBoard(pitch, aspect, fov) {
    const key = `${pitch.toFixed(4)}|${aspect.toFixed(4)}|${fov.toFixed(2)}`;
    if (this.fitCache && this.fitCache.key === key) return this.fitCache;
    const half = this.board.extent.W / 2 + 0.05, cam = new THREE.PerspectiveCamera(fov, aspect, 0.1, 500), v = new THREE.Vector3();
    const corners = [];
    for (const x of [-half, half]) for (const z of [-half, half]) for (const y of [0, BOARD.RIM_H]) corners.push([x, y, z]);
    // The HUD bar takes up to ~17% of the height (NDC 0.66 and up on a wide screen); small side margins
    const fits = (dist, tz) => {
      cam.position.set(0, Math.sin(pitch) * dist, Math.cos(pitch) * dist + tz);
      cam.lookAt(0, 0, tz);
      cam.updateMatrixWorld(true);
      return corners.every(([x, y, z]) => { v.set(x, y, z).project(cam); return Math.abs(v.x) <= 0.96 && v.y >= -0.96 && v.y <= 0.64 && v.z < 1; });
    };
    let best = { dist: Infinity, tz: 0 };
    for (let tz = -half * 0.3; tz <= half * 0.3 + 1e-9; tz += half * 0.05) {
      let lo = 2, hi = 300;
      if (!fits(hi, tz)) continue;
      for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (fits(mid, tz)) hi = mid; else lo = mid; }
      if (hi < best.dist) best = { dist: hi, tz };
    }
    this.fitCache = { key, ...best };
    return this.fitCache;
  }

  /** Golf-style camera behind the puck, looking along the aim; it holds its heading while the puck rolls. */
  updateBehindCamera(dt) {
    const r = this.renderer, V = BEHIND_VIEW, b = this.behind, p = this.world.puck;
    const aiming = this.state === 'PLAYING' && this.world.ready && this.aim.power >= PHYS.MIN_POWER;
    if (aiming || !b.ready) b.yaw = b.ready ? wrap(b.yaw + wrap(this.aim.angle - b.yaw) * Math.min(1, V.YAW_EASE * dt)) : this.aim.angle;
    const fx = Math.sin(b.yaw), fz = -Math.cos(b.yaw);
    const eye = new THREE.Vector3(p.x - fx * V.BACK, V.HEIGHT, p.z - fz * V.BACK);
    const look = new THREE.Vector3(p.x + fx * V.LOOK_AHEAD, 0, p.z + fz * V.LOOK_AHEAD);
    if (b.ready) b.eye.lerp(eye, Math.min(1, 8 * dt)); else b.eye.copy(eye);
    b.ready = true;
    const m = new THREE.Matrix4().lookAt(b.eye, look, new THREE.Vector3(0, 1, 0));
    r.cameraGroup.position.copy(b.eye);
    r.cameraGroup.quaternion.setFromRotationMatrix(m);
    this.cam.ready = false; // snap cleanly back when leaving this view

    const mapHud = !this.hud.dialogVisible;
    this.hud.setMapVisible(mapHud && this.mapOn);
    this.hud.setMapButton(mapHud, this.mapMode);
    this.hud.updateMap(this.world, dt, this.world.ready ? this.aim : null, b.yaw);

    const dist = Math.hypot(V.BACK, V.HEIGHT);
    r.setFocalLength(dist * (1 + this.focusOffset));
    r.setEyeDistance(this.depth * dist * STEREO_RATIO);
  }

  /* ------------------------------ Phone controller ------------------------------ */
  /** Show a pairing code; a phone opening controller.html and entering it becomes the controller. */
  async startPhoneLink() {
    if (this.link) { this.ui.showLinkPanel(this.link.code, this.link.connected ? 'connected' : 'waiting'); return; }
    this.ui.showLinkPanel(null, 'starting');
    this.link = new TVLink({
      onMessage: m => this.onRemoteMessage(m),
      onStatus: s => {
        this.ui.setLinkStatus(s);
        if (s === 'connected') { this.audio.playTick(false); this.hud.showBanner('📲 PHONE', 'Controller connected', '#34ff9a', 1.4); }
        if (s === 'lost') this.controls.remoteAt = 0; // the aim stops following at once
      }
    });
    try {
      const code = await this.link.start();
      this.ui.showLinkPanel(code, 'waiting');
    } catch (err) {
      this.link = null;
      this.ui.setLinkStatus('error:' + err.message);
    }
  }

  stopPhoneLink() {
    if (this.link) this.link.stop();
    this.link = null;
    this.controls.remoteAt = 0;
    this.ui.setLinkStatus('off');
  }

  onRemoteMessage(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'tilt') this.controls.setRemoteTilt(+m.x, +m.y);
    else if (m.t === 'btn' && REMOTE_ACTIONS.has(m.b)) { this.audio.ensureContext(); this.handleAction(m.b); }
  }

  /** ~4x/s: tell the phone what the game is doing, so its screen can show it. */
  sendLinkState(now) {
    if (!this.link || !this.link.connected || now - (this.linkSentAt || 0) < 250) return;
    this.linkSentAt = now;
    this.link.send({
      t: 'state', s: this.state, lv: this.level ? this.level.n : this.run.level, practice: this.practice,
      score: this.run.score, pucks: this.run.pucks, shots: this.level ? this.shots : 0,
      ready: !!(this.world && this.world.ready), panel: this.hud.dialogSpec ? this.hud.dialogSpec.title : null
    });
  }

  animate(timestamp) {
    const now = timestamp || performance.now();
    const dt = Math.min(Math.max(((now - (this.lastTime || now)) / 1000), 0.001), 0.05);
    this.lastTime = now;
    this.sendLinkState(now);
    if (this.state === 'MENU' || !this.level) {
      this.controls.pollGamepads(); // a pad's A button can start the game from the menu
      return; // menu has no 3D view: save battery
    }
    const xr = this.renderer.renderer.xr;
    if (xr.isPresenting) {
      const { confirm, pause } = this.controls.pollXR(xr.getSession());
      if (confirm && !this.xrConfirmHeld) this.handleAction('confirm');
      if (pause && !this.xrPauseHeld) this.handleAction('pause');
      this.xrConfirmHeld = confirm; this.xrPauseHeld = pause;
      if (this.vr.pending && ++this.vr.frames > 3) this.placeVR(); // the head pose is known after a few XR frames
      this.hud.layout(VR.HUD.DIST, VR.HUD.FOV, VR.HUD.ASPECT);
    }
    this.controls.update(dt); // every frame, so gamepad/XR can drive dialogs while paused
    if (this.hud.dialogVisible) this.pollDialogStick();
    if (this.state !== 'PAUSED') this.updatePlay(dt);
    this.hud.update(dt);
    this.updateCamera(dt);
    this.renderer.render(this.scene);
  }

  /** Gamepad / Quest thumbstick flicks move dialog focus (edge-triggered). */
  pollDialogStick() {
    const x = ['pad', 'vr', 'remote'].includes(this.controls.source) ? this.controls.tilt.x : 0;
    const dir = x > 0.6 ? 1 : x < -0.6 ? -1 : 0;
    if (dir && dir !== this.stickDir) this.hud.moveFocus(dir);
    this.stickDir = dir;
  }

  /* ------------------------------ WebXR (from 3D Labyrinth) ------------------------------ */
  get inVR() { return this.renderer.renderer.xr.isPresenting; }

  setupWebXR() {
    if (!navigator.xr) return;
    navigator.xr.isSessionSupported('immersive-vr').then(ok => {
      if (!ok) return;
      const btn = document.getElementById('webxrBtn');
      if (btn) btn.style.display = 'inline-flex';
      btn && btn.addEventListener('click', async () => {
        try {
          const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
          this.renderer.renderer.xr.setReferenceSpaceType('local-floor');
          await this.renderer.renderer.xr.setSession(session);
          session.addEventListener('select', () => this.handleAction('confirm')); // trigger = shoot / OK
          session.addEventListener('end', () => this.onVREnd());
          this.renderer.cameraGroup.position.set(0, 0, 0);
          this.renderer.cameraGroup.quaternion.identity();
          this.hud.attachTo(this.vrHud);
          this.hud.setMapVisible(false); this.hud.setMapButton(false);
          this.vr.pending = true; this.vr.frames = 0;
          // The Behind camera would move the world around a player who stands still (motion sickness)
          if (this.viewMode === 'BEHIND') this.ui.setViewMode('OVERVIEW');
          if (this.state === 'MENU') this.startRun(); else this.startLevel(this.level.n, this.mode);
        } catch (err) {
          console.warn('[WebXR] session failed:', err);
          alert('Could not start VR: ' + err.message);
        }
      });
    }).catch(() => {});
  }

  /** Place the board (and the floating HUD) relative to where the player's head is right now. */
  placeVR() {
    const cam = this.renderer.mainCamera; // three r128 copies the XR head pose into the user camera each frame
    const head = cam.position.clone();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    Object.assign(this.vr, { pending: false, head, fwd, yaw: Math.atan2(-fwd.x, -fwd.z) });
    this.vrHud.position.copy(head);
    this.vrHud.rotation.set(0, this.vr.yaw, 0);
    this.applyVR();
  }

  /** Table = a ~0.8 m board below the eyes, far edge raised like a drafting table; Floor = ~3.2 m at your feet. */
  applyVR() {
    const v = this.vr;
    if (!v.head || !this.board.extent) return;
    const { W, H } = this.board.extent, span = Math.max(W, H);
    const w = this.board.world;
    if (v.mode === 'table') {
      const s = VR.TABLE.SIZE / span, depth = H * s;
      w.scale.setScalar(s);
      w.position.copy(v.head).addScaledVector(v.fwd, VR.TABLE.NEAR_EDGE + depth / 2);
      w.position.y = v.head.y - VR.TABLE.BELOW_EYES;
    } else {
      const s = VR.FLOOR.SIZE / span, depth = H * s;
      const floorY = v.head.y > 0.8 ? 0 : v.head.y - VR.FLOOR.STAND_EYE;
      w.scale.setScalar(s);
      w.position.copy(v.head).addScaledVector(v.fwd, VR.FLOOR.NEAR_EDGE + depth / 2);
      w.position.y = floorY + 0.02;
    }
    const pitch = v.mode === 'table' ? VR.TABLE.TILT_DEG * DEG : 0;
    w.rotation.set(pitch, v.yaw, 0, 'YXZ');
  }

  exitVR() {
    const session = this.renderer.renderer.xr.getSession();
    if (session) session.end();
  }

  onVREnd() {
    const cam = this.renderer.mainCamera;
    cam.position.set(0, 0, 0); cam.quaternion.identity(); cam.scale.set(1, 1, 1); cam.updateMatrix();
    const w = this.board.world;
    w.scale.setScalar(1); w.position.set(0, 0, 0); w.rotation.set(0, 0, 0);
    this.hud.attachTo(this.renderer.mainCamera);
    this.vr.pending = false; this.vr.head = null;
    if (this.state === 'PLAYING') this.togglePause(); // back on the flat screen: give the player a moment
  }

  /* ------------------------------ PWA ------------------------------ */
  registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing && this.state !== 'PLAYING') { refreshing = true; location.reload(); }
    });
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(`./sw.js?v=${VERSION}`).then(reg => {
        if (reg.waiting && navigator.serviceWorker.controller) this.ui.showUpdatePrompt(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const w = reg.installing;
          w && w.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) this.ui.showUpdatePrompt(w);
          });
        });
      }).catch(err => console.warn('[SW] registration failed:', err));
    });
  }
}

document.addEventListener('DOMContentLoaded', () => { window.app = new GameApp(); });
