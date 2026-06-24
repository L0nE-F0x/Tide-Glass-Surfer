import { clamp01, smoothstep } from "../util/math.ts";

/**
 * The single peeling wave.
 *
 * This replaces the old "ocean of random swells". Instead of summing a dozen
 * Gerstner waves, the field is ONE shaped, breaking wall that peels down the
 * line, exactly like a real surf break:
 *
 *   - the player rides *down the line* in +X;
 *   - the crest runs along X at a fixed cross-shore band (z = 0), the open face
 *     dropping away toward +Z;
 *   - a **curl** marches along the line forever ({@link WaveField.curlX}). The
 *     wave is a clean unbroken shoulder *ahead* of the curl (d > 0), throws over
 *     into a hollow barrel *at* the curl (d ~ 0), and is churning whitewater
 *     *behind* it (d < 0).
 *
 * As before, ONE surface function drives BOTH the renderer (the GLSL emitted by
 * {@link WaveField.glsl}) and the surfing physics ({@link WaveField.sample}), so
 * "the wave you see is the wave you ride". Surface position is the shaped wall;
 * the normal, height gradient and the displacement Jacobian (which goes negative
 * where the lip folds over — the barrel) are taken by central differences of the
 * exact same function on both the CPU and the GPU.
 */

/** All the knobs that define one wave type (a "spot"). Fed per-spot. */
export interface WaveParams {
  /** crest height above the mean water line (m) */
  wallHeight: number;
  /** cross-shore distance from crest to trough (m) — how wide the face is */
  faceWidth: number;
  /** how far the trough sits below the mean line (m) */
  troughDepth: number;
  /** distance behind the crest the back of the wave slopes to sea level (m) */
  backWidth: number;
  /** distance beyond the trough the face eases out to flat water (m) */
  flatWidth: number;
  /** how far down the line (m) the curl's pitching band reaches (hollowness) */
  barrelSigma: number;
  /** distance behind the curl (m) over which the standing wall collapses to flat */
  collapseWidth: number;
  /** how far behind the curl (m) the whitewater band runs before settling to flat */
  foamRun: number;
  /** how quickly (m) the whitewater ramps up just behind the curl */
  breakWidth: number;
  /** forward throw of the lip at full pitch (m) — bigger folds harder = barrel */
  lipThrow: number;
  /** vertical lift of the lip at full pitch (m) */
  lipLift: number;
  /** centre of the throwing band as a fraction of faceWidth (0 = crest) */
  lipCenter: number;
  /** width of the throwing band as a fraction of faceWidth */
  lipWidth: number;
  /** small surface chop amplitude (m) for life */
  chopAmp: number;
  /** how fast the curl peels down the line (m/s) */
  peelSpeed: number;
}

/** A reasonable, gentle default ("Cove"-like) so the field always has a shape. */
export const DEFAULT_WAVE: WaveParams = {
  wallHeight: 4.5,
  faceWidth: 10.0,
  troughDepth: 1.8,
  backWidth: 12.0,
  flatWidth: 18.0,
  barrelSigma: 9.0,
  collapseWidth: 16.0,
  foamRun: 26.0,
  breakWidth: 5.0,
  lipThrow: 4.4,
  lipLift: 1.0,
  lipCenter: 0.16,
  lipWidth: 0.17,
  chopAmp: 0.16,
  peelSpeed: 16.0,
};

/** Result of sampling the surface at a base (x,z) coordinate. */
export interface WaveSample {
  /** world-space displaced position */
  posX: number;
  posY: number;
  posZ: number;
  /** unit surface normal (+Y up) */
  nX: number;
  nY: number;
  nZ: number;
  /** height-field gradient over base coords (dY/dx, dY/dz) */
  gradX: number;
  gradZ: number;
  /** determinant of the horizontal displacement Jacobian (<1 compresses, <0 folds = barrel) */
  jacobian: number;
  /** down-the-line offset from the curl: >0 ahead (clean shoulder), <0 behind (broken) */
  curlDist: number;
  /** 0 ahead of the curl … 1 in the whitewater behind it */
  broken: number;
  /** 0 mellow shoulder … 1 fully pitching lip (the barrel band) */
  pitch: number;
  /** 0 at the crest/lip … 1 down at the trough (where on the face the board sits) */
  faceFrac: number;
}

const EPS = 0.25; // central-difference step (m) for normals / Jacobian

interface SurfPoint {
  px: number;
  py: number;
  pz: number;
  broken: number;
  pitch: number;
}

