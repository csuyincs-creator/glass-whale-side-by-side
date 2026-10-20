import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ImprovedNoise } from 'three/addons/math/ImprovedNoise.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* =====================================================================
   Helpers
   ===================================================================== */
let seed = 20261020;
function rand() {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rr = (a, b) => a + (b - a) * rand();
const perlin = new ImprovedNoise();
function fbm(x, z, oct = 4, off = 0) {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < oct; i++) {
    s += a * perlin.noise(x * f + off, off * 0.37 + i * 7.13, z * f - off);
    a *= 0.5; f *= 2.03;
  }
  return s;
}
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function distSeg(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
function distPoly(x, z, pts) {
  let m = 1e9;
  for (let i = 0; i < pts.length - 1; i++) m = Math.min(m, distSeg(x, z, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  return m;
}
const C = (hex) => new THREE.Color(hex);

const NOISE_GLSL = /* glsl */`
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
float fbm3(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<5;i++){ s+=a*snoise(p); p*=2.02; a*=0.5; } return s; }
`;

const SPRITE_FRAG = /* glsl */`
varying vec3 vCol; varying float vA; varying float vSharp;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d2 = dot(c,c)*4.0;
  if(d2 > 1.0 || vA <= 0.0) discard;
  float a = (exp(-d2*vSharp) - exp(-vSharp)) / (1.0 - exp(-vSharp));
  gl_FragColor = vec4(vCol, a*vA);
}`;

/* =====================================================================
   Renderer, scene, camera
   ===================================================================== */
const PR = Math.min(window.devicePixelRatio || 1, 1.5);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(PR);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(28, innerWidth / innerHeight, 0.1, 600);
camera.position.set(22.5, 15.5, 15.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, -0.2, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enablePan = false;
controls.minDistance = 13;
controls.maxDistance = 70;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.22;

/* ---------- side-by-side embedding ----------
   The host owns yaw/pitch/zoom and pushes them here, so this copy hands over
   camera control entirely: no local input, no auto-rotate, and no damping
   (damping would make the two panels settle at different times). */
const EMBED = window.__EMBED__ === true;
const CUBE_TARGET = new THREE.Vector3(0, -0.2, 0);
const CUBE_HALF_DIAG = Math.sqrt(3) * 5;      // S = 10
const FOV = 28;
// The host normalises framing with a reference fov; see the host's k mapping.
const FOV_REF = 27;
const FOV_COMP = Math.tan(FOV_REF * Math.PI / 360) / Math.tan(FOV * Math.PI / 360);

if (EMBED) {
  controls.enabled = false;
  controls.enableDamping = false;
  controls.autoRotate = false;
  // apply() takes the same units the host uses for both scenes: yaw/pitch in
  // radians, k = camera distance / cube half-diagonal.
  window.__view = {
    side: 'left',
    fov: FOV,
    halfDiag: CUBE_HALF_DIAG,
    camera,
    apply(yaw, pitch, k) {
      const dist = CUBE_HALF_DIAG * k * FOV_COMP;
      const cp = Math.cos(pitch);
      camera.position.set(
        CUBE_TARGET.x + Math.sin(yaw) * cp * dist,
        CUBE_TARGET.y + Math.sin(pitch) * dist,
        CUBE_TARGET.z + Math.cos(yaw) * cp * dist
      );
      camera.lookAt(CUBE_TARGET);
    },
  };
}

const U = {
  uTime: { value: 0 },
  uBreath: { value: 0.5 },
  uViewH: { value: innerHeight * PR },
  uPR: { value: PR },
};


/* =====================================================================
   Cosmic void background
   ===================================================================== */
{
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(260, 64, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { uTime: U.uTime },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: NOISE_GLSL + `
        varying vec3 vDir; uniform float uTime;
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y*0.5 + 0.5;
          vec3 col = mix(vec3(0.0025,0.003,0.010), vec3(0.008,0.011,0.032), smoothstep(0.1,0.9,h));
          float n  = fbm3(d*1.9 + vec3(0.0,0.0,uTime*0.003));
          float n2 = fbm3(d*4.2 + 7.1);
          float neb = smoothstep(0.05, 0.75, n*0.7 + 0.35);
          vec3 nebCol = mix(vec3(0.075,0.05,0.17), vec3(0.02,0.07,0.15), n2*0.5+0.5);
          col += nebCol * neb * 0.30;
          col += vec3(0.16,0.05,0.07) * pow(max(n2,0.0), 3.0) * 0.18;
          gl_FragColor = vec4(col, 1.0);
        }`,
    })
  );
  scene.add(sky);

  const N = 2600;
  const pos = new Float32Array(N * 3), size = new Float32Array(N), col = new Float32Array(N * 3), rnd = new Float32Array(N);
  const tints = [C('#cfd8ff'), C('#ffffff'), C('#b9c6ff'), C('#ffd6e0'), C('#a8f0ff')];
  for (let i = 0; i < N; i++) {
    const u = rand() * 2 - 1, th = rand() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    pos.set([Math.cos(th) * s * 200, u * 200, Math.sin(th) * s * 200], i * 3);
    size[i] = 0.7 + Math.pow(rand(), 7) * 5.5;
    const c = tints[Math.floor(rand() * tints.length)];
    col.set([c.r, c.g, c.b], i * 3);
    rnd[i] = rand();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
  const stars = new THREE.Points(g, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: U.uTime, uPR: U.uPR },
    vertexShader: `
      attribute float aSize; attribute vec3 aCol; attribute float aRnd;
      uniform float uTime, uPR; varying vec3 vCol; varying float vA; varying float vSharp;
      void main(){
        gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);
        float tw = 0.65 + 0.35*sin(uTime*(0.4+aRnd*1.8) + aRnd*60.0);
        gl_PointSize = aSize*uPR*2.2;
        vCol = aCol; vA = tw * (aSize > 3.0 ? 0.28 : 0.55); vSharp = aSize > 3.0 ? 2.5 : 6.0;
      }`,
    fragmentShader: SPRITE_FRAG,
  }));
  stars.frustumCulled = false;
  scene.add(stars);

  // a faint aura beneath the floating cube
  const aura = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec2 vP; void main(){ float r = length(vP); vec3 c = mix(vec3(0.18,0.20,0.55), vec3(0.30,0.18,0.45), smoothstep(2.0,12.0,r)); gl_FragColor = vec4(c*exp(-r*r*0.018)*0.08, 1.0); }`,
  }));
  aura.position.y = -7.4;
  scene.add(aura);
}

/* =====================================================================
   Lights
   ===================================================================== */
scene.add(new THREE.HemisphereLight(0x5a68b8, 0x1b1230, 1.15));
const moon = new THREE.DirectionalLight(0xd4dcff, 2.3);
moon.position.set(-10, 14, 1.5);
moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 45 });
moon.shadow.bias = -0.0004;
moon.shadow.normalBias = 0.02;
scene.add(moon);
const rimLight = new THREE.DirectionalLight(0x9a80ff, 1.6);
rimLight.position.set(-8, 5, -9);
scene.add(rimLight);
const dawn = new THREE.DirectionalLight(0xff9c8c, 0.45);
dawn.position.set(3, 1.5, -10);
scene.add(dawn);

/* =====================================================================
   The cube and its contents
   ===================================================================== */
const S = 10, HS = S / 2;
const cube = new THREE.Group();
scene.add(cube);

// ---------- glass
function glassMaterial(side, gain) {
  return new THREE.ShaderMaterial({
    side, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: U.uTime, uHS: { value: HS }, uGain: { value: gain } },
    vertexShader: `
      varying vec3 vW; varying vec3 vN; varying vec3 vL;
      void main(){ vL = position; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `
      uniform float uTime, uHS, uGain; varying vec3 vW; varying vec3 vN; varying vec3 vL;
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        vec3 N = normalize(vN); if(!gl_FrontFacing) N = -N;
        float ndv = abs(dot(N,V));
        float fres = pow(1.0 - ndv, 4.0);
        vec3 a = uHS - abs(vL);
        float edge = a.x + a.y + a.z - min(a.x,min(a.y,a.z)) - max(a.x,max(a.y,a.z));
        float edgeGlow = exp(-edge*14.0)*0.16 + exp(-edge*2.5)*0.015;
        vec3 rainbow = 0.5 + 0.5*cos(6.2831*(vec3(0.0,0.33,0.67) + fres*1.6 + dot(vW, vec3(0.05,0.03,0.04)) + uTime*0.015));
        vec3 silver = vec3(0.74,0.80,0.96);
        float band = dot(vW, normalize(vec3(1.0,0.6,-0.8)))*0.11 - uTime*0.025;
        float sheen = pow(1.0 - abs(fract(band)-0.5)*2.0, 22.0);
        vec3 L = normalize(vec3(-10.0,14.0,1.5));
        float spec = pow(max(dot(N, normalize(L+V)),0.0), 260.0);
        vec3 col = silver*0.010
                 + fres*mix(silver, rainbow, 0.5)*0.2
                 + edgeGlow*mix(silver, rainbow, 0.22)
                 + rainbow*edgeGlow*fres*0.6
                 + sheen*0.045*mix(silver, rainbow, 0.4)
                 + spec*silver*1.2;
        gl_FragColor = vec4(col*uGain, 1.0);
      }`,
  });
}
{
  const box = new THREE.BoxGeometry(S, S, S);
  const back = new THREE.Mesh(box, glassMaterial(THREE.BackSide, 0.55));
  const front = new THREE.Mesh(box, glassMaterial(THREE.FrontSide, 1.0));
  back.renderOrder = 10; front.renderOrder = 11;
  cube.add(back, front);

  const metal = new THREE.MeshStandardMaterial({
    color: 0xb4bcdc, metalness: 0.35, roughness: 0.38,
    emissive: 0x404a80, emissiveIntensity: 0.3,
  });
  const T = 0.05;
  const geoX = new THREE.BoxGeometry(S + T, T, T), geoY = new THREE.BoxGeometry(T, S + T, T), geoZ = new THREE.BoxGeometry(T, T, S + T);
  for (const a of [-HS, HS]) for (const b of [-HS, HS]) {
    const ex = new THREE.Mesh(geoX, metal); ex.position.set(0, a, b);
    const ey = new THREE.Mesh(geoY, metal); ey.position.set(a, 0, b);
    const ez = new THREE.Mesh(geoZ, metal); ez.position.set(a, b, 0);
    cube.add(ex, ey, ez);
  }
  const capGeo = new THREE.SphereGeometry(0.075, 16, 12);
  for (const x of [-HS, HS]) for (const y of [-HS, HS]) for (const z of [-HS, HS]) {
    const cap = new THREE.Mesh(capGeo, metal); cap.position.set(x, y, z); cube.add(cap);
  }
}

