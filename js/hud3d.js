/* ==========================================================================
   3D SHAPE PUTTER - IN-SCENE HUD
   Ported from 3D Labyrinth v1.14.1. Drawn into canvas textures on planes
   parented to the camera and placed on the stereo focal plane (zero
   parallax), so it reads in every mode: both SBS halves, anaglyph, smart
   glasses and WebXR. Bar, banners and 3D dialogs are the Labyrinth's; the
   status bar and the north-up board map are this game's.
   ========================================================================== */

import { BOARD } from './config.js';
import { shapeOutline } from './levels.js';

const MAP_PX = 512;

function makePanel(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.renderOrder = 999;
  mesh.frustumCulled = false;
  return { canvas, ctx: canvas.getContext('2d'), tex, mesh, key: '' };
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

const fmt = n => n.toLocaleString('en-IN');

export class HUD3D {
  constructor(camera) {
    this.camera = camera;
    this.bar = makePanel(1024, 128);
    this.banner = makePanel(1024, 512);
    this.banner.mesh.visible = false;
    this.dialog = makePanel(1024, 640);
    this.dialog.mesh.visible = false;
    this.dialog.mesh.renderOrder = 1000;
    this.dialogSpec = null;  // { title, color, big, lines, buttons:[{id,label}], focus }
    this.dialogNdc = { hw: 1, hh: 1 };
    // Board map (Behind view): static layer drawn once per level, moving pieces composited ~12x/s
    this.map = makePanel(MAP_PX, MAP_PX);
    this.map.mesh.visible = false;
    this.mapLayer = null;
    this.mapTimer = 0;
    // 🗺 toggle icon: a tappable 3D button, so it works in every stereo mode
    this.mapBtn = makePanel(128, 128);
    this.mapBtn.mesh.visible = false;
    this.mapBtnNdc = { x: 0, y: 0, hw: 0, hh: 0 };
    this.mapBtnOn = null;
    camera.add(this.bar.mesh, this.banner.mesh, this.dialog.mesh, this.map.mesh, this.mapBtn.mesh);
    this.distance = 10;
    this.bannerTimer = 0;
  }

  /** Move every HUD panel under another parent (VR: a floating screen anchored in the room). */
  attachTo(parent) {
    for (const p of [this.bar, this.banner, this.dialog, this.map, this.mapBtn]) parent.add(p.mesh);
  }

  /** Fit panels to the eye frustum at the given distance (the focal plane). */
  layout(distance, fovDeg, aspect) {
    this.distance = distance;
    const viewH = 2 * distance * Math.tan((fovDeg * Math.PI / 180) / 2);
    const viewW = viewH * aspect;
    const barW = Math.min(viewW * 0.96, viewH * 1.25), barH = barW / 8;
    this.bar.mesh.scale.set(barW, barH, 1);
    this.bar.mesh.position.set(0, viewH / 2 - barH / 2 - viewH * 0.015, -distance);
    const bW = Math.min(viewW * 0.86, viewH * 1.1);
    this.banner.mesh.scale.set(bW, bW / 2, 1);
    this.banner.mesh.position.set(0, 0, -distance);
    // Map toggle icon top-right under the status bar; minimap just below it. Small = a corner glance;
    // Large = most of the free height, so it stays readable on short (phone landscape) screens.
    const small = Math.min(viewW * 0.4, viewH * 0.34), margin = viewH * 0.02;
    const iS = Math.max(small * 0.24, viewH * 0.075);
    const iX = viewW / 2 - iS / 2 - margin, iY = viewH / 2 - barH - viewH * 0.03 - iS / 2;
    this.mapBtn.mesh.scale.set(iS, iS, 1);
    this.mapBtn.mesh.position.set(iX, iY, -distance * 0.997);
    this.mapBtnNdc = { x: iX / (viewW / 2), y: iY / (viewH / 2), hw: iS / viewW, hh: iS / viewH };
    const top = iY - iS / 2 - viewH * 0.015, bottom = -viewH / 2 + margin;
    const mS = this.mapLarge ? Math.min(top - bottom, viewW * 0.62) : small;
    this.map.mesh.scale.set(mS, mS, 1);
    this.map.mesh.position.set(viewW / 2 - mS / 2 - margin, top - mS / 2, -distance * 0.998);

    const dW = Math.min(viewW * 0.94, viewH * 1.2), dH = dW * 0.625;
    this.dialog.mesh.scale.set(dW, dH, 1);
    this.dialog.mesh.position.set(0, -viewH * 0.02, -distance * 0.999);
    // Panel extent in NDC (identical for both eyes: it sits on the zero-parallax plane)
    this.dialogNdc = { hw: dW / viewW, hh: dH / viewH, cy: (-viewH * 0.02) / (viewH / 2) };
  }

  /* ---------------- Board map (Behind view) ---------------- */
  /** Pre-render the board top-down (north up) for this level: frame, static holes, goal. */
  setMap(level, world) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = MAP_PX;
    const g = cv.getContext('2d'), H = BOARD.HALF, pad = 34;
    const scale = (MAP_PX - pad * 2) / (2 * H);
    this.mapXf = { scale, ox: pad, oz: pad };
    const X = x => pad + (x + H) * scale, Z = z => pad + (z + H) * scale;
    g.fillStyle = 'rgba(11,80,30,0.9)';
    g.fillRect(pad, pad, 2 * H * scale, 2 * H * scale);
    g.strokeStyle = '#c08a55'; g.lineWidth = 8; g.strokeRect(pad - 4, pad - 4, 2 * H * scale + 8, 2 * H * scale + 8);
    for (const h of world.holes) {
      if (h.moving) continue;
      g.fillStyle = '#05070d'; g.strokeStyle = '#ff3b5c'; g.lineWidth = 3;
      g.beginPath(); g.arc(X(h.x), Z(h.z), h.r * scale, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    g.fillStyle = '#062a1c'; g.strokeStyle = '#34ff9a'; g.lineWidth = 4;
    g.beginPath();
    shapeOutline(level.shape, level.goal.r * 1.15, 40).forEach(([x, z], i) => (i ? g.lineTo(X(x + level.goal.x), Z(z + level.goal.z)) : g.moveTo(X(x + level.goal.x), Z(z + level.goal.z))));
    g.closePath(); g.fill(); g.stroke();
    this.mapLayer = cv;
    this.mapTimer = 0;
  }

  setMapVisible(v) { this.map.mesh.visible = v && !!this.mapLayer; }

  /** Map size: Large fills most of the free height (readable on phone landscape), Small is a corner glance. */
  setMapLarge(large) { if (this.mapLarge !== large) { this.mapLarge = large; this.mapTimer = 0; } }

  /**
   * Show the 🗺 toggle and draw its state. mode: 'off' | 'small' | 'large'. A badge says what the next
   * tap does: "+" (enlarge) when small, "×" (close) when large.
   */
  setMapButton(visible, mode = 'off') {
    if (mode === true) mode = 'small'; else if (mode === false) mode = 'off';
    this.mapBtn.mesh.visible = visible;
    if (!visible || mode === this.mapBtnOn) return;
    this.mapBtnOn = mode;
    const on = mode !== 'off';
    const g = this.mapBtn.ctx;
    g.clearRect(0, 0, 128, 128);
    g.fillStyle = on ? 'rgba(0,240,255,0.28)' : 'rgba(2,6,23,0.7)';
    roundRect(g, 6, 6, 116, 116, 26); g.fill();
    g.strokeStyle = on ? '#00f0ff' : 'rgba(148,163,184,0.6)'; g.lineWidth = 6; g.stroke();
    // Folded-map glyph drawn as vectors: emoji rendering on canvas varies across headsets/glasses
    const col = on ? '#e0fbff' : 'rgba(203,213,225,0.6)';
    g.lineJoin = 'round'; g.lineWidth = 6; g.strokeStyle = col;
    g.beginPath();
    g.moveTo(26, 38); g.lineTo(50, 28); g.lineTo(78, 38); g.lineTo(102, 28);
    g.lineTo(102, 90); g.lineTo(78, 100); g.lineTo(50, 90); g.lineTo(26, 100); g.closePath();
    g.stroke();
    g.beginPath(); g.moveTo(50, 28); g.lineTo(50, 90); g.moveTo(78, 38); g.lineTo(78, 100); g.stroke();
    g.fillStyle = on ? '#ffc93c' : 'rgba(255,201,60,0.5)';
    g.beginPath(); g.arc(64, 60, 9, 0, Math.PI * 2); g.fill();
    if (on) { // next-tap badge, bottom-right
      g.fillStyle = '#020617'; g.beginPath(); g.arc(100, 100, 22, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#00f0ff'; g.lineWidth = 4; g.stroke();
      g.fillStyle = '#e0fbff'; g.font = '800 34px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(mode === 'large' ? '×' : '+', 100, 102);
    }
    this.mapBtn.tex.needsUpdate = true;
  }

  /** Eye-local NDC point over the 🗺 icon? */
  hitMapButton(ndcX, ndcY) {
    if (!this.mapBtn.mesh.visible) return false;
    const b = this.mapBtnNdc, pad = 1.25; // slightly generous target for fingers
    return Math.abs(ndcX - b.x) <= b.hw * pad && Math.abs(ndcY - b.y) <= b.hh * pad;
  }

  /**
   * North-up board map, redrawn ~12x/s: moving holes, discs, the puck, the aim line and a wedge
   * showing which way the Behind camera looks (it turns, the map doesn't).
   */
  updateMap(world, dt, aim = null, camYaw = null) {
    if (!this.map.mesh.visible || !this.mapLayer) return;
    this.mapTimer -= dt;
    if (this.mapTimer > 0) return;
    this.mapTimer = 1 / 12;
    const g = this.map.ctx, S = MAP_PX, { scale, ox, oz } = this.mapXf, H = BOARD.HALF;
    const X = x => ox + (x + H) * scale, Z = z => oz + (z + H) * scale;
    g.clearRect(0, 0, S, S);
    g.fillStyle = 'rgba(2,6,23,0.72)';
    roundRect(g, 2, 2, S - 4, S - 4, 36); g.fill();
    g.drawImage(this.mapLayer, 0, 0);
    for (const h of world.holes) {
      if (!h.moving) continue;
      g.fillStyle = '#05070d'; g.strokeStyle = '#a855f7'; g.lineWidth = 4;
      g.beginPath(); g.arc(X(h.x), Z(h.z), h.r * scale, 0, Math.PI * 2); g.fill(); g.stroke();
    }
    for (const d of world.discs) {
      g.fillStyle = `hsl(${d.hue},100%,62%)`; g.strokeStyle = '#020617'; g.lineWidth = 2;
      g.beginPath(); g.arc(X(d.x), Z(d.z), Math.max(6, d.r * scale), 0, Math.PI * 2); g.fill(); g.stroke();
    }
    const p = world.puck, px = X(p.x), pz = Z(p.z);
    if (camYaw !== null) { // camera view wedge
      g.fillStyle = 'rgba(255,255,255,0.12)';
      g.beginPath(); g.moveTo(px, pz);
      g.arc(px, pz, 150, camYaw - Math.PI / 2 - 0.5, camYaw - Math.PI / 2 + 0.5); g.closePath(); g.fill();
    }
    if (aim && aim.power > 0 && p.state === 'rest') {
      const len = (0.5 + aim.power * 3.2) * scale;
      g.strokeStyle = `hsl(${120 * (1 - aim.power)},100%,55%)`; g.lineWidth = 6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(px, pz); g.lineTo(px + Math.sin(aim.angle) * len, pz - Math.cos(aim.angle) * len); g.stroke();
    }
    if (p.state !== 'fallen') {
      g.fillStyle = '#ffffff'; g.strokeStyle = '#020617'; g.lineWidth = 3;
      g.beginPath(); g.arc(px, pz, Math.max(8, p.r * scale), 0, Math.PI * 2); g.fill(); g.stroke();
    }
    g.fillStyle = 'rgba(226,232,240,0.85)'; g.font = '700 26px system-ui, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText('N ▲', S / 2, 4);
    this.map.tex.needsUpdate = true;
  }

  /* ---------------- 3D dialogs (level clear, time's up, pause...) ---------------- */
  get dialogVisible() { return this.dialog.mesh.visible; }

  showDialog(spec) {
    this.dialogSpec = { focus: 0, lines: [], ...spec };
    this.dialog.mesh.visible = true;
    this.hideBanner();
    this.drawDialog();
  }

  hideDialog() { this.dialog.mesh.visible = false; this.dialogSpec = null; }

  moveFocus(delta) {
    const d = this.dialogSpec;
    if (!d) return;
    d.focus = (d.focus + delta + d.buttons.length) % d.buttons.length;
    this.drawDialog();
  }

  setFocus(i) {
    if (!this.dialogSpec || i < 0 || i === this.dialogSpec.focus) return;
    this.dialogSpec.focus = i;
    this.drawDialog();
  }

  focusedAction() { const d = this.dialogSpec; return d ? d.buttons[d.focus].id : null; }

  /** Map an eye-local NDC point to a dialog button index (-1 = none). */
  hitIndex(ndcX, ndcY) {
    const d = this.dialogSpec;
    if (!d) return -1;
    const { hw, hh, cy } = this.dialogNdc;
    const u = (ndcX / hw + 1) / 2, v = (1 - (ndcY - cy) / hh) / 2;
    if (u < 0 || u > 1 || v < 0 || v > 1) return -1;
    const px = u * 1024, py = v * 640;
    return d.buttons.findIndex(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
  }

  drawDialog() {
    const d = this.dialogSpec, g = this.dialog.ctx, W = 1024, H = 640;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(2,6,23,0.88)';
    roundRect(g, 8, 8, W - 16, H - 16, 44); g.fill();
    g.strokeStyle = d.color || '#00f0ff'; g.lineWidth = 6; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = d.color || '#00f0ff';
    g.font = `900 ${d.title.length > 14 ? 74 : 92}px system-ui, sans-serif`;
    g.fillText(d.title, W / 2, 100);
    let y = 190;
    if (d.big) {
      g.fillStyle = '#ffc93c'; g.font = '900 96px system-ui, sans-serif';
      g.fillText(d.big, W / 2, y + 10); y += 100;
    }
    g.fillStyle = '#e2e8f0'; g.font = '600 42px system-ui, sans-serif';
    for (const line of d.lines) { g.fillText(line, W / 2, y); y += 56; }

    const n = d.buttons.length, gap = 26, bw = (W - 80 - gap * (n - 1)) / n, bh = 104, by = H - bh - 44;
    d.buttons.forEach((b, i) => {
      Object.assign(b, { x: 40 + i * (bw + gap), y: by, w: bw, h: bh });
      roundRect(g, b.x, b.y, b.w, b.h, 26);
      g.fillStyle = i === 0 ? (d.color || '#00f0ff') : 'rgba(255,255,255,0.12)';
      g.fill();
      if (i === d.focus) { g.strokeStyle = '#ffffff'; g.lineWidth = 8; g.stroke(); }
      g.fillStyle = i === 0 ? '#020617' : '#f8fafc';
      let size = 46;
      do { g.font = `800 ${size}px system-ui, sans-serif`; size -= 2; } while (size > 22 && g.measureText(b.label).width > b.w - 28);
      g.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 2);
    });
    this.dialog.tex.needsUpdate = true;
  }

  /** Status bar: level, score (or PRACTICE), pucks left, shots this level, disc hits towards the next lost puck. */
  setStatus({ level, score, pucks, shots, hits, hitsMax, source, practice }) {
    const key = `${level}|${score}|${pucks}|${shots}|${hits}|${source}|${practice}`;
    if (key === this.bar.key) return;
    this.bar.key = key;
    const g = this.bar.ctx, W = 1024, H = 128, y = H / 2 + 2;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(2,6,23,0.72)';
    roundRect(g, 4, 8, W - 8, H - 16, 36); g.fill();
    g.strokeStyle = 'rgba(0,240,255,0.55)'; g.lineWidth = 3; g.stroke();
    g.textBaseline = 'middle';
    g.font = '800 52px system-ui, sans-serif';
    g.textAlign = 'left'; g.fillStyle = '#e2e8f0';
    g.fillText(`L${level}`, 30, y);
    g.textAlign = 'center';
    if (practice) { g.fillStyle = '#ffc93c'; g.font = '800 40px system-ui, sans-serif'; g.fillText('PRACTICE', 330, y); }
    else { g.fillStyle = score < 0 ? '#fca5a5' : '#ffc93c'; g.fillText(fmt(score), 330, y); }
    // Pucks left as small white discs (drawn, not emoji: canvas emoji rendering varies across headsets)
    if (!practice) {
      const n = Math.max(0, pucks), shown = Math.min(n, 5);
      for (let i = 0; i < shown; i++) {
        g.beginPath(); g.arc(540 + i * 30, y, 12, 0, Math.PI * 2);
        g.fillStyle = '#f8fafc'; g.fill(); g.strokeStyle = '#64748b'; g.lineWidth = 3; g.stroke();
      }
      g.font = '800 40px system-ui, sans-serif'; g.textAlign = 'left';
      if (n > 5) { g.fillStyle = '#e2e8f0'; g.fillText(`+${n - 5}`, 540 + shown * 30 - 8, y); }
      if (n === 0) { g.fillStyle = '#ff3b5c'; g.fillText('last', 528, y); }
    }
    g.font = '800 44px system-ui, sans-serif';
    g.textAlign = 'right';
    g.fillStyle = '#94a3b8'; g.fillText(`⛳${shots}`, 790, y);
    g.fillStyle = hits >= hitsMax - 2 ? '#ff3b5c' : hits ? '#fca5a5' : '#64748b';
    g.fillText(`💥${hits}/${hitsMax}`, 950, y);
    g.font = '700 34px system-ui, sans-serif'; g.fillStyle = '#64748b';
    g.fillText({ gyro: '📱', touch: '👆', keys: '⌨', pad: '🎮', vr: '🥽', remote: '📲' }[source] || '', 1006, y);
    this.bar.tex.needsUpdate = true;
  }

  showBanner(title, sub = '', color = '#00f0ff', seconds = 0) {
    const key = `${title}|${sub}|${color}`;
    this.banner.mesh.visible = true;
    this.bannerTimer = seconds;
    if (key === this.banner.key) return;
    this.banner.key = key;
    const g = this.banner.ctx, W = 1024, H = 512;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(2,6,23,0.6)';
    roundRect(g, 40, 90, W - 80, H - 180, 48); g.fill();
    g.strokeStyle = color; g.lineWidth = 5; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = color;
    g.font = `900 ${title.length > 8 ? 96 : 150}px system-ui, sans-serif`;
    g.fillText(title, W / 2, sub ? H / 2 - 30 : H / 2);
    if (sub) {
      g.fillStyle = '#e2e8f0';
      g.font = '600 46px system-ui, sans-serif';
      g.fillText(sub, W / 2, H / 2 + 80);
    }
    this.banner.tex.needsUpdate = true;
  }

  hideBanner() { this.banner.mesh.visible = false; this.bannerTimer = 0; }

  setVisible(v) { this.bar.mesh.visible = v; if (!v) { this.hideBanner(); this.hideDialog(); this.setMapVisible(false); this.setMapButton(false); } }

  update(dt) {
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.hideBanner();
    }
  }
}
