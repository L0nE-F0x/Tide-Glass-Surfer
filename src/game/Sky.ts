import * as THREE from "three";

/**
 * Shared scene palette so the ocean, spray and scenery all sit under the same
 * sunset. Warm low light, deep indigo overhead, glassy teal water that picks up
 * the orange horizon.
 */
export const Palette = {
  zenith: new THREE.Color("#21285a"),
  horizon: new THREE.Color("#ff9e5e"),
  sun: new THREE.Color("#ffdca8"),
  deep: new THREE.Color("#08283f"),
  shallow: new THREE.Color("#1c6f93"),
  foam: new THREE.Color("#fff4e8"),
  fog: new THREE.Color("#e7a877"),
  sand: new THREE.Color("#e8c79a"),
  palm: new THREE.Color("#2f6b46"),
};

/** Direction *to* the sun (world space): low on the horizon, down the line — you
 * surf into the sunset. Long, warm, glassy highlights. */
export const SUN_DIR = new THREE.Vector3(0.78, 0.13, -0.34).normalize();

const skyVert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_Position.z = gl_Position.w; // force the dome to the far plane
  }
`;

const skyFrag = /* glsl */ `
  precision highp float;
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uSun;
  uniform vec3 uSunDir;
  uniform float uTime;
  varying vec3 vDir;

  // cheap value noise for cloud bands
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.02; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 dir = normalize(vDir);
    vec3 sun = normalize(uSunDir);
    float h = clamp(dir.y, 0.0, 1.0);

    // vertical gradient: warm peach low -> rose mid -> deep indigo high
    vec3 mid = mix(uHorizon, uZenith, 0.5) * 1.05;
    vec3 sky = mix(uHorizon, mid, smoothstep(0.0, 0.28, dir.y));
    sky = mix(sky, uZenith, smoothstep(0.18, 0.75, dir.y));

    // sun glow spreads warmth into the surrounding sky and along the horizon
    float d = max(dot(dir, sun), 0.0);
    float glow = pow(d, 6.0);
    sky += uSun * glow * 0.6;
    float horizonBand = smoothstep(0.16, 0.0, abs(dir.y)) * smoothstep(0.2, 0.9, d);
    sky = mix(sky, uSun, horizonBand * 0.5);

    // the sun disc + tight halo
    float disc = smoothstep(0.9975, 0.9992, d);
    float halo = pow(d, 220.0);
    sky += uSun * (disc * 1.4 + halo * 0.9);

    // cloud bands: drifting fbm, banded by height, lit warm toward the sun
    if (dir.y > -0.02) {
      vec2 cp = dir.xz / max(dir.y + 0.18, 0.08);
      float clouds = fbm(cp * 1.4 + vec2(uTime * 0.012, uTime * 0.004));
      clouds = smoothstep(0.55, 0.95, clouds);
      float band = smoothstep(0.5, 0.06, dir.y) * smoothstep(-0.02, 0.1, dir.y);
      vec3 cloudCol = mix(uZenith * 1.1, uSun, glow * 0.8 + 0.25);
      sky = mix(sky, cloudCol, clouds * band * 0.85);
    }

    gl_FragColor = vec4(sky, 1.0);
  }
`;

export class Sky {
  readonly mesh: THREE.Mesh;
  readonly sunLight: THREE.DirectionalLight;
  readonly hemiLight: THREE.HemisphereLight;
  readonly fillLight: THREE.DirectionalLight;
  private readonly mat: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.SphereGeometry(1, 128, 64);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: Palette.zenith },
        uHorizon: { value: Palette.horizon },
        uSun: { value: Palette.sun },
        uSunDir: { value: SUN_DIR },
        uTime: { value: 0 },
      },
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    scene.add(this.mesh);

    // warm low key light from the sun
    this.sunLight = new THREE.DirectionalLight(new THREE.Color("#ffcf99").getHex(), 2.1);
    this.sunLight.position.copy(SUN_DIR).multiplyScalar(120);
    scene.add(this.sunLight);

    // cool sky fill from above, warm bounce from the water below
    this.hemiLight = new THREE.HemisphereLight(Palette.zenith.getHex(), Palette.horizon.getHex(), 0.8);
    scene.add(this.hemiLight);

    // a soft cool counter-fill so shadowed sides aren't pure black
    this.fillLight = new THREE.DirectionalLight(new THREE.Color("#5a6ea8").getHex(), 0.4);
    this.fillLight.position.set(-0.4, 0.5, 0.7).multiplyScalar(100);
    scene.add(this.fillLight);

    scene.fog = new THREE.FogExp2(Palette.fog.getHex(), 0.0016);
    scene.background = Palette.horizon.clone();
  }

  /** Keep the dome centred on the camera and drift the clouds. */
  follow(camPos: THREE.Vector3, time = 0): void {
    this.mesh.position.copy(camPos);
    this.mat.uniforms.uTime.value = time;
  }
}