/* =====================================================================
   Island generator
   ===================================================================== */
const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.94, metalness: 0, side: THREE.DoubleSide });
const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.05, side: THREE.DoubleSide });

const cSoil = C('#3a2d3e'), cRockA = C('#232239'), cRockB = C('#4a4466'), cMoss = C('#2f5650');

function buildIsland({ R, rimNoise = 0.06, off = 0, height, color, depth = 1.6, rings = 56, segs = 168 }) {
  const group = new THREE.Group();
  const rimR = [];
  for (let j = 0; j < segs; j++) {
    const th = j / segs * Math.PI * 2;
    rimR.push(R * (1 + rimNoise * 2 * fbm(Math.cos(th) * 1.2 + off, Math.sin(th) * 1.2 + off * 0.7, 3)));
  }
  const rimAt = (th) => {
    const f = ((th / (Math.PI * 2)) % 1 + 1) % 1 * segs, j0 = Math.floor(f) % segs, j1 = (j0 + 1) % segs;
    return lerp(rimR[j0], rimR[j1], f - Math.floor(f));
  };

  // top surface
  const pos = [], col = [], idx = [];
  const c = new THREE.Color(), e = 0.03;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    for (let j = 0; j < segs; j++) {
      const th = j / segs * Math.PI * 2, r = Math.max(t, 0.002) * rimR[j];
      const x = Math.cos(th) * r, z = Math.sin(th) * r, h = height(x, z, t);
      const hx = (height(x + e, z, t) - height(x - e, z, t)) / (2 * e);
      const hz = (height(x, z + e, t) - height(x, z - e, t)) / (2 * e);
      color(x, z, h, Math.hypot(hx, hz), t, c);
      pos.push(x, h, z); col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = i * segs + j, b = i * segs + (j + 1) % segs, cc = (i + 1) * segs + j, d = (i + 1) * segs + (j + 1) % segs;
    idx.push(a, b, cc, b, d, cc);
  }
  const topGeo = new THREE.BufferGeometry();
  topGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  topGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  topGeo.setIndex(idx);
  topGeo.computeVertexNormals();
  const top = new THREE.Mesh(topGeo, terrainMat);
  top.castShadow = true; top.receiveShadow = true;
  group.add(top);

  // rocky underside: an inverted, jagged mountain
  const K = 26, upos = [], ucol = [], uidx = [], under = [];
  for (let k = 0; k <= K; k++) {
    const t = k / K;
    for (let j = 0; j < segs; j++) {
      const th = j / segs * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
      const R0 = rimR[j], topY = height(cs * R0, sn * R0, 1);
      const nz = fbm(cs * 1.9 + off * 1.3, sn * 1.9 + t * 2.8, 4, off);
      let r = R0 * Math.pow(1 - t, 0.85) * (k > 0 ? 1 + 0.24 * nz * Math.sin(Math.PI * Math.min(1, t * 1.15)) : 1);
      if (k === K) r = 0;
      const y = k === 0 ? topY : lerp(topY - 0.16, -depth, Math.pow(t, 1.1)) + 0.5 * nz * t * (1 - t);
      upos.push(cs * r, y, sn * r);
      // strata colouring
      c.copy(cRockA).lerp(cRockB, 0.5 + 0.5 * Math.sin(y * 9 + nz * 5));
      c.multiplyScalar(0.55 + 0.45 * (1 - t));
      if (k <= 1) c.copy(cSoil);
      if (k === 2) c.lerp(cMoss, 0.5);
      ucol.push(c.r, c.g, c.b);
      if (k > 2 && k < K - 3) under.push({ x: cs * r, y, z: sn * r, t });
    }
  }
  for (let k = 0; k < K; k++) for (let j = 0; j < segs; j++) {
    const a = k * segs + j, b = k * segs + (j + 1) % segs, cc = (k + 1) * segs + j, d = (k + 1) * segs + (j + 1) % segs;
    uidx.push(a, cc, b, b, cc, d);
  }
  const ug = new THREE.BufferGeometry();
  ug.setAttribute('position', new THREE.Float32BufferAttribute(upos, 3));
  ug.setAttribute('color', new THREE.Float32BufferAttribute(ucol, 3));
  ug.setIndex(uidx);
  ug.computeVertexNormals();
  const underMesh = new THREE.Mesh(ug, rockMat);
  underMesh.castShadow = true; underMesh.receiveShadow = true;
  group.add(underMesh);

  return { group, height, rimAt, under, R };
}

/* ---------- miniature props (trees, crystals, animals) ---------- */
function paint(g, color) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([color.r, color.g, color.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
function merge(parts) {
  return mergeGeometries(parts.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    if (ng.attributes.uv) ng.deleteAttribute('uv');
    return ng;
  }));
}
const WHITE = C('#ffffff');
const pineGeo = (() => {
  const parts = [paint(new THREE.CylinderGeometry(0.01, 0.014, 0.07, 5).translate(0, 0.035, 0), C('#4a3b3b'))];
  for (let i = 0; i < 3; i++) parts.push(paint(new THREE.ConeGeometry(0.075 - i * 0.017, 0.13, 7).translate(0, 0.09 + i * 0.058, 0), WHITE));
  return merge(parts);
})();
const roundGeo = (() => {
  const parts = [paint(new THREE.CylinderGeometry(0.011, 0.016, 0.11, 5).translate(0, 0.055, 0), C('#4a3b3b'))];
  parts.push(paint(new THREE.IcosahedronGeometry(0.085, 1).scale(1, 0.9, 1).translate(0, 0.16, 0), WHITE));
  parts.push(paint(new THREE.IcosahedronGeometry(0.06, 1).translate(0.05, 0.2, 0.02), WHITE));
  parts.push(paint(new THREE.IcosahedronGeometry(0.055, 1).translate(-0.045, 0.19, -0.03), WHITE));
  return merge(parts);
})();
const foliageMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, flatShading: true });

function makeForest(parent, items) {
  for (const [type, geo] of [['pine', pineGeo], ['round', roundGeo]]) {
    const arr = items.filter((it) => it.type === type);
    if (!arr.length) continue;
    const m = new THREE.InstancedMesh(geo, foliageMat, arr.length);
    const d = new THREE.Object3D();
    arr.forEach((it, i) => {
      d.position.set(it.x, it.y, it.z); d.rotation.set(rr(-0.05, 0.05), rr(0, 6.28), rr(-0.05, 0.05)); d.scale.setScalar(it.s);
      d.updateMatrix(); m.setMatrixAt(i, d.matrix); m.setColorAt(i, it.color);
    });
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m);
  }
}

const crystalGeo = new THREE.OctahedronGeometry(1, 0).scale(0.045, 0.17, 0.045).translate(0, 0.12, 0);
const crystalMats = [
  new THREE.MeshStandardMaterial({ color: 0x9fe6ff, emissive: 0x47c4ff, emissiveIntensity: 1.6, roughness: 0.15, metalness: 0.1 }),
  new THREE.MeshStandardMaterial({ color: 0xc9b8ff, emissive: 0x8f6bff, emissiveIntensity: 1.5, roughness: 0.15, metalness: 0.1 }),
];
function addCrystals(island, count) {
  const d = new THREE.Object3D(), up = new THREE.Vector3(0, 1, 0);
  const meshes = crystalMats.map((m) => new THREE.InstancedMesh(crystalGeo, m, count));
  const n = [0, 0];
  for (let i = 0; i < count; i++) {
    const p = island.under[Math.floor(rand() * island.under.length)];
    const k = rand() < 0.65 ? 0 : 1;
    const dir = new THREE.Vector3(p.x, -0.9 - rand() * 0.6, p.z).normalize();
    d.position.set(p.x * 0.97, p.y, p.z * 0.97);
    d.quaternion.setFromUnitVectors(up, dir);
    d.scale.setScalar(rr(0.6, 1.6));
    d.updateMatrix();
    meshes[k].setMatrixAt(n[k]++, d.matrix);
  }
  meshes.forEach((m, k) => { m.count = n[k]; island.group.add(m); });
}

// generic glowing points (lanterns, springs)
function makeGlows(parent, list) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(list.flatMap((l) => l.p), 3));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(list.flatMap((l) => [l.c.r, l.c.g, l.c.b]), 3));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(list.map((l) => l.s), 1));
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: U.uTime, uBreath: U.uBreath, uViewH: U.uViewH },
    vertexShader: `
      attribute vec3 aCol; attribute float aSize; uniform float uTime, uBreath, uViewH;
      varying vec3 vCol; varying float vA; varying float vSharp;
      void main(){
        vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv;
        gl_PointSize = aSize*uViewH*projectionMatrix[1][1]*0.5/max(-mv.z,0.01);
        vCol = aCol; vA = 0.75 + 0.25*sin(uTime*1.7 + position.x*9.0) + 0.2*uBreath; vSharp = 3.2;
      }`,
    fragmentShader: SPRITE_FRAG,
  }));
  pts.frustumCulled = false;
  parent.add(pts);
}

