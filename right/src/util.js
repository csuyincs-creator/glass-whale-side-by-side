import * as THREE from 'three';

export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Classic 2D perlin noise, roughly in [-1,1]. */
export function makePerlin(seed = 1337) {
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  let s = seed >>> 0;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

  const grad = (h, x, y) => {
    switch (h & 7) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      case 3: return -x - y;
      case 4: return x;
      case 5: return -x;
      case 6: return y;
      default: return -y;
    }
  };
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

  return function (x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const aa = perm[perm[X] + Y];
    const ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y];
    const bb = perm[perm[X + 1] + Y + 1];
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v) * 0.7071;
  };
}

export function makeFbm(noise) {
  return function fbm(x, y, oct = 4, lac = 2.05, gain = 0.5) {
    let a = 0.5, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      sum += a * noise(x * f, y * f);
      norm += a;
      a *= gain; f *= lac;
    }
    return sum / norm;
  };
}

export function makeRidged(noise) {
  return function ridged(x, y, oct = 4) {
    let a = 0.5, f = 1, sum = 0, norm = 0;
    for (let i = 0; i < oct; i++) {
      const n = 1 - Math.abs(noise(x * f, y * f));
      sum += a * (n * n);
      norm += a;
      a *= 0.5; f *= 2.1;
    }
    return sum / norm;
  };
}

export function sdRoundRect(x, z, cx, cz, hx, hz, r) {
  const qx = Math.abs(x - cx) - (hx - r);
  const qz = Math.abs(z - cz) - (hz - r);
  const ax = Math.max(qx, 0), az = Math.max(qz, 0);
  return Math.sqrt(ax * ax + az * az) + Math.min(Math.max(qx, qz), 0) - r;
}

export function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

export function softCircleTexture(size = 128, hardness = 0.18, tint = '255,255,255') {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, `rgba(${tint},1)`);
  g.addColorStop(hardness, `rgba(${tint},0.92)`);
  g.addColorStop(0.55, `rgba(${tint},0.32)`);
  g.addColorStop(1, `rgba(${tint},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Lumpy cloud puff: many soft blobs clustered together. */
export function cloudPuffTexture(size = 256, seed = 7) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  const rnd = mulberry32(seed);
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 34; i++) {
    const ang = rnd() * Math.PI * 2;
    const rr = Math.pow(rnd(), 0.62) * size * 0.23;
    const x = size / 2 + Math.cos(ang) * rr;
    const y = size / 2 + Math.sin(ang) * rr * 0.7;
    const rad = size * (0.09 + rnd() * 0.13);
    const g = ctx.createRadialGradient(x, y, rad * 0.05, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.50)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.24)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  // circular falloff so sprites never show a square edge
  const mask = ctx.createRadialGradient(size / 2, size / 2, size * 0.16, size / 2, size / 2, size * 0.5);
  mask.addColorStop(0, 'rgba(0,0,0,0)');
  mask.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = mask;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = 'source-over';
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function ringTexture(size = 128) {
  const c = makeCanvas(size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = size * 0.018;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.filter = 'blur(2px)';
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Environment map painted on a canvas: dark surround, one warm key, neutral bounce. */
export function makeEnvironment(renderer) {
  const W = 1024, H = 512;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');

  // neutral dark base -- a tinted base turns every roughness sample into
  // that colour and the whole scene goes magenta
  ctx.fillStyle = '#0e1116';
  ctx.fillRect(0, 0, W, H);

  const blob = (x, y, r, rgb, a) => {
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(${rgb},${a})`);
    rg.addColorStop(0.45, `rgba(${rgb},${a * 0.4})`);
    rg.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = rg;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };

  // warm key, straight overhead-right
  blob(W * 0.62, H * 0.26, 150, '255,238,214', 1.0);
  blob(W * 0.62, H * 0.26, 340, '255,228,196', 0.34);
  // gentle neutral fill opposite, plus a faint sky bounce from below
  blob(W * 0.14, H * 0.52, 260, '214,222,232', 0.30);
  blob(W * 0.85, H * 0.72, 220, '226,226,222', 0.20);
  blob(W * 0.45, H * 0.92, 320, '190,182,172', 0.16);

  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  tex.dispose();
  pmrem.dispose();
  return env;
}
