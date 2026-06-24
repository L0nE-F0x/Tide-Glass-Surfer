import { BOARDS } from "./boards.ts";
import { SPOTS } from "./spots.ts";

/** One leaderboard line — a banked ride by a named player. */
export interface ScoreEntry {
  name: string;
  score: number;
  bestTrick: number;
  barrels: number;
  rideSeconds: number;
  date: number; // epoch ms
}

/** Persistent meta-progression, saved to localStorage between sessions. */
export interface MetaState {
  bestScore: number;
  longestRide: number; // seconds
  totalBarrels: number;
  totalRuns: number;
  selectedBoard: string;
  selectedSpot: string;
  /** remembered hot-seat roster, so the family doesn't retype names each time */
  players: string[];
  /** per-spot leaderboards (spot id → top entries, score-descending) */
  leaderboards: Record<string, ScoreEntry[]>;
  muted: boolean;
}

const KEY = "tide-glass-surfer.meta.v2";
export const LEADERBOARD_MAX = 8;

function defaults(): MetaState {
  return {
    bestScore: 0,
    longestRide: 0,
    totalBarrels: 0,
    totalRuns: 0,
    selectedBoard: BOARDS[0].id,
    selectedSpot: SPOTS[0].id,
    players: ["Player 1"],
    leaderboards: {},
    muted: false,
  };
}

export function loadMeta(): MetaState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults();
    const parsed = JSON.parse(raw) as Partial<MetaState>;
    const m = { ...defaults(), ...parsed };
    if (!m.players || m.players.length === 0) m.players = ["Player 1"];
    if (!m.leaderboards) m.leaderboards = {};
    return m;
  } catch {
    return defaults();
  }
}

export function saveMeta(meta: MetaState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(meta));
  } catch {
    /* storage unavailable (private mode etc.) — meta is best-effort */
  }
}

export interface BankedRun {
  name: string;
  score: number;
  rideSeconds: number;
  barrels: number;
  bestTrick: number;
}

export interface BankResult {
  /** 1-based placing on the spot leaderboard, or 0 if it didn't place */
  rank: number;
  /** beat the all-time personal best across all spots */
  newOverallBest: boolean;
  /** took the #1 slot on this spot */
  topOfSpot: boolean;
}

/** Folds a finished ride into the meta state and its spot leaderboard. */
export function bankRun(meta: MetaState, spotId: string, run: BankedRun): BankResult {
  meta.totalRuns += 1;
  meta.totalBarrels += run.barrels;
  meta.longestRide = Math.max(meta.longestRide, run.rideSeconds);
  const newOverallBest = Math.round(run.score) > meta.bestScore;
  meta.bestScore = Math.max(meta.bestScore, Math.round(run.score));

  const board = meta.leaderboards[spotId] ?? [];
  const entry: ScoreEntry = {
    name: run.name,
    score: Math.round(run.score),
    bestTrick: Math.round(run.bestTrick),
    barrels: run.barrels,
    rideSeconds: run.rideSeconds,
    date: Date.now(),
  };
  board.push(entry);
  board.sort((a, b) => b.score - a.score);
  board.length = Math.min(board.length, LEADERBOARD_MAX);
  meta.leaderboards[spotId] = board;

  const rank = board.indexOf(entry) >= 0 ? board.indexOf(entry) + 1 : 0;
  saveMeta(meta);
  return { rank, newOverallBest, topOfSpot: rank === 1 };
}

export function spotLeaderboard(meta: MetaState, spotId: string): ScoreEntry[] {
  return meta.leaderboards[spotId] ?? [];
}
