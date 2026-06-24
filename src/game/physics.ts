import { Balance } from "../config/balance.ts";
import type { Input } from "../input/input.ts";
import { clamp, clamp01, damp, smoothstep } from "../util/math.ts";
import type { WaveField, WaveSample } from "./waves.ts";

/** Per-board stat multipliers applied on top of the base balance constants. */
export interface SurferStats {
  dragMul: number;
  turnMul: number;
  pumpMul: number;
}

export type WipeoutReason =
  | "Pearled the nose"
  | "Caught behind the section"
  | "Lost the wave"
  | "Blew the landing"
  | "Stalled out";

export type TrickName = "Off the Lip" | "Cutback" | "Floater" | "Air" | "Barrel";

/** A scored trick this frame, for the HUD popup / audio / FX. */
export interface TrickEvent {
  name: TrickName;
  /** points actually banked (already multiplied by style + combo) */
  points: number;
  /** combo count after this trick */
  combo: number;
  /** extra label, e.g. "360" for a full spin */
  tag?: string;
}

/** Transient events a single physics step can emit (for FX / audio / scoring). */
export interface SurferEvents {
  pump?: "good" | "scrub";
  pumpQuality?: number;
  enteredBarrel?: boolean;
  airLaunch?: number; // launch speed if the board left the lip
  trick?: TrickEvent;
  wipeout?: WipeoutReason;
}

/**
 * The surfer model. Pure simulation: it knows nothing about Three.js. It samples
 * the SAME {@link WaveField} the renderer draws and rides the one peeling wave:
 * heading is held within ~77° of "down the line", so steering climbs toward the
 * lip or drops toward the trough while the board always advances down the line.
 * A pocket-driven wave push lets a good line race the curl; tricks are detected
 * contextually from position + steer/pump/tuck.
 */
export class Surfer {
  // base-plane state (physics integrates here; render position is the displaced point)
  x = 0;
  z = 0;
  heading = 0;
  speed: number = Balance.vStart;
  steer = 0;

  // derived render state (filled each update from the wave sample)
  sample!: WaveSample;
  bank = 0;
  airborne = false;
  airHeight = 0; // metres above the surface while airborne

  // gameplay state
  /** Style multiplier ceiling — raised by harder spots. */
  flowCeiling: number = Balance.flowMax;
  flow: number = Balance.flowMin;
  pocketScore = 0;
  foam = 0;
  inBarrel = false;
  barrelTime = 0;
  combo = 0;
  score = 0;
  runTime = 0;
  barrels = 0;
  bestTrick = 0;
  alive = true;
  wipeoutReason: WipeoutReason | null = null;

  // timers / latches
  private pumpCd = 0;
  private stallTimer = 0;
  private caughtTimer = 0;
  private lostTimer = 0;
  private barrelGap = 1; // time since last barrel, to count distinct barrels
  private vy = 0; // vertical velocity while airborne
  private trickCd = 0;
  private carveArm = 0; // last committed steer direction, for flip detection
  private floaterTime = 0;
  private airTime = 0;
  private airSpin = 0; // radians rotated while airborne
  private airLaunchSpeed = 0;

  reset(x: number, z: number, heading: number): void {
    this.x = x;
    this.z = z;
    this.heading = heading;
    this.speed = Balance.vStart;
    this.steer = 0;
    this.bank = 0;
    this.airborne = false;
    this.airHeight = 0;
    this.vy = 0;
    this.flow = Balance.flowMin;
    this.pocketScore = 0;
    this.foam = 0;
    this.inBarrel = false;
    this.barrelTime = 0;
    this.combo = 0;
    this.score = 0;
    this.runTime = 0;
    this.barrels = 0;
    this.bestTrick = 0;
    this.alive = true;
    this.wipeoutReason = null;
    this.pumpCd = 0;
    this.stallTimer = 0;
    this.caughtTimer = 0;
    this.lostTimer = 0;
    this.barrelGap = 1;
    this.trickCd = 0;
    this.carveArm = 0;
    this.floaterTime = 0;
    this.airTime = 0;
    this.airSpin = 0;
    this.airLaunchSpeed = 0;
  }

