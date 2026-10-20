import * as THREE from 'three';
import {
  clamp, lerp, smoothstep, makePerlin, makeFbm, makeRidged,
  sdRoundRect, mulberry32, makeCanvas
} from './util.js';

/**
 * The island sits in the lower third of the cube. Everything is authored at the
 * same relative proportions as the earlier terrarium but shifted down and
 * shrunk, because the cloud whale owns the upper half of the volume.
 */
export const CFG = {
  cubeHalf: 0.745,
  terrainHalf: 0.500,
  cornerR: 0.205,
  islandBottom: -0.600,
  lake: { x: 0.236, z: 0.256, r: 0.112, y: -0.243 },
  brinkX: -0.080,
};

const SRGB = (hex) => new THREE.Color(hex);

export class Terrain {
  constructor() {
    this.noise = makePerlin(9271);
    this.fbm = makeFbm(this.noise);
    this.ridged = makeRidged(this.noise);
    this.rng = mulberry32(4242);
    this.lake = CFG.lake;
    this.brinkZ = this.cliffZ(CFG.brinkX);
    this.buildRiver();
    this.buildIndex();
    this.buildGrid();
  }

  cliffZ(x) {
    return 0.049 + 0.0445 * Math.sin(x * 2.9 + 0.4) + 0.022 * this.noise(x * 3.2, 9.1);
  }

  massif(x, z, cx, cz, rad, height) {
    const dx = x - cx, dz = z - cz;
    const d = Math.hypot(dx, dz) / rad;
    const warp = 0.30 * this.fbm(x * 4.4 + cx * 17, z * 4.4 + cz * 11, 3);
    const m = clamp(1 - d + warp * 0.45, 0, 1);
    const ridges = 0.72 + 0.55 * this.ridged(x * 8.5 + 23, z * 8.5 - 13, 3);
    const crag = 0.18 * this.ridged(x * 17 + 5, z * 17 + 9, 2);
    return height * Math.pow(m, 1.75) * (ridges + crag * Math.pow(m, 0.4));
  }

  // ---------- river ----------
  buildRiver() {
    const bz = this.brinkZ;
    const Y = (v) => v - 0.155;
    // The path steps off the lip almost vertically: only a few mm of horizontal
    // travel while dropping ~15 cm, which is what makes the waterfall read.
    const path = [
      new THREE.Vector3(-0.207, Y(0.132), -0.283),
      new THREE.Vector3(-0.176, Y(0.124), -0.214),
      new THREE.Vector3(-0.135, Y(0.116), -0.141),
      new THREE.Vector3(-0.110, Y(0.108), -0.062),
      new THREE.Vector3(-0.090, Y(0.086), bz - 0.027),
      new THREE.Vector3(-0.084, Y(0.072), bz - 0.004),  // lip
      new THREE.Vector3(-0.083, Y(0.030), bz + 0.001),  // free fall
      new THREE.Vector3(-0.083, Y(-0.012), bz + 0.004),
      new THREE.Vector3(-0.082, Y(-0.050), bz + 0.011), // plunge pool
      new THREE.Vector3(-0.062, Y(-0.058), bz + 0.043),
      new THREE.Vector3(-0.018, Y(-0.058), bz + 0.082),
      new THREE.Vector3(0.043, Y(-0.058), bz + 0.125),
      new THREE.Vector3(0.112, Y(-0.058), bz + 0.166),
      new THREE.Vector3(0.183, Y(-0.058), bz + 0.189),
    ];
    this.riverCurve = new THREE.CatmullRomCurve3(path, false, 'catmullrom', 0.5);
    this.riverPts = this.riverCurve.getSpacedPoints(280);

    // Find the lip: the last sample that is still upstream of the cliff line.
    // Sampling "closest to the cliff" lands on the already-fallen section.
    let lipI = 0;
    for (let i = 0; i < this.riverPts.length; i++) {
      if (this.riverPts[i].z <= bz - 0.002) lipI = i;
      else break;
    }
    this.brinkIndex = clamp(lipI, 4, this.riverPts.length - 20);
    this.brink = this.riverPts[this.brinkIndex];
    this.upperPts = this.riverPts.slice(0, this.brinkIndex + 1);
    this.lowerPts = this.riverPts.slice(this.brinkIndex + 2);
    this.plunge = this.lowerPts[0] || this.brink;
  }