/* =====================================================================
   Main island: meadows, forest, mountain, lake, river, waterfall
   ===================================================================== */
const MAIN_Y = -2.35;
const lakeC = { x: 1.05, z: 0.85 }, lakeR = 1.05;
const riverIn = [[-1.45, -1.05], [-1.05, -0.55], [-0.8, 0.02], [-0.35, 0.42], [0.15, 0.55], [0.55, 0.72]];
const FALL_TH = Math.PI / 4;
// the outflow ends at the rim, so its last point is filled in after the rim is known
const riverOut = [[1.75, 1.35], [2.1, 1.72], [2.3, 2.1], [2.5, 2.42]];
const RIM_GUESS = 3.95;
riverOut.push([Math.cos(FALL_TH) * (RIM_GUESS + 0.3), Math.sin(FALL_TH) * (RIM_GUESS + 0.3)]);

function mainHeight(x, z, t) {
  let h = 0.17 + 0.3 * fbm(x * 0.33 + 3.1, z * 0.33 - 1.7, 5, 1.0);
  const mx = x + 1.95, mz = z + 1.85, md2 = mx * mx + mz * mz;
  const ridge = 1 - Math.abs(fbm(x * 0.95, z * 0.95, 3, 5.0)) * 1.3;
  h += 1.85 * Math.exp(-md2 / 1.2) * (0.72 + 0.38 * ridge);
  h += 0.55 * Math.exp(-((x - 1.7) ** 2 + (z + 1.7) ** 2) / 0.9);
  h += 0.4 * Math.exp(-((x + 2.1) ** 2 + (z - 1.5) ** 2) / 0.7);
  h -= 0.12 * smooth(0.82, 1.0, t);
  const ld = Math.hypot(x - lakeC.x, z - lakeC.z) / lakeR;
  h = lerp(h, -0.24 + 0.16 * ld * ld, smooth(1.3, 0.6, ld));
  const dIn = distPoly(x, z, riverIn), dOut = distPoly(x, z, riverOut);
  h = lerp(h, Math.min(h, 0.03), smooth(0.75, 0.15, dOut));
  h -= 0.13 * smooth(0.3, 0.06, Math.min(dIn, dOut));
  return h;
}
const cGrassA = C('#28554f'), cGrassB = C('#4a8064'), cMeadow = C('#78a383'), cFlower = C('#9a8fd2'),
  cRock = C('#5d5b7c'), cSnow = C('#eef3ff'), cSand = C('#928fb0'), cBed = C('#1d3653');
function mainColor(x, z, h, slope, t, c) {
  const n = fbm(x * 1.1 + 4, z * 1.1 - 2, 3, 2.0) * 0.5 + 0.5;
  c.copy(cGrassA).lerp(cGrassB, smooth(0.25, 0.75, n));
  c.lerp(cMeadow, smooth(0.6, 0.85, n) * 0.5);
  const fl = fbm(x * 3.2 + 9, z * 3.2 + 1, 2, 3.0);
  if (fl > 0.2) c.lerp(cFlower, smooth(0.2, 0.38, fl) * 0.55);
  c.lerp(cRock, smooth(0.75, 1.4, slope));
  const sl = 1.0 + 0.25 * fbm(x * 2, z * 2, 2, 7);
  c.lerp(cSnow, smooth(sl, sl + 0.2, h) * (1 - smooth(1.7, 2.4, slope) * 0.5));
  const ld = Math.hypot(x - lakeC.x, z - lakeC.z) / lakeR;
  const dr = Math.min(distPoly(x, z, riverIn), distPoly(x, z, riverOut));
  c.lerp(cSand, Math.max(smooth(1.45, 1.1, ld), smooth(0.34, 0.17, dr)) * 0.7);
  if (h < -0.02) c.lerp(cBed, smooth(-0.02, -0.14, h));
  c.lerp(cSoil, smooth(0.95, 1.0, t) * 0.7);
}

const main = buildIsland({ R: RIM_GUESS, rimNoise: 0.035, off: 0.0, height: mainHeight, color: mainColor, depth: 2.05, rings: 64, segs: 192 });
main.group.position.y = MAIN_Y;
cube.add(main.group);
addCrystals(main, 46);

// ---------- forest on the main island
{
  const items = [];
  const pineCols = [C('#24484a'), C('#2c5552'), C('#355f57')];
  const roundCols = [C('#3a6c59'), C('#4b7d61'), C('#2f5e5b'), C('#56876a')];
  const blossomCols = [C('#f0a39f'), C('#eab2c6')];
  for (let tries = 0; tries < 9000 && items.length < 420; tries++) {
    const a = rand() * Math.PI * 2, rad = Math.sqrt(rand()) * main.rimAt(a) * 0.93;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad;
    const h = mainHeight(x, z, rad / RIM_GUESS);
    const ld = Math.hypot(x - lakeC.x, z - lakeC.z) / lakeR;
    const dr = Math.min(distPoly(x, z, riverIn), distPoly(x, z, riverOut));
    if (ld < 1.3 || dr < 0.26 || h < 0.04 || h > 1.15) continue;
    const e = 0.04, slope = Math.hypot(mainHeight(x + e, z, 0.5) - mainHeight(x - e, z, 0.5), mainHeight(x, z + e, 0.5) - mainHeight(x, z - e, 0.5)) / (2 * e);
    if (slope > 1.1) continue;
    const dens = fbm(x * 0.6, z * 0.6, 2, 33);
    if (rand() > smooth(-0.12, 0.22, dens) * 0.95 + 0.03) continue;
    let type = h > 0.55 || rand() < 0.38 ? 'pine' : 'round', color;
    if (type === 'pine') color = pineCols[Math.floor(rand() * 3)].clone();
    else color = rand() < 0.045 ? blossomCols[Math.floor(rand() * 2)].clone() : roundCols[Math.floor(rand() * 4)].clone();
    if (h > 0.85) color.lerp(cSnow, 0.45);
    items.push({ x, y: h - 0.01, z, s: rr(0.75, 1.45), type, color });
  }
  makeForest(main.group, items);
}

