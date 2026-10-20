import * as THREE from 'three';
import { shared } from './shared.js';
import { mulberry32, clamp, smoothstep, makeCanvas } from './util.js';

const SNOW_LINE = 0.150;

export function buildVegetation(terrain) {
  const group = new THREE.Group();
  const rng = mulberry32(20260);

  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();

  // ---------- gather candidate points ----------
  const conifers = [];
  const broadleaf = [];
  const tufts = [];
  const rocks = [];
  const flowers = [];

  const tries = 34000;
  for (let i = 0; i < tries; i++) {
    const ang = rng() * Math.PI * 2;
    // sample in polar space so coverage reaches the silhouette instead of
    // stopping at a square's inscribed circle and leaving bare soil wedges
    const rad = Math.sqrt(rng()) * terrain.rimRadiusAt(ang) * 0.985;
    const x = Math.cos(ang) * rad;
    const z = Math.sin(ang) * rad;
    const y = terrain.heightAt(x, z);
    if (y < -0.22) continue;
    if (terrain.isWater(x, z)) continue;
    const slope = terrain.slopeAt(x, z);
    if (slope > 0.85) continue;
    if (y > SNOW_LINE + 0.02) continue;
    if (terrain.riverInfo(x, z).dist < 0.034) continue;
    if (Math.hypot(x - terrain.lake.x, z - terrain.lake.z) < terrain.lake.r + 0.012) continue;

    // forest density mask: thick patches, open meadow near lake
    const f = terrain.fbm(x * 3.2 - 4, z * 3.2 + 7, 3);
    const forest = smoothstep(0.0, 0.34, f);
    const meadowNearLake = smoothstep(0.26, 0.14, Math.hypot(x - terrain.lake.x, z - terrain.lake.z));
    const alt = smoothstep(-0.16, 0.02, y);
    const density = forest * (1 - meadowNearLake * 0.75) * (1 - alt * 0.25);

    const r = rng();
    if (r < density * 0.055) {
      conifers.push({ x, y, z, s: 0.55 + Math.pow(rng(), 1.5) * 0.85, rot: rng() * Math.PI * 2 });
    } else if (r < density * 0.075 + 0.006) {
      broadleaf.push({ x, y, z, s: 0.5 + Math.pow(rng(), 1.5) * 0.7, rot: rng() * Math.PI * 2 });
    } else if (r < 0.30 && slope < 0.5) {
      tufts.push({ x, y, z, s: 0.6 + rng() * 0.9, rot: rng() * Math.PI * 2 });
    } else if (r < 0.315) {
      rocks.push({ x, y, z, s: 0.35 + Math.pow(rng(), 2) * 1.1, rot: rng() * Math.PI * 2 });
    } else if (r < 0.322 && slope < 0.35) {
      flowers.push({ x, y, z, s: 0.5 + rng() * 0.8, rot: rng() * Math.PI * 2 });
    }
  }

  // thin out tufts for performance, keep variety
  const tuftLimit = 3400;
  if (tufts.length > tuftLimit) {
    for (let i = tufts.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = tufts[i]; tufts[i] = tufts[j]; tufts[j] = t;
    }
    tufts.length = tuftLimit;
  }

  group.add(buildConifers(conifers, rng));
  group.add(buildBroadleaf(broadleaf, rng));
  group.add(buildTufts(tufts, rng));
  group.add(buildRocks(rocks, rng));
  group.add(buildFlowers(flowers, rng));

  return { group, counts: { conifers: conifers.length, broadleaf: broadleaf.length, tufts: tufts.length, rocks: rocks.length, flowers: flowers.length } };
}

