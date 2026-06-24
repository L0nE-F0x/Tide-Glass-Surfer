import { Balance } from "../config/balance.ts";
import type { Input } from "../input/input.ts";
import { BOARDS } from "../state/boards.ts";
import { spotLeaderboard, type MetaState } from "../state/meta.ts";
import { SPOTS, spotUnlocked, type Spot } from "../state/spots.ts";

export interface HudData {
  speed: number;
  speedFrac: number;
  style: number;
  styleFrac: number;
  pocket: number;
  score: number;
  bestToBeat: number;
  combo: number;
  playerName: string;
  inBarrel: boolean;
  barrelGlow: number;
}

/** A finished ride, shown on the player card and the session ranking. */
export interface PlayerResult {
  name: string;
  score: number;
  rideSeconds: number;
  barrels: number;
  bestTrick: number;
  reason: string;
  rank: number; // placing on the spot leaderboard (0 = didn't place)
  newOverallBest: boolean;
}

export interface UICallbacks {
  enterGame(): void;
  skipIntro(): void;
  setIntroSpeed(mult: number): void;
  startSession(): void;
  dropIn(): void;
  nextPlayer(): void;
  rematch(): void;
  toLobby(): void;
  resume(): void;
  selectBoard(id: string): void;
  selectSpot(id: string): void;
  setPlayers(names: string[]): void;
  toggleMute(): void;
}

type Screen = "landing" | "loading" | "intro" | "lobby" | "hud" | "paused" | "handoff" | "playerResult" | "results";

const MAX_PLAYERS = 6;