  buildIndex() {
    const cell = 0.06;
    this.riverCell = cell;
    this.riverGrid = new Map();
    this.riverPts.forEach((p, i) => {
      const gx = Math.floor(p.x / cell);
      const gz = Math.floor(p.z / cell);
      for (let ox = -2; ox <= 2; ox++) {
        for (let oz = -2; oz <= 2; oz++) {
          const k = (gx + ox) + ',' + (gz + oz);
          let arr = this.riverGrid.get(k);
          if (!arr) { arr = []; this.riverGrid.set(k, arr); }
          arr.push(i);
        }
      }
    });
  }

  riverInfo(x, z) {
    const cell = this.riverCell;
    const arr = this.riverGrid.get(Math.floor(x / cell) + ',' + Math.floor(z / cell));
    if (!arr) return { dist: 1, y: 0 };
    let best = Infinity, bi = -1;
    for (let i = 0; i < arr.length; i++) {
      const p = this.riverPts[arr[i]];
      const dx = p.x - x, dz = p.z - z;
      const d = dx * dx + dz * dz;
      if (d < best) { best = d; bi = arr[i]; }
    }
    return { dist: Math.sqrt(best), y: this.riverPts[bi].y };
  }

  lakeDist(x, z) {
    const l = this.lake;
    return Math.hypot(x - l.x, z - l.z) + 0.010 * this.noise(x * 11, z * 11);
  }

  // ---------- analytic height ----------
  baseHeight(x, z) {
    let d = -sdRoundRect(x, z, 0, 0, CFG.terrainHalf, CFG.terrainHalf, CFG.cornerR);
    d += 0.020 * this.fbm(x * 3.1 + 5, z * 3.1 - 3, 3);
    const edge = smoothstep(0.0, 0.042, d);

    const cz = this.cliffZ(x);
    const step = smoothstep(cz - 0.056, cz + 0.052, z);
    let y = lerp(-0.043, -0.203, Math.pow(step, 1.45));

    y += 0.018 * this.fbm(x * 2.4 + 2.0, z * 2.4 - 1.3, 4) * (1 - step * 0.55);
    y += 0.006 * this.fbm(x * 8.0, z * 8.0, 3);

    // terraced ledges on the cliff face
    const cliffMask = step * (1 - step) * 4;
    y += Math.sin(y * 46.0) * 0.006 * cliffMask;

    // massifs are deliberately half the old height: the upper half of the cube
    // belongs to the whale, and a peak that reaches it would break the hierarchy
    y += this.massif(x, z, -0.219, -0.344, 0.254, 0.196);
    y += this.massif(x, z, -0.384, -0.205, 0.165, 0.088);
    y += this.massif(x, z, 0.009, -0.429, 0.196, 0.070) * (1 - step);
    y += this.massif(x, z, 0.250, -0.402, 0.138, 0.040) * (1 - step);
    // the far flank needs its own relief, otherwise it reads as a bare shelf
    y += this.massif(x, z, -0.049, -0.264, 0.170, 0.044);
    y += this.massif(x, z, 0.321, -0.170, 0.125, 0.030);

    // river channel
    const ri = this.riverInfo(x, z);
    const bankW = 0.064;
    if (ri.dist < bankW) {
      const fall = Math.pow(1 - ri.dist / bankW, 1.4);
      const bed = ri.y - 0.026;
      const carve = Math.max(0, y - bed);
      y -= Math.min(carve, 0.11) * fall;
    }

    // lake basin
    const ld = this.lakeDist(x, z);
    const lr = this.lake.r;
    if (ld < lr + 0.068) {
      const inside = ld < lr ? 1 : Math.pow(clamp(1 - (ld - lr) / 0.068, 0, 1), 1.25);
      const bed = this.lake.y - 0.014 - 0.028 * (1 - clamp(ld / lr, 0, 1) ** 2);
      const carve = Math.max(0, y - bed);
      y -= Math.min(carve, 0.15) * inside;
    }

    y = lerp(y - 0.011, y, edge);
    return y;
  }

