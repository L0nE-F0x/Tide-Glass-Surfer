import * as THREE from "three";
import { Palette } from "./Sky.ts";

/**
 * The beach arena: a sandy coast on the inshore (+Z) side of the wave with palm
 * trees, umbrellas, a watching crowd, a judges' stand and seagulls overhead —
 * all procedural, no assets. Trees/umbrellas/crowd/gulls live in recycling pools
 * that tile along the line (+X) relative to the board, so the coast streams past
 * endlessly however far you ride. The sun sets down the line.
 */

/** Cross-shore sand profile: waterline near z≈30, rising into dunes that hide the
 * ocean behind the beach. */
function beachY(z: number): number {
  if (z < 26) return -1.5;
  const t = (z - 26) / 150;
  return -0.6 + Math.min(t, 1) * 19 + Math.max(0, z - 176) * 0.08;
}

const PALM_SPACING = 26;
const PALMS = 12;
const UMB_SPACING = 30;
const UMBRELLAS = 9;
const CROWD = 48;
const CROWD_SPAN = 360;
const GULLS = 14;
const GULL_SPAN = 520;
const STANDS = 3;
const STAND_SPACING = 240;

function tile(x0: number, boardX: number, span: number): number {
  return x0 + Math.round((boardX - x0) / span) * span;
}

function makePalm(): THREE.Group {
  const g = new THREE.Group();
  const bark = new THREE.MeshStandardMaterial({ color: "#6b4a2b", roughness: 0.9 });
  const frondMat = new THREE.MeshStandardMaterial({ color: Palette.palm, roughness: 0.8, side: THREE.DoubleSide });
  const h = 6.5 + Math.random() * 3;
  // a gently curved trunk built from a few tapering segments
  let y = 0;
  let lean = 0;
  const segs = 5;
  for (let i = 0; i < segs; i++) {
    const sh = h / segs;
    const r0 = 0.32 - (i / segs) * 0.16;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r0 * 0.85, r0, sh, 6), bark);
    lean += 0.12 + Math.random() * 0.05;
    seg.position.set(Math.sin(lean) * 0.5, y + sh / 2, 0);
    seg.rotation.z = -lean * 0.35;
    g.add(seg);
    y += sh * Math.cos(lean * 0.35);
  }
  const top = new THREE.Vector3(Math.sin(lean) * 0.9, y, 0);
  // crown of drooping fronds
  const fronds = 8;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2;
    const frond = new THREE.Mesh(new THREE.ConeGeometry(0.42, 3.4, 4), frondMat);
    frond.scale.set(1, 1, 0.18);
    frond.position.copy(top);
    frond.rotation.y = a;
    frond.rotation.z = Math.PI / 2 - 0.5; // splay out and droop
    frond.translateY(1.5);
    g.add(frond);
  }
  // a couple of coconuts
  const coco = new THREE.MeshStandardMaterial({ color: "#3b2a1a", roughness: 0.8 });
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), coco);
    c.position.set(top.x + (Math.random() - 0.5) * 0.5, top.y - 0.3, (Math.random() - 0.5) * 0.5);
    g.add(c);
  }
  return g;
}

const UMB_COLORS = ["#ff6b6b", "#ffd166", "#4ecdc4", "#f9f7f3", "#ff8e72", "#7b6cff"];
function makeUmbrella(i: number): THREE.Group {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 3, 6),
    new THREE.MeshStandardMaterial({ color: "#e8e8e8", roughness: 0.6 }),
  );
  pole.position.y = 1.5;
  g.add(pole);
  const canopy = new THREE.Mesh(
    new THREE.ConeGeometry(1.7, 0.85, 12),
    new THREE.MeshStandardMaterial({ color: UMB_COLORS[i % UMB_COLORS.length], roughness: 0.7, side: THREE.DoubleSide }),
  );
  canopy.position.y = 3.1;
  canopy.rotation.z = (Math.random() - 0.5) * 0.2;
  g.add(canopy);
  return g;
}

