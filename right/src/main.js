import * as THREE from 'three';
import { Terrain, CFG } from './terrain.js';
import { buildWater } from './water.js';
import { buildVegetation } from './vegetation.js';
import { buildClouds, buildMist, buildIslets, buildFireflies, buildStarDust } from './atmosphere.js';
import { buildAnimals } from './animals.js';
import { buildGlass, buildLights, sampleAmbient } from './glass.js';
import { buildWhale } from './whale.js';
import { shared } from './shared.js';
import { makeEnvironment, softCircleTexture, mulberry32, cloudPuffTexture, clamp } from './util.js';
import { PostChain } from './post.js';

const params = new URLSearchParams(location.search);
const STILL = params.has('still');
const FORCE_T = params.has('t') ? parseFloat(params.get('t')) : null;
const QUALITY = params.get('q') || 'high';
// Embed mode is decided up front so the camera code can branch on it.
const EMBED_VIEW = params.get('embed') === '1';

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: false,
  powerPreference: 'high-performance',
  preserveDrawingBuffer: true,
});
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const dprCap = QUALITY === 'high' ? 2 : 1.5;
const DPR = Math.min(window.devicePixelRatio || 1, dprCap);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 40);

// ---------------------------------------------------------------- background
scene.environment = makeEnvironment(renderer);