  update(dt: number, input: Input, field: WaveField, time: number, stats: SurferStats): SurferEvents {
    const ev: SurferEvents = {};
    if (!this.alive) return ev;
    this.runTime += dt;
    this.pumpCd -= dt;
    this.trickCd -= dt;

    const B = Balance;
    const s = field.sample(this.x, this.z, time);
    this.sample = s;

    // --- wave-relative bearings ---------------------------------------------
    const d = s.curlDist; // >0 ahead of the curl, <0 behind
    const faceFrac = s.faceFrac; // 0 crest .. 1 trough
    const faceSteep = Math.hypot(s.gradX, s.gradZ);
    this.foam = clamp01(s.broken);

    // --- steering ------------------------------------------------------------
    this.steer = damp(this.steer, input.steerTarget, B.steerResponse, dt);
    const turnAuth = clamp01(0.4 + this.speed / B.turnSpeedFloor);

    if (this.airborne) {
      // free spin in the air
      this.heading += this.steer * B.turnRate * 1.6 * dt;
      this.airSpin += Math.abs(this.steer) * B.turnRate * 1.6 * dt;
    } else {
      // steering sets the angle on the face: 0 = trim down the line, + = drop
      // toward the trough (gain speed), - = climb to the lip. Releasing the stick
      // returns the board to trim, so it never spins out and is easy to control.
      const target = this.steer * B.headingClamp;
      this.heading = damp(this.heading, target, B.turnRate * stats.turnMul * turnAuth, dt);
    }
    this.bank = damp(this.bank, -this.steer, 6, dt);

    const hx = Math.cos(this.heading);
    const hz = Math.sin(this.heading);
    const slopeAlong = s.gradX * hx + s.gradZ * hz; // +uphill ahead, -downhill ahead

    // --- pocket --------------------------------------------------------------
    const faceQ = smoothstep(B.faceTolerance, 0, Math.abs(faceFrac - B.faceSweet));
    const cd = (d - B.curlSweet) / B.curlTolerance;
    const curlQ = Math.exp(-cd * cd) * smoothstep(B.caughtMargin, 0.5, d); // dies behind the curl
    const steepQ = clamp01(faceSteep / 0.5);
    let pocket = B.pocketFaceWeight * faceQ + B.pocketCurlWeight * curlQ + B.pocketSteepWeight * steepQ;

    // --- barrel --------------------------------------------------------------
    const folding = s.jacobian < B.barrelJacobian;
    const wasInBarrel = this.inBarrel;
    this.inBarrel = input.tuckHeld && folding && faceFrac < 0.6 && d > B.caughtMargin && !this.airborne;
    this.barrelGap += dt;
    if (this.inBarrel) {
      pocket += B.pocketBarrelBonus;
      this.barrelTime += dt;
      this.score += B.scoreBarrelPerSec * this.flow * dt;
      if (!wasInBarrel && this.barrelGap > 0.5) {
        this.barrels += 1;
        this.barrelGap = 0;
        ev.enteredBarrel = true;
      }
    } else if (wasInBarrel && this.barrelTime > 0.4) {
      // made it out of the tube — bank an exit bonus
      const bonus = Math.round(B.barrelExitBonus * this.barrelTime * this.flow);
      this.bankTrick(ev, "Barrel", bonus, "made");
      this.barrelTime = 0;
    } else if (!this.inBarrel) {
      this.barrelTime = 0;
    }
    this.pocketScore = clamp01(pocket);

    // --- gravity on the face + wave push down the line -----------------------
    const aGrav = B.gravity * s.nY * (s.nX * hx + s.nZ * hz);
    this.speed += aGrav * dt;
    if (!this.airborne) {
      // push is driven by how close to the curl the board sits, so pulling far
      // ahead onto the shoulder starves it and the board settles near the pocket
      const aPush = B.pushGain * curlQ * steepQ * Math.max(0, hx);
      this.speed += aPush * dt;
    }

    // --- drag ----------------------------------------------------------------
    const baseDrag = (input.tuckHeld ? B.dragTuck : B.drag) * stats.dragMul;
    const drag = baseDrag + this.foam * B.dragFoam * (this.inBarrel ? 0.2 : 1);
    this.speed -= drag * this.speed * dt;
    this.speed = clamp(this.speed, 0, B.vMax);

    // --- pump ----------------------------------------------------------------
    if (input.consumePumpRelease() && this.pumpCd <= 0 && !this.airborne) {
      const sharp = clamp01(Math.abs(this.steer));
      if (faceSteep >= B.pumpMinSteepness) {
        const faceFactor = clamp01(faceSteep / 0.8);
        const quality = clamp01(0.25 + 0.75 * sharp);
        const impulse = B.pumpGain * stats.pumpMul * faceFactor * (0.3 + 0.7 * sharp) * quality;
        this.speed = clamp(this.speed + impulse, 0, B.vMax);
        this.pumpCd = B.pumpCooldown;
        ev.pump = "good";
        ev.pumpQuality = quality;
      } else {
        this.speed *= 1 - B.pumpScrub;
        this.pumpCd = B.pumpCooldown * 0.5;
        ev.pump = "scrub";
      }
    }

    // --- airtime off the lip -------------------------------------------------
    // launch when carving up over the lip fast (climbing toward the crest)
    if (!this.airborne && hz < -0.2 && faceFrac < 0.25 && this.speed > 18 && faceSteep > 0.4) {
      this.airborne = true;
      this.vy = this.speed * Math.min(0.6, -hz) * 0.9;
      this.airHeight = 0;
      this.airTime = 0;
      this.airSpin = 0;
      this.airLaunchSpeed = this.speed;
      ev.airLaunch = this.speed;
    }
    if (this.airborne) {
      this.airTime += dt;
      this.vy -= B.gravity * dt;
      this.airHeight += this.vy * dt;
      if (this.airHeight <= 0) {
        this.airHeight = 0;
        this.airborne = false;
        this.resolveLanding(ev, faceSteep);
      }
    }

    // --- advance the base position ------------------------------------------
    this.x += hx * this.speed * dt;
    this.z += hz * this.speed * dt;

    // --- contextual carve tricks (snap / cutback) ---------------------------
    this.detectCarve(ev, faceFrac, faceSteep);

    // --- floater over whitewater --------------------------------------------
    if (!this.airborne && this.foam > 0.5 && faceFrac < 0.55 && this.speed > 8) {
      this.floaterTime += dt;
    } else if (this.floaterTime > 0.4) {
      const pts = Math.round(B.floaterPerSec * this.floaterTime * this.flow);
      this.bankTrick(ev, "Floater", pts);
      this.floaterTime = 0;
    } else {
      this.floaterTime = 0;
    }

    // --- style multiplier + base score --------------------------------------
    if (this.pocketScore > B.flowPocketThreshold) {
      const ramp = smoothstep(B.flowPocketThreshold, 1, this.pocketScore);
      this.flow += B.flowRamp * ramp * dt;
      if (this.inBarrel) this.flow += B.flowRamp * 1.5 * dt;
    } else {
      this.flow -= B.flowDecay * dt;
    }
    this.flow = clamp(this.flow, B.flowMin, Math.min(B.flowMax, this.flowCeiling));
    this.score += B.scoreBase * this.speed * this.flow * dt;

    // --- wipeout / stall -----------------------------------------------------
    this.checkWipeouts(ev, dt, d, faceFrac, faceSteep, slopeAlong);

    return ev;
  }