function makeSeagull(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: "#f4f6fb", roughness: 0.7, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 5), mat);
  body.scale.set(1, 0.7, 1.8);
  g.add(body);
  for (const s of [-1, 1]) {
    const wing = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.5, 3), mat);
    wing.name = s < 0 ? "wingL" : "wingR";
    wing.scale.set(1, 0.12, 1);
    wing.rotation.z = Math.PI / 2;
    wing.position.x = s * 0.7;
    g.add(wing);
  }
  return g;
}

function makeDolphin(): THREE.Group {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: "#46697a", roughness: 0.45, metalness: 0.1 });
  const belly = new THREE.MeshStandardMaterial({ color: "#cdd9de", roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), skin);
  body.scale.set(1.8, 0.55, 0.5); // long axis along +x (travel direction)
  g.add(body);
  const bel = new THREE.Mesh(new THREE.SphereGeometry(0.46, 10, 8), belly);
  bel.scale.set(1.55, 0.36, 0.42);
  bel.position.y = -0.13;
  g.add(bel);
  const snout = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.55, 8), skin);
  snout.rotation.z = -Math.PI / 2;
  snout.position.set(1.0, 0.02, 0);
  g.add(snout);
  const fin = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.5, 4), skin);
  fin.scale.set(1, 1, 0.3);
  fin.position.set(-0.1, 0.42, 0);
  fin.rotation.z = -0.35;
  g.add(fin);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.55, 4), skin);
  tail.scale.set(0.45, 1, 1);
  tail.rotation.z = Math.PI / 2;
  tail.position.set(-1.0, 0, 0);
  g.add(tail);
  g.visible = false;
  return g;
}

function makeJudgesStand(): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: "#9c6b3f", roughness: 0.85 });
  const post = new THREE.MeshStandardMaterial({ color: "#6b4a2b", roughness: 0.9 });
  // raised deck on four posts
  for (const sx of [-1.6, 1.6]) for (const sz of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.6, 0.22), post);
    leg.position.set(sx, 1.3, sz);
    g.add(leg);
  }
  const deck = new THREE.Mesh(new THREE.BoxGeometry(4, 0.25, 2.6), wood);
  deck.position.y = 2.7;
  g.add(deck);
  const desk = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.7, 0.4), wood);
  desk.position.set(0, 3.2, -0.9);
  g.add(desk);
  // three judges behind the desk
  const suit = ["#15384a", "#7a2f3a", "#3a3f55"];
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.18, 0.4, 4, 6),
      new THREE.MeshStandardMaterial({ color: suit[i], roughness: 0.8 }),
    );
    body.position.y = 0.45;
    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 8, 6),
      new THREE.MeshStandardMaterial({ color: "#d9a06f", roughness: 0.6 }),
    );
    head.position.y = 0.95;
    p.add(body, head);
    p.position.set(-1.1 + i * 1.1, 2.85, -0.4);
    g.add(p);
  }
  // roof
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(4.4, 0.18, 3),
    new THREE.MeshStandardMaterial({ color: "#d65a4a", roughness: 0.7 }),
  );
  roof.position.y = 4.4;
  g.add(roof);
  for (const sx of [-2, 2]) {
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.7, 5), post);
    p.position.set(sx, 3.65, 0);
    g.add(p);
  }
  // banner
  const banner = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.7), judgesBannerMat());
  banner.position.set(0, 4.0, 1.55);
  g.add(banner);
  return g;
}

let _bannerMat: THREE.MeshBasicMaterial | null = null;
function judgesBannerMat(): THREE.MeshBasicMaterial {
  if (_bannerMat) return _bannerMat;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 96;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#0d2a3a";
  ctx.fillRect(0, 0, 512, 96);
  ctx.fillStyle = "#ffd166";
  ctx.font = "bold 56px Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("· JUDGES ·", 256, 52);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  _bannerMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true });
  return _bannerMat;
}