const skyGeo = new THREE.SphereGeometry(9, 48, 32);
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: {
    uTop: { value: new THREE.Color('#050813') },
    uBottom: { value: new THREE.Color('#0a0d1c') },
    uGlow: { value: new THREE.Color('#2a3f6e') },
    uViolet: { value: new THREE.Color('#3a2c5e') },
    uTime: shared.uTime,
  },
  vertexShader: /* glsl */`
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uGlow; uniform vec3 uViolet;
    uniform float uTime;
    varying vec3 vDir;
    float hash(vec3 p){ p=fract(p*0.3183099+vec3(0.1,0.2,0.3)); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
    float vn(vec3 x){
      vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
      return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
    }
    void main(){
      float h = vDir.y * 0.5 + 0.5;
      vec3 col = mix(uBottom, uTop, smoothstep(0.0, 1.0, h));
      // one very soft violet nebula band, low and behind everything
      float n = vn(vDir * 2.2 + vec3(0.0, 0.0, 3.0));
      float n2 = vn(vDir * 4.6 - vec3(4.0, 1.0, 0.0));
      float neb = smoothstep(0.52, 0.94, n * 0.68 + n2 * 0.42);
      col += uGlow * neb * 0.22 * (0.40 + 0.60 * smoothstep(-0.3, 0.6, vDir.y));
      col += uViolet * pow(neb, 2.0) * 0.10;
      col += uGlow * 0.045 * exp(-pow((vDir.y + 0.10) * 6.0, 2.0));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
const sky = new THREE.Mesh(skyGeo, skyMat);
sky.frustumCulled = false;
scene.add(sky);

// stars — few and faint; the cube must dominate
{
  const rng = mulberry32(99);
  const N = 900;
  const p = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const v = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize().multiplyScalar(7.5);
    p[i * 3] = v.x; p[i * 3 + 1] = v.y; p[i * 3 + 2] = v.z;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.PointsMaterial({
    map: softCircleTexture(48, 0.02), size: 0.045, transparent: true,
    opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending,
    color: new THREE.Color('#dfe9ff'), sizeAttenuation: true,
  });
  scene.add(new THREE.Points(g, m));
}

// out-of-focus background bokeh (they sell the macro look)
{
  const rng = mulberry32(1701);
  const tex = cloudPuffTexture(128, 3);
  for (let i = 0; i < 10; i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex, transparent: true, opacity: 0.04 + rng() * 0.04,
      blending: THREE.AdditiveBlending, depthWrite: false,
      color: new THREE.Color().setHSL(0.62 + rng() * 0.10, 0.45, 0.55),
    });
    const sp = new THREE.Sprite(mat);
    // Fixed deep-backdrop positions, well outside the cube's silhouette:
    // sprites near the camera plane get sliced into streaks while orbiting.
    const a = (i / 10) * Math.PI * 2 + rng() * 0.4;
    const r = 6.2 + rng() * 1.6;
    sp.position.set(Math.cos(a) * r, -1.8 + rng() * 4.2, Math.sin(a) * r);
    sp.scale.setScalar(0.5 + rng() * 0.9);
    sp.renderOrder = -5;
    scene.add(sp);
  }
}

// ---------------------------------------------------------------- world
const world = new THREE.Group();
scene.add(world);

const terrain = new Terrain();
const terrainMesh = terrain.buildMesh();
const baseMesh = terrain.buildBase();
world.add(baseMesh);
world.add(terrainMesh);

const water = buildWater(terrain);
world.add(water.group);

const veg = buildVegetation(terrain);
world.add(veg.group);

const clouds = buildClouds();
world.add(clouds.group);
const mist = buildMist(terrain);
world.add(mist.group);
const islets = buildIslets(terrain);
world.add(islets.group);
const fireflies = buildFireflies(terrain);
world.add(fireflies.points);
const starDust = buildStarDust();
world.add(starDust.points);

const animals = buildAnimals(terrain);
world.add(animals.group);

// ---------------------------------------------------------------- whale
// The whale lives directly in `world` so the cube rotation carries it, but its
// trail mist is added to the scene root: the puffs must stay behind.
const whale = buildWhale();
whale.group.scale.setScalar(1.22);
world.add(whale.group);
whale.trailMist.forEach((sp) => scene.add(sp));

const glass = buildGlass();
scene.add(glass.group);

const lights = buildLights(scene);

// soft inner halo so the volume feels lit from inside the glass
const innerGlow = new THREE.Sprite(new THREE.SpriteMaterial({
  map: softCircleTexture(256, 0.02, '190,215,255'),
  transparent: true, opacity: 0.16,
  blending: THREE.AdditiveBlending, depthWrite: false,
  color: new THREE.Color('#b9d4ff'),
}));
innerGlow.scale.setScalar(1.5);
innerGlow.position.set(0, 0.04, 0);
scene.add(innerGlow);

// ---------------------------------------------------------------- post
const post = new PostChain(renderer, window.innerWidth, window.innerHeight, DPR);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  post.setSize(w, h, DPR);
}
window.addEventListener('resize', resize);
resize();

// ---------------------------------------------------------------- camera
const camYaw = params.has('yaw') ? parseFloat(params.get('yaw')) : -0.58;
const camPitch = params.has('pitch') ? parseFloat(params.get('pitch')) : 0.42;
const camDist = params.has('dist') ? parseFloat(params.get('dist')) : 3.62;
const camLookY = params.has('ly') ? parseFloat(params.get('ly')) : 0.03;
const camState = {
  yaw: camYaw,
  pitch: camPitch,
  dist: camDist,
  targetYaw: camYaw,
  targetPitch: camPitch,
  targetDist: camDist,
  auto: !STILL,
};
const focusPoint = new THREE.Vector3(0, 0.02, 0);

let dragging = false;
let lastX = 0, lastY = 0;
canvas.addEventListener('pointerdown', (e) => {
  dragging = true; lastX = e.clientX; lastY = e.clientY;
  canvas.setPointerCapture(e.pointerId);
  camState.auto = false;
});
canvas.addEventListener('pointerup', (e) => {
  dragging = false;
  try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
  setTimeout(() => { camState.auto = !STILL; }, 6000);
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  camState.targetYaw -= dx * 0.005;
  camState.targetPitch = clamp(camState.targetPitch + dy * 0.0035, 0.20, 1.10);
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  camState.targetDist = clamp(camState.targetDist + e.deltaY * 0.0018, 2.3, 6.4);
  camState.auto = false;
  clearTimeout(canvas._wt);
  canvas._wt = setTimeout(() => { camState.auto = !STILL; }, 7000);
}, { passive: false });


/* ---------- side-by-side embedding ----------
   The host owns yaw/pitch/zoom. This copy reports its cube size and fov and
   exposes apply() in the same units the host uses for both scenes:
   yaw/pitch in radians, k = camera distance / cube half-diagonal. */
if (EMBED_VIEW) {
  // Local input must be off: the host forwards pointer events here itself, and
  // two input paths would fight over the same state.
  canvas.style.pointerEvents = 'none';
  camState.auto = false;
  const CUBE_HALF_DIAG = Math.sqrt(3) * 0.745;
  const FOV_REF = 27;
  const FOV_COMP = Math.tan(FOV_REF * Math.PI / 360) / Math.tan(camera.fov * Math.PI / 360);
  window.__view = {
    side: 'right',
    fov: camera.fov,
    halfDiag: CUBE_HALF_DIAG,
    // Exposed so the host (and the verification script) can read the camera
    // this scene actually used, not a mirror of the shared state.
    camera,
    apply(yaw, pitch, k) {
      // pitch 0 = horizontal, +pi/2 = straight down. The host allows negative
      // pitch (looking up from below), which the standalone build clamps away;
      // here the clamp is deliberately removed.
      const dist = CUBE_HALF_DIAG * k * FOV_COMP;
      const cp = Math.cos(pitch);
      camera.position.set(
        Math.sin(yaw) * cp * dist,
        Math.sin(pitch) * dist,
        Math.cos(yaw) * cp * dist
      );
      camera.lookAt(0, camLookY, 0);
      camState.yaw = camState.targetYaw = yaw;
      camState.pitch = camState.targetPitch = pitch;
      camState.dist = camState.targetDist = dist;
    },
  };
}

// 0 -> 1 over the opening; smoothed so it arrives rather than snaps
const INTRO_SECONDS = params.has('intro') ? parseFloat(params.get('intro')) : 9.0;
function introEase(t) {
  if (EMBED_VIEW) return 1;
  if (INTRO_SECONDS <= 0) return 1;
  const k = clamp(t / INTRO_SECONDS, 0, 1);
  return k * k * (3 - 2 * k);
}

function updateCamera(dt, t) {
  // In embed mode the host is the only thing allowed to move the camera, so
  // this whole intro/auto/ease path is bypassed and the host calls apply().
  if (EMBED_VIEW) return;
  const intro = introEase(t);
  if (camState.auto) {
    camState.targetYaw += dt * 0.028;
    camState.targetPitch = 0.42 + Math.sin(t * 0.09) * 0.040;
  }
  const k = Math.min(1, dt * 2.6);
  camState.yaw += (camState.targetYaw - camState.yaw) * k;
  camState.pitch += (camState.targetPitch - camState.pitch) * k;
  camState.dist += (camState.targetDist - camState.dist) * k;

  // Opening framing is wider, higher and slightly further round; all three
  // ease back to the resting values as the intro completes.
  const dist = camState.dist * (1.0 + 0.62 * (1 - intro));
  const pitch = camState.pitch + 0.22 * (1 - intro);
  const yawOff = -0.42 * (1 - intro);

  const cp = Math.cos(pitch);
  const yaw = camState.yaw + yawOff;
  camera.position.set(
    Math.sin(yaw) * cp * dist,
    Math.sin(pitch) * dist,
    Math.cos(yaw) * cp * dist
  );
  camera.lookAt(0, camLookY * intro, 0);
}

// ---------------------------------------------------------------- ambient drift
const tmpV = new THREE.Vector3();

function updateAmbient(t, dt) {
  const a = sampleAmbient(t);
  shared.uDay.value = a.day;

  lights.key.intensity = a.keyI;
  lights.fill.intensity = a.fillI;
  lights.back.intensity = a.backI;
  lights.hemi.intensity = 0.38 + 0.08 * Math.sin(t * 0.09);

  // the inner light follows the whale: this is what makes the terrain below it
  // brighten as the animal passes overhead
  const wp = shared.uWhalePos.value;
  lights.inner.position.set(wp.x * 0.75, Math.max(0.10, wp.y - 0.06), wp.z * 0.75);
  lights.inner.intensity = 0.45 + 0.35 * shared.uBreath.value;

  scene.environmentIntensity = 0.30 + a.day * 0.45;
  skyMat.uniforms.uGlow.value.set('#22365e').multiplyScalar(0.8 + a.day * 0.4);

  innerGlow.material.opacity = 0.11 + a.day * 0.09;
  innerGlow.material.color.copy(new THREE.Color('#b9d4ff'));
}

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let elapsed = 0;
let frames = 0;

function animate() {
  const dtRaw = clock.getDelta();
  const dt = Math.min(0.05, dtRaw);
  elapsed += dt;
  if (STILL && FORCE_T !== null) elapsed = FORCE_T;
  shared.uTime.value = elapsed;

  updateCamera(dt, elapsed);
  updateAmbient(elapsed, dt);

  whale.update(dt, elapsed);

  water.lakeMesh.material.uniforms.uDay.value = shared.uDay.value;
  water.spray.update(dt, elapsed);
  clouds.update(dt, elapsed, shared.uDay.value);
  mist.update(dt, elapsed, shared.uDay.value);
  islets.update(dt, elapsed);
  fireflies.update(dt, elapsed);
  starDust.update(dt, elapsed);
  animals.update(dt, elapsed, shared.uDay.value);
  glass.update(elapsed, shared.uDay.value);

  // gentle float + settle
  world.position.y = Math.sin(elapsed * 0.42) * 0.005;
  world.rotation.y = (STILL || EMBED_VIEW) ? 0.0 : Math.sin(elapsed * 0.11) * 0.008;
  glass.group.rotation.y = (STILL || EMBED_VIEW) ? 0 : Math.sin(elapsed * 0.08) * 0.005;

  camera.updateMatrixWorld();
  tmpV.set(0.55, 0.55, 0.62).project(camera);

  const exposure = (1.10 + shared.uDay.value * 0.30) * (0.62 + 0.38 * introEase(elapsed));
  post.render(scene, camera, {
    sunScreen: new THREE.Vector2(tmpV.x * 0.5 + 0.5, tmpV.y * 0.5 + 0.5),
    sunColor: new THREE.Color('#cfe0ff'),
    sunIntensity: 0.0,
    raysWeight: 0.0,
    time: elapsed,
    focus: 0.52 + Math.sin(elapsed * 0.06) * 0.015,
    focusWidth: 0.190,
    blurMax: 1.05,
    tiltAngle: -0.05,
    exposure,
    warm: -0.16,
    vignette: 1.20,
    grain: 0.008,
    chroma: 0.0,
    saturation: 1.12,
    bloom: 1.00,
    rays: 0.0,
  });

  frames++;
  if (frames === 3) {
    window.__ready = true;
    document.body.dataset.ready = '1';
  }
  requestAnimationFrame(animate);
}

// warm the shaders once
camera.position.set(2.6, 2.4, 2.6);
camera.lookAt(0, 0, 0);
animate();

window.__scene = { scene, camera, world, terrain, camState, renderer, post, whale, shared };