// ---------- lake
const lakeMat = new THREE.ShaderMaterial({
  transparent: true,
  uniforms: { uTime: U.uTime, uBreath: U.uBreath, uWhale: { value: new THREE.Vector2() } },
  vertexShader: `varying vec2 vP; varying vec3 vW; void main(){ vP = position.xz; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
  fragmentShader: NOISE_GLSL + `
    uniform float uTime, uBreath; uniform vec2 uWhale; varying vec2 vP; varying vec3 vW;
    void main(){
      float r = length(vP);
      float n = snoise(vec3(vP*3.0, uTime*0.15));
      float rip = pow(0.5+0.5*sin(r*19.0 - uTime*1.3 + n*2.2), 10.0) * exp(-r*1.8) * (0.15 + 0.85*uBreath) * (0.6 + 0.4*snoise(vec3(vP*1.5, uTime*0.1)));
      vec3 deep = vec3(0.015,0.05,0.14), shallow = vec3(0.05,0.22,0.40);
      vec3 col = mix(deep, shallow, smoothstep(0.4,1.4,r)*0.8 + n*0.08);
      col += vec3(0.45,0.9,1.0)*rip*0.45;
      float wd = length(vP - uWhale);
      col += vec3(0.30,0.65,1.0)*exp(-wd*wd*0.7)*0.32*(0.6 + 0.6*uBreath);
      vec3 V = normalize(cameraPosition - vW);
      col += vec3(0.22,0.24,0.48)*pow(1.0 - V.y, 3.0)*0.5;
      float sp = pow(max(snoise(vec3(vP*38.0, uTime*0.7)), 0.0), 10.0);
      col += vec3(0.85,0.92,1.0)*sp*1.4;
      gl_FragColor = vec4(col, 0.93);
    }`,
});
{
  const lake = new THREE.Mesh(new THREE.CircleGeometry(1.45, 96).rotateX(-Math.PI / 2), lakeMat);
  lake.position.set(lakeC.x, 0.0, lakeC.z);
  lake.receiveShadow = true;
  main.group.add(lake);
}

// ---------- luminous rivers
const riverMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false,
  uniforms: { uTime: U.uTime },
  vertexShader: `attribute float aLen; varying vec2 vUv; varying float vLen; void main(){ vUv = uv; vLen = aLen; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: NOISE_GLSL + `
    uniform float uTime; varying vec2 vUv; varying float vLen;
    void main(){
      float across = abs(vUv.y - 0.5)*2.0;
      float edge = 1.0 - smoothstep(0.5, 1.0, across);
      float f = snoise(vec3(vLen*7.0 - uTime*1.3, vUv.y*2.5, uTime*0.25));
      float streak = pow(max(f, 0.0), 2.5);
      vec3 col = mix(vec3(0.05,0.28,0.50), vec3(0.32,0.82,1.0), 0.35 + 0.35*streak) + vec3(0.85,0.96,1.0)*streak*0.9;
      gl_FragColor = vec4(col*1.25, edge*0.92);
    }`,
});
function buildRiver(pts, w0, w1) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const N = 140, pos = [], uv = [], len = [], idx = [];
  const L = curve.getLength();
  for (let i = 0; i <= N; i++) {
    const u = i / N, p = curve.getPointAt(u), tg = curve.getTangentAt(u);
    const nx = -tg.z, nz = tg.x, nl = Math.hypot(nx, nz), w = lerp(w0, w1, u);
    const y = mainHeight(p.x, p.z, Math.hypot(p.x, p.z) / RIM_GUESS) + 0.045;
    for (const s of [-1, 1]) { pos.push(p.x + nx / nl * w * s, y, p.z + nz / nl * w * s); uv.push(u, s < 0 ? 0 : 1); len.push(u * L); }
    if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aLen', new THREE.Float32BufferAttribute(len, 1));
  g.setIndex(idx);
  const m = new THREE.Mesh(g, riverMat);
  m.renderOrder = 2;
  main.group.add(m);
  return { curve, last: pos.slice(-6) };
}
buildRiver(riverIn, 0.06, 0.12);
// the outflow stops exactly at the rim so it can pour over the edge
const lipR = main.rimAt(FALL_TH) * 0.985;
buildRiver([...riverOut.slice(0, -1), [Math.cos(FALL_TH) * lipR, Math.sin(FALL_TH) * lipR]], 0.13, 0.12);

// ---------- waterfall of liquid starlight
const lip = new THREE.Vector3(Math.cos(FALL_TH) * lipR, mainHeight(Math.cos(FALL_TH) * lipR, Math.sin(FALL_TH) * lipR, 1) + 0.045, Math.sin(FALL_TH) * lipR);
const fallOut = new THREE.Vector3(Math.cos(FALL_TH), 0, Math.sin(FALL_TH));
const fallSide = new THREE.Vector3(-Math.sin(FALL_TH), 0, Math.cos(FALL_TH));
const FALL_H = 2.7;
{
  const fallU = { uTime: U.uTime, uViewH: U.uViewH, uLip: { value: lip }, uOut: { value: fallOut }, uSide: { value: fallSide }, uH: { value: FALL_H } };
  const fallPath = `
    vec3 fallPos(float v, float s){
      return uLip + uOut*(0.05 + 0.42*v*(1.0 - 0.35*v)) - vec3(0.0, uH*(0.85*v*v + 0.15*v), 0.0) + uSide*s*(0.12 + 0.3*v*v);
    }`;
  // ribbon curtain
  const N = 60, pos = [], uv = [], idx = [];
  for (let i = 0; i <= N; i++) for (let k = 0; k <= 6; k++) {
    pos.push(0, 0, 0); uv.push(k / 6, i / N);
    if (i < N && k < 6) { const a = i * 7 + k; idx.push(a, a + 7, a + 1, a + 1, a + 7, a + 8); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const curtain = new THREE.Mesh(g, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: fallU,
    vertexShader: `uniform vec3 uLip, uOut, uSide; uniform float uH; varying vec2 vUv;` + fallPath + `
      void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(fallPos(uv.y, uv.x*2.0 - 1.0), 1.0); }`,
    fragmentShader: NOISE_GLSL + `
      uniform float uTime; varying vec2 vUv;
      void main(){
        float f = snoise(vec3(vUv.x*7.0, vUv.y*5.0 - uTime*2.4, uTime*0.3));
        float streak = 0.35 + 0.65*pow(max(f,0.0), 1.5);
        float a = (1.0 - smoothstep(0.55, 1.0, abs(vUv.x - 0.5)*2.0)) * (1.0 - smoothstep(0.35, 0.9, vUv.y)) * smoothstep(0.0, 0.04, vUv.y);
        vec3 col = mix(vec3(0.30,0.75,1.0), vec3(0.85,0.95,1.0), streak);
        gl_FragColor = vec4(col, a*streak*0.4);
      }`,
  }));
  curtain.frustumCulled = false;
  main.group.add(curtain);

  // falling stardust droplets + dissolving mist
  const M = 2600, rnd = new Float32Array(M * 4);
  for (let i = 0; i < M * 4; i++) rnd[i] = rand();
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(M * 3), 3));
  pg.setAttribute('aRand', new THREE.BufferAttribute(rnd, 4));
  const drops = new THREE.Points(pg, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: fallU,
    vertexShader: `attribute vec4 aRand; uniform float uTime, uViewH; uniform vec3 uLip, uOut, uSide; uniform float uH;
      varying vec3 vCol; varying float vA; varying float vSharp;` + fallPath + `
      void main(){
        float v = fract(aRand.x + uTime*(0.16 + 0.08*aRand.y));
        vec3 p = fallPos(v, (aRand.z*2.0 - 1.0)*(1.0 + 0.6*v));
        p += uOut*(aRand.w - 0.5)*0.08*(1.0 + 4.0*v*v);
        p.y += sin(aRand.w*40.0 + uTime)*0.05*v;
        vec4 mv = modelViewMatrix*vec4(p,1.0); gl_Position = projectionMatrix*mv;
        float persp = uViewH*projectionMatrix[1][1]*0.5/max(-mv.z,0.01);
        bool mist = aRand.y > 0.82;
        float sz = mist ? mix(0.15, 0.5, v) : mix(0.022, 0.06, aRand.w);
        gl_PointSize = sz*persp;
        float tw = 0.6 + 0.4*sin(uTime*(5.0 + aRand.z*9.0) + aRand.x*50.0);
        vCol = mix(vec3(0.75,0.95,1.0), vec3(0.62,0.6,1.0), v);
        float fade = smoothstep(0.0, 0.04, v) * (1.0 - smoothstep(0.45, 0.95, v));
        vA = mist ? fade*0.025 : fade*tw*0.75;
        vSharp = mist ? 2.0 : 6.0;
      }`,
    fragmentShader: SPRITE_FRAG,
  }));
  drops.frustumCulled = false;
  main.group.add(drops);
}

// ---------- spring, lanterns and other little lights
const CORAL = C('#ff9f94'), CYAN = C('#8fe8ff');
{
  const sp = riverIn[0];
  const glows = [{ p: [sp[0], mainHeight(sp[0], sp[1], 0.4) + 0.08, sp[1]], c: CYAN.clone().multiplyScalar(1.6), s: 0.35 }];
  const postMat = new THREE.MeshStandardMaterial({ color: 0x3b3040, roughness: 0.8 });
  const postGeo = new THREE.CylinderGeometry(0.008, 0.01, 0.12, 5).translate(0, 0.06, 0);
  for (const a of [2.0, 2.6, 3.3, -0.9]) {
    let d = 1.3, x, z, h;
    do { x = lakeC.x + Math.cos(a) * lakeR * d; z = lakeC.z + Math.sin(a) * lakeR * d; h = mainHeight(x, z, 0.5); d += 0.05; } while (h < 0.04 && d < 2);
    const post = new THREE.Mesh(postGeo, postMat); post.position.set(x, h - 0.01, z); post.castShadow = true;
    main.group.add(post);
    glows.push({ p: [x, h + 0.13, z], c: CORAL.clone().multiplyScalar(1.8), s: 0.16 });
  }
  makeGlows(main.group, glows);
  const warm = new THREE.PointLight(0xff9f94, 0.9, 2.2, 1.6);
  warm.position.set(lakeC.x - 0.9, 0.3, lakeC.z + 0.6);
  main.group.add(warm);
}

// ---------- tiny animals
const animalMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
function deerGeo(drinking, antlers) {
  const parts = [], body = C('#b48d78'), light = C('#ecdcd0'), dark = C('#5b4545');
  const box = (w, h, d, x, y, z, col, rz = 0) => { const g = new THREE.BoxGeometry(w, h, d); if (rz) g.rotateZ(rz); g.translate(x, y, z); parts.push(paint(g, col)); };
  box(0.13, 0.052, 0.05, 0, 0.095, 0, body);
  box(0.11, 0.012, 0.042, 0, 0.068, 0, light);
  for (const sx of [-0.045, 0.045]) for (const sz of [-0.016, 0.016]) box(0.012, 0.075, 0.012, sx, 0.04, sz, body);
  box(0.015, 0.02, 0.015, -0.07, 0.11, 0, light);
  if (!drinking) {
    box(0.024, 0.07, 0.024, 0.06, 0.14, 0, body, -0.35);
    box(0.05, 0.025, 0.026, 0.085, 0.175, 0, body);
    for (const s of [-1, 1]) box(0.007, 0.022, 0.016, 0.07, 0.195, s * 0.016, body, 0.3);
    if (antlers) for (const s of [-1, 1]) { box(0.005, 0.05, 0.005, 0.072, 0.215, s * 0.012, dark, 0.25); box(0.022, 0.004, 0.004, 0.078, 0.232, s * 0.012, dark); }
  } else {
    box(0.024, 0.075, 0.024, 0.08, 0.085, 0, body, -1.15);
    box(0.045, 0.024, 0.026, 0.115, 0.045, 0, body, -0.5);
  }
  return merge(parts);
}
{
  const spots = [[2.05, false, true], [2.45, true, false], [2.85, true, false], [-0.35, false, false], [3.6, false, true]];
  for (const [a, drinking, antlers] of spots) {
    let d = 1.18, x, z, h;
    do { x = lakeC.x + Math.cos(a) * lakeR * d; z = lakeC.z + Math.sin(a) * lakeR * d; h = mainHeight(x, z, 0.5); d += 0.04; } while (h < 0.025 && d < 2.2);
    const deer = new THREE.Mesh(deerGeo(drinking, antlers), animalMat);
    deer.position.set(x, h - 0.005, z);
    deer.rotation.y = Math.atan2(-(lakeC.z - z), lakeC.x - x) + rr(-0.3, 0.3);
    deer.scale.setScalar(1.25);
    deer.castShadow = true;
    main.group.add(deer);
  }
  const bunnyGeo = merge([
    paint(new THREE.SphereGeometry(0.026, 10, 8).scale(1.3, 1, 1).translate(0, 0.026, 0), C('#f2eef6')),
    paint(new THREE.SphereGeometry(0.017, 10, 8).translate(0.032, 0.045, 0), C('#f2eef6')),
    paint(new THREE.BoxGeometry(0.006, 0.03, 0.01).translate(0.03, 0.072, 0.007), C('#f2eef6')),
    paint(new THREE.BoxGeometry(0.006, 0.03, 0.01).translate(0.03, 0.072, -0.007), C('#f2eef6')),
  ]);
  for (let i = 0, n = 0; i < 400 && n < 6; i++) {
    const x = rr(-2.6, 2.6), z = rr(-1, 3.0);
    const h = mainHeight(x, z, 0.5), ld = Math.hypot(x - lakeC.x, z - lakeC.z) / lakeR;
    if (h < 0.06 || h > 0.4 || ld < 1.25 || Math.hypot(x, z) > 3.1) continue;
    const b = new THREE.Mesh(bunnyGeo, animalMat);
    b.position.set(x, h, z); b.rotation.y = rr(0, 6.28); b.castShadow = true;
    main.group.add(b); n++;
  }
}

