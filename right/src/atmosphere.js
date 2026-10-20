import * as THREE from 'three';
import { cloudPuffTexture, softCircleTexture, mulberry32, clamp } from './util.js';
import { shared } from './shared.js';

/**
 * Atmosphere layer: clouds pushed to the corners (the whale owns the centre),
 * ground mist, floating islets, and drifting star dust that reacts to the
 * whale's breath.
 */

/** Drifting volumetric-ish clouds made from clustered soft sprites. */
export function buildClouds() {
  const group = new THREE.Group();
  const rng = mulberry32(8821);
  const tex = cloudPuffTexture(256, 5);
  const tex2 = cloudPuffTexture(256, 19);

  const clouds = [];
  // Positioned around the volume's edges, not in the middle: the whale swims
  // through the centre and any cloud in its path reads as a rendering error.
  const specs = [
    { x: -0.40, y: 0.30, z: -0.22, s: 0.135, op: 0.34, spd: 0.0075 },
    { x: 0.38, y: 0.20, z: 0.20, s: 0.105, op: 0.28, spd: 0.0105 },
    { x: -0.10, y: 0.52, z: -0.34, s: 0.120, op: 0.30, spd: 0.0062 },
    { x: 0.36, y: 0.40, z: 0.30, s: 0.092, op: 0.24, spd: 0.0120 },
    { x: -0.30, y: 0.05, z: 0.34, s: 0.140, op: 0.32, spd: 0.0050 },
    { x: 0.12, y: -0.06, z: -0.36, s: 0.110, op: 0.26, spd: 0.0085 },
  ];

  specs.forEach((spec) => {
    const cg = new THREE.Group();
    const puffs = 5 + Math.floor(rng() * 4);
    for (let i = 0; i < puffs; i++) {
      const mat = new THREE.SpriteMaterial({
        map: i % 2 ? tex : tex2,
        transparent: true,
        opacity: spec.op,
        depthWrite: false,
        depthTest: true,
        color: new THREE.Color('#dce8ff'),
        blending: THREE.NormalBlending,
      });
      const sp = new THREE.Sprite(mat);
      const ax = (rng() - 0.5) * spec.s * 1.7;
      const az = (rng() - 0.5) * spec.s * 0.8;
      const ay = (rng() - 0.5) * spec.s * 0.30;
      sp.position.set(ax, ay, az);
      const sc = spec.s * (0.55 + rng() * 0.75);
      sp.scale.set(sc, sc * (0.55 + rng() * 0.3), 1);
      sp.renderOrder = 8;
      cg.add(sp);
    }
    cg.position.set(spec.x, spec.y, spec.z);
    cg.userData = { ...spec, baseX: spec.x, phase: rng() * Math.PI * 2 };
    group.add(cg);
    clouds.push(cg);
  });

  return {
    group,
    clouds,
    update(dt, t, day) {
      clouds.forEach((c) => {
        const u = c.userData;
        c.position.x = u.baseX + Math.sin(t * u.spd * 9 + u.phase) * 0.045;
        c.position.y = u.y + Math.sin(t * 0.35 + u.phase) * 0.006;
        const dim = 0.55 + day * 0.55;
        c.children.forEach((sp) => {
          sp.material.opacity = u.op * dim;
        });
      });
    },
  };
}

/** Thin mist ribbons hugging the terrain, plus a low fog ring at the shore. */
export function buildMist(terrain) {
  const group = new THREE.Group();
  const rng = mulberry32(551);
  const tex = softCircleTexture(256, 0.02, '215,232,255');
  const items = [];

  const spots = [
    { x: -0.09, z: -0.30, y: 0.04, w: 0.11, h: 0.028, op: 0.11 },
    { x: 0.09, z: -0.09, y: -0.02, w: 0.13, h: 0.030, op: 0.10 },
    { x: 0.27, z: 0.30, y: -0.18, w: 0.14, h: 0.026, op: 0.12 },
    { x: -0.11, z: 0.27, y: -0.19, w: 0.15, h: 0.028, op: 0.10 },
    { x: 0.20, z: -0.18, y: -0.05, w: 0.10, h: 0.024, op: 0.09 },
    { x: -0.27, z: 0.02, y: -0.14, w: 0.11, h: 0.026, op: 0.09 },
  ];

  spots.forEach((s) => {
    for (let k = 0; k < 2; k++) {
      const mat = new THREE.SpriteMaterial({
        map: tex, transparent: true, opacity: s.op,
        depthWrite: false, color: new THREE.Color('#e8f0ff'),
        blending: THREE.NormalBlending,
      });
      const sp = new THREE.Sprite(mat);
      sp.position.set(s.x + (rng() - 0.5) * s.w * 0.6, s.y + (rng() - 0.5) * s.h, s.z + (rng() - 0.5) * s.w * 0.6);
      sp.scale.set(s.w * (0.8 + rng() * 0.5), s.h * (1.4 + rng() * 0.6), 1);
      sp.renderOrder = 7;
      sp.userData = {
        baseX: sp.position.x, baseZ: sp.position.z,
        phase: rng() * Math.PI * 2, spd: 0.4 + rng() * 0.5,
        baseOp: s.op,
      };
      group.add(sp);
      items.push(sp);
    }
  });

  return {
    group,
    update(dt, t, day) {
      // the whale's breath pushes the mist sideways in a slow travelling wave
      const breath = shared.uBreath.value;
      items.forEach((sp) => {
        const u = sp.userData;
        sp.position.x = u.baseX + Math.sin(t * u.spd + u.phase) * 0.009
                      + breath * 0.012;
        sp.position.z = u.baseZ + Math.cos(t * u.spd * 0.7 + u.phase) * 0.006;
        sp.material.opacity = (u.baseOp + 0.03 * Math.sin(t * 0.4 + u.phase)) * (0.55 + day * 0.55);
      });
    },
  };
}