  /** A scored carve fires on a hard steer reversal on a steep enough face. */
  private detectCarve(ev: SurferEvents, faceFrac: number, faceSteep: number): void {
    if (this.airborne) return;
    const B = Balance;
    const dir = this.steer > 0.6 ? 1 : this.steer < -0.6 ? -1 : 0;
    if (dir === 0) return;
    if (this.carveArm !== 0 && dir !== this.carveArm && this.trickCd <= 0) {
      if (this.speed >= B.trickMinSpeed && faceSteep >= B.pumpMinSteepness) {
        // high on the face near the lip = off-the-lip snap; lower/shoulder = cutback
        const off = faceFrac < 0.4;
        const base = off ? B.snapPoints : B.cutbackPoints;
        const pts = Math.round(base * (0.6 + 0.4 * clamp01(this.speed / B.vMax)) * this.flow);
        this.bankTrick(ev, off ? "Off the Lip" : "Cutback", pts);
        this.trickCd = B.trickCooldown;
      }
    }
    this.carveArm = dir;
  }

  /** Resolve an air on touchdown: score it, or eat a wipeout for a blown landing. */
  private resolveLanding(ev: SurferEvents, faceSteep: number): void {
    const B = Balance;
    // re-seat the heading down the line after a spin
    const spins = this.airSpin / (Math.PI * 2);
    const landOff = Math.abs(((this.heading % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
    this.heading = clamp(this.heading, -B.headingClamp, B.headingClamp);
    if (this.airTime < B.airMinTime) return; // a hop, not an air
    if (landOff > B.airLandTolerance && faceSteep < 0.2) {
      this.wipeoutNow(ev, "Blew the landing");
      return;
    }
    const spinPts = Math.floor(spins) * B.airSpinPoints;
    const pts = Math.round((B.airBase * this.airTime + spinPts) * (0.6 + 0.5 * clamp01(this.airLaunchSpeed / B.vMax)) * this.flow);
    const tag = spins >= 0.85 ? `${Math.round(Math.floor(spins) * 360 + 360)}` : undefined;
    this.bankTrick(ev, "Air", pts, tag);
  }

  private bankTrick(ev: SurferEvents, name: TrickName, points: number, tag?: string): void {
    if (points <= 0) return;
    this.combo += 1;
    const comboMult = clamp(1 + this.combo * Balance.comboStep, 1, Balance.comboMax);
    const banked = Math.round(points * comboMult);
    this.score += banked;
    this.bestTrick = Math.max(this.bestTrick, banked);
    // a later trick in the same frame overwrites the popup, but score still counts both
    ev.trick = { name, points: banked, combo: this.combo, tag };
  }

  private checkWipeouts(
    ev: SurferEvents,
    dt: number,
    d: number,
    faceFrac: number,
    faceSteep: number,
    slopeAlong: number,
  ): void {
    const B = Balance;
    if (this.airborne) return;

    // pearled the nose: pitched steeply down the face at speed, high up
    if (-slopeAlong > B.noseDiveSlope && this.speed > B.noseDiveSpeed && faceFrac < 0.5) {
      this.wipeoutNow(ev, "Pearled the nose");
      return;
    }

    // caught behind the section: the curl/foam overtook the board
    if (d < B.caughtMargin) {
      this.caughtTimer += dt;
      if (this.caughtTimer > B.caughtTime) this.wipeoutNow(ev, "Caught behind the section");
    } else {
      this.caughtTimer = 0;
    }

    // lost the wave: off the bottom onto the flats, or over the back
    if (faceFrac > B.lostFaceFrac || this.z < B.lostBackZ) {
      this.lostTimer += dt;
      if (this.lostTimer > B.lostTime) this.wipeoutNow(ev, "Lost the wave");
    } else {
      this.lostTimer = 0;
    }

    // stall: too slow on flat water
    if (this.speed < B.vMin && faceSteep < B.stallSteepness) {
      this.stallTimer += dt;
      if (this.stallTimer > B.stallTime) this.wipeoutNow(ev, "Stalled out");
    } else {
      this.stallTimer = 0;
    }
  }

  private wipeoutNow(ev: SurferEvents, reason: WipeoutReason): void {
    if (!this.alive) return;
    this.alive = false;
    this.wipeoutReason = reason;
    this.flow = Balance.flowMin;
    this.inBarrel = false;
    ev.wipeout = reason;
  }

  /** World render height including airtime. */
  get renderY(): number {
    return (this.sample?.posY ?? 0) + this.airHeight;
  }
}