// ---------- fireflies drifting over the forest
{
  const N = 220, pos = new Float32Array(N * 3), rnd = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    let x, z, h;
    do { x = rr(-3.2, 3.2); z = rr(-3.2, 3.2); } while (Math.hypot(x, z) > 3.3);
    h = mainHeight(x, z, 0.5);
    pos.set([x, Math.max(h, 0) + rr(0.08, 0.5), z], i * 3);
    rnd.set([rand(), rand(), rand(), rand()], i * 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 4));
  const ff = new THREE.Points(g, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: U.uTime, uViewH: U.uViewH, uBreath: U.uBreath },
    vertexShader: `attribute vec4 aRand; uniform float uTime, uViewH, uBreath; varying vec3 vCol; varying float vA; varying float vSharp;
      void main(){
        vec3 p = position + vec3(sin(uTime*0.3 + aRand.x*20.0), sin(uTime*0.5 + aRand.y*20.0)*0.4, cos(uTime*0.27 + aRand.z*20.0))*0.12;
        vec4 mv = modelViewMatrix*vec4(p,1.0); gl_Position = projectionMatrix*mv;
        gl_PointSize = mix(0.03,0.055,aRand.w)*uViewH*projectionMatrix[1][1]*0.5/max(-mv.z,0.01);
        vCol = aRand.w > 0.8 ? vec3(1.0,0.66,0.6)*1.6 : vec3(0.62,1.0,0.95)*1.5;
        vA = pow(0.5 + 0.5*sin(uTime*(0.8 + aRand.y*1.5) + aRand.x*30.0), 3.0)*(0.7 + 0.5*uBreath);
        vSharp = 5.0;
      }`,
    fragmentShader: SPRITE_FRAG,
  }));
  ff.frustumCulled = false;
  main.group.add(ff);
}

// ---------- thin drifting mist over the land
{
  for (const [y, layer] of [[0.14, 0], [0.42, 1]]) {
    const mist = new THREE.Mesh(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: U.uTime, uBreath: U.uBreath, uLayer: { value: layer } },
      vertexShader: `varying vec2 vP; void main(){ vP = position.xz; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: NOISE_GLSL + `
        uniform float uTime, uBreath, uLayer; varying vec2 vP;
        void main(){
          float r = length(vP);
          float mask = 1.0 - smoothstep(2.4, 3.9, r);
          float n = fbm3(vec3(vP*0.75 + vec2(uTime*0.035, uTime*0.018)*(1.0+uLayer), uTime*0.02 + uLayer*3.7));
          float a = smoothstep(0.0, 0.6, n) * mask * (0.13 + 0.09*uBreath) * (uLayer > 0.5 ? 0.7 : 1.0);
          gl_FragColor = vec4(vec3(0.76,0.79,0.98), a);
        }`,
    }));
    mist.position.y = y;
    mist.renderOrder = 3;
    main.group.add(mist);
  }
}

/* =====================================================================
   Floating snowy islands
   ===================================================================== */
const cSnowShade = C('#c4d0ee'), cFrost = C('#8ba3b4');
function snowHeight(off, R, peak) {
  return (x, z, t) => {
    const d2 = (x * x + z * z) / (R * R);
    let h = 0.1 + 0.1 * fbm(x * 0.9 + off, z * 0.9, 4, off);
    h += peak * Math.exp(-d2 * 3.0) * (0.72 + 0.55 * Math.abs(fbm(x * 1.7, z * 1.7, 3, off + 2)));
    h += 0.4 * peak * Math.exp(-((x - 0.38 * R) ** 2 + (z + 0.22 * R) ** 2) / (R * R * 0.1));
    h -= 0.08 * smooth(0.85, 1, t);
    return h;
  };
}
function snowColor(x, z, h, slope, t, c) {
  const n = fbm(x * 2 + 3, z * 2, 3, 4) * 0.5 + 0.5;
  c.copy(cSnow).lerp(cSnowShade, n * 0.55);
  c.lerp(cRock, smooth(1.0, 1.7, slope) * 0.8);
  c.lerp(cFrost, smooth(0.22, 0.05, h) * 0.45 * n);
  c.lerp(cSoil, smooth(0.95, 1, t) * 0.6);
}
const islands = [];
for (const cfg of [
  { p: [-2.7, 3.3, -2.35], R: 1.2, peak: 0.8, depth: 1.0, trees: 34, shrine: true },
  { p: [2.85, 3.0, -2.5], R: 0.92, peak: 0.65, depth: 0.8, trees: 20 },
  { p: [-3.2, -0.35, 2.85], R: 0.72, peak: 0.45, depth: 0.85, trees: 12, blossom: true },
  { p: [3.1, 3.35, 2.7], R: 0.56, peak: 0.4, depth: 0.65, trees: 7 },
]) {
  const off = islands.length * 11.7 + 3;
  const height = snowHeight(off, cfg.R, cfg.peak);
  const isl = buildIsland({ R: cfg.R, rimNoise: 0.08, off, height, color: snowColor, depth: cfg.depth, rings: 34, segs: 96 });
  isl.group.position.set(...cfg.p);
  isl.base = cfg.p[1];
  isl.phase = rand() * 6.28;
  cube.add(isl.group);
  addCrystals(isl, Math.round(cfg.R * 8));
  const items = [];
  for (let i = 0; i < 400 && items.length < cfg.trees; i++) {
    const a = rand() * 6.28, rad = Math.sqrt(rand()) * isl.rimAt(a) * 0.85;
    const x = Math.cos(a) * rad, z = Math.sin(a) * rad, h = height(x, z, rad / cfg.R);
    if (h > cfg.peak * 0.75 + 0.1) continue;
    const blossom = cfg.blossom && rand() < 0.3;
    items.push({
      x, y: h - 0.01, z, s: rr(0.7, 1.25), type: blossom ? 'round' : 'pine',
      color: blossom ? C('#f2a7a6') : C(rand() < 0.5 ? '#d5e0f2' : '#9cb3c6'),
    });
  }
  makeForest(isl.group, items);
  if (cfg.shrine) {
    let best = null;
    for (let i = 0; i < 200; i++) {
      const a = rand() * 6.28, rad = rr(0.35, 0.7) * cfg.R, x = Math.cos(a) * rad, z = Math.sin(a) * rad;
      const s = Math.abs(height(x + 0.03, z, 0.5) - height(x - 0.03, z, 0.5)) + Math.abs(height(x, z + 0.03, 0.5) - height(x, z - 0.03, 0.5));
      if (Math.cos(a) + Math.sin(a) > 0.3 && (!best || s < best.s)) best = { x, z, s };
    }
    const h = height(best.x, best.z, 0.5);
    const shrine = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: 0x5a5470, roughness: 0.8 });
    const roof = new THREE.MeshStandardMaterial({ color: 0xe48f8a, roughness: 0.6, emissive: 0x3a1210 });
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.09), stone); b.position.y = 0.035;
    const r = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.06, 4), roof); r.position.y = 0.1; r.rotation.y = Math.PI / 4;
    shrine.add(b, r);
    shrine.position.set(best.x, h - 0.01, best.z);
    shrine.traverse((o) => { o.castShadow = true; });
    isl.group.add(shrine);
    makeGlows(isl.group, [{ p: [best.x, h + 0.05, best.z], c: CORAL.clone().multiplyScalar(2.0), s: 0.2 }]);
  }
  islands.push(isl);
}

/* =====================================================================
   Floating clouds
   ===================================================================== */
{
  const clouds = [
    [-3.4, 1.55, -0.4, 0.62], [3.35, 0.9, 0.7, 0.55], [0.6, 3.75, -3.4, 0.75], [-1.2, 4.0, 2.9, 0.55],
    [-3.5, -2.25, 0.9, 0.55], [2.2, -2.6, -3.4, 0.65], [3.6, -3.3, -0.4, 0.5],
    [-1.4, -4.35, 1.6, 0.85], [1.9, -4.4, 2.0, 0.7], [-0.6, -4.4, -2.6, 0.75], [2.6, 3.9, 0.4, 0.45],
  ];
  const pos = [], size = [], rnd = [];
  for (const [cx, cy, cz, sc] of clouds) {
    const n = Math.round(24 * sc + 10);
    for (let i = 0; i < n; i++) {
      const ox = rr(-1, 1) * sc * 1.25, oz = rr(-1, 1) * sc * 0.75;
      const dome = 1 - Math.min(1, (ox * ox) / (sc * sc * 1.6) + (oz * oz) / (sc * sc * 0.6));
      const oy = rr(-0.15, 0.35) * sc * (0.4 + dome);
      pos.push(cx + ox, cy + oy, cz + oz);
      size.push(sc * rr(0.55, 1.0) * (0.6 + 0.6 * dome));
      rnd.push(rand(), rand(), clamp(0.5 + oy / (sc * 0.5), 0, 1), rand());
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aSize', new THREE.Float32BufferAttribute(size, 1));
  g.setAttribute('aRand', new THREE.Float32BufferAttribute(rnd, 4));
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: U.uTime, uViewH: U.uViewH, uBreath: U.uBreath },
    vertexShader: `attribute float aSize; attribute vec4 aRand; uniform float uTime, uViewH, uBreath;
      varying vec3 vCol; varying float vA; varying float vSharp;
      void main(){
        vec3 p = position;
        p.x += sin(uTime*0.05 + aRand.x*6.28)*0.18;
        p.y += sin(uTime*0.11 + aRand.y*6.28)*0.04;
        vec4 mv = modelViewMatrix*vec4(p,1.0); gl_Position = projectionMatrix*mv;
        gl_PointSize = aSize*uViewH*projectionMatrix[1][1]*0.5/max(-mv.z,0.01);
        vCol = mix(vec3(0.36,0.36,0.62), vec3(0.88,0.9,1.0), aRand.z) * (0.9 + 0.15*uBreath);
        vCol = mix(vCol, vec3(0.95,0.72,0.78), step(0.93, aRand.w)*0.35);
        vA = 0.2; vSharp = 2.4;
      }`,
    fragmentShader: SPRITE_FRAG,
  }));
  pts.frustumCulled = false;
  pts.renderOrder = 4;
  cube.add(pts);
}

/* =====================================================================
   Volumetric light beams through the mist
   ===================================================================== */
{
  const dir = moon.position.clone().normalize();
  const beamMat = (color, k) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: U.uTime, uBreath: U.uBreath, uColor: { value: C(color) }, uK: { value: k } },
    vertexShader: `varying vec3 vN; varying vec3 vW; varying vec2 vUv; void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: NOISE_GLSL + `
      uniform float uTime, uBreath, uK; uniform vec3 uColor; varying vec3 vN; varying vec3 vW; varying vec2 vUv;
      void main(){
        float ndv = abs(dot(normalize(vN), normalize(cameraPosition - vW)));
        float a = pow(ndv, 2.0) * smoothstep(0.0, 0.4, vUv.y) * (1.0 - smoothstep(0.45, 0.95, vUv.y));
        float flick = 0.7 + 0.3*snoise(vec3(vW*0.5 + vec3(0.0, uTime*0.12, 0.0)));
        gl_FragColor = vec4(uColor * a * flick * uK * (0.8 + 0.4*uBreath), 1.0);
      }`,
  });
  const up = new THREE.Vector3(0, 1, 0);
  for (const [bx, by, bz, rb, color, k] of [
    [0.9, -2.3, 0.9, 1.05, '#bcd4ff', 0.022], [-0.9, -1.7, 0.4, 0.75, '#a6f0ff', 0.016], [1.8, -2.2, -1.2, 0.7, '#c8b8ff', 0.016],
  ]) {
    const t = (4.85 - by) / dir.y, len = t;
    const geo = new THREE.CylinderGeometry(rb * 0.32, rb, len, 32, 1, true);
    const m = new THREE.Mesh(geo, beamMat(color, k));
    const bottom = new THREE.Vector3(bx, by, bz), top = bottom.clone().addScaledVector(dir, t);
    m.position.copy(bottom).add(top).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(up, dir);
    m.renderOrder = 5;
    cube.add(m);
  }
}