  // ---------- grid ----------
  buildGrid() {
    this.half = CFG.terrainHalf;
    // polar lookup of the island silhouette, shared with the base mesh so the
    // two surfaces meet exactly at the rim
    const M = 720;
    this.rimLUT = new Float32Array(M + 1);
    for (let i = 0; i <= M; i++) {
      const ang = (i / M) * Math.PI * 2;
      const dx = Math.cos(ang), dz = Math.sin(ang);
      let lo = 0.05, hi = CFG.terrainHalf * 1.6;
      for (let k = 0; k < 26; k++) {
        const mid = (lo + hi) / 2;
        if (sdRoundRect(dx * mid, dz * mid, 0, 0, CFG.terrainHalf, CFG.terrainHalf, CFG.cornerR) < 0) lo = mid;
        else hi = mid;
      }
      this.rimLUT[i] = lo;
    }
  }

  rimRadiusAt(ang) {
    const M = 720;
    let a = ang % (Math.PI * 2);
    if (a < 0) a += Math.PI * 2;
    const f = (a / (Math.PI * 2)) * M;
    const i0 = Math.floor(f) % M;
    const i1 = (i0 + 1) % M;
    const t = f - Math.floor(f);
    return lerp(this.rimLUT[i0], this.rimLUT[i1], t);
  }

  /** Pulls a point inward onto the rounded-square silhouette. */
  projectToRim(x, z) {
    const r = Math.hypot(x, z);
    if (r < 1e-6) return [x, z];
    const lim = this.rimRadiusAt(Math.atan2(z, x));
    if (r <= lim) return [x, z];
    const s = lim / r;
    return [x * s, z * s];
  }

  heightAt(x, z) {
    return this.baseHeight(x, z);
  }

  slopeAt(x, z) {
    const e = 0.004;
    const hx = this.baseHeight(x + e, z) - this.baseHeight(x - e, z);
    const hz = this.baseHeight(x, z + e) - this.baseHeight(x, z - e);
    return Math.hypot(hx, hz) / (2 * e);
  }

  isWater(x, z) {
    const l = this.lake;
    const ld = Math.hypot(x - l.x, z - l.z);
    if (ld < l.r - 0.008) return true;
    return this.riverInfo(x, z).dist < 0.027;
  }

