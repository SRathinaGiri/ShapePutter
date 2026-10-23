/* ==========================================================================
   3D SHAPE PUTTER - UI MANAGER (menus, modals, settings persistence)
   From 3D Labyrinth v1.14.1.
   ========================================================================== */

import { BOARD_SURFACES, PUCK_TYPES, PHYS, VIEWS, surfacePhysics } from './config.js';
import { PROGRESS_KEY, freshProgress } from './progress.js';
import { freshRun } from './rules.js';
import { levelShape, shapeName } from './levels.js';

const SETTINGS_KEY = '3d_shapeputter_settings';
const VIEW_LABEL = { OVERVIEW: '🎥 View: Overview', TOP: '⬇️ View: Top-down', BEHIND: '⛳ View: Behind the puck' };
const fmt = n => n.toLocaleString('en-IN');

const $ = id => document.getElementById(id);

export class UIManager {
  constructor(app) {
    this.app = app;
    this.modals = ['pauseScreen']; // only the settings sheet; game messages are 3D panels
    this.bindButtons();
    this.bindStereo();
    this.bindControlSettings();
    this.buildLookPickers();
    this.loadSettings();
    this.setupFolds();
    this.setupInstall();
  }

  syncGuide() {
    const b = $('guideBtn');
    if (b) { b.classList.toggle('active', !!this.app.guideOn); b.textContent = `🎯 Aim guide: ${this.app.guideOn ? 'ON' : 'OFF'}`; }
    if (this.app.look) this.syncSummaries();
  }

  /* ---------- Phone controller pairing panel ---------- */
  showLinkPanel(code, status) {
    const url = new URL('controller.html', location.href);
    url.search = ''; url.hash = '';
    $('linkUrl').textContent = url.href;
    $('linkCode').textContent = code || '······';
    $('linkPanel').classList.remove('hidden');
    this.setLinkStatus(status);
  }

  setLinkStatus(s) {
    const el = $('linkStatus'), btn = $('phonePadBtn');
    const text = {
      starting: '⏳ Getting a code…', waiting: '⏳ Waiting for the phone…', connected: '✅ Phone connected: tilt it to aim, OK to shoot',
      phone: '📲 Phone found · connecting directly over Wi-Fi…',
      failed: '⚠ The phone found this screen but could not connect directly. Same Wi-Fi? Guest networks often block devices talking to each other.',
      lost: '⚠ Phone disconnected: enter the code again on the phone', off: ''
    }[s] ?? (s.startsWith('error:') ? `⚠ ${s.slice(6)}` : '');
    if (el) el.textContent = text;
    if (btn) {
      btn.classList.toggle('active', s === 'connected');
      btn.textContent = s === 'connected' ? '📲 Phone: connected' : '📲 Phone controller';
    }
    if (s === 'connected') setTimeout(() => { if (this.app.link && this.app.link.connected) $('linkPanel').classList.add('hidden'); }, 1500);
  }

  /* ---------- Collapsible menu sections ---------- */
  setupFolds() {
    const key = '3d_shapeputter_folds';
    let open = {};
    try { open = JSON.parse(localStorage.getItem(key) || '{}') || {}; } catch (_) { open = {}; }
    document.querySelectorAll('details.fold').forEach(d => {
      d.open = !!open[d.dataset.fold];
      d.addEventListener('toggle', () => {
        open[d.dataset.fold] = d.open;
        try { localStorage.setItem(key, JSON.stringify(open)); } catch (_) { /* storage blocked */ }
      });
    });
    this.syncSummaries();
  }

  /** One-line summaries on the closed section headers. */
  syncSummaries() {
    const a = this.app;
    const set = (id, text) => { if ($(id)) $(id).textContent = text; };
    set('sumLook', `${BOARD_SURFACES[a.look.board].name} · ${PUCK_TYPES[a.look.puck].name}`);
    set('sumControls', `${VIEW_LABEL[a.viewMode].replace(/^\S+ View: /, '')} · tilt-aim ${a.controls.gyroEnabled ? 'on' : a.controls.gyroWanted ? 'auto' : 'off'}${a.guideOn ? ' · 🎯 guide' : ''}`);
    set('sum3d', `${{ '2d': '2D', parallel: 'Parallel 3D', cross: 'Cross-Eye 3D', anaglyph: 'Anaglyph', hsbs: 'Smart Glasses' }[a.renderer.mode]}${a.renderer.mode === '2d' ? '' : ` · depth ${a.depth.toFixed(2)}`}`);
  }

