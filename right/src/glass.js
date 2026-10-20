import * as THREE from 'three';
import { CFG } from './terrain.js';
import { shared } from './shared.js';
import { softCircleTexture } from './util.js';

/**
 * Glass cube. Same construction as the earlier terrarium (front-facing panes
 * only, thin cylinder edges), but lit as a display case under moonlight:
 * no warm highlights, a faint iridescent rim, and a weak inner glow.
 */
export function buildGlass() {
  const group = new THREE.Group();
  const h = CFG.cubeHalf;
  const geo = new THREE.BoxGeometry(h * 2, h * 2, h * 2, 1, 1, 1);

  const uniforms = {
    ...shared,
    uEdge: { value: new THREE.Color('#e8f2ff') },
    uTint: { value: new THREE.Color('#a8c4e0') },
    uIris: { value: new THREE.Color('#a8baf0') },
    uRimPow: { value: 2.7 },
    uStrength: { value: 1.0 },
  };

  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */`
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying vec3 vLocal;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vLocal = position;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uDay;
      uniform vec3 uSunColor;
      uniform vec3 uSunDir;
      uniform vec3 uEdge;
      uniform vec3 uTint;
      uniform vec3 uIris;
      uniform float uRimPow;
      uniform float uStrength;
      varying vec3 vWorld;
      varying vec3 vNormalW;
      varying vec3 vLocal;

      float hash(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      float vnoise(vec3 x) {
        vec3 i = floor(x); vec3 f = fract(x);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                       mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                       mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }

      void main() {
        // Only the panes facing the camera exist. With a solid box the far panes
        // would stack another layer of tint over the island and turn it to soup.
        if (dot(normalize(vNormalW), normalize(cameraPosition - vWorld)) < 0.01) discard;

        vec3 N = normalize(vNormalW);
        vec3 V = normalize(cameraPosition - vWorld);
        float ndv = abs(dot(N, V));
        float fres = pow(1.0 - ndv, uRimPow);

        // distance to the nearest cube edge, from local coordinates
        vec3 a = abs(vLocal);
        vec3 d3 = vec3(0.745) - a;
        float edgeDist;
        if (d3.x <= d3.y && d3.x <= d3.z) edgeDist = min(d3.y, d3.z);
        else if (d3.y <= d3.z) edgeDist = min(d3.x, d3.z);
        else edgeDist = min(d3.x, d3.y);
        float edgeGlow = pow(1.0 - smoothstep(0.0, 0.022, edgeDist), 2.0) * 0.15;

        vec3 sp = vWorld * 9.0;
        float smudge = vnoise(sp * 1.7 + vec3(0.0, uTime * 0.02, 0.0));
        float fine = vnoise(sp * 14.0);
        float dirt = smoothstep(0.64, 1.0, smudge) * 0.30 + smoothstep(0.72, 1.0, fine) * 0.10;

        vec3 L = normalize(uSunDir);
        float spec = pow(max(dot(reflect(-V, N), L), 0.0), 260.0);
        float broad = pow(max(dot(reflect(-V, L), N), 0.0), 8.0);

        // very weak iridescence, only at the grazing rim
        // One desaturated cool tint. A per-channel rainbow here separates
        // into visible magenta/green fringes along every edge.
        float irid = smoothstep(0.62, 1.0, fres) * (0.5 + 0.5 * sin(vWorld.y * 9.0));

        vec3 col = uTint * (0.020 + 0.050 * uDay);
        col += uEdge * fres * (0.34 + 0.16 * uDay);
        col += uEdge * edgeGlow * (0.30 + 0.08 * uDay);
        col += uIris * irid * fres * 0.10;
        col += uSunColor * spec * 1.25;
        col += uSunColor * broad * 0.020;

        float alpha = 0.006 + fres * 0.13 + edgeGlow * 0.24 + spec * 0.55;
        alpha *= (0.72 + 0.28 * uDay);
        alpha *= 1.0 - dirt;
        alpha *= uStrength;
        alpha = min(alpha, 0.66);

        gl_FragColor = vec4(col * uStrength, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  });

  const cube = new THREE.Mesh(geo, mat);
  cube.renderOrder = 20;
  group.add(cube);

  // ---------- edge definition ----------
  // 12 thin tubes, not lines and not sprites: tubes hold a constant silhouette
  // at every angle, while screen-space lines and near-plane sprites both fan
  // out into long streaks during an orbit.
  const edgeMat = new THREE.ShaderMaterial({
    uniforms: { ...shared, uColor: { value: new THREE.Color('#e4f0ff') } },
    vertexShader: /* glsl */`
      varying vec3 vN;
      varying vec3 vW;
      void main() {
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      uniform vec3 uColor;
      uniform float uDay;
      varying vec3 vN;
      varying vec3 vW;
      void main() {
        vec3 V = normalize(cameraPosition - vW);
        // a tube seen side-on keeps its full width and reads as a hard line
        float facing = pow(abs(dot(normalize(vN), V)), 0.55);
        float a = 0.26 * facing * (0.55 + 0.45 * uDay);
        gl_FragColor = vec4(uColor, a);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const r = 0.0024;
  const edgeGeoY = new THREE.CylinderGeometry(r, r, h * 2, 8, 1, true);
  const edgeGeoX = new THREE.CylinderGeometry(r, r, h * 2, 8, 1, true);
  edgeGeoX.rotateZ(Math.PI / 2);
  const edgeGeoZ = new THREE.CylinderGeometry(r, r, h * 2, 8, 1, true);
  edgeGeoZ.rotateX(Math.PI / 2);

  [-1, 1].forEach((sx) => {
    [-1, 1].forEach((sz) => {
      const m = new THREE.Mesh(edgeGeoY, edgeMat);
      m.position.set(sx * h, 0, sz * h);
      m.renderOrder = 22;
      group.add(m);
    });
  });
  [-1, 1].forEach((sy) => {
    [-1, 1].forEach((sz) => {
      const m = new THREE.Mesh(edgeGeoX, edgeMat);
      m.position.set(0, sy * h, sz * h);
      m.renderOrder = 22;
      group.add(m);
    });
    [-1, 1].forEach((sx) => {
      const m = new THREE.Mesh(edgeGeoZ, edgeMat);
      m.position.set(sx * h, sy * h, 0);
      m.renderOrder = 22;
      group.add(m);
    });
  });

  // ---------- contact shadow ----------
  // No ground plane exists in deep space, so this is only a whisper of a dark
  // pool far below the cube: it anchors the object without implying a floor.
  const shadowMat = new THREE.MeshBasicMaterial({
    map: softCircleTexture(256, 0.0, '0,0,0'),
    transparent: true, opacity: 0.0, depthWrite: false,
    color: new THREE.Color('#000000'),
  });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -h - 0.10;
  shadow.scale.set(2.6, 2.6, 1);
  shadow.renderOrder = 1;
  group.add(shadow);

  return {
    group,
    cube,
    update() {},
  };
}

/** Cool key/fill/back rig. No warm sun — this is a moonlit display case. */
export function buildLights(scene) {
  const key = new THREE.DirectionalLight('#eef3ff', 1.75);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.1;
  key.shadow.camera.far = 4.0;
  const d = 1.05;
  key.shadow.camera.left = -d;
  key.shadow.camera.right = d;
  key.shadow.camera.top = d;
  key.shadow.camera.bottom = -d;
  key.shadow.bias = -0.0009;
  key.shadow.normalBias = 0.006;
  key.shadow.radius = 4;
  key.position.set(1.1, 1.6, 0.9);
  scene.add(key);
  scene.add(key.target);

  const fill = new THREE.DirectionalLight('#9db0cc', 0.42);
  fill.position.set(-1.2, 0.55, 0.9);
  scene.add(fill);

  const back = new THREE.DirectionalLight('#b8aee8', 0.58);
  back.position.set(-0.7, 0.9, -1.4);
  scene.add(back);

  // point light inside the cube: the whale's own glow spilling onto terrain
  const inner = new THREE.PointLight('#c8e0ff', 0.62, 2.0, 2);
  inner.position.set(0.05, 0.30, 0.0);
  scene.add(inner);

  const hemi = new THREE.HemisphereLight('#93a8c4', '#191b26', 0.40);
  scene.add(hemi);

  return { key, fill, back, inner, hemi };
}

/** Slow moonlight drift: no sun, no dawn. The whole cycle is a slow breath. */
export function sampleAmbient(t) {
  const breathe = 0.5 + 0.5 * Math.sin(t * 0.11);
  return {
    day: 0.32 + 0.16 * breathe,
    keyI: 1.65 + 0.35 * breathe,
    fillI: 0.45 + 0.12 * breathe,
    backI: 0.62 + 0.20 * breathe,
  };
}
