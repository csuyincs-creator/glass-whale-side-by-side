import * as THREE from 'three';
import { CFG } from './terrain.js';
import { shared } from './shared.js';
import { softCircleTexture, mulberry32, clamp } from './util.js';

const WATER_VERT = /* glsl */`
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDepth;
  void main() {
    vUv = uv;
    vec3 p = position;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vWorld = wp.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vDepth = -wp.y;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const WATER_FRAG = /* glsl */`
  uniform float uTime;
  uniform float uDay;
  uniform float uBreath;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSky;
  uniform float uAlpha;
  uniform float uFlowSpeed;
  uniform float uRippleScale;
  varying vec2 vUv;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying float vDepth;

  vec3 waveNormal(vec2 p, float t) {
    // The whale's breathing reaches the water: ripple speed rides a slow
    // swell. Small on purpose — the link should be felt, not noticed.
    float swell = 0.72 + 0.28 * uBreath;
    vec2 q = p * uRippleScale;
    float e = 0.06;
    float h0 = sin(q.x * 21.0 + t * (1.7 * swell)) * 0.5
             + sin(q.y * 27.0 - t * (1.3 * swell)) * 0.35
             + sin((q.x + q.y) * 43.0 + t * 2.4) * 0.18
             + sin((q.x - q.y * 0.7) * 61.0 - t * 3.1) * 0.10;
    float hx = sin((q.x + e) * 21.0 + t * (1.7 * swell)) * 0.5
             + sin(((q.x + e) + q.y) * 43.0 + t * 2.4) * 0.18;
    float hy = sin((q.y + e) * 27.0 - t * (1.3 * swell)) * 0.35
             + sin((q.x + (q.y + e) * 0.7) * 61.0 - t * 3.1) * 0.10;
    vec3 n = normalize(vec3(-(hx - h0) / e * 0.10, 1.0, -(hy - h0) / e * 0.10));
    return n;
  }

  void main() {
    vec2 flowUv = vUv;
    flowUv.y -= uTime * uFlowSpeed;
    vec3 N = waveNormal(vWorld.xz + flowUv * 0.12, uTime);
    N = normalize(mix(vNormal, N, 0.85));

    vec3 V = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.6);
    fres = mix(0.12, 1.0, fres * 0.85);

    vec3 L = normalize(uSunDir);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(N, H), 0.0), 190.0) * 2.2;
    float specSoft = pow(max(dot(N, H), 0.0), 26.0) * 0.20;

    vec3 base = mix(uDeep, uShallow, clamp(fres * 0.65 + 0.18, 0.0, 1.0));
    vec3 col = base + uSky * fres * 0.55 + uSunColor * (spec + specSoft) * (0.35 + uDay * 0.9);
    col += uSunColor * spec * 0.8;

    // the shoreline glow pulses gently with the whale's breath
    col += uShallow * (0.05 + 0.05 * uBreath) * (1.0 - fres);

    gl_FragColor = vec4(col, uAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function makeWaterMaterial(opts = {}) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uDeep: { value: new THREE.Color(opts.deep || '#173a52') },
      uShallow: { value: new THREE.Color(opts.shallow || '#3d9aa2') },
      uSky: { value: new THREE.Color(opts.sky || '#bcdfff') },
      uAlpha: { value: opts.alpha ?? 0.86 },
      uFlowSpeed: { value: opts.flow ?? 0.03 },
      uRippleScale: { value: opts.ripple ?? 1.0 },
    },
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function buildWater(terrain) {
  const group = new THREE.Group();
  const rng = mulberry32(919);
  const lakeY = CFG.lake.y;
  const lake = CFG.lake;

  // ---------- lake disc shaped to the shoreline ----------
  const rings = 26, segs = 112;
  const pos = [], uv = [], idx = [];
  const radiusAt = (ang) => {
    const dx = Math.cos(ang), dz = Math.sin(ang);
    let lo = 0.05, hi = lake.r + 0.06;
    for (let k = 0; k < 22; k++) {
      const mid = (lo + hi) / 2;
      if (terrain.lakeDist(lake.x + dx * mid, lake.z + dz * mid) < lake.r) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  for (let r = 0; r <= rings; r++) {
    const rt = r / rings;
    for (let s = 0; s <= segs; s++) {
      const ang = (s / segs) * Math.PI * 2;
      const rad = radiusAt(ang) * rt * 1.008;
      pos.push(lake.x + Math.cos(ang) * rad, lakeY, lake.z + Math.sin(ang) * rad);
      uv.push(0.5 + Math.cos(ang) * rad * 1.6, 0.5 + Math.sin(ang) * rad * 1.6);
    }
  }
  const W = segs + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segs; s++) {
      const a = r * W + s, b = a + 1, c = a + W, d = c + 1;
      // wind CCW seen from +Y so the sheet faces up
      idx.push(a, c, b, b, c, d);
    }
  }
  const lakeGeo = new THREE.BufferGeometry();
  lakeGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  lakeGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  lakeGeo.setIndex(idx);
  lakeGeo.computeVertexNormals();
  const lakeMat = makeWaterMaterial({ deep: '#123b52', shallow: '#3e9fa4', alpha: 0.9, flow: 0.012, ripple: 2.4 });
  const lakeMesh = new THREE.Mesh(lakeGeo, lakeMat);
  lakeMesh.renderOrder = 2;
  group.add(lakeMesh);

  // ---------- river ribbons ----------
  const ribbon = (pts, widths, material, yOffset = 0) => {
    const n = pts.length;
    const p = [], uvs = [], ind = [];
    const tan = new THREE.Vector3(), side = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      tan.subVectors(b, a).setY(0).normalize();
      side.crossVectors(tan, up).normalize();
      if (side.lengthSq() < 0.1) side.set(1, 0, 0);
      const w = widths[Math.min(widths.length - 1, Math.floor((i / n) * widths.length))];
      const c = pts[i];
      p.push(c.x - side.x * w, c.y + yOffset, c.z - side.z * w);
      p.push(c.x + side.x * w, c.y + yOffset, c.z + side.z * w);
      uvs.push(0, i / (n - 1));
      uvs.push(1, i / (n - 1));
    }
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      ind.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(ind);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.renderOrder = 2;
    return m;
  };

  const upperW = [];
  for (let i = 0; i < 24; i++) {
    const t = i / 23;
    upperW.push(0.020 + 0.013 * Math.sin(t * Math.PI * 0.9) + 0.004 * Math.sin(i * 2.7));
  }
  const upperMat = makeWaterMaterial({ deep: '#1d5566', shallow: '#5cb7b4', alpha: 0.88, flow: 0.05, ripple: 4.0 });
  const upper = ribbon(terrain.upperPts, upperW, upperMat, -0.004);
  group.add(upper);

  const lowerW = [];
  for (let i = 0; i < 20; i++) {
    const t = i / 19;
    lowerW.push(0.032 + 0.022 * t + 0.006 * Math.sin(t * 9.0));
  }
  const lowerMat = makeWaterMaterial({ deep: '#16505c', shallow: '#5ab7a8', alpha: 0.88, flow: 0.04, ripple: 3.0 });
  const lower = ribbon(terrain.lowerPts, lowerW, lowerMat, 0.002);
  group.add(lower);

  // ---------- waterfall ----------
  const wf = buildWaterfall(terrain, rng);
  group.add(wf.group);

  // ---------- shore foam ----------
  group.add(buildFoam(terrain, rng));

  // ---------- spray particles ----------
  const spray = buildSpray(terrain, rng);
  group.add(spray.points);

  return { group, lakeMesh, upper, lower, waterfall: wf, spray };
}