export class Scenery {
  private readonly root = new THREE.Group();
  private readonly palms: THREE.Group[] = [];
  private readonly palmX: number[] = [];
  private readonly umbrellas: THREE.Group[] = [];
  private readonly umbX: number[] = [];
  private readonly stands: THREE.Group[] = [];
  private readonly standX: number[] = [];
  private readonly gulls: { g: THREE.Group; x0: number; z: number; y: number; phase: number }[] = [];
  private readonly dolphins: {
    g: THREE.Group;
    x0: number;
    z: number;
    period: number;
    leapDur: number;
    phase: number;
    height: number;
  }[] = [];
  private readonly crowd: THREE.InstancedMesh;
  private readonly crowdHeads: THREE.InstancedMesh;
  private readonly crowdData: { x0: number; z: number; s: number }[] = [];
  private readonly beach: THREE.Mesh;
  private readonly dummy = new THREE.Object3D();

  constructor(scene: THREE.Scene) {
    this.beach = this.makeBeach();
    this.root.add(this.beach);

    for (let i = 0; i < PALMS; i++) {
      const p = makePalm();
      const z = 48 + Math.random() * 70;
      p.position.z = z;
      p.position.y = beachY(z);
      this.palms.push(p);
      this.palmX.push(i * PALM_SPACING + (Math.random() - 0.5) * 10);
      this.root.add(p);
    }
    for (let i = 0; i < UMBRELLAS; i++) {
      const u = makeUmbrella(i);
      const z = 36 + Math.random() * 26;
      u.position.z = z;
      u.position.y = beachY(z);
      this.umbrellas.push(u);
      this.umbX.push(i * UMB_SPACING + (Math.random() - 0.5) * 12);
      this.root.add(u);
    }
    for (let i = 0; i < STANDS; i++) {
      const s = makeJudgesStand();
      s.position.z = 31;
      s.position.y = beachY(31);
      this.stands.push(s);
      this.standX.push(i * STAND_SPACING + 20);
      this.root.add(s);
    }
    for (let i = 0; i < GULLS; i++) {
      const g = makeSeagull();
      const z = -40 + Math.random() * 120;
      const y = 22 + Math.random() * 34;
      this.gulls.push({ g, x0: (i / GULLS) * GULL_SPAN, z, y, phase: Math.random() * 10 });
      this.root.add(g);
    }
    // a small pod leaping in the channel between the wave and the beach
    for (let i = 0; i < 3; i++) {
      const g = makeDolphin();
      this.dolphins.push({
        g,
        x0: (i / 3) * 300 + Math.random() * 40,
        z: 15 + Math.random() * 9,
        period: 9 + Math.random() * 7,
        leapDur: 1.4,
        phase: Math.random() * 20,
        height: 1.4 + Math.random() * 0.9,
      });
      this.root.add(g);
    }

    // crowd: instanced bodies + heads on the sand, facing the surf
    const bodyGeo = new THREE.CapsuleGeometry(0.16, 0.42, 4, 6);
    const headGeo = new THREE.SphereGeometry(0.15, 8, 6);
    const bodyMat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    const headMat = new THREE.MeshStandardMaterial({ roughness: 0.6 });
    this.crowd = new THREE.InstancedMesh(bodyGeo, bodyMat, CROWD);
    this.crowdHeads = new THREE.InstancedMesh(headGeo, headMat, CROWD);
    const shirt = ["#ff6b6b", "#ffd166", "#4ecdc4", "#f7f3ee", "#ff8e72", "#7b6cff", "#43aa8b", "#e07a5f"];
    const skin = ["#e8b98f", "#c98a5e", "#a4683f", "#f0c9a0"];
    for (let i = 0; i < CROWD; i++) {
      const z = 33 + Math.random() * 26;
      this.crowdData.push({ x0: (i / CROWD) * CROWD_SPAN, z, s: 0.9 + Math.random() * 0.4 });
      this.crowd.setColorAt(i, new THREE.Color(shirt[i % shirt.length]));
      this.crowdHeads.setColorAt(i, new THREE.Color(skin[i % skin.length]));
    }
    // upload the per-instance colours (setColorAt alone doesn't flag the buffer)
    if (this.crowd.instanceColor) this.crowd.instanceColor.needsUpdate = true;
    if (this.crowdHeads.instanceColor) this.crowdHeads.instanceColor.needsUpdate = true;
    this.root.add(this.crowd, this.crowdHeads);

    scene.add(this.root);
  }

