import * as THREE from 'three';
import { shared } from './shared.js';
import { mulberry32, clamp, softCircleTexture } from './util.js';

/**
 * The cloud whale.
 *
 * Body: one parametric tube along the spine. The nose is closed by a small fan
 * and the girth profile falls to near zero there, so the head is a dome rather
 * than the flat disc a cylinder cap produces. Every look that matters
 * (translucency, internal veins, star core) is shading, so the silhouette stays
 * clean at any angle.
 */

export const WHALE = {
  length: 0.66,
  radius: 0.054,
  path: { rx: 0.150, rz: 0.108, y: 0.372 },
};

// girth profile: r goes to near-zero at the nose so the head is a dome, holds
// full width through the chest, then tapers into a laterally flattened peduncle
const GIRTH = [
  [0.000, 0.010, 0.012],
  [0.008, 0.180, 0.190],
  [0.020, 0.360, 0.380],
  [0.040, 0.545, 0.575],
  [0.070, 0.705, 0.740],
  [0.110, 0.835, 0.870],
  [0.160, 0.925, 0.955],
  [0.230, 0.985, 0.998],
  [0.300, 1.000, 1.000],
  [0.370, 0.980, 0.980],
  [0.450, 0.925, 0.940],
  [0.530, 0.840, 0.885],
  [0.610, 0.745, 0.830],
  [0.690, 0.640, 0.760],
  [0.760, 0.535, 0.680],
  [0.820, 0.440, 0.610],
  [0.870, 0.365, 0.545],
  [0.915, 0.315, 0.500],
  [0.955, 0.280, 0.470],
  [1.000, 0.255, 0.445],
];

function lerpKeys(keys, t, col) {
  if (t <= keys[0][0]) return keys[0][col];
  if (t >= keys[keys.length - 1][0]) return keys[keys.length - 1][col];
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t <= b[0]) {
      let u = (t - a[0]) / (b[0] - a[0]);
      u = u * u * (3 - 2 * u);
      return a[col] + (b[col] - a[col]) * u;
    }
  }
  return 0;
}

/** Spine rises slightly at the head, droops into the fluke. */
function spineY(t) {
  // a shallow S: the head drops a touch, the back arches up, the tail lifts
  return 0.030 * Math.exp(-Math.pow((t - 0.30) * 2.6, 2.0))
       - 0.030 * Math.exp(-Math.pow((t - 0.90) * 5.0, 2.0))
       - 0.020 * t;
}

const TAIL_AMP = 0.040;
const TAIL_PHASE = 5.0;
const TAIL_RATE = 1.0;
/** Swim wave: lateral offset of the body at body-coordinate t. */
function tailOffset(t, time) {
  return TAIL_AMP * Math.pow(t, 2.2) * Math.sin(t * TAIL_PHASE - time * TAIL_RATE);
}