function buildWaterfall(terrain, rng) {
  const group = new THREE.Group();
  const brink = terrain.brink;

  // Derive the vertical extent from the terrain itself. The river spline is too
  // coarse around the cliff to give a real drop, so the sheet reads the ground
  // heights on both sides of the brink instead.
  const lipY = Math.max(
    terrain.heightAt(brink.x, brink.z - 0.020),
    terrain.heightAt(brink.x - 0.02, brink.z - 0.02),
    terrain.heightAt(brink.x + 0.02, brink.z - 0.02)
  ) + 0.004;
  const poolY = Math.min(
    terrain.heightAt(brink.x, brink.z + 0.030),
    terrain.heightAt(brink.x + 0.03, brink.z + 0.03),
    terrain.heightAt(brink.x - 0.03, brink.z + 0.03)
  ) + 0.010;

  const topY = lipY;
  const botY = poolY;
  const zTop = brink.z - 0.012;
  const zBot = brink.z + 0.030;
  const halfW = 0.024;

  const cols = 26, rows = 34;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i < cols; i++) {
    const u = i / (cols - 1);
    const x = brink.x + (u - 0.5) * halfW * 2;
    const spread = 1 + 0.55 * Math.pow(u - 0.5, 2) * 2;
    for (let j = 0; j < rows; j++) {
      const t = j / (rows - 1);
      const y = topY + (botY - topY) * t;
      // sheet bulges slightly outward then tucks back in
      const bulge = Math.sin(t * Math.PI) * 0.014;
      const z = zTop + (zBot - zTop) * Math.pow(t, 1.35) + bulge;
      pos.push(brink.x + (x - brink.x) * spread, y, z);
      uv.push(u, t);
    }
  }
  const SW = rows;
  for (let i = 0; i < cols - 1; i++) {
    for (let j = 0; j < rows - 1; j++) {
      const a = i * SW + j, b = a + 1, c = a + SW, d = c + 1;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uColorA: { value: new THREE.Color('#d6f2ff') },
      uColorB: { value: new THREE.Color('#8fc8e8') },
      uAlpha: { value: 0.75 },
    },
    vertexShader: WATER_VERT,
    fragmentShader: /* glsl */`
      uniform float uTime;
      uniform float uDay;
      uniform float uBreath;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uAlpha;
      varying vec2 vUv;
      varying vec3 vWorld;
      varying vec3 vNormal;
      void main() {
        float t = vUv.y;
        float s1 = sin(vUv.x * 92.0 + sin(vUv.x * 21.0) * 2.0 + t * 3.0);
        float s2 = sin(vUv.x * 173.0 - t * 9.0 + 1.7);
        float s3 = sin(vUv.x * 41.0 + t * 1.3);
        float streak = smoothstep(0.1, 1.0, 0.55 + 0.25 * s1 + 0.15 * s2 + 0.2 * s3);

        // broken up at the bottom, aerated
        float aer = smoothstep(0.55, 1.0, t);
        float noise = sin(vUv.x * 240.0 + t * 40.0) * sin(vUv.y * 190.0 - uTime * 6.0);
        streak = mix(streak, 0.5 + 0.5 * noise, aer * 0.55);

        vec3 V = normalize(cameraPosition - vWorld);
        vec3 N = normalize(vNormal);
        float rim = pow(1.0 - abs(dot(N, V)), 2.0);
        vec3 col = mix(uColorB, uColorA, streak);
        col += uSunColor * pow(max(dot(N, normalize(uSunDir)), 0.0), 8.0) * 0.30;
        col += vec3(0.35, 0.72, 0.92) * rim * 0.32;
        col += uColorA * 0.05 * (0.5 + 0.5 * uBreath);
        float alpha = uAlpha * (0.55 + 0.45 * streak) * (1.0 - smoothstep(0.86, 1.0, t) * 0.35);
        alpha *= smoothstep(0.0, 0.02, t);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
  });
  const sheet = new THREE.Mesh(geo, mat);
  sheet.renderOrder = 3;
  group.add(sheet);

  // glow behind the sheet (soft volume)
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softCircleTexture(128, 0.1, '185,235,255'),
    transparent: true, opacity: 0.28,
    blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  glow.scale.set(0.15, 0.28, 1);
  glow.position.set(brink.x, (topY + botY) / 2, brink.z + 0.024);
  glow.renderOrder = 4;
  group.add(glow);

  return { group, sheet, glow, topY, botY };
}

function buildFoam(terrain, rng) {
  const group = new THREE.Group();
  const tex = softCircleTexture(128, 0.05);
  const mk = (amount, spreadX, spreadZ, cx, cz, size, opacity, color) => {
    const g = new THREE.BufferGeometry();
    const p = [], s = [];
    for (let i = 0; i < amount; i++) {
      p.push(cx + (rng() - 0.5) * spreadX, 0, cz + (rng() - 0.5) * spreadZ);
      s.push(size * (0.5 + rng()));
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('aSize', new THREE.Float32BufferAttribute(s, 1));
    const m = new THREE.PointsMaterial({
      map: tex, size: 0.028, transparent: true, opacity,
      depthWrite: false, color: new THREE.Color(color),
      blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    const pts = new THREE.Points(g, m);
    pts.renderOrder = 5;
    return pts;
  };

  const brink = terrain.brink, plunge = terrain.plunge;
  const lip = mk(26, 0.05, 0.02, brink.x, brink.z - 0.002, 0.018, 0.70, '#e8fbff');
  lip.position.y = brink.y + 0.004;
  group.add(lip);

  const pool = mk(84, 0.10, 0.075, plunge.x, plunge.z + 0.012, 0.030, 0.68, '#e8fbff');
  pool.position.y = plunge.y + 0.008;
  group.add(pool);

  return group;
}

function buildSpray(terrain, rng) {
  const N = 190;
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const life = new Float32Array(N);
  const seed = new Float32Array(N);
  const plunge = terrain.plunge;

  for (let i = 0; i < N; i++) {
    respawn(i, 0, true);
  }
  function respawn(i) {
    const a = rng() * Math.PI * 2;
    const r = Math.pow(rng(), 0.6) * 0.030;
    pos[i * 3] = plunge.x + Math.cos(a) * r;
    pos[i * 3 + 1] = plunge.y + 0.005 + rng() * 0.02;
    pos[i * 3 + 2] = plunge.z + 0.012 + Math.sin(a) * r * 0.7;
    vel[i * 3] = (rng() - 0.5) * 0.09;
    vel[i * 3 + 1] = 0.05 + rng() * 0.10;
    vel[i * 3 + 2] = (rng() - 0.5) * 0.09 + 0.02;
    life[i] = 0;
    seed[i] = rng();
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const tex = softCircleTexture(64, 0.05, '230,250,255');
  const mat = new THREE.PointsMaterial({
    map: tex, size: 0.010, transparent: true, opacity: 0.50,
    depthWrite: false, blending: THREE.AdditiveBlending,
    sizeAttenuation: true, color: new THREE.Color('#dff7ff'),
  });
  const points = new THREE.Points(geo, mat);
  points.renderOrder = 6;

  return {
    points,
    update(dt) {
      for (let i = 0; i < N; i++) {
        life[i] += dt;
        if (life[i] > 1.7) { respawn(i); continue; }
        vel[i * 3 + 1] -= 0.20 * dt;
        pos[i * 3] += vel[i * 3] * dt;
        pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
        if (pos[i * 3 + 1] < plunge.y - 0.004) respawn(i);
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}