function instanced(geo, mat, list, apply, colorFn) {
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const d = new THREE.Object3D();
  const c = new THREE.Color();
  list.forEach((item, i) => {
    d.position.set(item.x, item.y, item.z);
    d.rotation.set(0, item.rot, 0);
    d.scale.setScalar(item.s);
    apply && apply(d, item, i);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
    if (colorFn) {
      colorFn(c, item, i);
      mesh.setColorAt(i, c);
    }
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

function buildConifers(list, rng) {
  const g = new THREE.Group();
  if (!list.length) return g;

  const trunkGeo = new THREE.CylinderGeometry(0.0035, 0.006, 0.055, 5, 1);
  trunkGeo.translate(0, 0.0275, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#4a3526', roughness: 0.95 });

  // three stacked cone tiers merged into one geometry, base at y=0.02
  const tierGeo = mergeCones();
  const foliageMat = new THREE.MeshStandardMaterial({
    vertexColors: false, roughness: 0.90, metalness: 0.0,
    envMapIntensity: 0.55, flatShading: true,
  });

  g.add(instanced(trunkGeo, trunkMat, list));
  const foliage = instanced(tierGeo, foliageMat, list, null, (c, item, i) => {
    const t = rng();
    c.setHSL(0.475 + t * 0.04, 0.26 + t * 0.10, 0.11 + t * 0.06);
  });
  foliage.castShadow = true;
  g.add(foliage);
  return g;
}

function mergeCones() {
  // 3 cones + tiny top, manually merged, with per-tier y offsets
  const parts = [];
  const tiers = [
    { r: 0.026, h: 0.052, y: 0.030 },
    { r: 0.021, h: 0.045, y: 0.058 },
    { r: 0.015, h: 0.038, y: 0.084 },
  ];
  tiers.forEach((t) => {
    const geo = new THREE.ConeGeometry(t.r, t.h, 7, 1);
    geo.translate(0, t.y + t.h / 2, 0);
    parts.push(geo);
  });
  const topGeo = new THREE.ConeGeometry(0.008, 0.026, 6, 1);
  topGeo.translate(0, 0.112, 0);
  parts.push(topGeo);
  return mergeGeometries(parts);
}

function mergeGeometries(geos) {
  let total = 0;
  geos.forEach((g0) => {
    const g = g0.index ? g0.toNonIndexed() : g0;
    total += g.attributes.position.count;
  });
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  let off = 0;
  geos.forEach((g0) => {
    const g = g0.index ? g0.toNonIndexed() : g0;
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    pos.set(p, off * 3);
    nrm.set(n, off * 3);
    off += g.attributes.position.count;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return out;
}

function buildBroadleaf(list, rng) {
  const g = new THREE.Group();
  if (!list.length) return g;
  const trunkGeo = new THREE.CylinderGeometry(0.0035, 0.0065, 0.05, 5, 1);
  trunkGeo.translate(0, 0.025, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#5a4130', roughness: 0.95 });

  const blobGeo = mergeBlobs();
  const leafMat = new THREE.MeshStandardMaterial({
    roughness: 0.88, metalness: 0.0, flatShading: true, envMapIntensity: 0.55,
  });

  g.add(instanced(trunkGeo, trunkMat, list));
  const canopy = instanced(blobGeo, leafMat, list, (d, item) => {
    d.rotation.y = item.rot;
    d.rotation.z = (rng() - 0.5) * 0.1;
  }, (c, item) => {
    const t = rng();
    c.setHSL(0.44 + t * 0.07, 0.22 + t * 0.10, 0.15 + t * 0.08);
  });
  g.add(canopy);
  return g;
}

function mergeBlobs() {
  const parts = [];
  const specs = [
    { x: 0, y: 0.062, z: 0, r: 0.028 },
    { x: 0.018, y: 0.050, z: 0.010, r: 0.021 },
    { x: -0.016, y: 0.055, z: -0.008, r: 0.019 },
    { x: 0.004, y: 0.080, z: -0.012, r: 0.018 },
  ];
  specs.forEach((s) => {
    const geo = new THREE.IcosahedronGeometry(s.r, 1);
    geo.translate(s.x, s.y, s.z);
    parts.push(geo);
  });
  return mergeGeometries(parts);
}

function buildTufts(list, rng) {
  const geo = makeBladeCluster();
  const mat = new THREE.MeshStandardMaterial({
    roughness: 0.92, metalness: 0.0, side: THREE.DoubleSide,
    vertexColors: false, envMapIntensity: 0.25,
  });
  const mesh = instanced(geo, mat, list, (d, item) => {
    d.rotation.y = item.rot;
    d.scale.set(item.s * 0.85, item.s * 0.55, item.s * 0.85);
  }, (c, item, i) => {
    const t = rng();
    // yellow-green, darker than the ground so tufts read as texture
    c.setHSL(0.42 + t * 0.06, 0.24 + t * 0.12, 0.13 + t * 0.07);
  });
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

function makeBladeCluster() {
  const blades = 6;
  const pos = [], nrm = [];
  const rng = mulberry32(31);
  for (let b = 0; b < blades; b++) {
    const ang = (b / blades) * Math.PI * 2 + rng() * 0.8;
    const lean = 0.16 + rng() * 0.22;
    const h = 0.022 + rng() * 0.018;
    const w = 0.0026 + rng() * 0.0016;
    const dx = Math.cos(ang), dz = Math.sin(ang);
    const px = -dz, pz = dx;
    const x0 = dx * 0.002, z0 = dz * 0.002;
    const x1 = dx * (0.002 + h * lean), z1 = dz * (0.002 + h * lean);
    const v = [
      [x0 - px * w, 0, z0 - pz * w],
      [x0 + px * w, 0, z0 + pz * w],
      [x1 + px * w * 0.3, h, z1 + pz * w * 0.3],
      [x1 - px * w * 0.3, h, z1 - pz * w * 0.3],
    ];
    // side-facing normals: upward normals make the blades catch the sky and
    // read as white confetti
    const tri = [0, 1, 2, 0, 2, 3];
    tri.forEach((k) => { pos.push(...v[k]); });
    const n1 = new THREE.Vector3(px, 0.10, pz).normalize();
    const n2 = new THREE.Vector3(pz, 0.10, -px).normalize();
    for (let k = 0; k < 3; k++) nrm.push(n1.x, n1.y, n1.z);
    for (let k = 0; k < 3; k++) nrm.push(n2.x, n2.y, n2.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.normalizeNormals();
  return g;
}

function buildRocks(list, rng) {
  const geo = new THREE.IcosahedronGeometry(0.018, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const s = 0.7 + rng() * 0.6;
    p.setXYZ(i, p.getX(i) * s * (0.8 + rng() * 0.5), p.getY(i) * s * 0.6, p.getZ(i) * s * (0.8 + rng() * 0.5));
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.94, metalness: 0.0, flatShading: true, envMapIntensity: 0.2 });
  const mesh = instanced(geo, mat, list, (d, item) => {
    d.scale.set(item.s, item.s * (0.6 + rng() * 0.5), item.s);
  }, (c, item) => {
    const t = rng();
    c.setHSL(0.62 + t * 0.05, 0.06 + t * 0.05, 0.34 + t * 0.14);
  });
  return mesh;
}

function buildFlowers(list, rng) {
  const g = new THREE.Group();
  if (!list.length) return g;
  const geo = new THREE.IcosahedronGeometry(0.0034, 0);
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.0, envMapIntensity: 0.9 });
  const mesh = instanced(geo, mat, list, (d, item) => {
    d.position.y += 0.012 * item.s;
  }, (c) => {
    const pal = ['#e8eeff', '#d8c6ff', '#f2f6ff', '#bcd4ff', '#ffd0dc'];
    c.set(pal[Math.floor(rng() * pal.length)]);
  });
  mesh.castShadow = false;
  g.add(mesh);
  return g;
}
