/* ==========================================================================
   3D SHAPE PUTTER - PROCEDURAL MATERIALS (board surfaces, pucks, reflections)
   Every texture is drawn on a canvas at runtime: no image files, fully
   offline. Wood, glass, neon and the environment map come from 3D Labyrinth
   v1.14.1; felt and the carrom board are new.
   ========================================================================== */

const NEON_PALETTES = [
  { floor: '#0b1530', line: 'rgba(0,240,255,0.16)', rim: 0x1e293b, edge: 0x00f0ff, bg: 0x020617 },
  { floor: '#1a0b2e', line: 'rgba(236,72,153,0.18)', rim: 0x2a1740, edge: 0xec4899, bg: 0x07020f },
  { floor: '#06231d', line: 'rgba(52,211,153,0.18)', rim: 0x123129, edge: 0x34d399, bg: 0x010a07 },
  { floor: '#2a1606', line: 'rgba(245,158,11,0.20)', rim: 0x3a2412, edge: 0xf59e0b, bg: 0x0a0501 }
];
export function paletteForLevel(n) { return NEON_PALETTES[Math.floor((n - 1) / 5) % NEON_PALETTES.length]; }

function canvas(w, h) {
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  return [cv, cv.getContext('2d')];
}

function toTexture(cv, repeat = true) {
  const tex = new THREE.CanvasTexture(cv);
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// Seeded so a given level always looks the same (and both eyes match, which stereo needs anyway)
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = Math.imul(a ^ (a >>> 15), a | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ------------------------------- Floor textures ------------------------------- */

/** Green baize: fine fibre noise, the 2D game's #006400 board. */
function feltTile() {
  const [cv, g] = canvas(256, 256), r = rng(3);
  g.fillStyle = '#0b6a1e'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 9000; i++) {
    const l = r();
    g.fillStyle = l < 0.5 ? `rgba(0,30,0,${0.08 + r() * 0.12})` : `rgba(120,200,110,${0.04 + r() * 0.07})`;
    const x = r() * 256, y = r() * 256, a = r() * Math.PI;
    g.fillRect(x, y, 1 + Math.abs(Math.cos(a)) * 2, 1 + Math.abs(Math.sin(a)) * 2);
  }
  return toTexture(cv);
}

/** Pale polished carrom board with its printed baseline square and corner circles. */
function carromBoard(size) {
  const [cv, g] = canvas(1024, 1024), r = rng(17);
  g.fillStyle = '#e6c48e'; g.fillRect(0, 0, 1024, 1024);
  for (let k = 0; k < 220; k++) { // fine straight grain
    const y = r() * 1024, amp = 1 + r() * 2.5, f = 0.004 + r() * 0.01, ph = r() * 6;
    g.strokeStyle = `rgba(150,100,50,${0.05 + r() * 0.12})`; g.lineWidth = 0.5 + r() * 1.6;
    g.beginPath();
    for (let x = 0; x <= 1024; x += 16) g.lineTo(x, y + Math.sin(x * f + ph) * amp);
    g.stroke();
  }
  // Printed markings (decorative only: play is the 2D game's, not carrom's)
  const m = 1024 * 0.14, s = 1024 - 2 * m;
  g.strokeStyle = 'rgba(40,20,10,0.75)'; g.lineWidth = 4;
  g.strokeRect(m, m, s, s); g.strokeRect(m + 20, m + 20, s - 40, s - 40);
  g.fillStyle = 'rgba(170,30,25,0.8)';
  for (const [x, y] of [[m + 10, m + 10], [1024 - m - 10, m + 10], [m + 10, 1024 - m - 10], [1024 - m - 10, 1024 - m - 10]]) {
    g.beginPath(); g.arc(x, y, 18, 0, Math.PI * 2); g.fill();
  }
  g.strokeStyle = 'rgba(40,20,10,0.6)'; g.lineWidth = 3;
  g.beginPath(); g.arc(512, 512, 150, 0, Math.PI * 2); g.stroke();
  const tex = toTexture(cv, false);
  tex.userData = { span: size }; // one image covers the whole board
  return tex;
}

/** Oak planks for the frame; tone 1 = dark walnut. (From 3D Labyrinth.) */
function woodPlanks(tone = 0, seed = 11) {
  const [cv, g] = canvas(512, 512), r = rng(seed);
  const bases = tone ? ['#5a3519', '#4d2c14', '#63391b', '#55321a'] : ['#c08a55', '#b57d49', '#c9945e', '#ad7442'];
  const plankW = 64;
  for (let x = 0; x < 512; x += plankW) {
    const joint = 80 + r() * 350;
    for (const [y0, y1] of [[0, joint], [joint, 512]]) {
      g.fillStyle = bases[Math.floor(r() * bases.length)];
      g.fillRect(x, y0, plankW, y1 - y0);
      for (let k = 0; k < 14; k++) {
        const gx = x + 4 + r() * (plankW - 8), amp = 1 + r() * 3, freq = 0.01 + r() * 0.03, ph = r() * 6;
        g.strokeStyle = `rgba(${tone ? '20,8,2' : '90,50,20'},${0.15 + r() * 0.25})`;
        g.lineWidth = 0.6 + r() * 1.4;
        g.beginPath();
        for (let y = y0; y <= y1; y += 6) g.lineTo(gx + Math.sin(y * freq + ph) * amp, y);
        g.stroke();
      }
      g.fillStyle = 'rgba(25,12,4,0.7)'; g.fillRect(x, y0, plankW, 2);
    }
    g.fillStyle = 'rgba(25,12,4,0.75)'; g.fillRect(x, 0, 2, 512);
  }
  return toTexture(cv);
}

function glassTile() {
  const [cv, g] = canvas(128, 128);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(120,200,255,0.9)'; g.lineWidth = 2; g.strokeRect(1, 1, 126, 126);
  g.strokeStyle = 'rgba(160,220,255,0.35)'; g.lineWidth = 1;
  for (let i = 16; i < 128; i += 16) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.moveTo(0, i); g.lineTo(128, i); g.stroke(); }
  return toTexture(cv);
}

