/**
 * Input aggregator. Keyboard drives it directly; touch / on-screen buttons call
 * the same setters, so the physics only ever sees one normalised snapshot.
 *
 * Steering is analog-feel: a tap nudges, a hold leans continuously. Pump is
 * evaluated on RELEASE (hold through the carve, release near the apex).
 */
export class Input {
  /** target steer in [-1, 1] (the physics smooths toward this) */
  steerTarget = 0;
  pumpHeld = false;
  tuckHeld = false;

  private left = false;
  private right = false;
  private pumpReleasedFlag = false;
  private pausePressedFlag = false;
  private disposed = false;

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    switch (e.code) {
      case "ArrowLeft":
      case "KeyA":
        this.left = true;
        e.preventDefault();
        break;
      case "ArrowRight":
      case "KeyD":
        this.right = true;
        e.preventDefault();
        break;
      case "Space":
        this.pumpHeld = true;
        e.preventDefault();
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.tuckHeld = true;
        break;
      case "Escape":
      case "KeyP":
        this.pausePressedFlag = true;
        break;
    }
    this.syncSteer();
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    switch (e.code) {
      case "ArrowLeft":
      case "KeyA":
        this.left = false;
        break;
      case "ArrowRight":
      case "KeyD":
        this.right = false;
        break;
      case "Space":
        if (this.pumpHeld) this.pumpReleasedFlag = true;
        this.pumpHeld = false;
        break;
      case "ShiftLeft":
      case "ShiftRight":
        this.tuckHeld = false;
        break;
    }
    this.syncSteer();
  };

  constructor() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  private syncSteer(): void {
    // keyboard overrides the analog touch value while a key is held
    if (this.left || this.right) {
      this.steerTarget = (this.right ? 1 : 0) - (this.left ? 1 : 0);
    }
  }

  // --- touch / on-screen control surface -----------------------------------
  setSteer(v: number): void {
    if (!this.left && !this.right) this.steerTarget = Math.max(-1, Math.min(1, v));
  }
  pressPump(): void {
    this.pumpHeld = true;
  }
  releasePump(): void {
    if (this.pumpHeld) this.pumpReleasedFlag = true;
    this.pumpHeld = false;
  }
  setTuck(v: boolean): void {
    this.tuckHeld = v;
  }

  /** Consume the "pump released this frame" edge. */
  consumePumpRelease(): boolean {
    const v = this.pumpReleasedFlag;
    this.pumpReleasedFlag = false;
    return v;
  }
  /** Consume the "pause pressed this frame" edge. */
  consumePause(): boolean {
    const v = this.pausePressedFlag;
    this.pausePressedFlag = false;
    return v;
  }

  /** Release everything (e.g. when pausing) so nothing sticks. */
  reset(): void {
    this.left = this.right = false;
    this.pumpHeld = this.tuckHeld = false;
    this.steerTarget = 0;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }
}