  private makeBeach(): THREE.Mesh {
    const segX = 60;
    const segZ = 40;
    const halfX = 700;
    const z0 = 24;
    const z1 = 260;
    const geo = new THREE.PlaneGeometry(halfX * 2, z1 - z0, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const wet = new THREE.Color("#b59a73");
    const dry = Palette.sand;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i) + (z0 + z1) / 2;
      const x = pos.getX(i);
      let y = beachY(z);
      y += Math.sin(x * 0.15) * 0.3 + Math.sin(z * 0.2 + x * 0.05) * 0.4; // gentle dune texture
      pos.setY(i, y);
      const t = Math.min(1, Math.max(0, (z - 26) / 20));
      const col = wet.clone().lerp(dry, t);
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0 });
    const m = new THREE.Mesh(geo, mat);
    m.position.z = (z0 + z1) / 2;
    return m;
  }

  update(boardX: number, time: number): void {
    // sand follows the board so the coast is always alongside (uniform → seamless)
    this.beach.position.x = Math.round(boardX / 4) * 4;

    for (let i = 0; i < this.palms.length; i++) {
      this.palms[i].position.x = tile(this.palmX[i], boardX, PALMS * PALM_SPACING);
      this.palms[i].rotation.y = Math.sin(time * 0.4 + i) * 0.04; // sway
    }
    for (let i = 0; i < this.umbrellas.length; i++) {
      this.umbrellas[i].position.x = tile(this.umbX[i], boardX, UMBRELLAS * UMB_SPACING);
    }
    for (let i = 0; i < this.stands.length; i++) {
      this.stands[i].position.x = tile(this.standX[i], boardX, STANDS * STAND_SPACING);
    }

    // crowd instances
    for (let i = 0; i < this.crowdData.length; i++) {
      const d = this.crowdData[i];
      const x = tile(d.x0, boardX, CROWD_SPAN);
      const y = beachY(d.z);
      const bob = Math.sin(time * 2 + i) * 0.03;
      this.dummy.position.set(x, y + 0.55 * d.s + bob, d.z);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.scale.setScalar(d.s);
      this.dummy.updateMatrix();
      this.crowd.setMatrixAt(i, this.dummy.matrix);
      this.dummy.position.y = y + 1.0 * d.s + bob;
      this.dummy.updateMatrix();
      this.crowdHeads.setMatrixAt(i, this.dummy.matrix);
    }
    this.crowd.instanceMatrix.needsUpdate = true;
    this.crowdHeads.instanceMatrix.needsUpdate = true;

    // seagulls drift down the line and flap
    for (const b of this.gulls) {
      const x = tile(b.x0 + time * 3.5, boardX, GULL_SPAN);
      b.g.position.set(x, b.y + Math.sin(time * 0.5 + b.phase) * 1.5, b.z);
      b.g.rotation.y = Math.PI / 2;
      const flap = Math.sin(time * 7 + b.phase) * 0.6;
      const wl = b.g.getObjectByName("wingL");
      const wr = b.g.getObjectByName("wingR");
      if (wl) wl.rotation.y = flap;
      if (wr) wr.rotation.y = -flap;
    }

    // dolphins arc out of the channel then slip back under
    for (const d of this.dolphins) {
      const cy = (time + d.phase) % d.period;
      if (cy < d.leapDur) {
        const a = cy / d.leapDur;
        d.g.visible = true;
        d.g.position.set(tile(d.x0 + a * 7, boardX, 300), Math.sin(a * Math.PI) * d.height - 0.25, d.z);
        d.g.rotation.z = (1 - 2 * a) * 0.9; // nose up on the way out, down on re-entry
      } else if (d.g.visible) {
        d.g.visible = false;
      }
    }
  }
}
