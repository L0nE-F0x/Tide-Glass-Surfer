import * as THREE from "three";

/** A recycled particle pool for spray, carve fans and wipeout bursts. */
export class Spray {
  readonly points: THREE.Points;
  private readonly count: number;
  private readonly pos: Float32Array;
  private readonly alpha: Float32Array;
  private readonly size: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private cursor = 0;
  private readonly geo: THREE.BufferGeometry;

  constructor(scene: THREE.Scene, count = 800) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.alpha = new Float32Array(count);
    this.size = new Float32Array(count);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count);

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.alpha, 1));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1));
    this.geo.setDrawRange(0, count);

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      // NormalBlending (not additive) so overlapping spray reads as soft foam
      // rather than stacking up into a glowing white blob.
      blending: THREE.NormalBlending,
      uniforms: { uColor: { value: new THREE.Color("#dfeefb") } },
      vertexShader: /* glsl */ `
        attribute float aAlpha;
        attribute float aSize;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // aSize is roughly the on-screen pixel size at ~14m; capped so a
          // particle near the camera can never balloon across the screen.
          gl_PointSize = min(64.0, aSize * (14.0 / max(-mv.z, 0.5)));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        precision mediump float;
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d, d);
          if (r > 0.25) discard;
          float soft = smoothstep(0.25, 0.0, r);
          gl_FragColor = vec4(uColor, vAlpha * soft);
        }
      `,
    });

    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    spread: number,
    size: number,
    life: number,
    n: number,
  ): void {
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.count;
      this.pos[i * 3 + 0] = x + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 1] = y + Math.random() * spread * 0.5;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * spread;
      this.vel[i * 3 + 0] = vx + (Math.random() - 0.5) * spread * 2.2;
      this.vel[i * 3 + 1] = vy + Math.random() * spread * 1.5;
      this.vel[i * 3 + 2] = vz + (Math.random() - 0.5) * spread * 2.2;
      this.life[i] = life * (0.7 + Math.random() * 0.5);
      this.maxLife[i] = this.life[i];
      this.size[i] = size * (0.6 + Math.random() * 0.8);
      this.alpha[i] = 1;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) {
          this.alpha[i] = 0;
          this.size[i] = 0;
        }
        continue;
      }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= 9.8 * dt; // gravity
      this.pos[i * 3 + 0] += this.vel[i * 3 + 0] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.alpha[i] = Math.max(0, this.life[i] / this.maxLife[i]) * 0.4;
    }
    (this.geo.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("aAlpha") as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.getAttribute("aSize") as THREE.BufferAttribute).needsUpdate = true;
  }
}