/* =====================================================================
   The cloud whale spirit
   ===================================================================== */
const WL = 4.3, WR = 0.8, BEND = 0.07;
const wShape = (u) => u >= 0.62 ? Math.sqrt(Math.max(0, 1 - ((u - 0.62) / 0.38) ** 2)) : 0.1 + 0.9 * Math.pow(1 - (1 - u / 0.62) ** 2, 1.8);
const wRadius = (u) => WR * Math.max(wShape(u), 0.0);
const wCenterY = (u) => 0.08 * WR * Math.sin(Math.PI * u) + 0.22 * WR * Math.pow(1 - u, 3);
const CORE = new THREE.Vector3(0.55, 0.05, 0);

const whale = new THREE.Group();
whale.scale.setScalar(1.4);
cube.add(whale);
const shellPts = [];
{
  const P = [], R4 = [], I = [];
  const add = (x, y, z, kind, extra = 0) => { P.push(x, y, z); R4.push(rand(), rand(), rand(), rand()); I.push(kind, extra); };

  // 0: cloud shell
  for (let i = 0; i < 18000;) {
    const u = rand(), r = wRadius(u);
    if (rand() > 0.08 + r / WR) continue;
    i++;
    const th = rand() * Math.PI * 2;
    const q = rand();
    let rho = q < 0.45 ? 0.86 + 0.14 * Math.sqrt(rand()) : q < 0.85 ? 0.35 + 0.6 * Math.sqrt(rand()) : 1.0 + 0.22 * rand();
    const sy = Math.sin(th), sz = Math.cos(th), vs = sy < 0 ? 0.8 : 0.92;
    const x = (u - 0.5) * WL, y = wCenterY(u) + sy * r * rho * vs, z = sz * r * rho;
    add(x, y, z, 0);
    if (i % 6 === 0) shellPts.push([x, y, z]);
  }
  // 1: inner stars
  for (let i = 0; i < 3800;) {
    const u = rand(), r = wRadius(u);
    if (rand() > (r / WR) ** 2) continue;
    i++;
    const th = rand() * Math.PI * 2, rho = Math.cbrt(rand()) * 0.8;
    add((u - 0.5) * WL, wCenterY(u) + Math.sin(th) * r * rho * 0.85, Math.cos(th) * r * rho, 1);
  }
  // 2: pectoral fins
  for (const side of [-1, 1]) {
    const u0 = 0.64, r0 = wRadius(u0);
    const base = new THREE.Vector3((u0 - 0.5) * WL, wCenterY(u0) - 0.45 * r0, side * 0.78 * r0);
    const dir = new THREE.Vector3(-0.55, -0.42, side * 0.72).normalize();
    for (let i = 0; i < 1500; i++) {
      const s = Math.pow(rand(), 0.85), chord = 0.5 * (1 - s) + 0.08, c = (rand() - 0.35) * chord;
      const p = base.clone().addScaledVector(dir, s * 0.95);
      p.x += c; p.y += -0.12 * s * s + rr(-0.025, 0.025); p.z += rr(-0.02, 0.02);
      add(p.x, p.y, p.z, 2, s);
    }
  }
  // 3: tail flukes
  const xt = -0.5 * WL + 0.08, yt = wCenterY(0);
  for (let i = 0; i < 3400; i++) {
    const s = rand() * 2 - 1, as = Math.abs(s);
    const xle = xt - 0.1 - 0.42 * as * as;
    const chord = 0.44 * (1 - Math.pow(as, 1.7)) + 0.05, notch = 0.16 * Math.exp(-s * s * 40);
    const xte = xle - chord + notch;
    add(lerp(xle, xte, rand()), yt + rr(-0.03, 0.03) + 0.07 * as * as, s * 1.05, 3);
  }
  // 4: soft halo
  for (let i = 0; i < 900;) {
    const u = rand(), r = wRadius(u);
    if (rand() > r / WR) continue;
    i++;
    const th = rand() * Math.PI * 2, rho = 1.0 + 0.6 * rand();
    add((u - 0.5) * WL, wCenterY(u) + Math.sin(th) * r * rho, Math.cos(th) * r * rho, 4);
  }
  // 5: eyes
  for (const side of [-1, 1]) {
    const u = 0.83, r = wRadius(u);
    add((u - 0.5) * WL, wCenterY(u) - 0.02 * r, side * 0.97 * r, 5);
  }
  // 6: glowing core (outer halo + inner heart)
  add(CORE.x, CORE.y, CORE.z, 6); R4[R4.length - 1] = 0.9;
  add(CORE.x, CORE.y, CORE.z, 6); R4[R4.length - 1] = 0.1;
  // 8: contour lines — mouth and throat grooves give the silhouette its whale character
  for (const side of [-1, 1]) {
    for (let i = 0; i < 260; i++) {
      const u = lerp(0.985, 0.74, i / 260), r = wRadius(u);
      const th = -0.12 - 0.35 * (1 - (u - 0.74) / 0.245);
      add((u - 0.5) * WL, wCenterY(u) + Math.sin(th) * r * 0.95, side * Math.cos(th) * r * 1.0, 8, 0.6);
    }
  }
  for (let line = 0; line < 9; line++) {
    const th = -Math.PI / 2 + (line - 4) * 0.13;
    for (let i = 0; i < 120; i++) {
      const v = i / 120, u = lerp(0.93, 0.5, v), r = wRadius(u);
      add((u - 0.5) * WL, wCenterY(u) + Math.sin(th) * r * 0.82, Math.cos(th) * r * 1.0, 8, 0.55 * Math.sin(Math.PI * v));
    }
  }
  // dorsal ridge — a faint spine of light that defines the back from above
  for (let i = 0; i < 320; i++) {
    const v = i / 320, u = lerp(0.9, 0.04, v), r = wRadius(u);
    add((u - 0.5) * WL, wCenterY(u) + r * 0.9, rr(-0.015, 0.015), 8, 0.5 * Math.sin(Math.PI * Math.min(1, v * 1.15)));
  }
  // 7: star trails flowing through the body
  for (let line = 0; line < 10; line++) {
    const ang = rand(), spd = rand(), radf = rand(), start = rand();
    for (let i = 0; i < 70; i++) { P.push(0, 0, 0); R4.push(start + i / 70 * 0.3 + rr(-0.004, 0.004), spd, ang, radf); I.push(7, 0); }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aRand', new THREE.Float32BufferAttribute(R4, 4));
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(I, 2));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: U.uTime, uBreath: U.uBreath, uViewH: U.uViewH,
      uBend: { value: BEND }, uHalfL: { value: WL / 2 }, uR: { value: WR }, uGain: { value: 0.36 }, uCore: { value: CORE },
    },
    vertexShader: /* glsl */`
      attribute vec4 aRand; attribute vec2 aInfo;
      uniform float uTime, uBreath, uViewH, uBend, uHalfL, uR, uGain; uniform vec3 uCore;
      varying vec3 vCol; varying float vA; varying float vSharp;
      float wR(float u){ float sh = u >= 0.62 ? sqrt(max(0.0, 1.0 - pow((u-0.62)/0.38, 2.0))) : 0.1 + 0.9*pow(max(1.0 - pow(1.0 - u/0.62, 2.0), 0.0), 1.8); return uR*sh; }
      float wY(float u){ return 0.08*uR*sin(3.14159265*u) + 0.22*uR*pow(1.0-u,3.0); }
      vec3 deform(vec3 p){
        float tail = clamp((uHalfL - p.x)/(2.0*uHalfL), 0.0, 1.25);
        p.y += 0.30*tail*tail*sin(p.x*1.25 + uTime*1.5);
        p.z += uBend*p.x*p.x;
        return p;
      }
      void main(){
        float kind = aInfo.x; float ex = aInfo.y;
        vec3 p = position;
        if(kind > 6.5 && kind < 7.5){
          float s = fract(aRand.x + uTime*(0.03 + 0.03*aRand.y));
          float u = 0.93 - s*0.86;
          float ang = aRand.z*6.2831853 + s*2.5;
          float rr = wR(u)*(0.22 + 0.4*aRand.w);
          p = vec3((u - 0.5)*2.0*uHalfL, wY(u) + sin(ang)*rr*0.8, cos(ang)*rr);
          ex = s;
        }
        if(kind > 1.5 && kind < 2.5) p.y += sin(uTime*1.5 + 0.8)*0.2*ex*ex;
        p = uCore + (p - uCore)*(1.0 + 0.035*uBreath);
        float tt = uTime*0.6;
        vec3 drift = vec3(sin(tt + aRand.x*6.2831), sin(tt*1.3 + aRand.y*6.2831), cos(tt*0.9 + aRand.z*6.2831));
        float amp = kind < 0.5 ? 0.03 : (kind > 3.5 && kind < 4.5 ? 0.1 : 0.008);
        if(kind < 6.5) p += drift*amp;
        vec3 rest = p;
        p = deform(p);
        vec4 mv = modelViewMatrix*vec4(p,1.0);
        gl_Position = projectionMatrix*mv;
        float persp = uViewH*projectionMatrix[1][1]*0.5/max(-mv.z,0.01);

        float u = clamp(rest.x/(2.0*uHalfL) + 0.5, 0.0, 1.0);
        float pulse = pow(0.5 + 0.5*sin(u*14.0 - uTime*2.2), 6.0);
        float coreGlow = exp(-dot(rest - uCore, rest - uCore)*1.6);
        vec3 cyan = vec3(0.12,0.72,1.0), lav = vec3(0.55,0.42,1.0), mist = vec3(0.8,0.88,1.0), deep = vec3(0.05,0.18,1.0);
        float top = clamp(position.y*1.3 + 0.45, 0.0, 1.0);
        float size; vec3 col; float a;
        if(kind < 0.5){
          size = mix(0.07, 0.17, aRand.w);
          col = mix(lav*0.85, mix(deep, cyan, 0.55), top);
          col = mix(col, mist, smoothstep(0.95, 1.0, aRand.y)*0.6);
          bool puff = aRand.z > 0.9;
          size = puff ? mix(0.2, 0.36, aRand.w) : size;
          a = (0.08 + 0.08*pulse + 0.14*coreGlow) * (puff ? 0.45 : 1.0) * mix(0.55, 1.25, top);
          vSharp = 3.0;
        } else if(kind < 1.5){
          size = mix(0.012, 0.04, aRand.w*aRand.w);
          col = mix(vec3(0.75,0.95,1.0), vec3(1.0,0.8,0.9), step(0.9, aRand.x)) * 1.4;
          float tw = 0.5 + 0.5*sin(uTime*(1.0 + aRand.y*3.0) + aRand.z*30.0);
          a = (0.2 + 0.8*tw)*(0.6 + 0.8*pulse);
          vSharp = 9.0;
        } else if(kind < 3.5){
          size = mix(0.05, 0.12, aRand.w);
          col = mix(mix(deep, cyan, 0.5), lav, aRand.x*0.6);
          col = mix(col, mist, smoothstep(0.92, 1.0, aRand.y)*0.5);
          col = mix(col, mist, 0.25);
          a = (0.15 + 0.07*pulse) * (kind < 2.5 ? 1.0 - 0.45*ex : 1.0);
          vSharp = 3.2;
        } else if(kind < 4.5){
          size = mix(0.35, 0.75, aRand.w);
          col = mix(deep, lav, aRand.x);
          a = 0.016;
          vSharp = 2.0;
        } else if(kind < 5.5){
          size = 0.1; col = vec3(0.85,1.0,1.0)*3.0; a = 1.0; vSharp = 5.0;
        } else if(kind < 6.5){
          bool outer = aRand.w > 0.5;
          size = outer ? 1.4 : 0.26;
          col = outer ? vec3(0.32,0.66,1.0) : vec3(0.85,0.97,1.0)*2.2;
          a = (outer ? 0.22 : 0.9)*(0.6 + 0.6*uBreath);
          vSharp = outer ? 2.2 : 3.5;
        } else if(kind < 7.5){
          size = mix(0.015, 0.035, aRand.w);
          col = vec3(0.75,0.95,1.0)*1.6;
          a = sin(3.14159*ex)*(0.25 + 0.5*step(0.7, fract(aRand.x*37.0 + uTime*0.8)));
          vSharp = 7.0;
        } else {
          size = mix(0.025, 0.05, aRand.w);
          col = mix(vec3(0.7,0.92,1.0), vec3(0.85,0.8,1.0), aRand.x)*1.3;
          a = ex*(0.45 + 0.35*pulse);
          vSharp = 5.0;
        }
        gl_PointSize = size*persp;
        vCol = col; vA = a*((kind > 4.5 && kind < 6.5) ? 1.0 : uGain);
      }`,
    fragmentShader: SPRITE_FRAG,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  whale.add(pts);
}
const whaleLight = new THREE.PointLight(0x7fd6ff, 10, 11, 1.4);
cube.add(whaleLight);

