/** Surfboards alter drag / turn / pump feel. All free — pick one for its style. */
export interface BoardDef {
  id: string;
  name: string;
  blurb: string;
  /** multipliers applied to the base balance constants */
  dragMul: number;
  turnMul: number;
  pumpMul: number;
  /** hull colour + accent for the visual */
  color: string;
  accent: string;
}

export const BOARDS: BoardDef[] = [
  {
    id: "driftwood",
    name: "Driftwood",
    blurb: "A forgiving all-rounder. Balanced everything — start here.",
    dragMul: 1.0,
    turnMul: 1.0,
    pumpMul: 1.0,
    color: "#e9d8a6",
    accent: "#ca6702",
  },
  {
    id: "fish",
    name: "Quad Fish",
    blurb: "Loose and skatey — turns hard, pumps strong, a touch draggy.",
    dragMul: 1.1,
    turnMul: 1.4,
    pumpMul: 1.2,
    color: "#94d2bd",
    accent: "#005f73",
  },
  {
    id: "gun",
    name: "Big-Wave Gun",
    blurb: "Built for speed and big drops. Low drag, stiff in the turn.",
    dragMul: 0.78,
    turnMul: 0.8,
    pumpMul: 1.05,
    color: "#9b2226",
    accent: "#e9d8a6",
  },
  {
    id: "blade",
    name: "Air Blade",
    blurb: "A twitchy performance shortboard — snappiest turns, best for airs.",
    dragMul: 0.95,
    turnMul: 1.55,
    pumpMul: 1.15,
    color: "#5a189a",
    accent: "#e0aaff",
  },
];

export function boardById(id: string): BoardDef {
  return BOARDS.find((b) => b.id === id) ?? BOARDS[0];
}
