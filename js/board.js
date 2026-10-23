/* ==========================================================================
   3D SHAPE PUTTER - BOARD SCENE BUILDER (THREE.js meshes for a level)
   Everything lives under boardGroup (inside `world`, which WebXR scales and
   places); physics coordinates are board-local, so meshes map 1:1 onto them.
   Static holes and the shaped goal are real cut-outs in the floor slab.
   Moving holes can't be re-cut every frame, so each one draws an invisible
   disc into the stencil buffer first and the floor's top face skips those
   pixels: the pit underneath shows through, in every stereo mode.
   ========================================================================== */

import { BOARD, DEFAULT_LOOK } from './config.js';
import { boardLook, puckMaterial, discMaterials, makeEnvironment } from './materials.js';
import { shapeOutline } from './levels.js';

const MAX_PATH_DOTS = 260;

/** THREE.Shape from board-plane [x, z] points (shape y = -world z after rotateX(-90deg)). */
function toShape(pts) {
  const s = new THREE.Shape();
  pts.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z)));
  s.closePath();
  return s;
}
function toPath(pts) {
  const p = new THREE.Path();
  pts.forEach(([x, z], i) => (i ? p.lineTo(x, -z) : p.moveTo(x, -z)));
  p.closePath();
  return p;
}

export class BoardView {
  constructor(scene, renderer) {
    this.scene = scene;
    this.env = makeEnvironment(renderer);
    this.world = new THREE.Group();      // scaled/placed for WebXR, identity otherwise
    this.boardGroup = new THREE.Group();
    this.world.add(this.boardGroup);
    scene.add(this.world);

    this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x10121a, 0.55);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 0.9);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0008;
    this.world.add(this.sun, this.sun.target);

    this.stars = this.makeStars();
    scene.add(this.stars);

    this.disposables = [];
    this.elapsed = 0;
  }

  makeStars() {
    const n = 600, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = 80 + Math.random() * 80, th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 2 - 1);
      pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      pos[i * 3 + 1] = -Math.abs(r * Math.cos(ph)) * 0.6 - 10;
      pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8fb4ff, size: 0.5, sizeAttenuation: true }));
  }

  clear() {
    for (const o of [...this.boardGroup.children]) this.boardGroup.remove(o);
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }

  track(...items) { this.disposables.push(...items); return items[0]; }

  /** A pit under an outline: inside walls + a bottom, top at y = top, `depth` deep. */
  pit(pts, depth, top, wallMat, bottomMat) {
    const geo = this.track(new THREE.ExtrudeGeometry(toShape(pts), { depth, bevelEnabled: false, curveSegments: 1 }));
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, top - depth, 0);
    // Both groups BackSide: from above you see the walls' insides and the bottom cap, never the top cap
    return new THREE.Mesh(geo, [bottomMat, wallMat]);
  }

  /** Flat outline ring on the floor (hole and goal rims). */
  rimRing(pts, width, mat, y = 0.004) {
    const k = pts.reduce((m, [x, z]) => Math.max(m, Math.hypot(x, z)), 0);
    const outer = pts.map(([x, z]) => [x * (k + width) / k, z * (k + width) / k]);
    const s = toShape(outer);
    s.holes.push(toPath(pts));
    const geo = this.track(new THREE.ShapeGeometry(s, 1));
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, mat);
    m.position.y = y;
    return m;
  }

  build(level, look = DEFAULT_LOOK, world) {
    this.endCelebration();
    this.clear();
    this.level = level;
    const { HALF, RIM_W, RIM_H, FLOOR_T, PUCK_H, DISC_H, PIT_DEPTH, GOAL_DEPTH } = BOARD;
    const OUT = HALF + RIM_W, size = 2 * OUT;
    const L = boardLook(look.board, level.n, this.env, size);
    this.track(L.floor, L.side, L.rim, L.rimCap, L.base, ...L.textures);
    this.scene.background = new THREE.Color(L.bg);
    this.stars.visible = L.stars;
    this.sun.color.setHex(L.sun[0]); this.sun.intensity = L.sun[1];
    this.hemi.color.setHex(L.hemi[0]); this.hemi.groundColor.setHex(L.hemi[1]); this.hemi.intensity = L.hemi[2];

    // Floor slab with the static holes and the goal shape cut out
    const goalPts = shapeOutline(level.shape, level.goal.r, 56).map(([x, z]) => [x + level.goal.x, z + level.goal.z]);
    const slab = toShape([[-OUT, -OUT], [OUT, -OUT], [OUT, OUT], [-OUT, OUT]]);
    const statics = world.holes.filter(h => !h.moving);
    for (const h of statics) { const p = new THREE.Path(); p.absarc(h.x, -h.z, h.r, 0, Math.PI * 2, true); slab.holes.push(p); }
    slab.holes.push(toPath(goalPts));
    const floorGeo = this.track(new THREE.ExtrudeGeometry(slab, { depth: FLOOR_T, bevelEnabled: false, curveSegments: 32 }));
    floorGeo.rotateX(-Math.PI / 2);
    floorGeo.translate(0, -FLOOR_T, 0);
    const tex = L.floor.map;
    tex.repeat.set(1 / L.tile, 1 / L.tile);
    tex.offset.set(L.offsetHalf ? 0.5 : 0, L.offsetHalf ? 0.5 : 0);
    // Stencil test: skip the pixels a moving hole's mask marked (ref 1)
    Object.assign(L.floor, {
      stencilWrite: true, stencilWriteMask: 0x00, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc,
      stencilFail: THREE.KeepStencilOp, stencilZFail: THREE.KeepStencilOp, stencilZPass: THREE.KeepStencilOp
    });
    const floor = new THREE.Mesh(floorGeo, [L.floor, L.side]);
    floor.receiveShadow = true;
    this.boardGroup.add(floor);

    // Pit materials
    const pitWall = this.track(new THREE.MeshStandardMaterial({ color: L.glowPits ? 0x1a0510 : 0x06070a, emissive: L.glowPits ? 0x5a0a1e : 0x000000, roughness: 1, side: THREE.BackSide }));
    const pitBottom = this.track(new THREE.MeshStandardMaterial({ color: 0x020308, roughness: 1, side: THREE.BackSide }));
    const goalWall = this.track(new THREE.MeshStandardMaterial({ color: 0x041b12, emissive: 0x0a5a3a, emissiveIntensity: 0.5, side: THREE.BackSide }));
    const goalBottom = this.track(new THREE.MeshStandardMaterial({ color: 0x0b3a27, emissive: 0x13a86c, emissiveIntensity: 0.55, side: THREE.BackSide }));
    const holeRimMat = this.track(new THREE.MeshBasicMaterial({ color: L.holeRim }));
    const circle = r => shapeOutline({ type: 'circle' }, r, 40);

    for (const h of statics) {
      const pit = this.pit(circle(h.r).map(([x, z]) => [x + h.x, z + h.z]), PIT_DEPTH, -FLOOR_T + 0.001, pitWall, pitBottom);
      this.boardGroup.add(pit);
      const ring = new THREE.Mesh(this.track(new THREE.RingGeometry(h.r, h.r + 0.07, 40)), holeRimMat);
      ring.rotation.x = -Math.PI / 2; ring.position.set(h.x, 0.004, h.z);
      this.boardGroup.add(ring);
    }

    // Goal: a cup in the level's shape with a glowing green rim (the 2D game drew it black)
    this.boardGroup.add(this.pit(goalPts, GOAL_DEPTH, -FLOOR_T + 0.001, goalWall, goalBottom));
    this.goalRing = this.rimRing(shapeOutline(level.shape, level.goal.r, 56), 0.08, this.track(new THREE.MeshBasicMaterial({ color: 0x34ff9a })));
    this.goalRing.position.x = level.goal.x; this.goalRing.position.z = level.goal.z;
    this.boardGroup.add(this.goalRing);

    // Moving holes: stencil mask + pit + spinning purple rim, moved every frame
    const maskMat = this.track(new THREE.MeshBasicMaterial({
      colorWrite: false, depthWrite: false,
      stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp
    }));
    const vortexMat = this.track(new THREE.MeshBasicMaterial({ color: 0xa855f7 }));
    const swirlMat = this.track(new THREE.MeshBasicMaterial({ color: 0xe9d5ff, transparent: true, opacity: 0.7, depthWrite: false }));
    this.movingHoles = world.holes.filter(h => h.moving).map(h => {
      const g = new THREE.Group();
      const mask = new THREE.Mesh(this.track(new THREE.CircleGeometry(h.r, 40)), maskMat);
      mask.rotation.x = -Math.PI / 2; mask.position.y = 0.002;
      mask.renderOrder = -10; // before the floor, so its stencil is in place when the floor is drawn
      g.add(mask);
      g.add(this.pit(circle(h.r), PIT_DEPTH, -0.001, pitWall, pitBottom));
      const ring = new THREE.Mesh(this.track(new THREE.RingGeometry(h.r, h.r + 0.07, 40)), vortexMat);
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.004;
      const swirl = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const arc = new THREE.Mesh(this.track(new THREE.RingGeometry(h.r * 0.55, h.r * 0.7, 16, 1, i * 2.094, 1.1)), swirlMat);
        arc.rotation.x = -Math.PI / 2;
        swirl.add(arc);
      }
      swirl.position.y = -0.25; // just inside the pit, so it reads as a vortex
      g.add(ring, swirl);
      g.userData.swirl = swirl;
      this.boardGroup.add(g);
      return { group: g, hole: h };
    });

    // Frame (cushions), like the 2D game's wooden border
    const rimGeoNS = this.track(new THREE.BoxGeometry(size, RIM_H, RIM_W)), rimGeoEW = this.track(new THREE.BoxGeometry(RIM_W, RIM_H, 2 * HALF));
    const capGeoNS = this.track(new THREE.BoxGeometry(2 * HALF + 0.08, 0.035, 0.07)), capGeoEW = this.track(new THREE.BoxGeometry(0.07, 0.035, 2 * HALF + 0.08));
    for (const s of [-1, 1]) {
      const ns = new THREE.Mesh(rimGeoNS, L.rim); ns.position.set(0, RIM_H / 2, s * (HALF + RIM_W / 2));
      const ew = new THREE.Mesh(rimGeoEW, L.rim); ew.position.set(s * (HALF + RIM_W / 2), RIM_H / 2, 0);
      const cn = new THREE.Mesh(capGeoNS, L.rimCap); cn.position.set(0, RIM_H + 0.018, s * (HALF + 0.035));
      const ce = new THREE.Mesh(capGeoEW, L.rimCap); ce.position.set(s * (HALF + 0.035), RIM_H + 0.018, 0);
      for (const m of [ns, ew]) { m.castShadow = true; m.receiveShadow = true; }
      this.boardGroup.add(ns, ew, cn, ce);
    }
    const base = new THREE.Mesh(this.track(new THREE.BoxGeometry(size + 0.4, 0.25, size + 0.4)), L.base);
    base.position.y = -FLOOR_T - PIT_DEPTH - 0.15;
    this.boardGroup.add(base);

    // Player puck: the level's shape, extruded (white, as in 2D)
    const puckGeo = this.track(new THREE.ExtrudeGeometry(toShape(shapeOutline(level.shape, level.puckR, 48)),
      { depth: PUCK_H - 0.04, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2, curveSegments: 1 }));
    puckGeo.rotateX(-Math.PI / 2);
    puckGeo.translate(0, 0.02, 0);
    this.puck = new THREE.Mesh(puckGeo, this.track(puckMaterial(look.puck, this.env)));
    this.puck.castShadow = true;
    this.boardGroup.add(this.puck);

    // Coloured moving discs
    const discGeo = this.track(new THREE.CylinderGeometry(world.discs[0] ? world.discs[0].r : 0.24, world.discs[0] ? world.discs[0].r : 0.24, DISC_H, 32));
    this.discs = world.discs.map(d => {
      const mats = discMaterials(d.hue, this.env);
      this.track(mats.body, mats.ring);
      const g = new THREE.Group();
      const body = new THREE.Mesh(discGeo, mats.body);
      body.position.y = DISC_H / 2; body.castShadow = true;
      const ring = new THREE.Mesh(this.track(new THREE.RingGeometry(d.r * 0.5, d.r * 0.72, 28)), mats.ring);
      ring.rotation.x = -Math.PI / 2; ring.position.y = DISC_H + 0.002;
      g.add(body, ring);
      this.boardGroup.add(g);
      return g;
    });

    this.buildAim(level);

    // Light + shadow frustum sized to the board
    const ext = OUT + 1;
    this.sun.position.set(-ext * 0.5, ext * 1.6, ext * 0.8);
    this.sun.target.position.set(0, 0, 0);
    Object.assign(this.sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: ext * 5 });
    this.sun.shadow.camera.updateProjectionMatrix();
    this.extent = { W: size, H: size };
  }

  /** Aim arrow, power ring and the aim-guide dots. */
  buildAim(level) {
    const basic = (color, opacity = 1) => this.track(new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    this.aimMat = basic(0x34ff9a, 0.9);
    const aim = this.aim = new THREE.Group();
    const shaft = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.09, 1).rotateX(-Math.PI / 2).translate(0, 0, -0.5)), this.aimMat);
    const hs = new THREE.Shape();
    hs.moveTo(0, 0.32); hs.lineTo(0.2, 0); hs.lineTo(-0.2, 0); hs.closePath();
    const head = new THREE.Mesh(this.track(new THREE.ShapeGeometry(hs).rotateX(-Math.PI / 2)), this.aimMat);
    aim.add(shaft, head);
    aim.userData = { shaft, head };
    aim.visible = false;
    aim.renderOrder = 5;
    this.boardGroup.add(aim);

    this.powerRing = new THREE.Mesh(this.track(new THREE.RingGeometry(1, 1.12, 48).rotateX(-Math.PI / 2)), this.aimMat);
    this.powerRing.visible = false;
    this.boardGroup.add(this.powerRing);

    // Ready halo: a soft pulsing ring under a puck that can be shot
    this.halo = new THREE.Mesh(this.track(new THREE.RingGeometry(level.puckR * 1.15, level.puckR * 1.35, 40).rotateX(-Math.PI / 2)), basic(0xffffff, 0.5));
    this.boardGroup.add(this.halo);

    this.dots = new THREE.InstancedMesh(this.track(new THREE.CircleGeometry(0.05, 10).rotateX(-Math.PI / 2)), basic(0xffffff, 0.8), MAX_PATH_DOTS);
    this.dots.count = 0;
    this.dots.frustumCulled = false;
    this.boardGroup.add(this.dots);
    this.pathEnd = new THREE.Mesh(this.track(new THREE.RingGeometry(0.16, 0.24, 28).rotateX(-Math.PI / 2)), basic(0xffffff, 0.9));
    this.pathEnd.visible = false;
    this.boardGroup.add(this.pathEnd);
  }

  /**
   * Show the aim: angle = direction of travel ((sin a, -cos a) on the board), power 0..1.
   * path = predictPath() result for the aim guide, or null.
   */
  setAim(puck, aim, path) {
    const show = !!aim && aim.power > 0;
    this.aim.visible = this.powerRing.visible = show;
    if (show) {
      const len = 0.5 + aim.power * 3.2, start = puck.r + 0.12;
      const { shaft, head } = this.aim.userData;
      this.aim.position.set(puck.x, 0.014, puck.z);
      this.aim.rotation.y = -aim.angle;
      shaft.scale.z = len; shaft.position.z = -start;
      head.position.z = -start - len;
      this.aimMat.color.setHSL(0.33 * (1 - aim.power), 1, 0.55);
      const pr = puck.r * (1.5 + aim.power * 1.4);
      this.powerRing.position.set(puck.x, 0.012, puck.z);
      this.powerRing.scale.set(pr, 1, pr);
    }
    const m = new THREE.Matrix4();
    if (path && show) {
      const pts = path.points, n = Math.min(MAX_PATH_DOTS, pts.length);
      for (let i = 0; i < n; i++) this.dots.setMatrixAt(i, m.makeTranslation(pts[i].x, 0.01, pts[i].z));
      this.dots.count = n;
      this.dots.instanceMatrix.needsUpdate = true;
      const e = pts[pts.length - 1];
      this.pathEnd.visible = true;
      this.pathEnd.position.set(e.x, 0.012, e.z);
      this.pathEnd.material.color.setHex(path.end === 'goal' ? 0x34ff9a : path.end === 'hole' ? 0xff3b5c : 0xffffff);
    } else {
      this.dots.count = 0;
      this.pathEnd.visible = false;
    }
  }

  /** Confetti burst over the goal (first clear of a level). From 3D Labyrinth. */
  celebrate(at) {
    this.endCelebration();
    const n = 220, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), vel = new Float32Array(n * 3);
    const palette = [0xffc93c, 0x00f0ff, 0xff4fa3, 0x34ff9a, 0xa855f7, 0xffffff].map(c => new THREE.Color(c));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 3.5;
      pos.set([at.x, 0.4, at.z], i * 3);
      vel.set([Math.cos(a) * s * 0.6, 4 + Math.random() * 5, Math.sin(a) * s * 0.6], i * 3);
      const c = palette[i % palette.length];
      col.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, depthWrite: false });
    this.confetti = { pts: new THREE.Points(geo, mat), vel, t: 0 };
    this.boardGroup.add(this.confetti.pts);
  }

  endCelebration() {
    if (!this.confetti) return;
    this.boardGroup.remove(this.confetti.pts);
    this.confetti.pts.geometry.dispose(); this.confetti.pts.material.dispose();
    this.confetti = null;
  }

  updateCelebration(dt) {
    const c = this.confetti;
    if (!c) return;
    c.t += dt;
    const p = c.pts.geometry.attributes.position, v = c.vel;
    for (let i = 0; i < v.length; i += 3) {
      v[i + 1] -= 9 * dt;
      v[i] *= 0.99; v[i + 2] *= 0.99;
      p.array[i] += v[i] * dt; p.array[i + 1] += v[i + 1] * dt; p.array[i + 2] += v[i + 2] * dt;
    }
    p.needsUpdate = true;
    c.pts.material.opacity = Math.max(0, 1 - (c.t - 1.6) / 1.2);
    if (c.t > 2.8) this.endCelebration();
  }

  /** Sync meshes to the physics world. */
  update(world, dt) {
    this.elapsed += dt;
    const p = world.puck;
    this.puck.position.set(p.x, p.y, p.z);
    this.puck.visible = p.state !== 'fallen';
    this.halo.visible = p.state === 'rest';
    if (this.halo.visible) {
      this.halo.position.set(p.x, 0.008, p.z);
      this.halo.material.opacity = 0.25 + 0.25 * Math.sin(this.elapsed * 4);
    }
    world.discs.forEach((d, i) => this.discs[i] && this.discs[i].position.set(d.x, 0, d.z));
    for (const m of this.movingHoles) {
      m.group.position.set(m.hole.x, 0, m.hole.z);
      m.group.userData.swirl.rotation.y -= dt * 2.4;
    }
    if (this.goalRing) {
      const k = 1 + Math.sin(this.elapsed * 4) * 0.04;
      this.goalRing.scale.set(k, 1, k);
    }
    this.stars.rotation.y += dt * 0.01;
    this.updateCelebration(dt);
  }
}
