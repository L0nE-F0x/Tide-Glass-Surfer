import { Game } from "./game/Game.ts";

const canvas = document.getElementById("scene") as HTMLCanvasElement | null;
const uiRoot = document.getElementById("ui-root") as HTMLElement | null;

if (!canvas || !uiRoot) {
  throw new Error("Tide Glass Surfer: missing #scene canvas or #ui-root.");
}

try {
  new Game(canvas, uiRoot);
} catch (err) {
  console.error(err);
  uiRoot.innerHTML = `
    <div class="screen menu">
      <div class="menu-card narrow">
        <h1 class="title">Can't catch the wave</h1>
        <p class="tagline">Your browser couldn't start WebGL. Try a recent Chrome, Edge, Firefox or Safari with hardware acceleration enabled.</p>
      </div>
    </div>`;
}