  // ---------- meshes ----------
  buildMesh() {
    // Polar grid whose outer ring follows the island silhouette exactly, so the
    // terrain never spills past the rounded-square rim.
    const RINGS = 150;
    const SEGS = 360;
    const M = SEGS;
    const pos = [];
    const uvs = [];
    const idx = [];

    for (let r = 0; r <= RINGS; r++) {
      const rt = Math.pow(r / RINGS, 0.92);
      // start just off the centre: a ring of coincident vertices would create
      // degenerate triangles that show up as stray dark slivers
      const minR = 0.0022;
      for (let s = 0; s <= M; s++) {
        const ang = (s / M) * Math.PI * 2;
        const lim = this.rimLUT[s % M];
        // the last ring reaches slightly past the silhouette so it overlaps the
        // pedestal's top edge and no bare ledge can show between them
        const over = r === RINGS ? 1.006 : 1.0;
        const rad = Math.max(minR, lim * rt * over);
        const x = Math.cos(ang) * rad;
        const z = Math.sin(ang) * rad;
        const y = this.baseHeight(x, z);
        pos.push(x, y, z);
        // uv drives the detail texture; keep it roughly metric
        uvs.push(x * 1.4 + 0.5, z * 1.4 + 0.5);
      }
    }
    const W = M + 1;
    for (let r = 0; r < RINGS; r++) {
      for (let s = 0; s < M; s++) {
        const a = r * W + s, b = a + 1, c = a + W, d = c + 1;
        // wind counter-clockwise seen from +Y so the sheet faces up
        idx.push(a, b, c, b, d, c);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const nrm = geo.attributes.normal;
    const colors = new Float32Array((pos.length / 3) * 3);
    // moonlit palette: desaturated teal greens, lavender-grey stone, ice snow
    const cGrassA = SRGB('#24414c'), cGrassB = SRGB('#3e6372');
    const cForest = SRGB('#182b36'), cRock = SRGB('#475363');
    const cRockDark = SRGB('#333e51'), cSnow = SRGB('#e8f0ff');
    const cSand = SRGB('#5d646e');
    const tmp = new THREE.Color();

    for (let v = 0; v < pos.length / 3; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      const ny = nrm.getY(v);

      const n1 = this.fbm(x * 6.5 + 3, z * 6.5 - 2, 3);
      const n2 = this.noise(x * 22, z * 22);
      const slope = 1 - clamp(ny, 0, 1);

      tmp.copy(cGrassA).lerp(cGrassB, clamp(0.5 + n1 * 1.6, 0, 1));
      const forestMask = smoothstep(0.04, 0.30, this.fbm(x * 3.4 - 8, z * 3.4 + 4, 3));
      tmp.lerp(cForest, forestMask * 0.58);

      // rock on steep faces first, then snow on top of it
      const rockAmt = smoothstep(0.30, 0.62, slope + n2 * 0.08);
      tmp.lerp(cRock, rockAmt * 0.95);
      if (slope > 0.74) tmp.lerp(cRockDark, smoothstep(0.74, 1.0, slope) * 0.55);

      // Snow accumulates by altitude; only the near-vertical faces stay bare.
      const snowLine = 0.150 + 0.024 * this.fbm(x * 7.1, z * 7.1, 3);
      const altT = smoothstep(snowLine, snowLine + 0.030, y);
      const faceT = smoothstep(0.94, 0.66, slope);
      const snowAmt = altT * faceT;
      tmp.lerp(cSnow, clamp(snowAmt, 0, 1));

      const ri = this.riverInfo(x, z).dist;
      const ld = Math.hypot(x - this.lake.x, z - this.lake.z);
      const shore = smoothstep(0.064, 0.022, ri);
      const lakeShore = smoothstep(this.lake.r + 0.038, this.lake.r - 0.006, ld);
      tmp.lerp(cSand, Math.max(shore, lakeShore) * 0.62);

      // no separate rim band: the outer lip of the sheet is already overhung by
      // grass, and any tinted band here reads as a painted stripe
      const rim = this.rimRadiusAt(Math.atan2(z, x));
      const rr = Math.hypot(x, z) / Math.max(rim, 1e-5);
      const skin = smoothstep(0.995, 1.0, rr);
      tmp.lerp(SRGB('#3f4653'), skin * 0.55);

      const shade = 0.88 + 0.12 * n2;
      colors[v * 3 + 0] = tmp.r * shade;
      colors[v * 3 + 1] = tmp.g * shade;
      colors[v * 3 + 2] = tmp.b * shade;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const tex = makeGroundTexture();
    tex.repeat.set(26, 26);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.94,
      metalness: 0.0,
      map: tex,
      envMapIntensity: 0.35,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    this.mesh = mesh;
    return mesh;
  }

  buildBase() {
    // Rock pedestal: a rounded-square column whose top ring follows the very
    // same silhouette as the terrain, tapering into a rough hanging rock.
    const SEG = this.rimLUT.length - 1;
    const ROWS = 38;
    const bottomY = CFG.islandBottom;

    const ringH = new Float32Array(SEG + 1);
    for (let i = 0; i <= SEG; i++) {
      const th = (i / SEG) * Math.PI * 2;
      const rim = this.rimLUT[i];
      // The top ring has to rise slightly ABOVE the terrain skirt: the terrain
      // sheet ends at the rim with a downward lip, and any gap between the two
      // shows the lit interior as a bright wedge.
      let hi = -Infinity;
      for (let k = 0; k <= 8; k++) {
        const f = 1.0 - k * 0.010;
        const x = Math.cos(th) * rim * f;
        const z = Math.sin(th) * rim * f;
        hi = Math.max(hi, this.baseHeight(x, z));
      }
      // Sit the pedestal top below the terrain skirt: the terrain sheet already
      // overhangs past the silhouette, so the rock never needs to show a top
      // face. A positive offset here produces the pale ledge seen from above.
      ringH[i] = hi - 0.050;
    }

    const pos = [], idx = [], uv = [];
    const W = SEG + 1;

    for (let j = 0; j <= ROWS; j++) {
      const s = j / ROWS;
      // Straight wall under the lip, then pinch into a jagged point. The wall
      // also leans inward slightly over its height so the silhouette is a cut
      // column rather than an extruded outline.
      const taper = 1.0 - 0.60 * smoothstep(0.32, 1.0, s) ** 1.5 - 0.045 * s;
      // start a hair outside the terrain rim so the two surfaces overlap
      const outset = 1.012;
      for (let i = 0; i <= SEG; i++) {
        const th = (i / SEG) * Math.PI * 2;
        const rim = this.rimLUT[i];
        const x0 = Math.cos(th) * rim;
        const z0 = Math.sin(th) * rim;
        const y = lerp(ringH[i], bottomY, Math.pow(s, 0.95));

        const nx = Math.cos(th), nz = Math.sin(th);
        // two noise scales: broad buttresses plus fine pitting
        const lump =
          0.024 * this.fbm(nx * 3.0 + 3, nz * 3.0 - s * 2.6, 4) +
          0.010 * this.noise(nx * 7.0 + 11, nz * 7.0 + y * 9.0) +
          0.005 * this.noise(nx * 18.0, nz * 18.0 + y * 30.0);
        const prof = taper + lump * (0.25 + s * 1.4);
        const wob = 1 + 0.030 * Math.sin(y * 30 + th * 3.0) * (0.2 + s);

        pos.push(x0 * prof * wob * outset, y, z0 * prof * wob * outset);
        uv.push(i / SEG, s);
      }
    }

    for (let j = 0; j < ROWS; j++) {
      for (let i = 0; i < SEG; i++) {
        const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
        idx.push(a, b, c, b, d, c);
      }
    }
    // bottom cap
    const capStart = pos.length / 3;
    pos.push(0, bottomY - 0.035, 0);
    uv.push(0.5, 1);
    for (let i = 0; i < SEG; i++) {
      const a = ROWS * W + i;
      idx.push(a, capStart, a + 1);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    // vertex colours: cool violet soil at the top, moonstone grey below
    const colors = new Float32Array((pos.length / 3) * 3);
    const cSoil = SRGB('#3d4152');
    const cSoil2 = SRGB('#515566');
    const cRock = SRGB('#6a7180');
    const cRock2 = SRGB('#4a505f');
    const tmp = new THREE.Color();
    for (let v = 0; v < pos.length / 3; v++) {
      const y = pos[v * 3 + 1];
      const x = pos[v * 3], z = pos[v * 3 + 2];
      const band = this.fbm(x * 9.0, z * 9.0 + y * 7.0, 3);
      const band2 = this.noise(x * 26.0, z * 26.0 + y * 20.0);
      tmp.copy(cSoil).lerp(cSoil2, clamp(0.5 + band * 1.2, 0, 1));
      // smoothstep needs edge0 < edge1; descending y is inverted here
      const rockT = smoothstep(-0.30, -0.24, -y);
      tmp.lerp(cRock, rockT * clamp(0.65 + band2 * 0.35, 0, 1));
      tmp.lerp(cRock2, smoothstep(-0.50, -0.30, -y) * clamp(0.5 + band2, 0, 1) * 0.75);
      // faint cold moss right under the grass lip
      const moss = smoothstep(-0.22, -0.02, y) * clamp(0.5 + band * 1.5, 0, 1);
      tmp.lerp(SRGB('#3c5a55'), moss * 0.30);

      // the texture map multiplies the vertex colour, so it must stay near
      // white on average; keep the base value lifted for the rock body
      const lift = 1.0 + smoothstep(0.0, -0.30, y) * 0.30;
      tmp.multiplyScalar(lift);
      colors[v * 3] = tmp.r; colors[v * 3 + 1] = tmp.g; colors[v * 3 + 2] = tmp.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const rockTex = makeRockTexture();
    rockTex.wrapS = rockTex.wrapT = THREE.RepeatWrapping;
    rockTex.repeat.set(3, 2);

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: rockTex,
      roughness: 0.95,
      metalness: 0.0,
      envMapIntensity: 0.55,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.baseMesh = mesh;
    return mesh;
  }
}

/** Fine speckle / mottling for the ground so it reads as clay, not plastic. */
function makeGroundTexture(size = 512) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(77);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 2600; i++) {
    const x = rnd() * size, y = rnd() * size;
    const r = 1 + rnd() * 5;
    const a = 0.02 + rnd() * 0.05;
    ctx.fillStyle = rnd() > 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 1.6})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Horizontal strata + speckle for the rock pedestal. */
function makeRockTexture(size = 512) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(214);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 46; i++) {
    const y = rnd() * size;
    const h = 1 + rnd() * 7;
    const a = 0.03 + rnd() * 0.07;
    ctx.fillStyle = rnd() > 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 1.3})`;
    ctx.beginPath();
    ctx.ellipse(size / 2, y, size * 0.62, h, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 5200; i++) {
    const x = rnd() * size, y = rnd() * size;
    const r = 0.6 + rnd() * 2.8;
    const a = 0.03 + rnd() * 0.09;
    ctx.fillStyle = rnd() > 0.45 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