function whaleDeform(v, t) {
  const tail = clamp((WL / 2 - v.x) / WL, 0, 1.25);
  v.y += 0.30 * tail * tail * Math.sin(v.x * 1.25 + t * 1.5);
  v.z += BEND * v.x * v.x;
  return v;
}
const PATH_R = 0.9, PATH_Y = 1.35;
const whalePos = (t, out) => {
  const a = 0.6 + t * 0.075;
  return out.set(Math.cos(a) * PATH_R, PATH_Y + 0.22 * Math.sin(a * 2 + 0.6), Math.sin(a) * PATH_R * 0.92);
};

/* ---------- vapor + stardust trail ---------- */
const TN = 5000;
const tPos = new Float32Array(TN * 3), tVel = new Float32Array(TN * 3), tData = new Float32Array(TN * 4);
for (let i = 0; i < TN; i++) tData[i * 4] = -999;
let tHead = 0;
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3).setUsage(THREE.DynamicDrawUsage));
trailGeo.setAttribute('aData', new THREE.BufferAttribute(tData, 4).setUsage(THREE.DynamicDrawUsage));
{
  const pts = new THREE.Points(trailGeo, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: U.uTime, uViewH: U.uViewH },
    vertexShader: `attribute vec4 aData; uniform float uTime, uViewH; varying vec3 vCol; varying float vA; varying float vSharp;
      void main(){
        vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv;
        float age = uTime - aData.x, life = aData.y, k = aData.z, r = aData.w;
        if(age < 0.0 || age > life){ gl_PointSize = 0.0; vA = 0.0; vCol = vec3(0.0); vSharp = 1.0; return; }
        float persp = uViewH*projectionMatrix[1][1]*0.5/max(-mv.z,0.01);
        float x = age/life, fin = smoothstep(0.0, 0.06, x), fout = 1.0 - x;
        if(k < 0.5){
          gl_PointSize = mix(0.14, 0.62, sqrt(x))*persp;
          vCol = mix(vec3(0.55,0.82,1.0), vec3(0.74,0.68,1.0), x);
          vA = 0.075*fin*fout*fout; vSharp = 2.4;
        } else {
          gl_PointSize = mix(0.02, 0.05, r)*persp;
          float tw = 0.5 + 0.5*sin(uTime*(6.0 + r*10.0) + r*40.0);
          vCol = (r > 0.86 ? vec3(1.0,0.72,0.72) : vec3(0.72,0.95,1.0))*1.5;
          vA = (0.35 + 0.65*tw)*fin*fout; vSharp = 7.0;
        }
      }`,
    fragmentShader: SPRITE_FRAG,
  }));
  pts.frustumCulled = false;
  cube.add(pts);
}
function emit(p, kind, life, spread, drift) {
  const i = tHead; tHead = (tHead + 1) % TN;
  tPos[i * 3] = p.x; tPos[i * 3 + 1] = p.y; tPos[i * 3 + 2] = p.z;
  tVel[i * 3] = rr(-1, 1) * spread; tVel[i * 3 + 1] = rr(-1, 1) * spread + drift; tVel[i * 3 + 2] = rr(-1, 1) * spread;
  tData[i * 4] = U.uTime.value; tData[i * 4 + 1] = life; tData[i * 4 + 2] = kind; tData[i * 4 + 3] = rand();
}