const LOADING_QUIPS = [
  "Waxing the board…",
  "Reading the swell…",
  "Briefing the judges…",
  "Shooing the seagulls…",
  "Chasing the sunset…",
  "Tuning the lineup…",
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export class UI {
  private readonly root: HTMLElement;
  private readonly cb: UICallbacks;
  private readonly input: Input;

  private readonly landing = el("div", "screen landing hidden");
  private readonly loading = el("div", "screen loading hidden");
  private readonly intro = el("div", "intro-ui hidden");
  private readonly lobby = el("div", "screen lobby hidden");
  private readonly hud = el("div", "hud hidden");
  private readonly paused = el("div", "screen paused hidden");
  private readonly handoff = el("div", "screen handoff hidden");
  private readonly playerResult = el("div", "screen playerResult hidden");
  private readonly results = el("div", "screen results hidden");
  private readonly vignette = el("div", "vignette");
  private readonly loadingBar = el("i");

  /** working roster while editing in the lobby (persists across re-renders) */
  private roster: string[] | null = null;

  // live hud nodes
  private readonly speedVal = el("span", "stat-val");
  private readonly speedBar = el("i");
  private readonly styleVal = el("span", "stat-val");
  private readonly styleBar = el("i");
  private readonly pocketBar = el("i");
  private readonly scoreVal = el("span", "score-val");
  private readonly bestVal = el("span");
  private readonly playerVal = el("span", "hud-player");
  private readonly comboVal = el("div", "combo-tag hidden");
  private readonly barrelTag = el("div", "barrel-tag hidden", "IN THE BARREL");

  constructor(root: HTMLElement, input: Input, cb: UICallbacks) {
    this.root = root;
    this.input = input;
    this.cb = cb;

    this.buildHud();
    this.root.append(
      this.vignette,
      this.landing,
      this.loading,
      this.intro,
      this.lobby,
      this.hud,
      this.paused,
      this.handoff,
      this.playerResult,
      this.results,
    );
    this.wireTouch();
  }

  // ---- HUD ----------------------------------------------------------------
  private buildHud(): void {
    const tl = el("div", "hud-tl");
    const speedRow = el("div", "meter");
    speedRow.append(el("label", undefined, "SPEED"), this.barWrap(this.speedBar), this.speedVal);
    const styleRow = el("div", "meter");
    styleRow.append(el("label", undefined, "STYLE"), this.barWrap(this.styleBar), this.styleVal);
    const pocketRow = el("div", "meter pocket");
    pocketRow.append(el("label", undefined, "POCKET"), this.barWrap(this.pocketBar));
    tl.append(speedRow, styleRow, pocketRow);

    const tr = el("div", "hud-tr");
    this.playerVal.textContent = "";
    const score = el("div", "score-box");
    score.append(el("label", undefined, "SCORE"), this.scoreVal);
    const best = el("div", "best-line");
    best.append(el("span", undefined, "TO BEAT "), this.bestVal);
    tr.append(this.playerVal, score, best);

    this.hud.append(tl, tr, this.comboVal, this.barrelTag);
    this.buildTouchControls();
  }

  private barWrap(inner: HTMLElement): HTMLElement {
    const w = el("div", "bar");
    w.append(inner);
    return w;
  }

  private touchControls = el("div", "touch-controls hidden");
  private buildTouchControls(): void {
    const pad = el("div", "tc-steer");
    pad.innerHTML = `<span>◄ STEER ►</span>`;
    const pump = el("button", "tc-btn tc-pump", "PUMP");
    const tuck = el("button", "tc-btn tc-tuck", "TUCK");
    this.touchControls.append(pad, el("div", "tc-actions"));
    (this.touchControls.lastChild as HTMLElement).append(tuck, pump);
    this.hud.append(this.touchControls);

    const steerFromEvent = (e: PointerEvent) => {
      const r = pad.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width; // 0..1
      this.input.setSteer((x - 0.5) * 2);
    };
    pad.addEventListener("pointerdown", (e) => {
      pad.setPointerCapture(e.pointerId);
      steerFromEvent(e);
    });
    pad.addEventListener("pointermove", (e) => {
      if (e.pressure > 0 || e.buttons) steerFromEvent(e);
    });
    const endSteer = () => this.input.setSteer(0);
    pad.addEventListener("pointerup", endSteer);
    pad.addEventListener("pointercancel", endSteer);

    pump.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.input.pressPump();
    });
    pump.addEventListener("pointerup", () => this.input.releasePump());
    tuck.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.input.setTuck(true);
    });
    tuck.addEventListener("pointerup", () => this.input.setTuck(false));
    tuck.addEventListener("pointercancel", () => this.input.setTuck(false));
  }

  updateHud(d: HudData): void {
    this.speedVal.textContent = `${(d.speed * 1.94).toFixed(0)} kt`;
    this.speedBar.style.width = `${Math.round(d.speedFrac * 100)}%`;
    this.styleVal.textContent = `${d.style.toFixed(1)}×`;
    this.styleBar.style.width = `${Math.round(d.styleFrac * 100)}%`;
    this.pocketBar.style.width = `${Math.round(d.pocket * 100)}%`;
    this.scoreVal.textContent = Math.round(d.score).toLocaleString();
    this.bestVal.textContent = d.bestToBeat ? d.bestToBeat.toLocaleString() : "—";
    this.playerVal.textContent = d.playerName;
    const showCombo = d.combo > 1;
    this.comboVal.classList.toggle("hidden", !showCombo);
    if (showCombo) this.comboVal.textContent = `${d.combo}× COMBO`;
    this.barrelTag.classList.toggle("hidden", !d.inBarrel);
    this.vignette.style.opacity = String(0.15 + d.barrelGlow * 0.7);
    this.vignette.classList.toggle("barrel", d.inBarrel);
  }

  // ---- screen switching ---------------------------------------------------
  show(screen: Screen): void {
    this.landing.classList.toggle("hidden", screen !== "landing");
    this.loading.classList.toggle("hidden", screen !== "loading");
    this.intro.classList.toggle("hidden", screen !== "intro");
    this.lobby.classList.toggle("hidden", screen !== "lobby");
    this.hud.classList.toggle("hidden", screen !== "hud" && screen !== "paused");
    this.paused.classList.toggle("hidden", screen !== "paused");
    this.handoff.classList.toggle("hidden", screen !== "handoff");
    this.playerResult.classList.toggle("hidden", screen !== "playerResult");
    this.results.classList.toggle("hidden", screen !== "results");
    const touch = matchMedia("(pointer: coarse)").matches;
    this.touchControls.classList.toggle("hidden", !(touch && screen === "hud"));
    if (screen !== "hud") this.vignette.style.opacity = "0";
  }

  // ---- landing / loading / intro -----------------------------------------
  renderLanding(): void {
    this.landing.innerHTML = "";
    const card = el("div", "landing-card");
    card.append(
      el("p", "landing-kicker", "◢◤ ARCADE SURF ◢◤"),
      el("h1", "title big-title", "Tide&nbsp;Glass&nbsp;Surfer"),
      el("p", "tagline", "One endless wave. Race the curl, throw tricks, hunt the barrel — then pass the board and battle for the high score."),
    );
    const how = el("div", "how-to");
    how.innerHTML = `
      <div class="how-col">
        <h3>Ride</h3>
        <p><kbd>A</kbd><kbd>D</kbd> / <kbd>←</kbd><kbd>→</kbd> climb to the lip or drop to the trough</p>
        <p><kbd>Space</kbd> pump for speed &nbsp;·&nbsp; <kbd>Shift</kbd> tuck into the barrel</p>
      </div>
      <div class="how-col">
        <h3>Score</h3>
        <p>Snap off the lip, cut back, floater & boost <b>airs</b></p>
        <p>Stay in the pocket to build your <b>Style</b> multiplier & combo</p>
      </div>`;
    card.append(how);
    const enter = el("button", "btn btn-primary big", "Enter Game ►");
    enter.addEventListener("click", () => this.cb.enterGame());
    const actions = el("div", "menu-actions center-actions");
    actions.append(enter);
    card.append(actions);
    card.append(el("p", "credit", "Built with Three.js · no assets — every wave, palm & gull is code."));
    this.landing.append(card);
  }

  renderLoading(): void {
    this.loading.innerHTML = "";
    const card = el("div", "loading-card");
    card.append(el("h1", "title", "Paddling out…"));
    const bar = el("div", "load-bar");
    this.loadingBar.style.width = "0%";
    bar.append(this.loadingBar);
    card.append(bar);
    card.append(el("p", "tip loading-quip", LOADING_QUIPS[(Math.random() * LOADING_QUIPS.length) | 0]));
    this.loading.append(card);
  }

  updateLoading(p: number): void {
    this.loadingBar.style.width = `${Math.round(p * 100)}%`;
  }

  renderIntro(): void {
    this.intro.innerHTML = "";
    const title = el("div", "intro-title");
    title.innerHTML = `<b>Tide Glass Surfer</b><span>welcome to the lineup</span>`;
    const bar = el("div", "intro-controls");
    const speed = el("button", "btn-ghost intro-btn", "▶▶ Speed");
    let mult = 1;
    speed.addEventListener("click", () => {
      mult = mult === 1 ? 2 : mult === 2 ? 4 : 1;
      speed.textContent = mult === 1 ? "▶▶ Speed" : `▶▶ ${mult}×`;
      this.cb.setIntroSpeed(mult);
    });
    const skip = el("button", "btn-ghost intro-btn", "Skip ►");
    skip.addEventListener("click", () => this.cb.skipIntro());
    bar.append(speed, skip);
    this.intro.append(title, bar);
  }

  // ---- lobby --------------------------------------------------------------
  renderLobby(meta: MetaState): void {
    if (!this.roster) this.roster = [...meta.players];
    this.lobby.innerHTML = "";
    const card = el("div", "menu-card wide");
    card.append(
      el("h1", "title", "Tide&nbsp;Glass&nbsp;Surfer"),
      el("p", "tagline", "One endless wave. Race the curl, throw tricks, take turns — high score wins."),
    );

    const stats = el("div", "menu-stats");
    stats.innerHTML = `
      <div><b>${Math.round(meta.bestScore).toLocaleString()}</b><span>best score</span></div>
      <div><b>${meta.longestRide.toFixed(0)}s</b><span>longest ride</span></div>
      <div><b>${meta.totalBarrels}</b><span>barrels</span></div>
      <div><b>${meta.totalRuns}</b><span>rides</span></div>`;
    card.append(stats);

    const cols = el("div", "lobby-cols");
    const left = el("div", "lobby-col");
    left.append(el("h2", "shop-h", "Spot"));
    left.append(this.spotGrid(meta));
    left.append(el("h2", "shop-h", "Board"));
    left.append(this.boardGrid(meta));
    const right = el("div", "lobby-col");
    right.append(el("h2", "shop-h", "Surfers"));
    right.append(this.rosterEditor(meta));
    right.append(el("h2", "shop-h", `Leaderboard · ${spotById(meta.selectedSpot).name}`));
    right.append(this.leaderboardEl(meta, meta.selectedSpot));
    cols.append(left, right);
    card.append(cols);

    const controls = el("div", "controls-help");
    controls.innerHTML = `
      <div class="keys">
        <span><kbd>A</kbd>/<kbd>D</kbd> or <kbd>←</kbd>/<kbd>→</kbd> climb to the lip / drop to the trough</span>
        <span><kbd>Space</kbd> pump for speed · <kbd>Shift</kbd> tuck into the barrel</span>
        <span>Snap off the lip, cut back, floater & boost airs to score</span>
      </div>`;
    card.append(controls);

    const play = el("button", "btn btn-primary", this.roster.length > 1 ? "Start Session ►" : "Drop In ►");
    play.addEventListener("click", () => {
      this.cb.setPlayers(this.commitRoster());
      this.cb.startSession();
    });
    const mute = el("button", "btn btn-ghost", meta.muted ? "🔇 Sound off" : "🔊 Sound on");
    mute.addEventListener("click", () => this.cb.toggleMute());
    const actions = el("div", "menu-actions");
    actions.append(play, mute);
    card.append(actions);

    this.lobby.append(card);
  }

  private commitRoster(): string[] {
    const names = (this.roster ?? [])
      .map((n, i) => (n.trim() ? n.trim() : `Player ${i + 1}`))
      .slice(0, MAX_PLAYERS);
    return names.length ? names : ["Player 1"];
  }

  private spotGrid(meta: MetaState): HTMLElement {
    const grid = el("div", "grid");
    for (const s of SPOTS) {
      const unlocked = spotUnlocked(s, meta.bestScore);
      const selected = meta.selectedSpot === s.id;
      const c = el("div", `pick ${selected ? "selected" : ""} ${unlocked ? "" : "locked"}`);
      c.innerHTML = `
        <b>${s.name}</b>
        <small>${s.blurb}</small>
        <div class="pstats">up to ${s.styleCeiling}× style${unlocked ? "" : ` · unlock at ${s.unlockAt.toLocaleString()}`}</div>`;
      const action = el(
        "button",
        "pick-btn",
        unlocked ? (selected ? "Selected" : "Select") : `🔒 ${s.unlockAt.toLocaleString()}`,
      );
      if (unlocked) action.addEventListener("click", () => this.cb.selectSpot(s.id));
      else action.classList.add("disabled");
      c.append(action);
      grid.append(c);
    }
    return grid;
  }

  private boardGrid(meta: MetaState): HTMLElement {
    const grid = el("div", "grid");
    for (const b of BOARDS) {
      const selected = meta.selectedBoard === b.id;
      const c = el("div", `pick ${selected ? "selected" : ""}`);
      c.innerHTML = `
        <div class="swatch" style="background:${b.color};border-color:${b.accent}"></div>
        <b>${b.name}</b>
        <small>${b.blurb}</small>
        <div class="pstats">drag ${b.dragMul.toFixed(2)}× · turn ${b.turnMul.toFixed(2)}× · pump ${b.pumpMul.toFixed(2)}×</div>`;
      const action = el("button", "pick-btn", selected ? "Selected" : "Select");
      action.addEventListener("click", () => this.cb.selectBoard(b.id));
      c.append(action);
      grid.append(c);
    }
    return grid;
  }

  private rosterEditor(meta: MetaState): HTMLElement {
    const wrap = el("div", "roster");
    const list = el("div", "roster-list");
    const roster = this.roster ?? (this.roster = [...meta.players]);
    roster.forEach((name, i) => {
      const row = el("div", "roster-row");
      const num = el("span", "roster-num", `${i + 1}`);
      const inp = el("input", "roster-input") as HTMLInputElement;
      inp.type = "text";
      inp.maxLength = 14;
      inp.value = name;
      inp.placeholder = `Player ${i + 1}`;
      inp.addEventListener("input", () => {
        roster[i] = inp.value;
      });
      const rm = el("button", "roster-rm", "✕");
      rm.title = "Remove";
      if (roster.length <= 1) rm.classList.add("disabled");
      else rm.addEventListener("click", () => {
        roster.splice(i, 1);
        this.renderLobby(meta);
      });
      row.append(num, inp, rm);
      list.append(row);
    });
    wrap.append(list);
    if (roster.length < MAX_PLAYERS) {
      const add = el("button", "btn btn-ghost btn-sm", "+ Add surfer");
      add.addEventListener("click", () => {
        roster.push(`Player ${roster.length + 1}`);
        this.renderLobby(meta);
      });
      wrap.append(add);
    }
    const hint = el("p", "tip", "Everyone rides their own wave until they fall — then pass the keyboard.");
    wrap.append(hint);
    return wrap;
  }

  private leaderboardEl(meta: MetaState, spotId: string): HTMLElement {
    const wrap = el("div", "leaderboard");
    const board = spotLeaderboard(meta, spotId);
    if (!board.length) {
      wrap.append(el("p", "tip", "No scores yet — be the first to put one up."));
      return wrap;
    }
    board.forEach((e, i) => {
      const row = el("div", `lb-row ${i === 0 ? "lb-top" : ""}`);
      row.innerHTML = `
        <span class="lb-rank">${i + 1}</span>
        <span class="lb-name">${escapeHtml(e.name)}</span>
        <span class="lb-score">${e.score.toLocaleString()}</span>`;
      wrap.append(row);
    });
    return wrap;
  }

  // ---- handoff ------------------------------------------------------------
  renderHandoff(name: string, num: number, total: number, spot: Spot): void {
    this.handoff.innerHTML = "";
    const card = el("div", "menu-card narrow center");
    if (total > 1) card.append(el("p", "handoff-turn", `Surfer ${num} of ${total}`));
    card.append(el("h1", "title", escapeHtml(name)));
    card.append(el("p", "tagline", `Paddle out at ${spot.name}. ${spot.blurb}`));
    const go = el("button", "btn btn-primary big", "Drop In ►");
    go.addEventListener("click", () => this.cb.dropIn());
    const actions = el("div", "menu-actions");
    actions.append(go);
    card.append(actions);
    card.append(el("p", "tip", "A · D to carve · Space pump · Shift tuck"));
    this.handoff.append(card);
  }

  // ---- player result ------------------------------------------------------
  renderPlayerResult(r: PlayerResult, nextName: string | null, spot: Spot): void {
    this.playerResult.innerHTML = "";
    const card = el("div", "menu-card narrow center");
    card.append(el("p", "wipe-reason", r.reason));
    card.append(el("h1", "title", `${escapeHtml(r.name)} · ${r.score.toLocaleString()}`));
    if (r.newOverallBest) card.append(el("p", "handoff-turn gold", "★ New personal best!"));
    else if (r.rank > 0) card.append(el("p", "handoff-turn", `#${r.rank} at ${spot.name}`));
    const stats = el("div", "summary-stats");
    stats.innerHTML = `
      <div><b>${r.rideSeconds.toFixed(0)}s</b><span>ride</span></div>
      <div><b>${r.barrels}</b><span>barrels</span></div>
      <div><b>${r.bestTrick.toLocaleString()}</b><span>best trick</span></div>
      <div><b>${r.score.toLocaleString()}</b><span>score</span></div>`;
    card.append(stats);
    const next = el("button", "btn btn-primary", nextName ? `Pass to ${escapeHtml(nextName)} ►` : "See results ►");
    next.addEventListener("click", () => this.cb.nextPlayer());
    const actions = el("div", "menu-actions");
    actions.append(next);
    card.append(actions);
    this.playerResult.append(card);
  }

  // ---- session results ----------------------------------------------------
  renderResults(results: PlayerResult[], spot: Spot, _meta: MetaState): void {
    this.results.innerHTML = "";
    const card = el("div", "menu-card narrow center");
    const ranked = [...results].sort((a, b) => b.score - a.score);
    const single = results.length === 1;
    card.append(el("h1", "title", single ? "Ride Over" : `Heat Results · ${spot.name}`));
    if (!single && ranked[0]) card.append(el("p", "handoff-turn gold", `🏆 ${escapeHtml(ranked[0].name)} takes it!`));

    const table = el("div", "results-table");
    ranked.forEach((r, i) => {
      const row = el("div", `lb-row ${i === 0 && !single ? "lb-top" : ""}`);
      row.innerHTML = `
        <span class="lb-rank">${i + 1}</span>
        <span class="lb-name">${escapeHtml(r.name)}</span>
        <span class="lb-meta">${r.barrels}🛢 · ${r.rideSeconds.toFixed(0)}s</span>
        <span class="lb-score">${r.score.toLocaleString()}</span>`;
      table.append(row);
    });
    card.append(table);

    const again = el("button", "btn btn-primary", "Rematch ►");
    again.addEventListener("click", () => this.cb.rematch());
    const lobby = el("button", "btn btn-ghost", "Lobby");
    lobby.addEventListener("click", () => this.cb.toLobby());
    const actions = el("div", "menu-actions");
    actions.append(again, lobby);
    card.append(actions);
    this.results.append(card);
  }

  // ---- pause --------------------------------------------------------------
  renderPaused(): void {
    this.paused.innerHTML = "";
    const card = el("div", "menu-card narrow center");
    card.append(el("h1", "title", "Paused"));
    const resume = el("button", "btn btn-primary", "Resume");
    resume.addEventListener("click", () => this.cb.resume());
    const quit = el("button", "btn btn-ghost", "Quit to lobby");
    quit.addEventListener("click", () => this.cb.toLobby());
    const actions = el("div", "menu-actions");
    actions.append(resume, quit);
    card.append(actions);
    this.paused.append(card);
  }

  // ---- transient popups ---------------------------------------------------
  /** A floating "OFF THE LIP +320 ×3" popup when a trick lands. */
  trickPopup(name: string, points: number, combo: string): void {
    const p = el("div", "trick-pop");
    p.innerHTML = `<b>${name}</b><i>+${points.toLocaleString()}${combo}</i>`;
    this.hud.append(p);
    requestAnimationFrame(() => p.classList.add("show"));
    setTimeout(() => {
      p.classList.remove("show");
      setTimeout(() => p.remove(), 350);
    }, 950);
  }

  flashMessage(text: string): void {
    const m = el("div", "toast", text);
    this.hud.append(m);
    requestAnimationFrame(() => m.classList.add("show"));
    setTimeout(() => {
      m.classList.remove("show");
      setTimeout(() => m.remove(), 400);
    }, 1100);
  }

  private wireTouch(): void {
    // two-finger anywhere = tuck (in addition to the on-screen button)
    let touches = 0;
    window.addEventListener("touchstart", (e) => {
      touches = e.touches.length;
      if (touches >= 2) this.input.setTuck(true);
    });
    window.addEventListener("touchend", (e) => {
      touches = e.touches.length;
      if (touches < 2) this.input.setTuck(false);
    });
  }

  /** Max style for the bar normalisation. */
  static readonly flowMax = Balance.flowMax;
}

function spotById(id: string): Spot {
  return SPOTS.find((s) => s.id === id) ?? SPOTS[0];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;",
  );
}
