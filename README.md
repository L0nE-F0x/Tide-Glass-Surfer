# Tide Glass Surfer

A surf-competition arcade game on **one endless, peeling wave**. There's no ocean of
random bumps — there's *the wave*: a wall that breaks down the line forever. Drop in, race
the curl, stay in the pocket, and throw tricks — snaps off the lip, cutbacks, floaters and
airs — while you hunt the barrel. Link them into combos for a Style multiplier and chase a
high score. Then **pass the keyboard**: everyone takes a turn, and the leaderboard settles
who's the best surfer in the family.

From the title screen you drop into a **cinematic fly-around** of the whole arena — the
sunset, the peeling wave, the palm-lined beach with its crowd and judges' stand — that eases
down to your POV (skip it or speed it up, arcade-style, or just soak in the view).

Built with **Vite + TypeScript + Three.js**. No assets — the wave, beach, palms, crowd,
gulls, board, spray and audio are all generated at runtime.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production bundle into dist/
npm run preview  # serve the production build
```

A modern browser with WebGL is required. Best on a discrete GPU but runs fine on integrated.

## How to play

You ride **down the line** (the wave peels away ahead of you). Steering doesn't spin the
board — it sets your angle on the face:

| Action | Keyboard | Touch |
|---|---|---|
| Climb to the lip / drop to the trough | `A` `D` or `←` `→` | drag the steer pad |
| Pump for speed | hold `Space`, release on a steep face | PUMP button |
| Tuck into the barrel | hold `Shift` | TUCK button / two-finger hold |
| Pause | `Esc` / `P` | — |

- **Stay in the pocket.** Trim just ahead of the curl, high on the face. That's where the
  wave pushes you fastest and your **Style** multiplier (top-left) climbs.
- **Drop too low or pull too far ahead** and you slide onto the mellow shoulder; **let the
  curl overtake you** and you get *caught behind the section*. Either way the ride can end.
- **Tricks score, and they're contextual** — no combos to memorise:
  - **Off the Lip / Cutback** — carve hard (flick the stick the other way) up near the lip
    or down on the shoulder.
  - **Floater** — ride up and across a broken whitewater section.
  - **Air** — climb the lip with speed to boost; hold a direction to spin, then land it.
  - **Barrel** — tuck (`Shift`) where the lip throws over you; score every second you're in
    the tube, with a bonus for making it out.
- **Combos** link every trick on a ride. The longer the clean line, the bigger the score —
  a barrel-into-snap-into-air pays far more than just surviving.
- A ride ends only when you **fall** (pearl the nose, get caught, blow a landing, lose the
  wave). It's endless until then — the better you are, the longer it lasts.

## Surf competition (hot-seat)

Add your family in the lobby's **Surfers** list (up to six). Hit **Start Session** and each
surfer takes a turn on the same spot, riding until they fall. After the last turn you get a
ranked **Heat Results** screen, and every ride is banked onto the spot's **Leaderboard**, so
high scores stick around between sessions (saved to `localStorage`). One surfer? It's just
solo practice against your own best.

## Spots & boards

Pick a **spot** — each is a different wave *type* — and a **board** for its feel:

- **The Cove** — long, mellow peelers. The place to learn the line. *(open from the start)*
- **The Point** — longer, faster walls with makeable barrel sections. *(unlock at 8,000)*
- **Slab Reef** — heavy, hollow and fast; the lip throws square. *(unlock at 25,000)*
- **Beach Break** — punchy, wedging ramps built for airs. *(unlock at 50,000)*

Spots unlock as your **best score** climbs. Boards (Driftwood / Quad Fish / Big-Wave Gun /
Air Blade) are all free — they just trade drag, turn and pump feel.

## The one big idea: one analytic wave that's drawn *and* ridden

A single surface function defines the whole wave — a shaped wall with a **curl** that peels
down the line: a clean unbroken shoulder ahead of it, a lip that pitches forward and folds
into a hollow **barrel** at the curl, and churning whitewater behind it.

That one function is evaluated in **two** places from the same source:

1. on the **GPU** (the GLSL emitted by [`waves.ts`](src/game/waves.ts)), to draw the water;
2. on the **CPU** (`WaveField.sample`), to drive the surfing physics.

So *the wave you see is the wave you ride* — the board sits exactly on the drawn surface,
with zero readback latency. The normal, height gradient and the displacement **Jacobian**
(which goes negative exactly where the lip folds — that's how the barrel is detected) are
taken by central differences of that single shared function, identically on both sides.

## Architecture

```
src/
  main.ts                 bootstrap
  config/balance.ts       ALL gameplay tuning (gravity, push, drag, pump, pocket, tricks, wipeouts)
  game/
    waves.ts              the single peeling wave — one surface fn → GLSL + CPU sampler
    physics.ts            the surfer: ride-the-line model, pocket, tricks, combos, scoring, wipeouts
    Ocean.ts              warped grid + water shader (calls the wave's GLSL)
    Board.ts              surfboard + rider, oriented to the live surface normal
    Sky.ts                sunset sky dome (sun, glow, drifting cloud bands), lights, palette
    Scenery.ts            the beach arena: sand, palms, umbrellas, crowd, judges' stand, gulls
    Spray.ts              recycled GPU particle pool (trail, carve fans, curl spray, trick bursts)
    Audio.ts              procedural WebAudio (speed-tracked water rush + SFX + trick stings)
    Game.ts               orchestrator: render loop, landing/intro/session state machine, camera, FX
  input/input.ts          keyboard + touch -> one normalised input snapshot
  state/
    spots.ts              spot (wave-type) definitions + per-spot swell ramp + milestone unlocks
    boards.ts             board stat definitions (all free)
    meta.ts               localStorage progression: best, leaderboards per spot, remembered roster
  ui/
    ui.ts                 lobby / HUD / handoff / results / leaderboard, built in vanilla DOM
    styles.css            HUD + glassmorphism menus
```

### How a frame works while surfing
1. The curl advances down the line; `Surfer.update` samples `WaveField.sample(x, z, t)` at
   the board → displaced position, normal, gradient, Jacobian and the wave-relative scalars
   (distance to the curl, how high on the face, broken/whitewater, barrel pitch).
2. Steering sets the board's angle on the face; gravity-on-slope plus a pocket-driven **wave
   push** set its speed, so a good line races the curl instead of sliding off.
3. Pocket quality ramps the **Style** multiplier; contextual tricks, barrel time and combos
   accrue the score.
4. Wipeout / caught / lost-the-wave conditions are checked.
5. The renderer draws the wave from the **same** function, so the board sits exactly on the
   surface it's simulating against.

All feel-related numbers live in one file, [`src/config/balance.ts`](src/config/balance.ts).
