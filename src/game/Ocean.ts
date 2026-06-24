import * as THREE from "three";
import { Palette, SUN_DIR } from "./Sky.ts";
import type { WaveField } from "./waves.ts";

/**
 * The visible ocean. A single large grid, denser toward the centre and stretched
 * out to the horizon, displaced in the vertex shader by the SAME waveSurface()
 * function the physics samples on the CPU. The grid follows the board so detail
 * stays under the surfer; the wave uses absolute world coords so the swell wall
 * and its peeling curl appear fixed in the world rather than sliding with the
 * camera.
 */

function buildGrid(segments: number, half: number, exponent: number): THREE.BufferGeometry {
  const verts = segments + 1;
  const positions = new Float32Array(verts * verts * 3);
  const warp = (t: number): number => {
    const u = t * 2 - 1; // [-1,1]
    return Math.sign(u) * Math.pow(Math.abs(u), exponent) * half;
  };
  let p = 0;
  for (let j = 0; j < verts; j++) {
    const z = warp(j / segments);
    for (let i = 0; i < verts; i++) {
      positions[p++] = warp(i / segments);
      positions[p++] = 0;
      positions[p++] = z;
    }
  }
  const indices: number[] = [];
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * verts + i;
      const b = a + 1;
      const c = a + verts;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform vec3 uDeep, uShallow, uFoam, uSkyTop, uSkyHorizon, uSunColor, uSunDir, uFog;
  uniform float uFogDensity;
  uniform float uTime;
  uniform float uQuality;
  varying vec3 vWorldPos;
  varying vec3 vNormalW;
  varying float vJac;
  varying float vBroken;

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
  }
  float fbm(vec2 p){ float v=0.0,a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }

  void main() {
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(cameraPosition - vWorldPos);
    if (dot(N, V) < 0.0) N = -N;
    vec3 sun = normalize(uSunDir);

    // small-scale detail normal: livens the surface and drives the sparkle
    // (skipped on the lowest quality tier to keep weak GPUs smooth)
    vec2 duv = vWorldPos.xz;
    vec3 Nd = N;
    if (uQuality > 0.5) {
      float nx = fbm(duv * 0.7 + vec2(uTime * 0.22, uTime * 0.15)) - 0.5;
      float nz = fbm(duv * 0.7 + vec2(-uTime * 0.18, uTime * 0.2)) - 0.5;
      Nd = normalize(N + vec3(nx, 0.0, nz) * 0.35);
    }

    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(Nd, V), 0.0), 5.0);

    vec3 R = reflect(-V, Nd);
    float ry = clamp(R.y, 0.0, 1.0);
    vec3 sky = mix(uSkyHorizon, uSkyTop, pow(ry, 0.5));
    float sunR = max(dot(R, sun), 0.0);
    // broad warm sun-reflection column streaming across the water
    sky += uSunColor * pow(sunR, 30.0) * 0.5;
    // tight sun glint
    sky += uSunColor * min(pow(sunR, 800.0) * 1.2, 1.0);
    // animated sun glitter — twinkling specks along the sun path (bloom catches these)
    if (uQuality > 0.5) {
      float tw = noise(duv * 3.3 + vec2(uTime * 0.9, -uTime * 0.7));
      sky += uSunColor * pow(sunR, 120.0) * smoothstep(0.45, 0.9, tw) * 1.5;
    }

    float depth = clamp(0.5 - vWorldPos.y * 0.05, 0.0, 1.0);
    vec3 body = mix(uShallow, uDeep, depth);
    float sss = pow(max(dot(V, -sun), 0.0), 3.0) * clamp(vWorldPos.y * 0.12 + 0.2, 0.0, 1.0);
    body += uShallow * sss * 0.7;

    vec3 col = mix(body, sky, fres);
    vec3 H = normalize(V + sun);
    col += uSunColor * pow(max(dot(Nd, H), 0.0), 90.0) * 0.7;

    // foam: where the lip folds (jac < 0 = barrel curtain), behind the broken
    // curl, and a thin band of foam along the crest line. Textured with fbm so it
    // reads as churning whitewater rather than flat paint.
    float foldFoam = smoothstep(0.6, -0.15, vJac);
    float crestFoam = smoothstep(0.95, 0.55, vJac) * smoothstep(0.55, 0.95, vJac); // thin line near jac~0.75
    float foamMask = clamp(max(max(foldFoam, vBroken), crestFoam * 0.6), 0.0, 1.0);
    // churning texture: two fbm octaves drifting at different rates
    float churn = fbm(vWorldPos.xz * 0.22 + vec2(uTime * 0.6, -uTime * 0.4))
                * fbm(vWorldPos.xz * 0.6 - vec2(uTime * 0.9, uTime * 0.5));
    float foam = smoothstep(0.15, 0.8, foamMask * (0.5 + 1.6 * churn));
    // streaky foam lines trailing down the face on the broken water
    float streak = smoothstep(0.5, 0.95, fbm(vWorldPos.xz * vec2(0.5, 0.12) + vec2(0.0, uTime * 0.8)));
    foam = clamp(max(foam, vBroken * streak), 0.0, 1.0);
    vec3 foamCol = mix(uFoam * 0.8, uFoam, churn);
    col = mix(col, foamCol, foam);

    float dist = length(cameraPosition - vWorldPos);
    float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    col = mix(col, uFog, clamp(fogF, 0.0, 1.0));

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Ocean {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly field: WaveField;

  constructor(scene: THREE.Scene, field: WaveField) {
    this.field = field;
    const geo = buildGrid(220, 1300, 1.9);
    const p = field.params;

    const vertexShader = /* glsl */ `
      ${field.glsl()}
      uniform vec2 uOrigin;
      varying vec3 vWorldPos;
      varying vec3 vNormalW;
      varying float vJac;
      varying float vBroken;
      void main() {
        vec2 base = position.xz + uOrigin;
        vec3 wp; vec3 nrm; vec2 grad; float jac; float broken; float pitch;
        waveSurface(base, wp, nrm, grad, jac, broken, pitch);
        vWorldPos = wp;
        vNormalW = nrm;
        vJac = jac;
        vBroken = broken;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }
    `;

    this.mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uEnergy: { value: field.energy },
        uCurlX: { value: field.curlX },
        uWallHeight: { value: p.wallHeight },
        uFaceWidth: { value: p.faceWidth },
        uTroughDepth: { value: p.troughDepth },
        uBackWidth: { value: p.backWidth },
        uFlatWidth: { value: p.flatWidth },
        uBarrelSigma: { value: p.barrelSigma },
        uCollapseWidth: { value: p.collapseWidth },
        uFoamRun: { value: p.foamRun },
        uBreakWidth: { value: p.breakWidth },
        uLipThrow: { value: p.lipThrow },
        uLipLift: { value: p.lipLift },
        uLipCenter: { value: p.lipCenter },
        uLipWidth: { value: p.lipWidth },
        uChopAmp: { value: p.chopAmp },
        uOrigin: { value: new THREE.Vector2(0, 0) },
        uDeep: { value: Palette.deep },
        uShallow: { value: Palette.shallow },
        uFoam: { value: Palette.foam },
        uSkyTop: { value: Palette.zenith },
        uSkyHorizon: { value: Palette.horizon },
        uSunColor: { value: Palette.sun },
        uSunDir: { value: SUN_DIR },
        uFog: { value: Palette.fog },
        uFogDensity: { value: 0.0016 },
        uQuality: { value: 1 },
      },
    });

    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  /** 1 = full detail water (sparkle + glitter), 0 = simplified for weak GPUs. */
  setQuality(q: number): void {
    this.mat.uniforms.uQuality.value = q;
  }

  update(time: number, boardX: number, boardZ: number): void {
    const u = this.mat.uniforms;
    u.uTime.value = time;
    u.uEnergy.value = this.field.energy;
    u.uCurlX.value = this.field.curlX;
    // snap the lattice origin so vertices don't shimmer as it follows the board
    const snap = 2.0;
    const ox = Math.round(boardX / snap) * snap;
    const oz = Math.round(boardZ / snap) * snap;
    (u.uOrigin.value as THREE.Vector2).set(ox, oz);
  }
}
