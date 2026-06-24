Before writing the spec, let me verify a couple of current technical details about the WebGPU and Three.js stack to make the build instructions accurate.I have what I need. The current stack confirms WebGPURenderer + TSL with compute shaders is the right modern call, and Tessendorf FFT (Phillips spectrum, IFFT for height + gradient, Jacobian for foam) is the established technique. Here's the build-ready spec.

# Tide Glass Surfer

## Concept & Core Loop

**The fantasy.** You are a surfer dropped onto an infinite, living ocean that is being sculpted in real time on the GPU. There is no track — the swell *is* the level. You read the water, drop in, carve, and chase the barrel as it forms ahead of you. The goal is flow state: long, unbroken lines where speed, light, and spray all click into a rhythm.

**Moment-to-moment.** The camera trails a surfboard descending an endless, procedurally swelling ocean. The player steers left/right and "pumps" — timing carves against the wave face to convert gravity and wave slope into speed. Riding high on a steepening face or threading a forming barrel (the hollow of a breaking wave) builds a **Flow** multiplier; wiping out (burying the nose, getting caught behind the break, or hitting flat water at low speed) resets it.

**Why it's the right technique.** The wave surface is a real Tessendorf FFT ocean. Twenty years after Tessendorf's paper, the FFT ocean simulation is still a great way to generate realistic oceans, and with modern GPUs the FFT has become really cheap to compute, so we can simulate detailed oceans in real-time. We compute it in a WebGPU compute pass so the *same* height/displacement data drives both the visuals and the surfing physics — the wave you see is literally the wave you ride.

**Core loop.**
1. **Drop in** — board accelerates down the nearest wave face.
2. **Carve & pump** — steer across the face; well-timed turns at the steepest part add speed.
3. **Build Flow** — staying in the "pocket" (just ahead of the break, high on the face, or inside the barrel) ramps a multiplier and score rate.
4. **Score → unlock** — banked score becomes Tide Coins between runs, unlocking boards/cosmetics and harder swell presets.
5. **Wipe out → run ends** — submit score, see the run summary, go again.

**Win/lose.** Endless arcade — there is no win, only a personal best (longest line / highest score). A run ends on **wipeout** or **stall** (speed drops below threshold on flat water for >2s).

**Why it's fun.** Skill expression lives in *reading the simulation*. Because the swell genuinely reshapes under you, no two lines repeat. Combining multiple simulations with differing areas creates a more dynamic surface, so the ocean never feels tiled or repetitive — the mastery is sensing where the next pocket forms.

---

## Gameplay & Mechanics

### Controls
| Input | Keyboard | Touch / Gamepad |
|---|---|---|
| Steer left / right | `A` / `D` or `←` / `→` | Tilt / left stick X / on-screen drag |
| Pump (carve hard) | `Space` (hold through a turn) | Bottom-screen hold / `A` button / `RT` |
| Crouch / tuck (lower drag, enter barrel) | `Shift` | Two-finger hold / `B` / `LT` |
| Pause | `Esc` / `P` | Pause button |

Steering is **analog-feel**: tap = small adjustment, hold = continuous lean. Pump only adds speed when released near the apex of a carve on a steep-enough face (a timing window shown by a subtle board-trail glow).

### Systems & rules
- **Wave sampling.** Each frame the board's world XZ samples the FFT displacement+height buffer (read back into a small CPU-side cache via a low-res mirror texture, or queried through a GPU compute "probe" pass writing to a tiny storage buffer). This yields surface height, slope (gradient), and the local normal at the board.
- **Gravity-on-slope physics.** Board velocity integrates gravity projected onto the wave's local tangent plane. Steeper face = more acceleration. This is the heart of "carving builds speed."
- **Pump model.** A successful pump injects an impulse along the board's heading proportional to `faceSteepness × turnSharpness × timingQuality`. Mis-timed pumps cost speed (scrub).
- **The pocket / Flow.** A scalar `pocketScore ∈ [0,1]` derived from: height above trough, proximity to the wave crest line, and whether the board is inside a barrel (detected via the **Jacobian** of the displacement — where the surface folds over). Tessendorf provides a simple method to detect overlapping by using the Jacobian. High `pocketScore` ramps the **Flow multiplier** (1×→6×).
- **Barrel ride.** When the Jacobian goes negative (surface folding) above the board and the board is tucked, the player is "in the barrel": max Flow gain, screen darkens to a tube, spray streaks past. Hold it as long as the barrel exists.
- **Wipeout conditions.** (a) nose-dive: heading pitched into the face beyond a threshold at speed; (b) caught behind the break: board falls behind the foam line; (c) stall: speed < `vMin` on flat water for >2s. Each plays a distinct fail animation and resets Flow.

### Difficulty & balancing
- **Swell presets** scale wind speed, fetch, and choppiness, which directly feed the Phillips spectrum. The reverse FFT computes the 2D wave height field from the Phillips spectrum, and it is possible to adjust parameters such as wind speed, direction and strength, wave choppiness, and sea depth.
- Difficulty rises *within* a run via a `time → swellEnergy` curve: bigger, hollower, faster-breaking waves the longer you survive.
- Tuning constants live in one `balance.ts` file (gravity, drag, pump impulse, pocket weights, vMin, Flow ramp/decay).

### Scoring & progression
- **Score rate** = `baseRate × speed × FlowMultiplier`, accumulated per second.
- **Bonuses:** barrel time (×3 banked), clean pump chains, big airs off crests.
- **Between runs:** score → **Tide Coins**. Spend on boards (alter drag/turn/pump stats), wetsuit/trail cosmetics (visual only), and new swell presets (which also raise the score multiplier ceiling).
- **Persistent meta:** best score, longest line (seconds), total barrels, coins, unlocks — saved to `localStorage`.

---

## Tech Stack

Decisive, modern, WebGPU-first with automatic fallback.

- **Build:** Vite + TypeScript (strict).
- **Renderer:** **Three.js `WebGPURenderer`** imported from `three/webgpu`. WebGPURenderer supports both WebGPU and WebGL, and will fall back to WebGL when WebGPU is not available on the device. Note: WebGPU requires `await renderer.init()` before rendering — it's asynchronous, unlike WebGLRenderer, which is why setup lives inside an async function.
- **React layer:** **react-three-fiber + drei**. R3F drives WebGPU through the `Canvas` `gl` prop; to get the new WebGPU features you instantiate its renderer through the `gl` prop of the Canvas, and you extend Three.js primitives from `three/webgpu` instead of `three`.
- **Shaders:** **TSL** (Three Shading Language) from `three/tsl`, for materials, the FFT compute passes, and post-processing. TSL is a JavaScript-native node graph that compiles to GLSL for WebGL and WGSL for WebGPU from one source. We pick TSL over raw GLSL because it gives WebGPU support, a refactorable JS-native graph, and the built-in PBR lighting pipeline via MeshStandardNodeMaterial.
- **GPU simulation:** WebGPU **compute shaders** via TSL `Fn` + `instancedArray`/`storage`. Storage buffers are GPU memory arrays that persist between frames — the WebGPU equivalent of JavaScript arrays, except they live on

---
*Build spec for **Tide Glass Surfer** — generated with [Vibe Forge](https://github.com/L0nE-F0x/VibeForge) on 2026-06-21.*
