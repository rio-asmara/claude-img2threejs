import * as THREE from 'three';
import type { SlimeMaterials } from './materials';
import {
  LANDMARKS as L, buildArm, buildHead, buildLeg, buildNeck, buildPelvis, buildTorso,
  type ArmChain, type GogglesBuilder, type LegChain, type Side,
} from './body';
import { pivot } from './geometry';

/**
 * Assembles the Slime Agent's action-ready hierarchy:
 *
 *   SlimeAgent
 *   └─ hips ─┬─ spine ─┬─ neck ─ head (hair, goggles, mouth)
 *            │         ├─ shoulder-l ─ elbow-l ─ wrist-l (hand-l, socket-hand-l)
 *            │         ├─ shoulder-r ─ elbow-r ─ wrist-r (hand-r, socket-hand-r → blaster)
 *            │         └─ socket-back → ink tank + hose
 *            ├─ hip-l ─ knee-l ─ ankle-l → sneaker-l
 *            └─ hip-r ─ knee-r ─ ankle-r → sneaker-r
 *
 * Every pivot sits on its joint with scale (1,1,1); geometry is authored relative to it.
 */

export interface SlimeAgentDeps {
  goggles: GogglesBuilder;
  buckle?: (mats: SlimeMaterials) => THREE.Object3D;
  sneaker?: (mats: SlimeMaterials, side: Side) => THREE.Object3D;
  inkTank?: (mats: SlimeMaterials) => THREE.Object3D;
  blaster?: (mats: SlimeMaterials) => THREE.Object3D;
}

export interface SlimeAgentRig {
  root: THREE.Group;
  hips: THREE.Group;
  spine: THREE.Group;
  neck: THREE.Group;
  head: THREE.Group;
  arms: Record<Side, ArmChain>;
  legs: Record<Side, LegChain>;
  backSocket: THREE.Group;
}

/** Place `child` (authored with world-space position) under a parent whose joint is at `parentWorld`. */
function attach(parent: THREE.Object3D, child: THREE.Object3D, parentWorld: THREE.Vector3): void {
  child.position.sub(parentWorld);
  parent.add(child);
}

/** Wrap content authored in world coordinates so it can live under a pivot at `jointWorld`. */
function worldContent(content: THREE.Object3D, jointWorld: THREE.Vector3): THREE.Object3D {
  content.position.sub(jointWorld);
  return content;
}

export function buildSlimeAgentRig(mats: SlimeMaterials, deps: SlimeAgentDeps): SlimeAgentRig {
  const root = new THREE.Group();
  root.name = 'SlimeAgent';

  const hipsW = new THREE.Vector3(0, L.hipsY, 0);
  const spineW = new THREE.Vector3(0, L.waistY, 0);
  const neckW = new THREE.Vector3(0, L.neckBaseY, 0);
  const headW = new THREE.Vector3(0, L.headPivotY, 0);
  const backW = new THREE.Vector3(0, 0.86, -0.152);

  const hips = pivot('hips', hipsW.x, hipsW.y, hipsW.z);
  root.add(hips);
  hips.add(worldContent(buildPelvis(mats), hipsW));

  const spine = pivot('spine', 0, spineW.y - hipsW.y, 0);
  hips.add(spine);
  spine.add(worldContent(buildTorso(mats, { buckle: deps.buckle }), spineW));

  const neck = pivot('neck-joint', 0, neckW.y - spineW.y, 0);
  spine.add(neck);
  neck.add(buildNeck(mats));

  const head = pivot('head-joint', 0, headW.y - neckW.y, 0);
  neck.add(head);
  head.add(buildHead(mats, deps.goggles));

  const arms = { left: buildArm(mats, 'left'), right: buildArm(mats, 'right') };
  attach(spine, arms.left.shoulder, spineW);
  attach(spine, arms.right.shoulder, spineW);

  const legs = { left: buildLeg(mats, 'left'), right: buildLeg(mats, 'right') };
  attach(hips, legs.left.hip, hipsW);
  attach(hips, legs.right.hip, hipsW);
  if (deps.sneaker) {
    legs.left.footSocket.add(deps.sneaker(mats, 'left'));
    legs.right.footSocket.add(deps.sneaker(mats, 'right'));
  }

  const backSocket = pivot('socket-back', backW.x, backW.y - spineW.y, backW.z);
  backSocket.userData.socket = { id: 'back', purpose: 'ink-tank-mount' };
  spine.add(backSocket);
  if (deps.inkTank) backSocket.add(deps.inkTank(mats));

  if (deps.blaster) arms.right.handSocket.add(deps.blaster(mats));

  return { root, hips, spine, neck, head, arms, legs, backSocket };
}

// ---------------------------------------------------------------------------
// Runtime metadata (sculptRuntime) + a tiny animation controller.
// ---------------------------------------------------------------------------

export type ActionName = 'idle' | 'wave' | 'none';

export interface AnimationController {
  actions: ActionName[];
  active: ActionName;
  play(name: ActionName): void;
  stop(): void;
  update(dt: number): void;
  subscribe(fn: (active: ActionName) => void): () => void;
}

