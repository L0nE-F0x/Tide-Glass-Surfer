import * as THREE from "three";
import type { BoardDef } from "../state/boards.ts";
import { damp } from "../util/math.ts";
import type { Surfer } from "./physics.ts";

/** Builds the classic pointed-nose, round-tail surfboard outline. */
function boardShape(): THREE.Shape {
  const len = 1.15;
  const w = 0.34;
  const s = new THREE.Shape();
  s.moveTo(0, len);
  s.quadraticCurveTo(w, len * 0.35, w * 0.85, 0);
  s.quadraticCurveTo(w * 0.72, -len * 0.7, 0, -len);
  s.quadraticCurveTo(-w * 0.72, -len * 0.7, -w * 0.85, 0);
  s.quadraticCurveTo(-w, len * 0.35, 0, len);
  return s;
}

/** The board + a stylised crouching rider, oriented to the wave surface. */
export class Board {
  readonly group = new THREE.Group();
  private readonly rider = new THREE.Group();
  private readonly hull: THREE.Mesh;
  private readonly stripe: THREE.Mesh;

  private readonly up = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly heading = new THREE.Vector3();
  private readonly basis = new THREE.Matrix4();
  private tuckAmt = 0;

  constructor(scene: THREE.Scene) {
    const shape = boardShape();
    const extrude = new THREE.ExtrudeGeometry(shape, {
      depth: 0.1,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.04,
      bevelSegments: 2,
      steps: 1,
    });
    // lay flat: length along +Z, thickness along Y
    extrude.rotateX(-Math.PI / 2);
    extrude.center();

    this.hull = new THREE.Mesh(
      extrude,
      new THREE.MeshStandardMaterial({ color: "#e9d8a6", roughness: 0.5, metalness: 0.0 }),
    );
    this.group.add(this.hull);

    // a centre stripe for a bit of character
    const stripeGeo = new THREE.BoxGeometry(0.05, 0.13, 2.0);
    this.stripe = new THREE.Mesh(
      stripeGeo,
      new THREE.MeshStandardMaterial({ color: "#ca6702", roughness: 0.4 }),
    );
    this.stripe.position.y = 0.02;
    this.group.add(this.stripe);

    // two fins under the tail
    const finGeo = new THREE.ConeGeometry(0.08, 0.22, 4);
    const finMat = new THREE.MeshStandardMaterial({ color: "#22323a", roughness: 0.6 });
    for (const dx of [-0.14, 0.14]) {
      const fin = new THREE.Mesh(finGeo, finMat);
      fin.rotation.x = Math.PI;
      fin.position.set(dx, -0.14, -0.85);
      this.group.add(fin);
    }

    this.buildRider();
    this.group.add(this.rider);
    scene.add(this.group);
  }

  private buildRider(): void {
    const suit = new THREE.MeshStandardMaterial({ color: "#15222b", roughness: 0.55, metalness: 0.05 });
    const accent = new THREE.MeshStandardMaterial({ color: "#ff7b54", roughness: 0.5 });
    const skin = new THREE.MeshStandardMaterial({ color: "#e0a87e", roughness: 0.6 });
    const hairMat = new THREE.MeshStandardMaterial({ color: "#2a1a12", roughness: 0.9 });

    // a low, dynamic surf crouch: staggered feet along the board, knees bent,
    // body leaning forward over the nose, arms thrown out for balance.
    // feet + shins (front foot toward the nose +Z)
    const stance = [
      { z: 0.34, lean: 0.25 },
      { z: -0.3, lean: -0.1 },
    ];
    for (let i = 0; i < stance.length; i++) {
      const { z, lean } = stance[i];
      const dx = i === 0 ? 0.1 : -0.11;
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.08, 0.24), suit);
      foot.position.set(dx, 0.04, z);
      this.rider.add(foot);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.26, 4, 6), suit);
      shin.position.set(dx, 0.28, z - lean * 0.2);
      shin.rotation.x = lean;
      this.rider.add(shin);
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.24, 4, 6), suit);
      thigh.position.set(dx * 0.7, 0.5, z * 0.4);
      thigh.rotation.x = -lean * 0.6 + 0.2;
      this.rider.add(thigh);
    }

    // hips + torso, leaning forward over the nose
    const hips = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.12, 4, 8), suit);
    hips.position.set(0, 0.66, 0.05);
    this.rider.add(hips);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.38, 4, 10), suit);
    torso.position.set(0, 0.92, 0.16);
    torso.rotation.x = 0.5;
    this.rider.add(torso);
    // accent stripe down the wetsuit
    const stripe = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.4, 3, 6), accent);
    stripe.position.set(0.13, 0.9, 0.18);
    stripe.rotation.x = 0.5;
    this.rider.add(stripe);

    // neck + head, looking down the line
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 12), skin);
    head.position.set(0, 1.2, 0.34);
    this.rider.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.145, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), hairMat);
    hair.position.set(0, 1.22, 0.31);
    hair.rotation.x = -0.5;
    this.rider.add(hair);

    // arms out for balance: front arm reaching down the line, back arm trailing
    const frontArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.4, 4, 6), suit);
    frontArm.position.set(0.26, 1.0, 0.4);
    frontArm.rotation.set(0.5, 0, 0.9);
    this.rider.add(frontArm);
    const backArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.4, 4, 6), suit);
    backArm.position.set(-0.27, 1.0, -0.05);
    backArm.rotation.set(-0.4, 0, -1.0);
    this.rider.add(backArm);
    // hands
    for (const [hx, hy, hz] of [[0.42, 0.82, 0.55], [-0.45, 0.86, -0.22]] as const) {
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), skin);
      hand.position.set(hx, hy, hz);
      this.rider.add(hand);
    }
  }

  applyBoardDef(def: BoardDef): void {
    (this.hull.material as THREE.MeshStandardMaterial).color.set(def.color);
    (this.stripe.material as THREE.MeshStandardMaterial).color.set(def.accent);
  }

  update(surfer: Surfer, tuckHeld: boolean, dt: number): void {
    const s = surfer.sample;
    if (!s) return;
    this.group.position.set(s.posX, surfer.renderY + 0.12, s.posZ);

    this.up.set(s.nX, s.nY, s.nZ);
    this.heading.set(Math.cos(surfer.heading), 0, Math.sin(surfer.heading));
    // project heading onto the surface tangent plane
    this.forward.copy(this.heading).addScaledVector(this.up, -this.heading.dot(this.up)).normalize();
    this.right.crossVectors(this.up, this.forward).normalize();
    this.up.crossVectors(this.forward, this.right).normalize();

    this.basis.makeBasis(this.right, this.up, this.forward);
    this.group.quaternion.setFromRotationMatrix(this.basis);
    this.group.rotateZ(surfer.bank * 0.5);
    // nose lifts a touch in the air
    if (surfer.airborne) this.group.rotateX(-0.25);

    // crouch / tuck
    this.tuckAmt = damp(this.tuckAmt, tuckHeld ? 1 : 0, 10, dt);
    const crouch = 1 - this.tuckAmt * 0.42;
    this.rider.scale.set(1, crouch, 1);
    this.rider.position.y = 0;
  }
}
