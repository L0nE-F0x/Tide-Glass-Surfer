/**
 * Single source of truth for gameplay tuning. Everything that affects "feel"
 * lives here so it can be balanced in one place.
 *
 * The board rides ONE peeling wave: it travels *down the line* (+X), the crest
 * runs along X at z = 0 and the open face drops away toward +Z. The curl peels
 * along the line; staying just ahead of it, high on the face, is the pocket.
 */
export const Balance = {
  /** Gravity used by the slope-projection physics (m/s^2). */
  gravity: 16.0,

  /** Base linear drag applied to speed each second. */
  drag: 0.2,
  /** Drag while tucked/crouched (lower = faster). */
  dragTuck: 0.11,
  /** Extra drag when riding through whitewater/foam. */
  dragFoam: 1.1,

  /**
   * Wave push: the peeling wave drives the board down the line when it's in the
   * pocket on a steep face. This is what lets a good surfer race the curl
   * instead of just sliding down into the trough. Tuned so a trimming board in
   * the pocket cruises near the peel speed (~15 m/s) rather than outrunning it.
   */
  pushGain: 12.0,

  /** Max steer rate (radians/sec) at full lean. */
  turnRate: 2.2,
  /** Steering loses authority at very low speed. */
  turnSpeedFloor: 3.0,
  /** How quickly steer input ramps toward the held value. */
  steerResponse: 9.0,
  /** Max angle (radians) either side of "down the line" the board can point —
   * full steer climbs to the lip or drops to the trough but never spins out. */
  headingClamp: 1.05,

  /** Speed clamps (m/s). */
  vMin: 2.0,
  vMax: 34.0,
  /** Launch speed when dropping in. */
  vStart: 15.0,

  /** Pump impulse model: impulse = pumpGain * faceSteepness * turnSharpness * timing. */
  pumpGain: 13.0,
  /** Steepness (|gradient|) below which a pump just scrubs speed. */
  pumpMinSteepness: 0.16,
  /** Cooldown between pumps (s). */
  pumpCooldown: 0.4,
  /** A mistimed pump scrubs this fraction of speed. */
  pumpScrub: 0.1,

  /** Style multiplier (was "Flow"): multiplies trick payouts and ticks score. */
  flowMin: 1.0,
  flowMax: 8.0,
  /** Pocket score needed before Style starts ramping. */
  flowPocketThreshold: 0.3,
  /** Style ramp/decay (units per second at full/zero pocket). */
  flowRamp: 1.0,
  flowDecay: 1.6,

  /**
   * The pocket: how good the board's position on the wave is, in [0,1].
   * Composed of how high on the face it sits, how close to the curl it is down
   * the line, and how steep the face is right there.
   */
  /** ideal fraction down the face (0 crest .. 1 trough) — high in the pocket. */
  faceSweet: 0.3,
  faceTolerance: 0.34,
  /** ideal distance (m) ahead of the curl to sit. */
  curlSweet: 2.5,
  curlTolerance: 5.0,
  pocketFaceWeight: 0.4,
  pocketCurlWeight: 0.4,
  pocketSteepWeight: 0.2,
  /** Bonus added to pocketScore while inside a barrel. */
  pocketBarrelBonus: 0.5,

  /** Barrel detection: surface is "folding" when Jacobian < this. */
  barrelJacobian: 0.2,

  /** Scoring (steady drip; tricks dominate). */
  scoreBase: 3.0,
  scoreBarrelPerSec: 320,
  /** Bonus banked for cleanly exiting a barrel, per second spent inside. */
  barrelExitBonus: 220,

  // --- contextual tricks (detection thresholds; see physics.ts) -------------
  /** A snap/cutback needs the steer to reverse at least this hard. */
  trickSteerFlip: 1.3,
  /** Minimum speed (m/s) for a turn to register as a scored trick. */
  trickMinSpeed: 12.0,
  /** Cooldown (s) between scored carve tricks so one flick = one trick. */
  trickCooldown: 0.5,
  /** Points. */
  snapPoints: 180,
  cutbackPoints: 150,
  floaterPerSec: 240,
  /** Air scoring: base × airtime, plus rotation bonus per full spin. */
  airBase: 120,
  airSpinPoints: 500,
  /** Air must clear at least this long to score (s). */
  airMinTime: 0.32,
  /** Land within this many radians of forward to make the landing. */
  airLandTolerance: 1.2,
  /** Combo: each linked trick adds this to the chain multiplier. */
  comboStep: 0.5,
  comboMax: 6.0,

  // --- wipeout thresholds ---------------------------------------------------
  /** Caught: board falls this far behind the curl (curlDist below) for caughtTime. */
  caughtMargin: -2.0,
  caughtTime: 1.6,
  /** Lost the wave: off the bottom (faceFrac above) or over the back (z below). */
  lostFaceFrac: 0.98,
  lostBackZ: -1.5,
  lostTime: 1.4,
  /** Pearl: pitched down the face this steep at speed. */
  noseDiveSlope: 1.2,
  noseDiveSpeed: 16.0,
  /** Stall: below vMin on a face flatter than this for stallTime seconds. */
  stallSteepness: 0.12,
  stallTime: 1.8,

  /** Camera. Sits low and close so the bigger wave face looms over the rider. */
  camDistance: 9.5,
  camHeight: 2.6,
  camLookAhead: 8.0,
  camFollow: 3.6,
  camFovBase: 72,
  camFovSpeed: 14, // extra FOV at vMax for a sense of speed

  /** Score -> Tide Coins conversion at end of run (legacy; unused once coins go). */
  coinsPerScore: 0.01,
} as const;

export type BalanceConfig = typeof Balance;