/**
 * Small floating islets orbiting inside the cube. These are what make the
 * volume read as a world rather than a diorama on a plinth.
 */
export function buildIslets(terrain) {
  const group = new THREE.Group();
  const rng = mulberry32(1313);
  const islets = [];

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#7d8496'),
    roughness: 0.95, metalness: 0.0, flatShading: true,
    envMapIntensity: 0.4,
  });
  const grassMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#416b6b'),
    roughness: 0.92, metalness: 0.0, flatShading: true,
    envMapIntensity: 0.3,
  });

  const specs = [
    { x: -0.44, y: 0.09, z: 0.26, r: 0.028, spd: 0.07, ph: 0.0, orbit: 0.022 },
    { x: 0.42, y: 0.05, z: 0.30, r: 0.022, spd: 0.09, ph: 2.1, orbit: 0.020 },
    { x: 0.36, y: 0.12, z: -0.34, r: 0.019, spd: 0.11, ph: 4.0, orbit: 0.018 },
    { x: -0.38, y: 0.04, z: -0.36, r: 0.024, spd: 0.08, ph: 1.2, orbit: 0.020 },
    { x: 0.10, y: 0.20, z: 0.40, r: 0.016, spd: 0.12, ph: 5.3, orbit: 0.016 },
  ];

  specs.forEach((s) => {
    const g = new THREE.Group();
    // rock underside: a cone pulled into a rough inverted peak
    const rockGeo = new THREE.ConeGeometry(s.r, s.r * 2.1, 7, 2);
    rockGeo.rotateX(Math.PI);
    const rp = rockGeo.attributes.position;
    for (let i = 0; i < rp.count; i++) {
      const k = 0.78 + rng() * 0.45;
      rp.setXYZ(i, rp.getX(i) * k, rp.getY(i), rp.getZ(i) * k);
    }
    rockGeo.computeVertexNormals();
    const rock = new THREE.Mesh(rockGeo, mat);
    rock.castShadow = true;
    g.add(rock);

    // a thin cap of turf
    const capGeo = new THREE.CylinderGeometry(s.r * 0.98, s.r * 0.86, s.r * 0.22, 8, 1);
    const cap = new THREE.Mesh(capGeo, grassMat);
    cap.position.y = s.r * 1.02;
    cap.castShadow = true;
    g.add(cap);

    // one tiny tree so the scale reads
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(s.r * 0.055, s.r * 0.075, s.r * 0.5, 5),
      new THREE.MeshStandardMaterial({ color: '#4a3a33', roughness: 0.95 })
    );
    trunk.position.set(s.r * 0.15, s.r * 1.35, s.r * 0.1);
    g.add(trunk);
    const crown = new THREE.Mesh(
      new THREE.ConeGeometry(s.r * 0.30, s.r * 0.9, 6),
      new THREE.MeshStandardMaterial({ color: '#2f4f46', roughness: 0.9, flatShading: true })
    );
    crown.position.set(s.r * 0.15, s.r * 1.9, s.r * 0.1);
    g.add(crown);

    g.position.set(s.x, s.y, s.z);
    g.userData = { ...s, base: new THREE.Vector3(s.x, s.y, s.z), phase: rng() * Math.PI * 2 };
    group.add(g);
    islets.push(g);
  });

  return {
    group,
    update(dt, t) {
      islets.forEach((g) => {
        const u = g.userData;
        const a = t * u.spd + u.ph;
        g.position.x = u.base.x + Math.cos(a) * u.orbit;
        g.position.z = u.base.z + Math.sin(a) * u.orbit;
        g.position.y = u.base.y + Math.sin(t * 0.30 + u.phase) * 0.010;
        g.rotation.y = t * 0.02 + u.phase;
      });
    },
  };
}

