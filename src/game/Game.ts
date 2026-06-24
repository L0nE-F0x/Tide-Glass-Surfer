import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Balance } from "../config/balance.ts";
import { Input } from "../input/input.ts";
import { boardById } from "../state/boards.ts";
import { bankRun, loadMeta, saveMeta, spotLeaderboard, type MetaState } from "../state/meta.ts";
import { spotById, spotEnergyAt, spotUnlocked, type Spot } from "../state/spots.ts";
import { clamp01, damp } from "../util/math.ts";
import { UI, type HudData, type PlayerResult } from "../ui/ui.ts";
import { Audio } from "./Audio.ts";
import { Board } from "./Board.ts";
import { Ocean } from "./Ocean.ts";
import { Surfer, type SurferStats } from "./physics.ts";
import { Scenery } from "./Scenery.ts";
import { Sky } from "./Sky.ts";
import { Spray } from "./Spray.ts";
import { WaveField } from "./waves.ts";

type State =
  | "landing"
  | "loading"
  | "intro"
  | "lobby"
  | "handoff"
  | "playing"
  | "paused"
  | "wipeout"
  | "playerResult"
  | "results";

const INTRO_DURATION = 15; // seconds at 1× speed

/** One hot-seat session: a roster taking turns on the same spot. */
interface Session {
  players: string[];
  results: PlayerResult[];
  current: number;
}

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly sky: Sky;
  private readonly scenery: Scenery;
  private readonly board: Board;
  private readonly spray: Spray;
  private readonly surfer = new Surfer();
  private readonly input = new Input();
  private readonly audio: Audio;
  private readonly ui: UI;

  private meta: MetaState;
  private field!: WaveField;
  private ocean!: Ocean;
  private spot!: Spot;
  private stats!: SurferStats;
  private session: Session = { players: [], results: [], current: 0 };

  private state: State = "landing";
  private elapsed = 0; // global time (drives the ocean even in menus)
  private last = performance.now();
  private menuAngle = 0;
  private wipeoutTimer = 0;
  private snapCam = false;
  private fov: number = Balance.camFovBase;

  // post-processing + game feel
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  private shake = 0;
  private timeScale = 1;
  private slowmo = 0; // seconds of slow-motion remaining
  // adaptive quality: drop bloom / pixel ratio if the frame rate sags
  private frameEma = 1 / 60;
  private quality = 2; // 2 = full, 1 = no bloom, 0 = no bloom + 1× pixels
  private qualityCheck = 0;

  // landing → loading → cinematic intro
  private loadingT = 0;
  private introT = 0;
  private introSpeed = 1;
  private introPos!: THREE.CatmullRomCurve3;
  private introLook!: THREE.CatmullRomCurve3;

  private readonly camTarget = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(Balance.camFovBase, window.innerWidth / window.innerHeight, 0.1, 4000);
    this.camera.position.set(0, 8, -14);

    this.sky = new Sky(this.scene);
    this.scenery = new Scenery(this.scene);
    this.board = new Board(this.scene);
    this.spray = new Spray(this.scene, 1400);
    this.audio = new Audio();

    this.meta = loadMeta();
    this.audio.setMuted(this.meta.muted);
    this.spot = spotById(this.meta.selectedSpot);
    this.buildField();
    this.setupComposer();

    this.ui = new UI(uiRoot, this.input, {
      enterGame: () => this.enterGame(),
      skipIntro: () => this.toLobby(),
      setIntroSpeed: (m) => (this.introSpeed = m),
      startSession: () => this.startSession(),
      dropIn: () => this.startRide(),
      nextPlayer: () => this.nextPlayer(),
      rematch: () => this.startSession(),
      toLobby: () => this.toLobby(),
      resume: () => this.resume(),
      selectBoard: (id) => this.selectBoard(id),
      selectSpot: (id) => this.selectSpot(id),
      setPlayers: (names) => this.setPlayers(names),
      toggleMute: () => this.toggleMute(),
    });

    window.addEventListener("resize", () => this.onResize());
    // dev-only handle for tuning balance.ts against live state (stripped from prod builds)
    if (import.meta.env.DEV) (window as unknown as { __tgs: Game }).__tgs = this;
    this.toLanding();
    requestAnimationFrame(this.loop);
  }

  // --- setup ---------------------------------------------------------------
  private buildField(): void {
    this.field = new WaveField(this.spot.wave);
    if (this.ocean) this.scene.remove(this.ocean.mesh);
    this.ocean = new Ocean(this.scene, this.field);
    this.ocean.setQuality(this.quality >= 1 ? 1 : 0);
    this.stats = boardById(this.meta.selectedBoard);
    this.board.applyBoardDef(boardById(this.meta.selectedBoard));
  }

  /** Park the board on the open face so menus show a clean peeling wall. */
  private parkOnWave(): void {
    this.field.energy = 1;
    this.field.curlX = -6;
    this.surfer.reset(0, 2.0, 0.0);
  }

  // --- state transitions ---------------------------------------------------
  private toLanding(): void {
    this.state = "landing";
    this.spot = spotById(this.meta.selectedSpot);
    this.buildField();
    this.parkOnWave();
    this.ui.renderLanding();
    this.ui.show("landing");
    this.input.reset();
  }

  /** Enter Game → brief loading → cinematic intro. Also unlocks the AudioContext
   * (this is a user gesture). */
  private enterGame(): void {
    this.audio.start();
    this.state = "loading";
    this.loadingT = 0;
    this.ui.renderLoading();
    this.ui.show("loading");
  }

  /** A cinematic fly-around of the arena that eases down to the lineup. */
  private startIntro(): void {
    this.parkOnWave();
    this.introT = 0;
    this.introSpeed = 1;
    // a sweeping loop: out to sea → behind the wave → around the sunny channel →
    // over the beach & crowd → drop into the lineup behind the board
    this.introPos = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-58, 27, -40),
      new THREE.Vector3(-16, 32, -58),
      new THREE.Vector3(42, 21, -28),
      new THREE.Vector3(74, 16, 26),
      new THREE.Vector3(44, 14, 78),
      new THREE.Vector3(-6, 17, 62),
      new THREE.Vector3(-24, 9, 22),
      new THREE.Vector3(-12, 5.5, -2),
    ]);
    this.introLook = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 3, 3),
      new THREE.Vector3(0, 3, 3),
      new THREE.Vector3(0, 2.6, 4),
      new THREE.Vector3(6, 2.2, 4),
      new THREE.Vector3(0, 2.6, 3),
      new THREE.Vector3(0, 2.6, 3),
      new THREE.Vector3(4, 2.4, 4),
      new THREE.Vector3(14, 2.6, 4),
    ]);
    this.state = "intro";
    this.ui.renderIntro();
    this.ui.show("intro");
  }

  private toLobby(): void {
    this.state = "lobby";
    this.spot = spotById(this.meta.selectedSpot);
    this.buildField();
    this.parkOnWave();
    this.ui.renderLobby(this.meta);
    this.ui.show("lobby");
    this.input.reset();
  }

  /** Begin a fresh hot-seat session from the current roster. */
  private startSession(): void {
    this.spot = spotById(this.meta.selectedSpot);
    this.session = { players: [...this.meta.players], results: [], current: 0 };
    this.audio.start();
    this.toHandoff();
  }

  private toHandoff(): void {
    this.state = "handoff";
    this.buildField();
    this.parkOnWave();
    const name = this.session.players[this.session.current] ?? "Player";
    this.ui.renderHandoff(name, this.session.current + 1, this.session.players.length, this.spot);
    this.ui.show("handoff");
    this.input.reset();
  }

  private startRide(): void {
    if (this.state !== "handoff") return;
    this.buildField();
    this.field.energy = 1;
    // drop in well ahead of the curl with a steeper line so the board can build
    // speed before the peel catches up
    this.field.curlX = -6;
    this.surfer.reset(0, 2.4, 0.28);
    this.surfer.flowCeiling = this.spot.styleCeiling;
    this.input.reset();
    this.snapCam = true;
    this.wipeoutTimer = 0;
    this.state = "playing";
    this.ui.show("hud");
    this.audio.start();
  }

  private resume(): void {
    if (this.state !== "paused") return;
    this.state = "playing";
    this.ui.show("hud");
  }

  private pause(): void {
    if (this.state !== "playing") return;
    this.state = "paused";
    this.input.reset();
    this.ui.renderPaused();
    this.ui.show("paused");
  }

  /** Fold the just-finished ride into the leaderboard and show the player card. */
  private endRide(): void {
    const name = this.session.players[this.session.current] ?? "Player";
    const banked = bankRun(this.meta, this.spot.id, {
      name,
      score: this.surfer.score,
      rideSeconds: this.surfer.runTime,
      barrels: this.surfer.barrels,
      bestTrick: this.surfer.bestTrick,
    });
    const result: PlayerResult = {
      name,
      score: Math.round(this.surfer.score),
      rideSeconds: this.surfer.runTime,
      barrels: this.surfer.barrels,
      bestTrick: Math.round(this.surfer.bestTrick),
      reason: this.surfer.wipeoutReason ?? "Wiped out",
      rank: banked.rank,
      newOverallBest: banked.newOverallBest,
    };
    this.session.results.push(result);

    const isLast = this.session.current >= this.session.players.length - 1;
    this.state = "playerResult";
    this.ui.renderPlayerResult(result, isLast ? null : this.session.players[this.session.current + 1], this.spot);
    this.ui.show("playerResult");
  }

  private nextPlayer(): void {
    if (this.session.current >= this.session.players.length - 1) {
      this.state = "results";
      this.ui.renderResults(this.session.results, this.spot, this.meta);
      this.ui.show("results");
      return;
    }
    this.session.current += 1;
    this.toHandoff();
  }

  // --- lobby actions -------------------------------------------------------
  private selectBoard(id: string): void {
    this.meta.selectedBoard = id;
    saveMeta(this.meta);
    this.stats = boardById(id);
    this.board.applyBoardDef(boardById(id));
    this.ui.renderLobby(this.meta);
  }
  private selectSpot(id: string): void {
    const spot = spotById(id);
    if (!spotUnlocked(spot, this.meta.bestScore)) return;
    this.meta.selectedSpot = id;
    saveMeta(this.meta);
    this.toLobby();
  }
  private setPlayers(names: string[]): void {
    this.meta.players = names.length ? names : ["Player 1"];
    saveMeta(this.meta);
    this.ui.renderLobby(this.meta);
  }
  private toggleMute(): void {
    this.meta.muted = !this.meta.muted;
    this.audio.setMuted(this.meta.muted);
    saveMeta(this.meta);
    this.ui.renderLobby(this.meta);
  }

  // --- loop ----------------------------------------------------------------
  private readonly loop = (now: number) => {
    const rawDt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.adaptQuality(rawDt);

    // slow-motion + shake ease in real time, but only bite during the action
    this.slowmo = Math.max(0, this.slowmo - rawDt);
    const dramatic = this.state === "playing" || this.state === "wipeout";
    this.timeScale = damp(this.timeScale, this.slowmo > 0 && dramatic ? 0.45 : 1, 7, rawDt);
    this.shake = Math.max(0, this.shake - rawDt * 3.2);
    const dt = rawDt * (dramatic ? this.timeScale : 1);

    if (this.input.consumePause()) {
      if (this.state === "playing") this.pause();
      else if (this.state === "paused") this.resume();
    }

    // paused: freeze the world, keep the music alive, just re-show the frame
    if (this.state === "paused") {
      this.audio.update(rawDt, null);
      this.composer.render();
      requestAnimationFrame(this.loop);
      return;
    }

    this.elapsed += dt;

    if (this.state === "playing") this.stepPlaying(dt);
    else if (this.state === "wipeout") this.stepWipeout(dt);
    else if (this.state === "intro") this.stepIntro(dt);
    else this.stepIdle(dt);

    this.spray.update(dt);
    this.scenery.update(this.surfer.x, this.elapsed);
    this.ocean.update(this.elapsed, this.surfer.x, this.surfer.z);
    this.sky.follow(this.camera.position, this.elapsed);
    this.audio.update(rawDt, this.state === "playing" ? this.surfer : null);

    // screen shake: jitter the camera for this frame only, then restore it
    let ox = 0, oy = 0, oz = 0;
    if (this.shake > 0.001) {
      const a = this.shake * 0.6;
      ox = (Math.random() * 2 - 1) * a;
      oy = (Math.random() * 2 - 1) * a;
      oz = (Math.random() * 2 - 1) * a;
      this.camera.position.set(this.camera.position.x + ox, this.camera.position.y + oy, this.camera.position.z + oz);
    }
    this.composer.render();
    if (ox || oy || oz) this.camera.position.set(this.camera.position.x - ox, this.camera.position.y - oy, this.camera.position.z - oz);

    requestAnimationFrame(this.loop);
  };

  private stepPlaying(dt: number): void {
    this.field.energy = spotEnergyAt(this.spot, this.surfer.runTime);
    // the curl peels down the line; it speeds up only a little as the swell
    // builds, so it always stays catchable
    this.field.curlX += this.field.peelSpeed * (0.85 + 0.15 * this.field.energy) * dt;
    const ev = this.surfer.update(dt, this.input, this.field, this.elapsed, this.stats);

    this.emitSprayAndFx(ev);
    this.emitCurlSpray(0.7 + 0.5 * this.field.energy);
    this.updateCameraFollow(dt);
    this.board.update(this.surfer, this.input.tuckHeld, dt);
    this.pushHud();

    if (ev.wipeout) {
      this.audio.wipeout();
      this.bigBurst();
      this.kick(1.3, 0.55); // hard shake + a beat of slow-mo on the crash
      this.state = "wipeout";
      this.wipeoutTimer = 1.3;
      this.ui.flashMessage(ev.wipeout);
    }
  }

  private stepWipeout(dt: number): void {
    this.wipeoutTimer -= dt;
    // keep the board where it fell, let the camera ease and spray settle
    this.updateCameraFollow(dt);
    this.board.update(this.surfer, false, dt);
    this.pushHud();
    if (this.wipeoutTimer <= 0) this.endRide();
  }

  private stepIntro(dt: number): void {
    this.field.curlX += this.field.peelSpeed * 0.5 * dt;
    const s = this.field.sample(this.surfer.x, this.surfer.z, this.elapsed);
    this.surfer.sample = s;
    this.board.update(this.surfer, false, dt);
    this.emitCurlSpray(1.0);

    this.introT += (dt * this.introSpeed) / INTRO_DURATION;
    if (this.introT >= 1) {
      this.toLobby();
      return;
    }
    const t = this.introT;
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; // easeInOutQuad
    this.introPos.getPoint(e, this.camera.position);
    this.introLook.getPoint(e, this.lookTarget);
    const seaY = this.field.height(this.camera.position.x, this.camera.position.z, this.elapsed);
    if (this.camera.position.y < seaY + 1.6) this.camera.position.y = seaY + 1.6;
    this.camera.lookAt(this.lookTarget);
    if (Math.abs(this.camera.fov - Balance.camFovBase) > 0.01) {
      this.camera.fov = Balance.camFovBase;
      this.camera.updateProjectionMatrix();
    }
  }

  private stepIdle(dt: number): void {
    if (this.state === "loading") {
      this.loadingT += dt;
      this.ui.updateLoading(clamp01(this.loadingT / 1.4));
      if (this.loadingT >= 1.4) this.startIntro();
      return; // hold the scene still behind the loading overlay
    }
    // gently peel the wave past and orbit the camera in every menu state
    this.field.curlX += this.field.peelSpeed * 0.35 * dt;
    const s = this.field.sample(this.surfer.x, this.surfer.z, this.elapsed);
    this.surfer.sample = s;
    this.board.update(this.surfer, false, dt);
    this.emitCurlSpray(0.8);

    this.menuAngle += dt * 0.1;
    const r = 13;
    this.camTarget.set(s.posX + Math.cos(this.menuAngle) * r, s.posY + 6, s.posZ + Math.sin(this.menuAngle) * r);
    this.camera.position.lerp(this.camTarget, 1 - Math.exp(-2 * dt));
    this.lookTarget.set(s.posX, s.posY + 1.2, s.posZ);
    this.camera.lookAt(this.lookTarget);
  }

  // --- camera --------------------------------------------------------------
  private updateCameraFollow(dt: number): void {
    const s = this.surfer.sample;
    const hx = Math.cos(this.surfer.heading);
    const hz = Math.sin(this.surfer.heading);
    const px = s.posX;
    const py = this.surfer.renderY;
    const pz = s.posZ;

    this.camTarget.set(
      px - hx * Balance.camDistance,
      py + Balance.camHeight,
      pz - hz * Balance.camDistance,
    );
    this.lookTarget.set(px + hx * Balance.camLookAhead, py + 1.0, pz + hz * Balance.camLookAhead);

    if (this.snapCam) {
      this.camera.position.copy(this.camTarget);
      this.snapCam = false;
    } else {
      const k = 1 - Math.exp(-Balance.camFollow * dt);
      this.camera.position.lerp(this.camTarget, k);
    }
    // never let the chase cam sink into the swell in front of/around it
    const seaY = this.field.height(this.camera.position.x, this.camera.position.z, this.elapsed);
    if (this.camera.position.y < seaY + 1.6) this.camera.position.y = seaY + 1.6;
    this.camera.lookAt(this.lookTarget);

    const targetFov = Balance.camFovBase + clamp01(this.surfer.speed / Balance.vMax) * Balance.camFovSpeed;
    this.fov = damp(this.fov, targetFov, 4, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  // --- fx ------------------------------------------------------------------
  private emitSprayAndFx(ev: ReturnType<Surfer["update"]>): void {
    const s = this.surfer.sample;
    const hx = Math.cos(this.surfer.heading);
    const hz = Math.sin(this.surfer.heading);
    // trail starts well behind and just below the board so it streams away
    const tailX = s.posX - hx * 1.8;
    const tailZ = s.posZ - hz * 1.8;
    const tailY = this.surfer.renderY - 0.25;

    const speedF = clamp01(this.surfer.speed / Balance.vMax);
    if (!this.surfer.airborne && speedF > 0.1) {
      const n = Math.round(speedF * 2.5 + this.surfer.foam * 3);
      const side = -this.surfer.steer; // spray kicks out of the turn
      const sx = -hz * side;
      const sz = hx * side;
      this.spray.emit(
        tailX,
        tailY,
        tailZ,
        -hx * this.surfer.speed * 0.2 + sx * 3,
        1.5 + speedF * 2,
        -hz * this.surfer.speed * 0.2 + sz * 3,
        0.5,
        9,
        0.5,
        n,
      );
    }

    if (ev.pump === "good") {
      this.audio.pump(ev.pumpQuality ?? 0.5);
      this.spray.emit(tailX, tailY, tailZ, -hx * 4, 4, -hz * 4, 0.8, 12, 0.6, 10);
    } else if (ev.pump === "scrub") {
      this.audio.scrub();
      this.spray.emit(tailX, tailY, tailZ, 0, 1.5, 0, 0.6, 8, 0.4, 6);
    }
    if (ev.airLaunch) {
      this.spray.emit(s.posX - hx * 1.5, tailY, s.posZ - hz * 1.5, -hx * 6, 6, -hz * 6, 1.0, 12, 0.7, 14);
    }
    if (ev.enteredBarrel) {
      this.audio.barrel();
      this.kick(0.45);
    }
    if (ev.trick) {
      this.audio.trick(ev.trick.points / 1500);
      const tag = ev.trick.tag ? ` ${ev.trick.tag}` : "";
      const combo = ev.trick.combo > 1 ? `  ×${ev.trick.combo}` : "";
      this.ui.trickPopup(`${ev.trick.name}${tag}`, ev.trick.points, combo);
      // bigger payoff = bigger kick; a stomped air gets a beat of slow-mo
      const big = clamp01(ev.trick.points / 4000);
      this.kick(0.3 + big * 0.7, ev.trick.name === "Air" && ev.trick.points > 1500 ? 0.4 : 0);
      this.spray.emit(s.posX, this.surfer.renderY + 0.3, s.posZ, -hx * 3, 4.5, -hz * 3, 0.8, 12, 0.6, 14);
    }
  }

  /** Spray flying off the breaking curl, so the wave looks alive even before you
   * drop in. Samples the surface along the line near the board and throws foam up
   * and seaward wherever it's folding or already broken. */
  private emitCurlSpray(strength: number): void {
    const f = this.field;
    const lipZ = f.params.lipCenter * f.params.faceWidth + 0.6;
    const n = Math.round(strength * 6);
    for (let k = 0; k < n; k++) {
      const x = this.surfer.x + (Math.random() * 46 - 30);
      const s = f.sample(x, lipZ, this.elapsed);
      if (s.jacobian < 0.5 || s.broken > 0.3) {
        this.spray.emit(
          s.posX,
          s.posY + 0.4,
          s.posZ,
          (Math.random() - 0.5) * 3,
          3.5 + Math.random() * 5 * strength,
          -1.5 - Math.random() * 3.5,
          0.9,
          11,
          0.8,
          1,
        );
      }
    }
  }

  private bigBurst(): void {
    const s = this.surfer.sample;
    this.spray.emit(s.posX, this.surfer.renderY + 0.5, s.posZ, 0, 6, 0, 1.6, 22, 1.0, 70);
  }

  private pushHud(): void {
    const board = spotLeaderboard(this.meta, this.spot.id);
    const hud: HudData = {
      speed: this.surfer.speed,
      speedFrac: clamp01(this.surfer.speed / Balance.vMax),
      style: this.surfer.flow,
      styleFrac: clamp01((this.surfer.flow - Balance.flowMin) / (Balance.flowMax - Balance.flowMin)),
      pocket: this.surfer.pocketScore,
      score: this.surfer.score,
      bestToBeat: board.length ? board[0].score : 0,
      combo: this.surfer.combo,
      playerName: this.session.players[this.session.current] ?? "",
      inBarrel: this.surfer.inBarrel,
      barrelGlow: this.surfer.inBarrel ? 1 : clamp01(this.surfer.pocketScore),
    };
    this.ui.updateHud(hud);
  }

  // --- post-processing -----------------------------------------------------
  private setupComposer(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.composer = new EffectComposer(this.renderer);
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // bloom only the brightest things — the sun, its glint on the water, foam
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.55, 0.5, 0.82);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  /** Kick the camera (and optionally drop into slow-mo) for impact. */
  private kick(shake: number, slowmo = 0): void {
    this.shake = Math.max(this.shake, shake);
    if (slowmo > 0) this.slowmo = Math.max(this.slowmo, slowmo);
  }

  /** Lower visual quality a notch if frames are consistently slow (and bump it
   * back up if there's headroom) so it stays smooth on weaker GPUs. */
  private adaptQuality(rawDt: number): void {
    this.frameEma += (rawDt - this.frameEma) * 0.05;
    this.qualityCheck += rawDt;
    if (this.qualityCheck < 1.5) return;
    this.qualityCheck = 0;
    const ms = this.frameEma * 1000;
    if (ms > 26 && this.quality > 0) {
      this.quality--;
      this.applyQuality();
    } else if (ms < 15 && this.quality < 2) {
      this.quality++;
      this.applyQuality();
    }
  }

  private applyQuality(): void {
    this.bloom.enabled = this.quality >= 2;
    this.ocean.setQuality(this.quality >= 1 ? 1 : 0);
    const pr = this.quality >= 1 ? Math.min(window.devicePixelRatio, 2) : 1;
    this.renderer.setPixelRatio(pr);
    this.composer.setPixelRatio(pr);
    this.onResize();
  }

  private onResize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloom.setSize(w, h);
  }
}