  /* ---------- Install as an app ---------- */
  /**
   * Chrome/Edge/Android fire beforeinstallprompt once the PWA is installable: keep it and offer
   * our own button + banner. iOS never fires it, so there we show the Add-to-Home-Screen steps.
   */
  setupInstall() {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    if (standalone) return;
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    let deferred = null;
    const dismissedKey = '3d_shapeputter_install_dismissed';
    const show = () => {
      if ($('installBtn')) $('installBtn').style.display = 'inline-flex';
      let dismissed = false;
      try { dismissed = localStorage.getItem(dismissedKey) === '1'; } catch (_) { /* storage blocked */ }
      if (!dismissed) $('installBanner').classList.remove('hidden');
    };
    const hide = () => {
      if ($('installBtn')) $('installBtn').style.display = 'none';
      $('installBanner').classList.add('hidden');
    };
    const install = async () => {
      if (deferred) {
        deferred.prompt();
        const { outcome } = await deferred.userChoice;
        deferred = null;
        if (outcome === 'accepted') hide();
      } else if (isIOS) {
        $('iosInstallHelp').classList.remove('hidden');
      }
    };
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; show(); });
    window.addEventListener('appinstalled', hide);
    this.on('installBtn', install);
    this.on('installBannerBtn', install);
    this.on('closeInstallBtn', () => {
      $('installBanner').classList.add('hidden');
      try { localStorage.setItem(dismissedKey, '1'); } catch (_) { /* storage blocked */ }
    });
    this.on('closeIosHelpBtn', () => $('iosInstallHelp').classList.add('hidden'));
    if (isIOS) show();
  }

  on(id, fn) {
    const el = $(id);
    if (el) el.addEventListener('click', e => { e.preventDefault(); this.app.audio.ensureContext(); fn(e); });
  }

  bindButtons() {
    const a = this.app;
    this.on('playBtn', () => a.startRun());
    this.on('gamePauseBtn', () => a.togglePause());
    this.on('gameStopBtn', () => a.stopGame());
    this.on('gameRecenterBtn', () => a.calibrate());
    this.on('resumeBtn', () => a.togglePause());
    this.on('settingsBackBtn', () => this.hideModals()); // back to the 3D pause panel
    this.on('newRunBtn', () => {
      if (!confirm('Start a new run from level 1? Your levels, stars and high score are kept.')) return;
      a.progress.run = freshRun();
      a.saveProgress();
      this.renderLevelGrid();
    });
    this.on('resetProgressBtn', () => {
      if (!confirm('Reset everything: the run, all stars and the high score?')) return;
      a.progress = freshProgress();
      try { localStorage.removeItem(PROGRESS_KEY); } catch (_) { /* storage blocked */ }
      this.renderLevelGrid();
    });
    ['audioToggle', 'gameAudioBtn'].forEach(id => this.on(id, () => this.toggleMute()));
    ['gyroToggle', 'gameGyroBtn'].forEach(id => this.on(id, () => this.toggleGyro()));
    ['viewModeBtn', 'gameViewBtn'].forEach(id => this.on(id, () => this.setViewMode(a.cycleViewMode())));
    this.on('helpBtn', () => { $('infoDrawer').classList.remove('hidden'); });
    this.on('phonePadBtn', () => a.startPhoneLink());
    this.on('guideBtn', () => a.toggleGuide());
    this.on('linkDoneBtn', () => $('linkPanel').classList.add('hidden'));
    this.on('linkStopBtn', () => { a.stopPhoneLink(); $('linkPanel').classList.add('hidden'); });
    this.on('closeInfoBtn', () => { $('infoDrawer').classList.add('hidden'); });
  }

  bindStereo() {
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.preventDefault();
        this.setStereoMode(btn.dataset.mode);
        this.saveSettings();
      });
    });
    this.bindSliderPair('.depth-slider', '.depth-val', v => { this.app.depth = v; }, v => v.toFixed(2));
    this.bindSliderPair('.focus-slider', '.focus-val', v => { this.app.focusOffset = v / 100; }, v => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`);
    document.querySelectorAll('.swap-btn').forEach(btn => btn.addEventListener('click', e => {
      e.preventDefault();
      this.app.renderer.swapEyes = !this.app.renderer.swapEyes;
      this.syncSwap();
      this.saveSettings();
    }));
  }

  bindSliderPair(sliderSel, valSel, apply, fmtVal) {
    const sliders = document.querySelectorAll(sliderSel), vals = document.querySelectorAll(valSel);
    const set = v => {
      sliders.forEach(s => { s.value = v; });
      vals.forEach(el => { el.textContent = fmtVal(v); });
      apply(v);
    };
    sliders.forEach(s => s.addEventListener('input', () => { set(parseFloat(s.value)); this.saveSettings(); }));
    this[`set_${sliderSel}`] = set;
    return set;
  }

  bindControlSettings() {
    const c = this.app.controls;
    this.bindSliderPair('.sens-slider', '.sens-val', v => { c.gyroSensitivity = v; }, v => `${v.toFixed(0)}°`);
    this.on('invertYBtn', () => { c.invertY = !c.invertY; this.syncInvert(); this.saveSettings(); });
  }

  /* ---------- Board surface & puck type ---------- */
  buildLookPickers() {
    const make = (hostId, table, key) => {
      const host = $(hostId);
      if (!host) return;
      for (const [id, t] of Object.entries(table)) {
        const b = document.createElement('button');
        b.className = 'look-btn';
        b.dataset[key] = id;
        b.setAttribute('role', 'radio');
        b.title = t.desc;
        b.textContent = `${t.icon} ${t.name}`;
        b.addEventListener('click', e => { e.preventDefault(); this.setLook({ [key]: id }); this.saveSettings(); });
        host.appendChild(b);
      }
    };
    make('boardSelector', BOARD_SURFACES, 'board');
    make('puckSelector', PUCK_TYPES, 'puck');
  }

  setLook(change) {
    const look = this.app.look;
    Object.assign(look, change);
    if (!BOARD_SURFACES[look.board]) look.board = 'felt';
    if (!PUCK_TYPES[look.puck]) look.puck = 'plastic';
    document.querySelectorAll('.look-btn').forEach(b => {
      const on = b.dataset.board ? b.dataset.board === look.board : b.dataset.puck === look.puck;
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on);
    });
    // 1-5 meters on log scales spanning the extremes of the material table
    const s = surfacePhysics(look.board, look.puck);
    const meter = (v, lo, hi) => {
      const n = Math.max(1, Math.min(5, Math.round(1 + 4 * (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)))));
      return `<span class="meter">${'●'.repeat(n)}<span class="off">${'●'.repeat(5 - n)}</span></span>`;
    };
    const glide = PHYS.DAMPING / s.damping;
    const stats = $('lookStats');
    if (stats) stats.innerHTML =
      `<span>Glide</span>${meter(glide, 0.55, 3.4)}` +
      `<span>Cushion</span>${meter(s.rimRestitution, 0.38, 0.95)}` +
      `<span>Weight</span>${meter(s.mass, 0.8, 2.2)}` +
      `<span class="desc">${BOARD_SURFACES[look.board].icon} ${BOARD_SURFACES[look.board].desc}. ` +
      `${PUCK_TYPES[look.puck].icon} ${PUCK_TYPES[look.puck].desc}.</span>`;
  }

  setStereoMode(mode) {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    this.app.renderer.setMode(mode);
    // Changed mid-game (a tap, so allowed): side-by-side modes need landscape, re-lock to match
    if (!this.loading && this.app.state !== 'MENU') this.app.lockOrientation();
  }

  syncSwap() { document.querySelectorAll('.swap-btn').forEach(b => b.classList.toggle('active', this.app.renderer.swapEyes)); }
  syncInvert() { const b = $('invertYBtn'); if (b) { b.classList.toggle('active', this.app.controls.invertY); b.textContent = `↕️ Invert tilt: ${this.app.controls.invertY ? 'ON' : 'OFF'}`; } }

  toggleMute() {
    const m = this.app.audio.toggleMute();
    if (!m && this.app.state !== 'MENU') this.app.audio.startMusic();
    this.syncMute();
    this.saveSettings();
  }

  syncMute() {
    const m = this.app.audio.muted;
    if ($('audioToggle')) $('audioToggle').textContent = m ? '🔇 Muted' : '🔊 Sound';
    if ($('gameAudioBtn')) { $('gameAudioBtn').textContent = m ? '🔇' : '🔊'; $('gameAudioBtn').classList.toggle('active', m); }
  }

  async toggleGyro() {
    const c = this.app.controls;
    if (c.gyroEnabled) { c.disableGyro(); c.gyroWanted = false; this.syncGyro(false); }
    else {
      c.gyroWanted = true;
      const ok = await c.enableGyro();
      if (!ok) alert('Motion sensor not available or permission denied. Aim by dragging, with the arrow keys or a gamepad.');
      this.syncGyro(ok);
    }
    this.saveSettings();
  }

  syncGyro(on) {
    const want = this.app.controls.gyroWanted;
    const label = on ? 'Tilt aim: ON' : (want ? 'Tilt aim: AUTO' : 'Tilt aim: OFF');
    if ($('gyroBadge')) $('gyroBadge').textContent = label;
    $('gyroToggle') && $('gyroToggle').classList.toggle('active', on || want);
    $('gameGyroBtn') && $('gameGyroBtn').classList.toggle('active', on);
    if ($('gameRecenterBtn')) $('gameRecenterBtn').style.display = on ? '' : 'none';
    if (this.app.look) this.syncSummaries();
  }

  setViewMode(mode) {
    if (!VIEWS.includes(mode)) mode = 'OVERVIEW';
    this.app.viewMode = mode;
    if ($('viewModeBtn')) $('viewModeBtn').textContent = VIEW_LABEL[mode];
    if ($('gameViewBtn')) { $('gameViewBtn').title = `${VIEW_LABEL[mode]} (V)`; $('gameViewBtn').textContent = { OVERVIEW: '🎥', TOP: '⬇️', BEHIND: '⛳' }[mode]; }
    this.saveSettings();
  }

  renderLevelGrid() {
    const grid = $('levelGrid');
    const p = this.app.progress, run = p.run;
    if ($('playBtn')) $('playBtn').textContent = run.level > 1 || run.score ? `▶ Continue run · Level ${run.level}` : '▶ Play Level 1';
    if ($('runInfo')) {
      $('runInfo').textContent = `Score ${fmt(run.score)} · ${run.pucks} ${run.pucks === 1 ? 'puck' : 'pucks'} · 🚩 checkpoint level ${run.checkpoint}` +
        (p.highScore ? ` · 🏆 best ${fmt(p.highScore)}` : '');
    }
    if ($('newRunBtn')) $('newRunBtn').style.display = run.level > 1 || run.score ? '' : 'none';
    if (!grid) return;
    grid.innerHTML = '';
    for (let n = 1; n <= p.maxLevel; n++) {
      const b = document.createElement('button');
      b.className = 'level-btn' + (n === run.level ? ' current' : '');
      const best = p.best[n];
      b.innerHTML = `<span class="lv">${n}</span><span class="st">${best ? '★'.repeat(best.stars) + '☆'.repeat(3 - best.stars) : '···'}</span>`;
      b.title = `Practise level ${n} (${shapeName(levelShape(n))})` + (best ? ` · best ${best.shots} ${best.shots === 1 ? 'shot' : 'shots'}, ${fmt(best.points)} pts` : '');
      b.addEventListener('click', e => { e.preventDefault(); this.app.startPractice(n); });
      grid.appendChild(b);
    }
  }

  showMenuPage() {
    $('gamePage').classList.add('hidden');
    $('menuPage').classList.remove('hidden');
    this.hideModals();
    this.renderLevelGrid();
  }

  showGamePage() {
    $('menuPage').classList.add('hidden');
    $('gamePage').classList.remove('hidden');
    this.hideModals();
  }

  showModal(id) { this.hideModals(); $(id).classList.remove('hidden'); }
  hideModals() { this.modals.forEach(id => $(id) && $(id).classList.add('hidden')); }

  showUpdatePrompt(worker) {
    const banner = $('updateBanner');
    banner.classList.remove('hidden');
    $('installUpdateBtn').onclick = () => { $('installUpdateBtn').textContent = '⏳ Updating...'; worker.postMessage({ type: 'SKIP_WAITING' }); };
    $('closeUpdateBtn').onclick = () => banner.classList.add('hidden');
  }

  saveSettings() {
    if (this.loading) return;
    const a = this.app;
    const s = {
      mode: a.renderer.mode,
      depth: a.depth,
      focus: Math.round(a.focusOffset * 100),
      swapEyes: a.renderer.swapEyes,
      viewMode: a.viewMode,
      muted: a.audio.muted,
      gyroWanted: a.controls.gyroWanted,
      gyroSensitivity: a.controls.gyroSensitivity,
      invertY: a.controls.invertY,
      mapMode: a.mapMode,
      guide: !!a.guideOn,
      board: a.look.board,
      puck: a.look.puck
    };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (_) { /* storage blocked */ }
    this.syncSummaries();
  }

  loadSettings() {
    this.loading = true;
    let s = {};
    try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch (_) { s = {}; }
    const a = this.app;
    this.setStereoMode(s.mode || '2d');
    this['set_.depth-slider'](typeof s.depth === 'number' ? s.depth : 1.0);
    this['set_.focus-slider'](typeof s.focus === 'number' ? s.focus : 0);
    this['set_.sens-slider'](typeof s.gyroSensitivity === 'number' ? s.gyroSensitivity : 20);
    a.renderer.swapEyes = !!s.swapEyes; this.syncSwap();
    a.controls.invertY = !!s.invertY; this.syncInvert();
    a.mapMode = ['off', 'small', 'large'].includes(s.mapMode) ? s.mapMode : 'small';
    a.hud.setMapLarge(a.mapMode === 'large');
    a.guideOn = !!s.guide;
    this.syncGuide();
    if (s.muted && !a.audio.muted) a.audio.toggleMute();
    this.syncMute();
    a.controls.gyroWanted = s.gyroWanted === true; // default OFF: the slingshot drag is the main control
    this.syncGyro(false);
    this.setViewMode(s.viewMode || 'OVERVIEW');
    this.setLook({ board: s.board || 'felt', puck: s.puck || 'plastic' });
    this.loading = false;
  }
}