const BODY_VERT = /* glsl */`
  uniform float uTime;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec2 vUv;
  varying float vCloud;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }

  void main() {
    vUv = uv;
    float t = uv.x;

    // Swim wave as a lateral shear. Normals are left unrotated on purpose: the
    // amplitude is a few millimetres, the error is invisible, and analytic
    // correction produced a visible crease at the peduncle.
    float amp = 0.040 * pow(t, 2.2);
    float off = amp * sin(t * 5.0 - uTime * 1.0);

    // Low-frequency lumpiness. This is what keeps the body from reading as a
    // machined solid: the silhouette gets a soft uneven edge like a cumulus.
    float lump = vnoise(vec3(t * 7.0 - uTime * 0.05, uv.y * 4.0, 1.7)) - 0.5;
    float lump2 = vnoise(vec3(t * 15.0, uv.y * 9.0, 5.1)) - 0.5;
    vCloud = lump * 0.7 + lump2 * 0.3;

    vec3 p = position + normal * (lump * 0.010 + lump2 * 0.004);
    p.z += off;

    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorld = wp.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const BODY_FRAG = /* glsl */`
  uniform float uTime;
  uniform float uBreath;
  uniform float uDay;
  uniform float uBack;
  uniform float uLimb;
  uniform float uOpacity;
  uniform vec3 uTintA;
  uniform vec3 uTintB;
  uniform vec3 uRim;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec2 vUv;
  varying float vCloud;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                   mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                   mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }

  void main() {
    vec3 N = normalize(vNormalW);
    if (!gl_FrontFacing) N = -N;
    vec3 V = normalize(cameraPosition - vWorld);
    float ndv = clamp(dot(N, V), 0.0, 1.0);
    // wide soft rim: this is what makes the shell read as glass-cloud
    float fres = pow(1.0 - ndv, 2.0);
    float rim = pow(1.0 - ndv, 4.0);

    // ---------- internal light veins ----------
    // Travelling waves warped by low-frequency noise so the light looks like
    // something circulating under the skin, not a scrolling texture.
    float journey = vUv.x * 8.0 - uTime * 0.50;
    float warp = vnoise(vec3(vUv.x * 4.0 - uTime * 0.06, vUv.y * 3.0, uTime * 0.05));
    float v1 = sin(journey + vUv.y * 6.2831 * 2.0 + warp * 3.6);
    v1 = pow(smoothstep(0.30, 1.0, v1 * 0.5 + 0.5), 2.0);
    float v2 = sin(journey * 0.63 - vUv.y * 6.2831 * 3.0 + warp * 5.2 + 1.9);
    v2 = pow(smoothstep(0.62, 1.0, v2 * 0.5 + 0.5), 2.6);

    float chest = exp(-pow((vUv.x - 0.24) * 2.6, 2.0));
    float pulse = 0.50 + 0.50 * uBreath;

    // cloud mottling: brighter pockets where the lump noise is high
    float mottle = smoothstep(-0.45, 0.55, vCloud) * 0.22 + 0.78;

    vec3 L = normalize(uSunDir);

    // Countershading: a deep indigo back, a pale luminous belly. Without this
    // the body shades as one flat white mass and reads as a zeppelin.
    float up = clamp(N.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 dorsal = uTintB * 0.34;
    vec3 ventral = mix(uTintA, vec3(0.90, 0.96, 1.0), 0.55);
    vec3 base = mix(ventral, dorsal, smoothstep(0.18, 0.92, up));

    float diff = clamp(dot(N, L) * 0.5 + 0.5, 0.0, 1.0);
    float diff2 = pow(diff, 1.6);

    vec3 col = base * (0.12 + 0.26 * uDay * diff2) * mottle;
    // cloud density banding: a couple of soft horizontal layers, like cirrus
    float band = vnoise(vec3(vUv.x * 3.4, vUv.y * 3.0 + vUv.y * 0.0, 3.3));
    col *= 0.90 + 0.20 * band;
    col += uTintA * diff2 * 0.22 * uDay;
    col += uTintA * v1 * (0.55 + 0.35 * pulse) * chest * 1.35;
    col += uRim * v2 * 0.22;
    col += uRim * fres * (0.42 + 0.22 * pulse) * 0.85;
    col += uRim * rim * 0.20;
    col += uSunColor * pow(max(dot(reflect(-V, N), L), 0.0), 22.0) * 0.14;

    // bioluminescent underside
    float under = 1.0 - smoothstep(-0.85, 0.15, N.y);
    col += uTintA * under * (0.18 + 0.14 * pulse);

    // ---------- anatomy ----------
    if (uLimb > 0.5) {
      // thin blades: brighter where the surface faces the key, plus a defined
      // trailing edge so the silhouette does not dissolve into the sky
      float fdiff = clamp(dot(N, normalize(uSunDir)) * 0.5 + 0.5, 0.0, 1.0);
      vec3 lcol = uTintA * 0.30 + uRim * (0.10 + 0.30 * fdiff) + uTintB * 0.16;
      float la = uOpacity * (0.16 + fres * 0.34 + rim * 0.18);
      gl_FragColor = vec4(lcol, clamp(la, 0.0, 0.66));
      return;
    }

    // uv.y runs 0 at the back, 0.25 at the right flank, 0.5 at the belly,
    // 0.75 at the left flank. Everything below is placed in that frame.
    // mouth: a crease that starts under the snout and sweeps back and down
    float mouthT = smoothstep(0.030, 0.055, vUv.x) * (1.0 - smoothstep(0.170, 0.235, vUv.x));
    float mouthY = 0.25 + 0.085 * smoothstep(0.05, 0.23, vUv.x) + 0.030;
    float mouth = mouthT * exp(-pow((vUv.y - mouthY) * 46.0, 2.0))
                + mouthT * exp(-pow(((1.0 - vUv.y) - mouthY) * 46.0, 2.0));
    col *= 1.0 - mouth * 0.55;

    // eye: one dark pit with a faint ring, at the flank just behind the mouth
    vec2 eyeUv = vec2(0.130, 0.285);
    float eyeD = length(vec2((vUv.x - eyeUv.x) * 1.35, vUv.y - eyeUv.y));
    // Only the flank that faces the camera shows an eye. Both are drawn, but the
    // far one is hidden by the body itself, which is what we want.
    float eye = 1.0 - smoothstep(0.003, 0.011, eyeD);
    col = mix(col, vec3(0.015, 0.025, 0.055), eye * 0.90);
    // lid: a faint cold highlight just outside the pupil
    float lid = (1.0 - smoothstep(0.011, 0.020, eyeD)) * smoothstep(0.010, 0.017, eyeD);
    col += uTintA * lid * 0.22;
    float eye2 = length(vec2((vUv.x - eyeUv.x) * 1.35, (1.0 - vUv.y) - eyeUv.y));
    float eyeB = 1.0 - smoothstep(0.003, 0.011, eye2);
    col = mix(col, vec3(0.015, 0.025, 0.055), eyeB * 0.90);
    col += uTintA * (1.0 - smoothstep(0.011, 0.020, eye2)) * smoothstep(0.010, 0.017, eye2) * 0.22;

    // throat grooves: lengthwise pleats on the belly, fading before the tail
    float grooveZone = smoothstep(0.045, 0.090, vUv.x) * (1.0 - smoothstep(0.400, 0.520, vUv.x));
    float bellyBand = exp(-pow((vUv.y - 0.5) * 7.0, 2.0));
    float grooves = sin((vUv.y - 0.5) * 190.0);
    grooves = pow(abs(grooves), 0.55);
    col *= 1.0 - grooves * grooveZone * bellyBand * 0.30;
    col += uTintA * (1.0 - grooves) * grooveZone * bellyBand * 0.10;

    // the tail dissolves: alpha falls away over the last stretch so the body
    // hands off to the mist instead of ending on a hard cut
    float dissolve = 1.0 - smoothstep(0.93, 1.0, vUv.x);

    // Base transparency stays low so the star core and rings read through,
    // while the rim keeps the wing-like silhouette visible.

    float alpha = uOpacity * (0.14 + fres * 0.26 + v1 * 0.11 * chest + rim * 0.16);
    if (uBack > 0.5) {
      col *= 0.72;
      alpha = uOpacity * (0.07 + fres * 0.20 + rim * 0.10);
    }
    alpha *= (0.74 + 0.26 * uDay);
    alpha *= mix(0.45, 1.0, dissolve);

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.82));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * Lens blade: leading edge at +x, chord runs -x, span runs +z, thickness in y.
 * Built flat in the XZ plane, so a fluke needs no base rotation at all.
 *
 * The outline is not a scaled rectangle: the chord keeps its width for the
 * first third, then falls away in a curve, and the span rounds off. That
 * combination is what reads as a limb rather than a sheet of plastic.
 */