export class WaveField {
  readonly params: WaveParams;
  /** live amplitude multiplier (difficulty / energy ramp) */
  energy = 1.0;
  /** current along-line position of the curl; advanced by the game each frame */
  curlX = 0;

  constructor(params: WaveParams = DEFAULT_WAVE) {
    this.params = params;
  }

  get peelSpeed(): number {
    return this.params.peelSpeed;
  }

  /**
   * The shared surface function. Returns the displaced world position plus the
   * "broken" (whitewater) and "pitch" (barrel) scalars at a base coordinate.
   * The GLSL in {@link glsl} is a line-for-line mirror of this.
   */
  private surf(x: number, z: number, time: number): SurfPoint {
    const p = this.params;
    const e = this.energy;
    const A = p.wallHeight * e;
    const Lf = p.faceWidth;
    const Tr = p.troughDepth * e;

    // --- along-line envelopes ----------------------------------------------
    const d = x - this.curlX;
    const pitch = Math.exp(-(d * d) / (p.barrelSigma * p.barrelSigma)); // peak at the curl
    // the wall stands tall ahead of and at the curl, then collapses to flat
    // water behind it — so "the wave" is a moving wall, not an endless ridge
    const waveAmp = 0.05 + 0.95 * smoothstep(-p.collapseWidth, 0.0, d);
    // whitewater is a band just behind the curl that settles back to flat water
    const bd = -d; // distance behind the curl
    const broken = smoothstep(-0.5, p.breakWidth, bd) * smoothstep(p.foamRun, p.foamRun * 0.5, bd);

    // --- cross-shore wall profile (crest at z=0, face toward +z) ------------
    const hump = smoothstep(-p.backWidth, 0.0, z) * (1.0 - smoothstep(0.0, Lf, z));
    const qd = (z - Lf) / (0.6 * Lf);
    const dip = Math.exp(-qd * qd);
    let h = (A * hump - Tr * dip) * waveAmp;

    // --- lip pitch / overhang (the barrel) ---------------------------------
    const lipC = p.lipCenter * Lf;
    const lipW = p.lipWidth * Lf;
    const ql = (z - lipC) / lipW;
    const lipZone = Math.exp(-ql * ql);
    const throwZ = pitch * p.lipThrow * e * lipZone; // forward push of the lip band
    h += pitch * p.lipLift * e * lipZone; // lift the lip

    // --- chop / life (calmer on the flat water behind) ---------------------
    const ch =
      p.chopAmp *
      (Math.sin(z * 0.55 - time * 1.7 + x * 0.15) + 0.6 * Math.sin(x * 0.33 + time * 1.3));
    h += ch * (0.4 + 0.6 * hump) * (0.35 + 0.65 * waveAmp);

    // --- whitewater mound in the broken band -------------------------------
    const churn =
      0.16 * A * Math.sin(x * 0.8 + z * 0.9 + time * 5.0) * Math.sin(x * 0.5 - time * 3.3);
    const foamMound = 0.12 * A * hump + churn;
    h = h * (1.0 - broken * 0.7) + foamMound * (broken * 0.7);

    return {
      px: x + ch * 0.25,
      py: h,
      pz: z + throwZ,
      broken,
      pitch,
    };
  }

  /**
   * Sample the surface at base coordinate (x, z) and time. Returns the displaced
   * world position, unit normal, height gradient, Jacobian, and the gameplay
   * scalars (curl distance, broken, pitch, face fraction). Normal and Jacobian
   * are central differences of {@link surf} — the EXACT computation the GLSL does
   * per-vertex on the GPU.
   */
  sample(x: number, z: number, time: number): WaveSample {
    const c = this.surf(x, z, time);
    const px = this.surf(x + EPS, z, time);
    const pz = this.surf(x, z + EPS, time);

    // tangents dP/dx and dP/dz
    const txx = (px.px - c.px) / EPS;
    const txy = (px.py - c.py) / EPS;
    const txz = (px.pz - c.pz) / EPS;
    const tzx = (pz.px - c.px) / EPS;
    const tzy = (pz.py - c.py) / EPS;
    const tzz = (pz.pz - c.pz) / EPS;

    // normal = normalize(cross(dP/dz, dP/dx)) → +Y up
    let nX = tzy * txz - tzz * txy;
    let nY = tzz * txx - tzx * txz;
    let nZ = tzx * txy - tzy * txx;
    const len = Math.hypot(nX, nY, nZ) || 1;
    nX /= len;
    nY /= len;
    nZ /= len;
    if (nY < 0) {
      nX = -nX;
      nY = -nY;
      nZ = -nZ;
    }

    // horizontal Jacobian of (px,pz) over (x,z); <0 where the surface folds
    const jac = txx * tzz - tzx * txz;

    return {
      posX: c.px,
      posY: c.py,
      posZ: c.pz,
      nX,
      nY,
      nZ,
      gradX: txy,
      gradZ: tzy,
      jacobian: jac,
      curlDist: x - this.curlX,
      broken: c.broken,
      pitch: c.pitch,
      faceFrac: clamp01(z / this.params.faceWidth),
    };
  }