interface RestPose {
  obj: THREE.Object3D;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

export function createAnimationController(rig: SlimeAgentRig): AnimationController {
  const animated: THREE.Object3D[] = [
    rig.hips, rig.spine, rig.neck, rig.head,
    rig.arms.left.shoulder, rig.arms.left.elbow, rig.arms.right.shoulder, rig.arms.right.elbow,
    rig.legs.left.hip, rig.legs.right.hip, rig.legs.left.knee, rig.legs.right.knee,
  ];
  const rest: RestPose[] = animated.map((obj) => ({
    obj, position: obj.position.clone(), quaternion: obj.quaternion.clone(),
  }));
  const listeners = new Set<(a: ActionName) => void>();
  let time = 0;
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();

  const resetPose = () => {
    for (const r of rest) {
      r.obj.position.copy(r.position);
      r.obj.quaternion.copy(r.quaternion);
    }
  };
  const rotate = (obj: THREE.Object3D, x: number, y: number, z: number) => {
    const r = rest.find((p) => p.obj === obj);
    if (!r) return;
    q.setFromEuler(e.set(x, y, z));
    obj.quaternion.copy(r.quaternion).multiply(q);
  };

  const ctrl: AnimationController = {
    actions: ['idle', 'wave', 'none'],
    active: 'none',
    play(name) {
      ctrl.active = name;
      time = 0;
      resetPose();
      listeners.forEach((fn) => fn(name));
    },
    stop() {
      ctrl.play('none');
    },
    update(dt) {
      if (ctrl.active === 'none') return;
      time += dt;
      const t = time;
      resetPose();
      // Idle: squishy slime bob — the body sinks and rebounds, arms sway, head lags.
      const bob = Math.sin(t * 2.4);
      rig.hips.position.y += bob * 0.008;
      rotate(rig.spine, bob * 0.02, 0, Math.sin(t * 1.2) * 0.015);
      rotate(rig.head, -bob * 0.035, Math.sin(t * 0.8) * 0.08, Math.sin(t * 1.2 + 0.6) * 0.03);
      rotate(rig.legs.left.knee, Math.max(0, -bob) * 0.04, 0, 0);
      rotate(rig.legs.right.knee, Math.max(0, -bob) * 0.04, 0, 0);
      rotate(rig.arms.left.shoulder, Math.sin(t * 1.2) * 0.06, 0, bob * 0.03);
      if (ctrl.active === 'wave') {
        // Raise the right arm and wave from the elbow.
        rotate(rig.arms.right.shoulder, 0, 0, -2.2);
        rotate(rig.arms.right.elbow, 0, 0, -0.5 + Math.sin(t * 8) * 0.45);
      } else {
        rotate(rig.arms.right.shoulder, Math.sin(t * 1.2 + 1) * 0.06, 0, -bob * 0.03);
      }
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return ctrl;
}

export interface ColliderSpec {
  type: 'capsule' | 'box' | 'sphere';
  /** Attached node name. */
  node: string;
  offset: [number, number, number];
  scale: [number, number, number];
  isTrigger?: boolean;
}

/** Collect parts, sockets and colliders into root.userData.sculptRuntime. */
export function attachSculptRuntime(rig: SlimeAgentRig, ctrl: AnimationController): void {
  const nodes: Record<string, THREE.Object3D> = {};
  const parts: Record<string, THREE.Object3D> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const destructionGroups: Record<string, string[]> = {};
  rig.root.traverse((o) => {
    if (o.name) nodes[o.name] = o;
    const part = o.userData.img2Part as { id: string; module: string } | undefined;
    if (part) {
      parts[part.id] = o;
      (destructionGroups[part.module] ??= []).push(part.id);
    }
    if (o.userData.socket) sockets[`${o.parent?.name ?? 'root'}:${(o.userData.socket as { id: string }).id}`] = o;
  });
  const colliders: Record<string, ColliderSpec> = {
    head: { type: 'sphere', node: 'head-joint', offset: [0, 0.22, 0], scale: [0.27, 0.27, 0.27] },
    torso: { type: 'capsule', node: 'spine', offset: [0, 0.13, 0], scale: [0.2, 0.3, 0.16] },
    pelvis: { type: 'box', node: 'hips', offset: [0, -0.02, 0], scale: [0.36, 0.2, 0.28] },
    'ink-tank': { type: 'capsule', node: 'socket-back', offset: [0, 0, -0.1], scale: [0.08, 0.3, 0.08] },
    'leg-l': { type: 'capsule', node: 'hip-l', offset: [0, -0.3, 0], scale: [0.1, 0.62, 0.1] },
    'leg-r': { type: 'capsule', node: 'hip-r', offset: [0, -0.3, 0], scale: [0.1, 0.62, 0.1] },
    'arm-l': { type: 'capsule', node: 'shoulder-l', offset: [0, -0.18, 0], scale: [0.06, 0.4, 0.06] },
    'arm-r': { type: 'capsule', node: 'shoulder-r', offset: [0, -0.18, 0], scale: [0.06, 0.4, 0.06] },
  };
  rig.root.userData.sculptRuntime = {
    nodes, meshes: parts, parts, sockets, colliders, destructionGroups, animationController: ctrl,
  };
}