function makeBlade(len, span, thick, sweep, tipTaper, rootNotch, droop = 0) {
  const NU = 22, NV = 9;
  const rowLen = NV * 2 + 1;
  const p = [], u = [], ix = [];

  for (let i = 0; i <= NU; i++) {
    const s = i / NU;
    // span: fast flare at the root, soft round-off at the tip
    const z = span * (1.0 - Math.pow(1.0 - s, 2.4)) * (1.0 - 0.06 * s * s);
    // chord: full width until ~0.30, then a smooth taper to a point
    const taperK = 1.0 - tipTaper * Math.pow(smoothstep(0.22, 1.0, s), 1.15);
    const notchK = rootNotch > 0 ? (0.50 + 0.50 * Math.pow(s, 0.45)) : 1.0;
    const chord = len * taperK * notchK;
    const thickK = thick * (1.0 - 0.72 * s);
    for (let k = 0; k < rowLen; k++) {
      const onTop = k <= NV;
      const c = (onTop ? k : rowLen - 1 - k) / NV;
      // leading edge sweeps back harder near the tip
      const x = -c * chord - sweep * Math.pow(s, 1.7);
      const bulge = Math.sin(Math.PI * c) * thickK * 0.5;
      // spanwise droop: a real flipper bends away from the body. A dead-straight
      // blade reads as an aircraft wing no matter how the outline is tapered.
      // droop is authored positive; the blade is built with +z as its span, so
      // the bend has to be subtracted in y to curve downward
      const bend = droop * Math.pow(s, 1.8);
      p.push(x, (onTop ? bulge : -bulge) + bend, z);
      u.push(c, s);
    }
  }
  for (let i = 0; i < NU; i++) {
    for (let k = 0; k < rowLen - 1; k++) {
      const a = i * rowLen + k, b = a + 1, c = a + rowLen, d = c + 1;
      ix.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
  g.setIndex(ix);
  g.computeVertexNormals();
  return g;
}

function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Whale fluke: one symmetric blade, wide spanwise, with the trailing edge
 * notched at the centre and swept tips. Built flat in XZ so it needs no base
 * rotation; the hinge is at the origin, on the leading edge.
 */
function makeFluke(halfSpan, rootChord, tipChord) {
  const NU = 26, NV = 12;
  const rowLen = NV * 2 + 1;
  const p = [], u = [], ix = [];
  const spread = halfSpan * 2;

  for (let i = 0; i <= NU; i++) {
    const s = i / NU;                             // 0 at centre, 1 at tip
    const z = s * halfSpan;
    // chord: widest around 3/4 out, short at the centre to cut the notch
    const chord = rootChord + (tipChord - rootChord) * Math.pow(s, 0.72);
    // sweeping the trailing edge back is what gives a fluke its arrow shape
    const sweep = 0.030 * Math.pow(s, 1.4);
    const droop = -0.016 * Math.pow(s, 1.6);
    for (let k = 0; k < rowLen; k++) {
      const onTop = k <= NV;
      const c = (onTop ? k : rowLen - 1 - k) / NV;
      const x = -c * chord - sweep;
      const bulge = Math.sin(Math.PI * c) * 0.0055 * (1.0 - 0.55 * s);
      p.push(x, (onTop ? bulge : -bulge) + droop, z * (0.94 + 0.06 * c));
      u.push(c, s);
    }
  }
  for (let i = 0; i < NU; i++) {
    for (let k = 0; k < rowLen - 1; k++) {
      const a = i * rowLen + k, b = a + 1, c = a + rowLen, d = c + 1;
      ix.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
  g.setIndex(ix);
  g.computeVertexNormals();
  return g;
}

function makeTailFin(halfSpan, rootChord, tipChord) {
  const group = new THREE.Group();
  [1, -1].forEach((s) => {
    const lobe = new THREE.Mesh(makeFluke(halfSpan, rootChord, tipChord), null);
    lobe.scale.z = s;
    lobe.renderOrder = 11;
    group.add(lobe);
  });
  return group;
}

export function buildWhale() {
  const group = new THREE.Group();
  const L = WHALE.length;
  const R = WHALE.radius;

  // ---------------------------------------------------------------- body
  const SEG_U = 150;
  const SEG_V = 48;

  const pos = [];
  const uv = [];
  const idx = [];

  for (let i = 0; i <= SEG_U; i++) {
    const t = i / SEG_U;
    const ry = lerpKeys(GIRTH, t, 1) * R;
    const rz = lerpKeys(GIRTH, t, 2) * R;
    const cx = (0.5 - t) * L;
    const cy = spineY(t);

    for (let j = 0; j <= SEG_V; j++) {
      const a = (j / SEG_V) * Math.PI * 2;
      const sn = Math.sin(a), cs = Math.cos(a);
      // belly is flatter than the back
      // The cross-section is an ellipse whose lower half is flatter; the
      // throat also widens a little around the chest, which is where a
      // humpback's pleats live.
      const chest = smoothstep(0.08, 0.30, t) * (1.0 - smoothstep(0.30, 0.55, t));
      // the last third narrows in x and stays tall in y: a compressed peduncle
      const peduncle = smoothstep(0.62, 0.94, t);
      const vy = cs > 0 ? cs * ry : cs * ry * (0.86 + 0.10 * chest);
      const vz = sn * rz * (1.0 + 0.05 * chest * (1.0 - Math.abs(cs))) * (1.0 - 0.34 * peduncle);
      pos.push(cx, cy + vy, vz);
      uv.push(t, j / SEG_V);
    }
  }
  const W = SEG_V + 1;
  for (let i = 0; i < SEG_U; i++) {
    for (let j = 0; j < SEG_V; j++) {
      const a = i * W + j, b = a + 1, c = a + W, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  // nose: the profile already tapers to ~0.02R, so this fan is a tiny dome
  const noseIdx = pos.length / 3;
  pos.push(0.5 * L + 0.002, spineY(0), 0);
  uv.push(0, 0.5);
  for (let j = 0; j < SEG_V; j++) idx.push(j, noseIdx, j + 1);
  // tail cap
  const tailIdx = pos.length / 3;
  pos.push(-0.5 * L, spineY(1), 0);
  uv.push(1, 0.5);
  const base = SEG_U * W;
  for (let j = 0; j < SEG_V; j++) idx.push(base + j + 1, tailIdx, base + j);

  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bodyGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  bodyGeo.setIndex(idx);
  bodyGeo.computeVertexNormals();

  const bodyUniforms = {
    ...shared,
    uLimb: { value: 0.0 },
    uOpacity: { value: 1.0 },
    uTintA: { value: new THREE.Color('#8ec6ff') },
    uTintB: { value: new THREE.Color('#4a52b4') },
    uRim: { value: new THREE.Color('#d8d2ff') },
  };

  const backMat = new THREE.ShaderMaterial({
    uniforms: { ...bodyUniforms, uBack: { value: 1 } },
    vertexShader: BODY_VERT,
    fragmentShader: BODY_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
  });
  const frontMat = new THREE.ShaderMaterial({
    uniforms: { ...bodyUniforms, uBack: { value: 0 } },
    vertexShader: BODY_VERT,
    fragmentShader: BODY_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });

  const bodyBack = new THREE.Mesh(bodyGeo, backMat);
  bodyBack.renderOrder = 10;
  bodyBack.frustumCulled = false;
  const bodyFront = new THREE.Mesh(bodyGeo, frontMat);
  bodyFront.renderOrder = 12;
  bodyFront.frustumCulled = false;
  group.add(bodyBack, bodyFront);

  // ---------------------------------------------------------------- cloud shell
  // Soft puffs riding on the body surface. The mesh alone always reads as a
  // smooth balloon no matter how the shader is tuned; these billows are what
  // give the whale its cumulus edge and let it dissolve into the air at the
  // flanks. They are children of the group so they inherit the swim motion.
  const puffTex = softCircleTexture(256, 0.0, '196,222,255');
  const shell = [];
  const srng = mulberry32(6161);
  const SHELL_N = 34;
  for (let i = 0; i < SHELL_N; i++) {
    // sample along the body, avoiding the very nose and the thin peduncle
    const t = 0.06 + srng() * 0.80;
    const ry = lerpKeys(GIRTH, t, 1) * R;
    const rz = lerpKeys(GIRTH, t, 2) * R;
    const ang = srng() * Math.PI * 2;
    const cx = (0.5 - t) * L;
    const cy = spineY(t) + Math.cos(ang) * ry * (0.72 + srng() * 0.34);
    const cz = Math.sin(ang) * rz * (0.78 + srng() * 0.40);

    const mat = new THREE.SpriteMaterial({
      map: puffTex, transparent: true, opacity: 0,
      blending: THREE.NormalBlending, depthWrite: false,
      color: new THREE.Color('#cfe4ff'),
    });
    const sp = new THREE.Sprite(mat);
    sp.position.set(cx, cy, cz);
    // bigger toward the head/back, tiny toward the tail
    const base = (0.030 + srng() * 0.030) * (0.55 + 0.75 * Math.sin(Math.PI * Math.min(1, t * 1.15)));
    sp.scale.set(base, base * (0.72 + srng() * 0.4), 1);
    sp.renderOrder = srng() < 0.5 ? 9 : 13;
    sp.userData = {
      base, ph: srng() * Math.PI * 2, spin: (srng() - 0.5) * 0.5,
      local: new THREE.Vector3(cx, cy, cz),
      amp: 0.6 + srng() * 0.8,
    };
    group.add(sp);
    shell.push(sp);
  }

  // ---------------------------------------------------------------- limbs
  const limbMat = new THREE.ShaderMaterial({
    uniforms: { ...bodyUniforms, uBack: { value: 0 }, uLimb: { value: 1 } },
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying vec2 vUv;
      varying float vCloud;
      void main() {
        vUv = uv;
        vCloud = 0.0;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: BODY_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const fins = [];
  const finGeo = makeBlade(0.056, 0.150, 0.009, 0.088, 0.82, 0.0, 0.030);
  [1, -1].forEach((s) => {
    // Mirror with scale.z, not a rotation: rotating would swing the swept-back
    // leading edge forward and the fin reads as a broken wing.
    const fin = new THREE.Mesh(finGeo, limbMat);
    fin.position.set(0.128, spineY(0.30) - 0.032, s * 0.024);
    // Span runs +z. x-rotation tips the blade down, y-rotation sweeps it back;
    // both must flip with the side or the left fin points up and forward.
    // span points +z; positive x-rotation on the right side throws the tip OUT
    // and slightly down. Negative x on the left. -0.55 tips it clearly below the
    // belly line while keeping the sweep back.
    // -0.30 rad about x: tips drop just below the belly line without the
    // legs-of-a-jellyfish look a steeper angle produces from the front
    fin.rotation.set(-s * 0.30, s * 0.55, 0);
    fin.scale.z = s;
    fin.renderOrder = 11;
    group.add(fin);
    fins.push(fin);
  });

  // dorsal fin: blade span (+z) rotated to point up
  const dorsal = new THREE.Mesh(makeBlade(0.040, 0.056, 0.006, 0.036, 0.88, 0, 0.012), limbMat);
  dorsal.position.set(-0.058, spineY(0.66) + 0.010, 0);
  dorsal.rotation.x = -Math.PI / 2 + 0.80;
  dorsal.rotation.y = 0.42;
  dorsal.renderOrder = 11;
  group.add(dorsal);

  // flukes: blades already lie flat in XZ, so no base rotation is needed
  const fluke = makeTailFin(0.092, 0.022, 0.078);
  fluke.position.set(-0.5 * L + 0.004, spineY(1), 0);
  fluke.traverse((o) => { if (o.isMesh) o.material = limbMat; });
  group.add(fluke);

  // ---------------------------------------------------------------- star core
  const core = new THREE.Group();
  core.position.set(0.075, spineY(0.27), 0);
  group.add(core);

  const coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softCircleTexture(256, 0.05, '205,228,255'),
    transparent: true, opacity: 0.55,
    blending: THREE.AdditiveBlending, depthWrite: false,
    color: new THREE.Color('#cfe2ff'),
  }));
  coreGlow.scale.setScalar(0.055);
  coreGlow.renderOrder = 11;
  core.add(coreGlow);

  const coreInner = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softCircleTexture(128, 0.10, '255,255,255'),
    transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false,
    color: new THREE.Color('#f4f8ff'),
  }));
  coreInner.scale.setScalar(0.021);
  coreInner.renderOrder = 11;
  core.add(coreInner);

  // three orbital rings — a tiny orrery trapped in the chest
  const rings = [];
  const ringColors = ['#b9d2ff', '#d3c2ff', '#a4e8e6'];
  for (let i = 0; i < 3; i++) {
    const r = 0.019 + i * 0.007;
    const g = new THREE.TorusGeometry(r, 0.0009, 4, 72);
    const m = new THREE.MeshBasicMaterial({
      color: new THREE.Color(ringColors[i]),
      transparent: true, opacity: 0.26 - i * 0.04,
      blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(g, m);
    ring.rotation.set(0.6 + i * 0.7, i * 0.9, i * 0.5);
    ring.renderOrder = 11;
    core.add(ring);
    rings.push(ring);
  }

  // stardust held inside the body
  const DUST = 230;
  const dustPos = new Float32Array(DUST * 3);
  const dustBase = [];
  const drng = mulberry32(7712);
  for (let i = 0; i < DUST; i++) {
    const a = drng() * Math.PI * 2;
    const b = Math.acos(drng() * 2 - 1);
    const rr = Math.pow(drng(), 0.55);
    dustBase.push({
      x: Math.sin(b) * Math.cos(a) * 0.16 * rr,
      y: Math.cos(b) * 0.030 * rr,
      z: Math.sin(b) * Math.sin(a) * 0.038 * rr,
      ph: drng() * Math.PI * 2,
      sp: 0.28 + drng() * 0.5,
    });
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    map: softCircleTexture(64, 0.02, '225,238,255'),
    size: 0.0042, transparent: true, opacity: 0.75,
    depthWrite: false, blending: THREE.AdditiveBlending,
    color: new THREE.Color('#dfe9ff'), sizeAttenuation: true,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.renderOrder = 11;
  dust.frustumCulled = false;
  group.add(dust);

  // ---------------------------------------------------------------- tail mist
  // World-space sprites, returned separately: they must stay behind when the
  // whale moves on, which is the whole point of a trail.
  const mistTex = softCircleTexture(256, 0.0, '210,228,255');
  const trailMist = [];
  const mrng = mulberry32(3351);
  for (let i = 0; i < 34; i++) {
    const mat = new THREE.SpriteMaterial({
      map: mistTex, transparent: true, opacity: 0,
      blending: THREE.NormalBlending, depthWrite: false,
      color: new THREE.Color('#d2e2ff'),
    });
    const sp = new THREE.Sprite(mat);
    sp.renderOrder = 9;
    sp.scale.setScalar(0.05);
    sp.userData = { life: (i / 34) * 4.6, max: 4.2 + mrng() * 2.4, seed: mrng() };
    trailMist.push(sp);
  }

  // ---------------------------------------------------------------- update
  const pathPos = new THREE.Vector3();
  const pathAhead = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const prevPos = new THREE.Vector3();
  const tailWorld = new THREE.Vector3();
  let initialised = false;
  let yaw = 0;
  let roll = 0;

  function pathAt(t, out) {
    const a = t * 0.215;
    out.set(
      Math.cos(a) * WHALE.path.rx + Math.sin(a * 2.3) * 0.022,
      WHALE.path.y + Math.sin(a * 1.7 + 0.6) * 0.020,
      Math.sin(a * 1.15) * WHALE.path.rz + Math.sin(a * 0.7) * 0.036
    );
    return out;
  }

  return {
    group,
    core,
    trailMist,
    update(dt, t) {
      const breath = 0.5 + 0.5 * Math.sin(t * 0.62);
      shared.uBreath.value = breath;

      pathAt(t, pathPos);
      pathAt(t + 0.10, pathAhead);
      tangent.subVectors(pathAhead, pathPos).normalize();

      if (!initialised) { prevPos.copy(pathPos); initialised = true; }
      const velY = (pathPos.y - prevPos.y) / Math.max(dt, 1e-3);
      prevPos.copy(pathPos);

      group.position.copy(pathPos);
      group.position.y += Math.sin(t * 0.9) * 0.003;

      const targetYaw = Math.atan2(-tangent.z, tangent.x);
      let dYaw = targetYaw - yaw;
      while (dYaw > Math.PI) dYaw -= Math.PI * 2;
      while (dYaw < -Math.PI) dYaw += Math.PI * 2;
      yaw += dYaw * Math.min(1, dt * 1.6);
      group.rotation.y = yaw;

      // pitch with climb, roll into the turn: both tiny; this animal is calm
      const targetRoll = clamp(-dYaw * 2.2, -0.10, 0.10);
      roll += (targetRoll - roll) * Math.min(1, dt * 1.2);
      group.rotation.z = clamp(-velY * 0.9, -0.12, 0.12);
      group.rotation.x = roll;

      shared.uWhalePos.value.copy(group.position);

      // core pulse + rings
      const p = 0.58 + 0.42 * breath;
      coreGlow.material.opacity = 0.45 + 0.35 * p;
      coreGlow.scale.setScalar(0.072 + 0.020 * p);
      coreInner.material.opacity = 0.45 + 0.35 * p;
      rings.forEach((r, i) => {
        r.rotation.z += dt * (0.09 + i * 0.035) * (i % 2 ? -1 : 1);
        r.rotation.x += dt * 0.024;
        r.material.opacity = (0.18 + 0.14 * p) * (i === 0 ? 1 : 0.76);
      });

      // stardust drifts around the core
      for (let i = 0; i < DUST; i++) {
        const b = dustBase[i];
        const a = b.ph + t * 0.14 * b.sp;
        dustPos[i * 3] = Math.cos(a) * b.x - Math.sin(a) * b.z * 1.4;
        dustPos[i * 3 + 1] = b.y + Math.sin(t * 0.5 + b.ph) * 0.004;
        dustPos[i * 3 + 2] = Math.sin(a) * b.z * 1.4 + Math.cos(a) * b.x * 0.5;
      }
      dustGeo.attributes.position.needsUpdate = true;
      dustMat.opacity = 0.30 + 0.22 * p;

      // cloud shell: slow independent swell, strongest on the far side
      shell.forEach((sp) => {
        const u = sp.userData;
        const k = 0.55 + 0.45 * Math.sin(t * 0.55 + u.ph) * u.amp;
        sp.material.opacity = (0.055 + 0.075 * breath) * k;
        const s2 = u.base * (0.85 + 0.35 * k);
        sp.scale.set(s2, s2 * 0.85, 1);
      });

      // fins breathe with the body
      fins.forEach((f, i) => {
        const base = i === 0 ? 0.42 : -0.42;
        f.rotation.x = base + Math.sin(t * 0.5 + i * 2.0) * 0.09;
      });
      dorsal.rotation.z = Math.sin(t * 0.4) * 0.04;

      // fluke swings in phase with the shader tail
      const off = tailOffset(1, t);
      const tailPhase = TAIL_PHASE - t * TAIL_RATE;
      fluke.position.z = off;
      // the tips sit on ±z, so a vertical beat is a rotation about x. Rotating
      // about y here would sweep the flukes sideways like a rudder.
      fluke.rotation.x = Math.sin(tailPhase) * 0.34;
      fluke.rotation.y = Math.cos(tailPhase) * 0.10;

      // mist trail recycled in world space
      group.updateMatrixWorld();
      tailWorld.set(-0.5 * L, spineY(1), off).applyMatrix4(group.matrixWorld);
      trailMist.forEach((sp) => {
        const u = sp.userData;
        u.life += dt;
        if (u.life > u.max) {
          u.life = 0;
          sp.position.copy(tailWorld);
          // puffs are seeded slightly behind the animal so the wake grows
          // outward from the fluke instead of stacking on one point
          sp.position.x -= 0.020 + Math.random() * 0.055;
          sp.position.x += (Math.random() - 0.5) * 0.030;
          sp.position.y += (Math.random() - 0.5) * 0.026;
          sp.position.z += (Math.random() - 0.5) * 0.026;
        }
        const k = u.life / u.max;
        // fade in fast, hold, then dissolve; the peak lands early so the
        // freshest puff is the brightest and the wake reads as trailing off
        const fade = Math.sin(Math.PI * Math.min(1, k * 1.15));
        sp.material.opacity = 0.26 * fade * (1 - k * 0.25);
        const sc = 0.045 + k * 0.165;
        sp.scale.set(sc, sc * 0.82, 1);
      });
    },
  };
}