function neonTile(pal) {
  const [cv, g] = canvas(128, 128), r = rng(7);
  g.fillStyle = pal.floor; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.05})`; g.fillRect(r() * 128, r() * 128, 2, 2); }
  g.strokeStyle = pal.line; g.lineWidth = 3; g.strokeRect(6, 6, 116, 116);
  g.fillStyle = pal.line; g.beginPath(); g.arc(64, 64, 4, 0, Math.PI * 2); g.fill();
  return toTexture(cv);
}

/* ---------------------------- Reflection environment ---------------------------- */

/** Studio-style environment so steel pucks, glass and chrome have something to reflect. */
export function makeEnvironment(renderer) {
  const [cv, g] = canvas(1024, 512);
  const sky = g.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, '#dfeeff'); sky.addColorStop(0.45, '#8a9bb3'); sky.addColorStop(0.55, '#3a4250'); sky.addColorStop(1, '#0d0f14');
  g.fillStyle = sky; g.fillRect(0, 0, 1024, 512);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.fillRect(140, 60, 160, 70); g.fillRect(620, 40, 220, 60);
  g.fillStyle = 'rgba(255,214,160,0.8)'; g.fillRect(420, 150, 120, 40);
  g.fillStyle = 'rgba(120,220,255,0.6)'; g.fillRect(880, 170, 90, 50);
  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  tex.dispose(); pmrem.dispose();
  return env;
}

/* ------------------------------- Board looks ------------------------------- */

/**
 * Material set for a board surface. tile = world units covered by one floor texture repeat
 * (ExtrudeGeometry UVs are world x / -z).
 */
export function boardLook(kind, levelN, env, boardSize) {
  const std = o => new THREE.MeshStandardMaterial(o);
  const frameTex = woodPlanks(1, 3);
  frameTex.repeat.set(0.35, 0.35);
  const frame = () => std({ map: frameTex, color: 0xc89a6a, roughness: 0.5, metalness: 0, envMap: env, envMapIntensity: 0.25 });
  switch (kind) {
    case 'wood': {
      const tex = carromBoard(boardSize);
      return {
        bg: 0x120a05, stars: false, sun: [0xffe6c4, 1.0], hemi: [0xfff0dc, 0x2a1608, 0.6],
        floor: std({ map: tex, roughness: 0.32, metalness: 0, envMap: env, envMapIntensity: 0.25 }), tile: boardSize, offsetHalf: true,
        side: std({ color: 0x8a5a2b, roughness: 0.7 }), rim: frame(), rimCap: std({ color: 0x1c0f07, roughness: 0.4 }),
        base: std({ color: 0x2b170a, roughness: 0.7 }), holeRim: 0x111111, textures: [tex, frameTex]
      };
    }
    case 'glass': {
      const tex = glassTile();
      return {
        bg: 0x020617, stars: true, sun: [0xffffff, 0.9], hemi: [0xbfe8ff, 0x0a1a2a, 0.7],
        floor: std({ map: tex, color: 0xbfefff, transparent: true, opacity: 0.32, roughness: 0.04, metalness: 0.1, envMap: env, envMapIntensity: 1.2, depthWrite: false }),
        tile: 1, side: std({ color: 0x9fe3ff, transparent: true, opacity: 0.45, roughness: 0.05, envMap: env }),
        rim: std({ color: 0xd6dde6, roughness: 0.12, metalness: 1, envMap: env, envMapIntensity: 1.1 }),
        rimCap: new THREE.MeshBasicMaterial({ color: 0x00f0ff }),
        base: std({ color: 0x0b1726, roughness: 0.15, metalness: 0.8, envMap: env }), holeRim: 0xff3b5c, glowPits: true, textures: [tex, frameTex]
      };
    }
    case 'neon': {
      const pal = paletteForLevel(levelN), tex = neonTile(pal);
      return {
        bg: pal.bg, stars: true, sun: [0xffffff, 0.9], hemi: [0xbfd8ff, 0x10121a, 0.55],
        floor: std({ map: tex, roughness: 0.85, metalness: 0.05 }), tile: 1,
        side: std({ color: 0x0f172a, roughness: 0.9 }), rim: std({ color: pal.rim, roughness: 0.55, metalness: 0.2 }),
        rimCap: new THREE.MeshBasicMaterial({ color: pal.edge }),
        base: std({ color: 0x0b1020, roughness: 0.6, metalness: 0.4 }), holeRim: 0xff3b5c, glowPits: true, textures: [tex, frameTex]
      };
    }
    default: { // felt
      const tex = feltTile();
      return {
        bg: 0x0c0d10, stars: false, sun: [0xfff4e0, 1.05], hemi: [0xe8f0ff, 0x101410, 0.5],
        floor: std({ map: tex, roughness: 0.95, metalness: 0 }), tile: 2,
        side: std({ color: 0x0a4d16, roughness: 0.95 }), rim: frame(), rimCap: std({ color: 0x3a1f0c, roughness: 0.4, metalness: 0.1 }),
        base: std({ color: 0x1d0f06, roughness: 0.7 }), holeRim: 0x2a1600, textures: [tex, frameTex]
      };
    }
  }
}

/* ---------------------------------- Pucks ---------------------------------- */

export function puckMaterial(kind, env) {
  switch (kind) {
    case 'steel': return new THREE.MeshStandardMaterial({ color: 0xeeeeee, metalness: 1, roughness: 0.14, envMap: env, envMapIntensity: 1.3 });
    case 'rubber': return new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.9, metalness: 0 });
    default: return new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0, envMap: env, envMapIntensity: 0.5 });
  }
}

/** The coloured moving pucks: the 2D game's hsl(h, 100%, 75%) with a carrom-coin ring. */
export function discMaterials(hue, env) {
  const c = new THREE.Color().setHSL(hue / 360, 1, 0.62);
  return {
    body: new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, emissive: c.clone().multiplyScalar(0.18), envMap: env, envMapIntensity: 0.4 }),
    ring: new THREE.MeshBasicMaterial({ color: new THREE.Color().setHSL(hue / 360, 1, 0.85) })
  };
}