/* ---------- ambient stardust inside the cube ---------- */
const dustMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  uniforms: { uTime: U.uTime, uViewH: U.uViewH, uBreath: U.uBreath, uWhale: { value: new THREE.Vector3() } },
  vertexShader: `attribute vec4 aRand; uniform float uTime, uViewH, uBreath; uniform vec3 uWhale;
    varying vec3 vCol; varying float vA; varying float vSharp;
    void main(){
      vec3 p = position + vec3(sin(uTime*0.07 + aRand.x*30.0), sin(uTime*0.05 + aRand.y*30.0)*0.6, cos(uTime*0.06 + aRand.z*30.0))*0.25;
      vec3 d = p - uWhale; float dd = dot(d,d);
      p += normalize(d + 1e-4)*0.35*exp(-dd*0.35);
      vec4 mv = modelViewMatrix*vec4(p,1.0); gl_Position = projectionMatrix*mv;
      gl_PointSize = mix(0.018, 0.05, aRand.w*aRand.w)*uViewH*projectionMatrix[1][1]*0.5/max(-mv.z,0.01);
      float tw = 0.5 + 0.5*sin(uTime*(0.6 + aRand.y*2.5) + aRand.x*40.0);
      vCol = aRand.z > 0.85 ? vec3(1.0,0.75,0.8) : (aRand.z > 0.45 ? vec3(0.7,0.9,1.0) : vec3(0.8,0.78,1.0));
      vA = (0.15 + 0.7*tw) * (0.55 + 0.25*uBreath + 1.6*exp(-dd*0.25));
      vSharp = 6.0;
    }`,
  fragmentShader: SPRITE_FRAG,
});
{
  const N = 1700, pos = new Float32Array(N * 3), rnd = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    pos.set([rr(-4.6, 4.6), rr(-4.6, 4.6), rr(-4.6, 4.6)], i * 3);
    rnd.set([rand(), rand(), rand(), rand()], i * 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aRand', new THREE.BufferAttribute(rnd, 4));
  const pts = new THREE.Points(g, dustMat);
  pts.frustumCulled = false;
  cube.add(pts);
}

/* ---------- little birds ---------- */
const birds = [];
{
  const mat = new THREE.MeshStandardMaterial({ color: 0xe6ebff, roughness: 0.6, side: THREE.DoubleSide, emissive: 0x2a3050 });
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0.02, 0, 0, -0.025, 0, 0, -0.01, 0, 0.09], 3));
  wing.computeVertexNormals();
  const bodyGeo = new THREE.SphereGeometry(0.014, 8, 6).scale(2.2, 0.8, 0.8);
  for (let i = 0; i < 8; i++) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(bodyGeo, mat);
    const wl = new THREE.Mesh(wing, mat), wr = new THREE.Mesh(wing, mat);
    wr.scale.z = -1;
    g.add(body, wl, wr);
    const isl = islands[i % 2];
    g.userData = { center: isl.group.position.clone().add(new THREE.Vector3(0, rr(0.6, 1.1), 0)), r: rr(1.1, 1.7), speed: rr(0.25, 0.4) * (i % 3 ? 1 : -1), phase: rand() * 6.28, wl, wr };
    g.scale.setScalar(1.3);
    cube.add(g);
    birds.push(g);
  }
}

/* =====================================================================
   Post-processing: bloom, tilt-shift, lens finish
   ===================================================================== */
const rt = new THREE.WebGLRenderTarget(innerWidth * PR, innerHeight * PR, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(PR);
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.45, 0.92);
composer.addPass(bloom);

const TiltShift = {
  uniforms: { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() }, uAmt: { value: 9 }, uFocus: { value: 0.5 }, uBand: { value: 0.13 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform vec2 uDir; uniform float uAmt, uFocus, uBand; varying vec2 vUv;
    void main(){
      float b = max(0.0, abs(vUv.y - uFocus) - uBand) * uAmt;
      vec2 o1 = uDir*b*1.3846153846, o2 = uDir*b*3.2307692308;
      vec4 s = texture2D(tDiffuse, vUv)*0.2270270270;
      s += (texture2D(tDiffuse, vUv + o1) + texture2D(tDiffuse, vUv - o1))*0.3162162162;
      s += (texture2D(tDiffuse, vUv + o2) + texture2D(tDiffuse, vUv - o2))*0.0702702703;
      gl_FragColor = s;
    }`,
};
const tiltPasses = [];
for (let i = 0; i < 4; i++) {
  const p = new ShaderPass(TiltShift);
  p.userData = { horizontal: i % 2 === 0 };
  tiltPasses.push(p);
  composer.addPass(p);
}
const finish = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uTime: U.uTime, uRes: { value: new THREE.Vector2() } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uRes; varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5; float d = length(c*vec2(uRes.x/uRes.y, 1.0));
      vec2 off = c*d*0.006;
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      col *= 1.0 - smoothstep(0.35, 1.15, d)*0.75;
      float g = fract(sin(dot(vUv*uRes + fract(uTime)*91.7, vec2(12.9898,78.233)))*43758.5453);
      col += (g - 0.5)*0.01;
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
});
composer.addPass(finish);
composer.addPass(new OutputPass());

function resize() {
  const w = innerWidth, h = innerHeight;
  camera.aspect = w / h; camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  U.uViewH.value = h * PR;
  finish.uniforms.uRes.value.set(w * PR, h * PR);
  for (const p of tiltPasses) p.uniforms.uDir.value.set(p.userData.horizontal ? 1 / (w * PR) : 0, p.userData.horizontal ? 0 : 1 / (h * PR));
}
addEventListener('resize', resize);
resize();

/* =====================================================================
   UI
   ===================================================================== */
function saveImage() {
  composer.render();
  const a = document.createElement('a');
  a.download = `cloud-whale-${Date.now()}.png`;
  a.href = renderer.domElement.toDataURL('image/png');
  a.click();
}
addEventListener('keydown', (e) => {
  if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('hide');
  if (e.key === 'p' || e.key === 'P') saveImage();
  if (e.key === ' ') controls.autoRotate = !controls.autoRotate;
});

/* =====================================================================
   Animation
   ===================================================================== */
const clock = new THREE.Clock();
const vA = new THREE.Vector3(), vB = new THREE.Vector3(), vel = new THREE.Vector3(), tmp = new THREE.Vector3();
const corePos = new THREE.Vector3();
const lakeWorld = new THREE.Vector3(lakeC.x, MAIN_Y, lakeC.z);
let emitAcc = 0, firstFrame = true;

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  U.uTime.value = t;
  const breath = 0.5 + 0.5 * Math.sin(t * 0.85);
  U.uBreath.value = breath;
  finish.uniforms.uTime.value = t;

  // the cube gently floats
  cube.position.y = Math.sin(t * 0.4) * 0.14;
  cube.rotation.z = Math.sin(t * 0.23) * 0.01;
  cube.rotation.x = Math.sin(t * 0.17 + 1) * 0.008;

  // whale swims a slow, breathing loop
  whalePos(t, vA); whalePos(t + 0.05, vB);
  vel.subVectors(vB, vA);
  whale.position.copy(vA);
  whale.rotation.set(0.06 * Math.sin(t * 0.3), Math.atan2(-vel.z, vel.x), Math.atan2(vel.y, Math.hypot(vel.x, vel.z)), 'YZX');
  whale.updateMatrix();
  corePos.copy(CORE).applyMatrix4(whale.matrix);
  whaleLight.position.copy(corePos);
  whaleLight.intensity = 7 + 7 * breath;
  dustMat.uniforms.uWhale.value.copy(corePos);
  lakeMat.uniforms.uWhale.value.set(corePos.x - lakeWorld.x, corePos.z - lakeWorld.z);

  // shed vapor and stardust
  emitAcc += dt * 260;
  while (emitAcc >= 1) {
    emitAcc -= 1;
    const r = rand();
    if (r < 0.35) {
      const s = rand() < 0.5 ? -1 : 1;
      tmp.set(-0.5 * WL - rr(0.15, 0.45), wCenterY(0) + 0.05, s * rr(0.5, 1.05));
      whaleDeform(tmp, t).applyMatrix4(whale.matrix);
      emit(tmp, rand() < 0.45 ? 0 : 1, rr(3.5, 7), 0.05, 0.015);
    } else {
      const sp = shellPts[Math.floor(rand() * shellPts.length)];
      tmp.set(sp[0], sp[1], sp[2]).multiplyScalar(1.05);
      whaleDeform(tmp, t).applyMatrix4(whale.matrix);
      emit(tmp, rand() < 0.4 ? 0 : 1, rr(2.5, 6), 0.035, rand() < 0.5 ? 0.02 : -0.02);
    }
  }
  const damp = 1 - 0.35 * dt;
  for (let i = 0; i < TN; i++) {
    if (t - tData[i * 4] > tData[i * 4 + 1]) continue;
    const j = i * 3;
    tVel[j] *= damp; tVel[j + 1] *= damp; tVel[j + 2] *= damp;
    tVel[j] += Math.sin(tPos[j + 1] * 2.1 + t * 0.7) * 0.01 * dt;
    tVel[j + 2] += Math.cos(tPos[j] * 1.9 + t * 0.6) * 0.01 * dt;
    tPos[j] += tVel[j] * dt; tPos[j + 1] += tVel[j + 1] * dt; tPos[j + 2] += tVel[j + 2] * dt;
  }
  trailGeo.attributes.position.needsUpdate = true;
  trailGeo.attributes.aData.needsUpdate = true;

  // floating islands bob
  for (const isl of islands) isl.group.position.y = isl.base + Math.sin(t * 0.45 + isl.phase) * 0.07;

  // birds circle the snowy peaks
  for (const b of birds) {
    const d = b.userData, a = d.phase + t * d.speed;
    b.position.set(d.center.x + Math.cos(a) * d.r, d.center.y + Math.sin(t * 0.7 + d.phase) * 0.12, d.center.z + Math.sin(a) * d.r);
    b.rotation.y = -a + (d.speed > 0 ? -Math.PI : 0);
    const flap = Math.sin(t * 9 + d.phase * 3) * 0.7;
    d.wl.rotation.x = flap; d.wr.rotation.x = -flap;
  }

  // OrbitControls.update() re-derives the camera position from its own spherical
  // state AND clamps it to minDistance/maxDistance (13..70 here). The host drives
  // k down to ~3.7 units, so letting update() run would snap the framing back.
  if (!EMBED) controls.update();
  composer.render();

  if (firstFrame) { firstFrame = false; document.getElementById('veil').classList.add('gone'); }
  requestAnimationFrame(frame);
}
frame();
