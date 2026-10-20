import * as THREE from 'three';

const FS_VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const QUAD_GEO = new THREE.PlaneGeometry(2, 2);

export class PostChain {
  constructor(renderer, width, height, dpr) {
    this.renderer = renderer;
    this.dpr = dpr;
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    this.brightRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.halfA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.halfB = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.quarterA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.quarterB = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.eighthA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.eighthB = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.raysA = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.raysB = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });

    this.quad = new THREE.Mesh(QUAD_GEO, null);
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene();
    this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.brightMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uThreshold: { value: 2.6 },
        uSoft: { value: 0.9 },
      },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float uThreshold;
        uniform float uSoft;
        varying vec2 vUv;
        void main() {
          vec3 c = texture2D(tDiffuse, vUv).rgb;
          float l = max(max(c.r, c.g), c.b);
          float k = smoothstep(uThreshold - uSoft, uThreshold + uSoft, l);
          gl_FragColor = vec4(c * k, 1.0);
        }
      `,
      depthTest: false, depthWrite: false,
    });

    this.blurMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uDir: { value: new THREE.Vector2(1, 0) },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uRadius: { value: 1.0 },
      },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform vec2 uDir;
        uniform vec2 uTexel;
        uniform float uRadius;
        varying vec2 vUv;
        void main() {
          vec2 step = uDir * uTexel * uRadius;
          vec3 sum = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
          sum += texture2D(tDiffuse, vUv + step * 1.3846153846).rgb * 0.3162162162;
          sum += texture2D(tDiffuse, vUv - step * 1.3846153846).rgb * 0.3162162162;
          sum += texture2D(tDiffuse, vUv + step * 3.2307692308).rgb * 0.0702702703;
          sum += texture2D(tDiffuse, vUv - step * 3.2307692308).rgb * 0.0702702703;
          gl_FragColor = vec4(sum, 1.0);
        }
      `,
      depthTest: false, depthWrite: false,
    });

    this.raysMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uSun: { value: new THREE.Vector2(0.5, 0.5) },
        uDensity: { value: 0.45 },
        uDecay: { value: 0.94 },
        uWeight: { value: 0.55 },
        uSunI: { value: 1.0 },
      },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform vec2 uSun;
        uniform float uDensity;
        uniform float uDecay;
        uniform float uWeight;
        uniform float uSunI;
        varying vec2 vUv;
        void main() {
          const int SAMPLES = 22;
          vec3 acc = vec3(0.0);
          vec2 uv = vUv;
          float illum = 1.0;
          vec2 delta = (uv - uSun) * (uDensity / float(SAMPLES));
          for (int i = 0; i < SAMPLES; i++) {
            uv -= delta;
            vec3 s = texture2D(tDiffuse, uv).rgb;
            s = max(s - vec3(1.6), vec3(0.0));
            acc += s * illum;
            illum *= uDecay;
          }
          acc /= float(SAMPLES);
          acc = min(acc, vec3(0.55));
          float d = distance(vUv, uSun);
          acc *= smoothstep(0.10, 0.62, d);
          gl_FragColor = vec4(acc * uWeight * uSunI, 1.0);
        }
      `,
      depthTest: false, depthWrite: false,
    });

    this.compMat = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null },
        tBloom: { value: null },
        tRays: { value: null },
        uSunPos: { value: new THREE.Vector2(0.5, 0.5) },
        uSunColor: { value: new THREE.Color('#ffe6c0') },
        uAspect: { value: 1 },
        uFocus: { value: 0.5 },
        uFocusWidth: { value: 0.16 },
        uBlurMax: { value: 2.2 },
        uTiltAngle: { value: 0.0 },
        uVignette: { value: 1.0 },
        uGrain: { value: 0.035 },
        uChroma: { value: 0.9 },
        uExposure: { value: 1.0 },
        uSaturation: { value: 1.04 },
        uWarm: { value: 0.0 },
        uTime: { value: 0 },
        uBloomStrength: { value: 0.9 },
        uRaysStrength: { value: 0.55 },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: FS_VERT,
      fragmentShader: /* glsl */`
        uniform sampler2D tScene;
        uniform sampler2D tBloom;
        uniform sampler2D tRays;
        uniform vec2 uSunPos;
        uniform vec3 uSunColor;
        uniform float uAspect;
        uniform float uFocus;
        uniform float uFocusWidth;
        uniform float uBlurMax;
        uniform float uTiltAngle;
        uniform float uVignette;
        uniform float uGrain;
        uniform float uChroma;
        uniform float uExposure;
        uniform float uSaturation;
        uniform float uWarm;
        uniform float uTime;
        uniform float uBloomStrength;
        uniform float uRaysStrength;
        uniform vec2 uResolution;
        varying vec2 vUv;

        vec3 aces(vec3 x) {
          const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
          return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
        }
        float hash12(vec2 p) {
          vec3 p3 = fract(vec3(p.xyx) * 0.1031);
          p3 += dot(p3, p3.yzx + 33.33);
          return fract((p3.x + p3.y) * p3.z);
        }
        float blurAmount(vec2 uv) {
          // tilt-shift: sharp band across the middle, blur toward top & bottom
          float ca = cos(uTiltAngle), sa = sin(uTiltAngle);
          vec2 c = uv - 0.5;
          float v = c.x * sa + c.y * ca;
          float d = abs(v - (uFocus - 0.5));
          float t = smoothstep(uFocusWidth, uFocusWidth + 0.34, d);
          return t * uBlurMax;
        }

        void main() {
          vec2 uv = vUv;
          float blur = blurAmount(uv);

          // Chromatic aberration is off by default (uChroma 0): on hairline
          // geometry it separates into coloured fringes.
          vec2 fromCenter = uv - 0.5;
          float caAmt = uChroma * (0.0003 + 0.0008 * dot(fromCenter, fromCenter) * 4.0);

          vec3 col;
          if (blur < 0.08) {
            col = texture2D(tScene, uv).rgb;
          } else {
            // Separable vertical blur: a tilt-shift lens only needs vertical
            // defocus, and vertical-only taps keep straight edges straight.
            // Spiral/poisson taps turned every thin line into a fan of
            // ghosts, which is exactly what the glass edges used to do.
            float radius = blur * 0.013;
            vec3 acc = vec3(0.0);
            float total = 0.0;
            const int TAPS = 15;
            for (int i = 0; i < TAPS; i++) {
              float fi = float(i) - float(TAPS - 1) * 0.5;
              float t = fi / (float(TAPS - 1) * 0.5);
              float w = exp(-t * t * 2.2);
              acc += texture2D(tScene, uv + vec2(0.0, fi * radius / (float(TAPS - 1) * 0.5))).rgb * w;
              total += w;
            }
            col = acc / total;
          }

          // Chromatic aberration only when it is actually asked for. Running
          // the split at caAmt = 0 still made green come from the BLURRED
          // colour while red/blue came from the sharp one, which turned every
          // hairline edge into a magenta line with a green ghost.
          if (uChroma > 0.001) {
            vec3 chr;
            chr.r = texture2D(tScene, uv + vec2(caAmt, 0.0)).r;
            chr.g = texture2D(tScene, uv).g;
            chr.b = texture2D(tScene, uv - vec2(caAmt, 0.0)).b;
            col = mix(col, chr, 0.6);
          }

          // bloom + god rays
          vec4 bloom = texture2D(tBloom, uv);
          vec3 rays = texture2D(tRays, uv).rgb;
          col += bloom.rgb * uBloomStrength;
          col += rays * uSunColor * uRaysStrength;

          // sun glow in screen space
          float sd = distance(uv * vec2(uAspect, 1.0), uSunPos * vec2(uAspect, 1.0));
          col += uSunColor * smoothstep(0.55, 0.0, sd) * 0.10;

          // exposure + filmic tonemap
          col *= uExposure;
          // gentle contrast S-curve before the tonemap keeps the shadows alive
          col = max(col - 0.004, 0.0);
          col = aces(col);

          // grade
          float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
          col = mix(vec3(lum), col, uSaturation);
          col += vec3(uWarm * 0.035, uWarm * 0.012, -uWarm * 0.028);

          // vignette
          vec2 vc = uv - 0.5;
          float vig = 1.0 - dot(vc, vc) * 1.25 * uVignette;
          col *= clamp(vig, 0.0, 1.0);

          // subtle film grain
          float g = hash12(uv * uResolution + uTime * 60.0) - 0.5;
          col += g * uGrain;

          // linear -> sRGB
          col = pow(max(col, 0.0), vec3(1.0 / 2.2));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
      depthTest: false, depthWrite: false,
    });

    this.setSize(width, height, dpr);
  }

  setSize(width, height, dpr) {
    const W = Math.max(2, Math.floor(width * dpr));
    const H = Math.max(2, Math.floor(height * dpr));
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.sceneRT.setSize(W, H);
    this.brightRT.setSize(W >> 1, H >> 1);
    this.halfA.setSize(W >> 1, H >> 1);
    this.halfB.setSize(W >> 1, H >> 1);
    this.quarterA.setSize(W >> 2, H >> 2);
    this.quarterB.setSize(W >> 2, H >> 2);
    this.eighthA.setSize(W >> 3, H >> 3);
    this.eighthB.setSize(W >> 3, H >> 3);
    this.raysA.setSize(W >> 1, H >> 1);
    this.raysB.setSize(W >> 1, H >> 1);
    this.W = W; this.H = H;
    this.compMat.uniforms.uAspect.value = W / H;
    this.compMat.uniforms.uResolution.value.set(W, H);
  }

  blit(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.clear();
    this.renderer.render(this.quadScene, this.quadCam);
  }

  blurPass(src, dst, radius, w, h) {
    this.blurMat.uniforms.tDiffuse.value = src.texture;
    this.blurMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.blurMat.uniforms.uDir.value.set(1, 0);
    this.blurMat.uniforms.uRadius.value = radius;
    this.blit(this.blurMat, dst);
  }

  render(scene, camera, opts) {
    const r = this.renderer;
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(scene, camera);

    // bright pass at half res
    this.brightMat.uniforms.tDiffuse.value = this.sceneRT.texture;
    this.blit(this.brightMat, this.brightRT);

    // bloom mip chain
    this.blurMat.uniforms.tDiffuse.value = this.brightRT.texture;
    this.blurMat.uniforms.uTexel.value.set(2 / this.W, 2 / this.H);
    this.blurMat.uniforms.uDir.value.set(1, 0);
    this.blurMat.uniforms.uRadius.value = 1.0;
    this.blit(this.blurMat, this.halfA);
    this.blurMat.uniforms.tDiffuse.value = this.halfA.texture;
    this.blurMat.uniforms.uDir.value.set(0, 1);
    this.blit(this.blurMat, this.halfB);

    this.blurMat.uniforms.tDiffuse.value = this.halfB.texture;
    this.blurMat.uniforms.uTexel.value.set(4 / this.W, 4 / this.H);
    this.blurMat.uniforms.uDir.value.set(1, 0);
    this.blurMat.uniforms.uRadius.value = 1.2;
    this.blit(this.blurMat, this.quarterA);
    this.blurMat.uniforms.tDiffuse.value = this.quarterA.texture;
    this.blurMat.uniforms.uDir.value.set(0, 1);
    this.blit(this.blurMat, this.quarterB);

    this.blurMat.uniforms.tDiffuse.value = this.quarterB.texture;
    this.blurMat.uniforms.uTexel.value.set(8 / this.W, 8 / this.H);
    this.blurMat.uniforms.uDir.value.set(1, 0);
    this.blurMat.uniforms.uRadius.value = 1.5;
    this.blit(this.blurMat, this.eighthA);
    this.blurMat.uniforms.tDiffuse.value = this.eighthA.texture;
    this.blurMat.uniforms.uDir.value.set(0, 1);
    this.blit(this.blurMat, this.eighthB);

    // screen-space god rays traced from the bright pass toward the sun
    this.raysMat.uniforms.tDiffuse.value = this.brightRT.texture;
    this.raysMat.uniforms.uSun.value.copy(opts.sunScreen);
    this.raysMat.uniforms.uSunI.value = opts.sunIntensity;
    this.raysMat.uniforms.uWeight.value = opts.raysWeight;
    this.blit(this.raysMat, this.raysA);

    // composite
    const u = this.compMat.uniforms;
    u.tScene.value = this.sceneRT.texture;
    u.tBloom.value = this.eighthB.texture;
    u.tRays.value = this.raysA.texture;
    u.uSunPos.value.copy(opts.sunScreen);
    u.uSunColor.value.copy(opts.sunColor);
    u.uTime.value = opts.time;
    u.uFocus.value = opts.focus;
    u.uFocusWidth.value = opts.focusWidth;
    u.uBlurMax.value = opts.blurMax;
    u.uTiltAngle.value = opts.tiltAngle;
    u.uExposure.value = opts.exposure;
    u.uWarm.value = opts.warm;
    u.uVignette.value = opts.vignette;
    u.uGrain.value = opts.grain;
    u.uChroma.value = opts.chroma;
    u.uSaturation.value = opts.saturation;
    u.uBloomStrength.value = opts.bloom;
    u.uRaysStrength.value = opts.rays;
    this.blit(this.compMat, null);
  }
}

export function resizeTarget(rt, w, h) {
  rt.setSize(Math.max(2, w), Math.max(2, h));
}
