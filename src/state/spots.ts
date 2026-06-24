import { clamp01, lerp } from "../util/math.ts";
import type { WaveParams } from "../game/waves.ts";

/**
 * A spot is one wave *type* — the level you pick. Each defines the shape of its
 * peeling wave (fed straight to the wave field) plus how the swell builds during
 * a ride and the score milestone that unlocks it.
 */
export interface Spot {
  id: string;
  name: string;
  blurb: string;
  /** best score needed to unlock this spot (0 = available from the start) */
  unlockAt: number;
  /** Style-multiplier ceiling this spot allows (bigger waves → higher ceiling) */
  styleCeiling: number;
  /** the shape of the wave */
  wave: WaveParams;
  /** peak energy multiplier the swell builds to over a long ride */
  energyMax: number;
  /** seconds over which the swell builds toward energyMax */
  energyRampSecs: number;
}

export const SPOTS: Spot[] = [
  {
    id: "cove",
    name: "The Cove",
    blurb: "Long, mellow peelers. Forgiving pocket — the place to learn the line.",
    unlockAt: 0,
    styleCeiling: 5,
    energyMax: 1.35,
    energyRampSecs: 80,
    wave: {
      wallHeight: 4.6,
      faceWidth: 11.0,
      troughDepth: 1.8,
      backWidth: 13.0,
      flatWidth: 20.0,
      barrelSigma: 9.0,
      collapseWidth: 18.0,
      foamRun: 28.0,
      breakWidth: 5.0,
      lipThrow: 4.2,
      lipLift: 0.9,
      lipCenter: 0.16,
      lipWidth: 0.18,
      chopAmp: 0.16,
      peelSpeed: 14.0,
    },
  },
  {
    id: "point",
    name: "The Point",
    blurb: "Longer, faster walls with makeable barrel sections. Link your turns.",
    unlockAt: 8000,
    styleCeiling: 7,
    energyMax: 1.6,
    energyRampSecs: 75,
    wave: {
      wallHeight: 5.8,
      faceWidth: 10.0,
      troughDepth: 2.2,
      backWidth: 12.0,
      flatWidth: 18.0,
      barrelSigma: 8.0,
      collapseWidth: 16.0,
      foamRun: 26.0,
      breakWidth: 5.0,
      lipThrow: 5.4,
      lipLift: 1.05,
      lipCenter: 0.16,
      lipWidth: 0.16,
      chopAmp: 0.18,
      peelSpeed: 16.0,
    },
  },
  {
    id: "slab",
    name: "Slab Reef",
    blurb: "Heavy, hollow and fast. Barrel or bail — the lip throws square.",
    unlockAt: 25000,
    styleCeiling: 9,
    energyMax: 1.75,
    energyRampSecs: 65,
    wave: {
      wallHeight: 7.5,
      faceWidth: 9.0,
      troughDepth: 3.0,
      backWidth: 11.0,
      flatWidth: 16.0,
      barrelSigma: 7.0,
      collapseWidth: 14.0,
      foamRun: 24.0,
      breakWidth: 4.5,
      lipThrow: 7.6,
      lipLift: 1.4,
      lipCenter: 0.15,
      lipWidth: 0.15,
      chopAmp: 0.2,
      peelSpeed: 18.0,
    },
  },
  {
    id: "beach",
    name: "Beach Break",
    blurb: "Punchy, wedging ramps. Built for airs — boost off the lip and spin.",
    unlockAt: 50000,
    styleCeiling: 8,
    energyMax: 1.8,
    energyRampSecs: 70,
    wave: {
      wallHeight: 5.0,
      faceWidth: 9.5,
      troughDepth: 2.2,
      backWidth: 11.5,
      flatWidth: 16.0,
      barrelSigma: 7.5,
      collapseWidth: 15.0,
      foamRun: 25.0,
      breakWidth: 5.0,
      lipThrow: 5.0,
      lipLift: 1.4,
      lipCenter: 0.18,
      lipWidth: 0.17,
      chopAmp: 0.22,
      peelSpeed: 16.0,
    },
  },
];

export function spotById(id: string): Spot {
  return SPOTS.find((s) => s.id === id) ?? SPOTS[0];
}

export function spotUnlocked(spot: Spot, bestScore: number): boolean {
  return bestScore >= spot.unlockAt;
}

/**
 * Difficulty rises WITHIN a ride: the swell energy multiplier climbs over time so
 * the wave gets bigger, hollower and faster-peeling the longer you survive.
 */
export function spotEnergyAt(spot: Spot, runTime: number): number {
  const t = clamp01(runTime / spot.energyRampSecs);
  return lerp(1.0, spot.energyMax, t * (2 - t));
}