/** Fireflies / motes that wake as the ambient dims, and drift with breath. */
export function buildFireflies(terrain) {
  const rng = mulberry32(4404);
  const N = 150;
  const pos = new Float32Array(N * 3);
  const base = new Float32Array(N * 3);
  const phase = new Float32Array(N);
  let n = 0;
  let guard = 0;
  while (n < N && guard++ < 6000) {
    const x = (rng() * 2 - 1) * 0.46;
    const z = (rng() * 2 - 1) * 0.46;
    const y = terrain.heightAt(x, z);
    if (y < -0.22 || terrain.isWater(x, z)) continue;
    base[n * 3] = x;
    base[n * 3 + 1] = y + 0.02 + rng() * 0.10;
    base[n * 3 + 2] = z;
    pos[n * 3] = x;
    pos[n * 3 + 1] = y + 0.02;
    pos[n * 3 + 2] = z;
    phase[n] = rng() * Math.PI * 2;
    n++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    map: softCircleTexture(64, 0.05, '205,230,255'),
    size: 0.018, transparent: true, opacity: 0.8,
    depthWrite: false, blending: THREE.AdditiveBlending,
    color: new THREE.Color('#d8e6ff'), sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.renderOrder = 9;

  return {
    points,
    update(dt, t) {
      const breath = shared.uBreath.value;
      for (let i = 0; i < n; i++) {
        const ph = phase[i];
        pos[i * 3] = base[i * 3] + Math.sin(t * 0.55 + ph) * 0.020;
        pos[i * 3 + 1] = base[i * 3 + 1] + Math.sin(t * 0.75 + ph * 1.7) * 0.014
                       + breath * 0.006;
        pos[i * 3 + 2] = base[i * 3 + 2] + Math.cos(t * 0.48 + ph * 1.3) * 0.020;
      }
      geo.attributes.position.needsUpdate = true;
      mat.size = 0.016 + Math.sin(t * 1.6) * 0.002;
      mat.opacity = 0.45 + 0.35 * breath;
    },
  };
}

/**
 * Star dust filling the cube. Reacts to the whale's passage by brightening and
 * parting slightly — the cheapest way to make the whole volume feel alive.
 */
export function buildStarDust() {
  const rng = mulberry32(9012);
  const N = 420;
  const pos = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  const scale = new Float32Array(N);
  const half = 0.70;
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (rng() * 2 - 1) * half;
    pos[i * 3 + 1] = (rng() * 2 - 1) * half;
    pos[i * 3 + 2] = (rng() * 2 - 1) * half;
    seed[i] = rng() * Math.PI * 2;
    scale[i] = 0.5 + rng() * 1.4;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aScale', new THREE.BufferAttribute(scale, 1));

  const mat = new THREE.PointsMaterial({
    map: softCircleTexture(48, 0.02, '225,238,255'),
    size: 0.0075, transparent: true, opacity: 0.55,
    depthWrite: false, blending: THREE.AdditiveBlending,
    color: new THREE.Color('#e2ecff'), sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.renderOrder = 6;
  points.frustumCulled = false;

  return {
    points,
    update(dt, t) {
      const wp = shared.uWhalePos.value;
      const breath = shared.uBreath.value;
      for (let i = 0; i < N; i++) {
        const sd = seed[i];
        let x = pos[i * 3];
        let y = pos[i * 3 + 1];
        let z = pos[i * 3 + 2];
        // slow drift
        x += Math.sin(t * 0.09 + sd) * 0.0006;
        y += Math.cos(t * 0.07 + sd * 1.7) * 0.0006;
        z += Math.sin(t * 0.08 + sd * 2.3) * 0.0006;
        // part around the whale
        const dx = x - wp.x, dy = y - wp.y, dz = z - wp.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        const R = 0.20;
        if (d2 < R * R) {
          const d = Math.sqrt(d2) + 1e-4;
          const push = (1 - d / R) * 0.30;
          x += (dx / d) * push;
          y += (dy / d) * push;
          z += (dz / d) * push;
        }
        pos[i * 3] = x;
        pos[i * 3 + 1] = y;
        pos[i * 3 + 2] = z;
      }
      geo.attributes.position.needsUpdate = true;
      mat.opacity = 0.42 + 0.20 * breath;
      mat.size = 0.0070 + 0.0018 * breath;
    },
  };
}