  /** Characteristic wave height — used to normalise "how high on the face". */
  amplitudeScale(): number {
    return this.params.wallHeight * this.energy;
  }

  /** Just the surface height (Y) at a base coord — cheaper for coarse needs. */
  height(x: number, z: number, time: number): number {
    return this.surf(x, z, time).py;
  }

  /**
   * GLSL that mirrors {@link surf} and {@link sample}. Defines `wpos(...)` (the
   * shared surface function) and `waveSurface(...)` which returns the displaced
   * position, normal, gradient, Jacobian and the broken/pitch scalars via
   * central differences — identical to the CPU path.
   */
  glsl(): string {
    return /* glsl */ `
      uniform float uTime;
      uniform float uEnergy;
      uniform float uCurlX;
      uniform float uWallHeight, uFaceWidth, uTroughDepth, uBackWidth, uFlatWidth;
      uniform float uBarrelSigma, uCollapseWidth, uFoamRun, uBreakWidth;
      uniform float uLipThrow, uLipLift, uLipCenter, uLipWidth;
      uniform float uChopAmp;

      vec3 wpos(vec2 b, out float broken, out float pitch) {
        float x = b.x, z = b.y;
        float A  = uWallHeight * uEnergy;
        float Lf = uFaceWidth;
        float Tr = uTroughDepth * uEnergy;

        float d = x - uCurlX;
        pitch  = exp(-(d * d) / (uBarrelSigma * uBarrelSigma));
        float waveAmp = 0.05 + 0.95 * smoothstep(-uCollapseWidth, 0.0, d);
        float bd = -d;
        broken = smoothstep(-0.5, uBreakWidth, bd) * smoothstep(uFoamRun, uFoamRun * 0.5, bd);

        float hump = smoothstep(-uBackWidth, 0.0, z) * (1.0 - smoothstep(0.0, Lf, z));
        float qd = (z - Lf) / (0.6 * Lf);
        float dip = exp(-qd * qd);
        float h = (A * hump - Tr * dip) * waveAmp;

        float lipC = uLipCenter * Lf;
        float lipW = uLipWidth * Lf;
        float ql = (z - lipC) / lipW;
        float lipZone = exp(-ql * ql);
        float throwZ = pitch * uLipThrow * uEnergy * lipZone;
        h += pitch * uLipLift * uEnergy * lipZone;

        float ch = uChopAmp * (sin(z * 0.55 - uTime * 1.7 + x * 0.15) + 0.6 * sin(x * 0.33 + uTime * 1.3));
        h += ch * (0.4 + 0.6 * hump) * (0.35 + 0.65 * waveAmp);

        float churn = 0.16 * A * sin(x * 0.8 + z * 0.9 + uTime * 5.0) * sin(x * 0.5 - uTime * 3.3);
        float foamMound = 0.12 * A * hump + churn;
        h = h * (1.0 - broken * 0.7) + foamMound * (broken * 0.7);

        return vec3(x + ch * 0.25, h, z + throwZ);
      }

      void waveSurface(
        in vec2 base,
        out vec3 worldPos,
        out vec3 normal,
        out vec2 grad,
        out float jacobian,
        out float broken,
        out float pitch
      ) {
        float e = ${EPS.toFixed(3)};
        float bk, pt, d0, d1;
        vec3 c  = wpos(base, broken, pitch);
        vec3 pX = wpos(base + vec2(e, 0.0), d0, d1);
        vec3 pZ = wpos(base + vec2(0.0, e), d0, d1);

        vec3 Tx = (pX - c) / e;
        vec3 Tz = (pZ - c) / e;
        normal = normalize(cross(Tz, Tx));
        if (normal.y < 0.0) normal = -normal;

        jacobian = Tx.x * Tz.z - Tz.x * Tx.z;
        grad = vec2(Tx.y, Tz.y);
        worldPos = c;
      }
    `;
  }
}
