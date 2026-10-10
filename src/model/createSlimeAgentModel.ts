import * as THREE from 'three';
import { createSlimeMaterials, type SlimeMaterials, type Team } from './materials';
import { buildGoggles, buildSlimeBlaster, buildSlimeBlasterHeld, buildSwimForm } from './props';
import { buildHarnessBuckle, buildInkTank, buildSneaker } from './gear';
import { attachSculptRuntime, buildSlimeAgentRig, createAnimationController } from './slimeAgent';

/**
 * Slime Agent — procedural Three.js reconstruction of reference/slime-agent-sheet.jpg,
 * built with the img2threejs pipeline (spec + review evidence under pipeline/ and renders/).
 *
 * Export surface used by the viewer (src/main.ts):
 *   createSlimeAgentModel(options?)    -> rigged humanoid (or the swim form when form === 'swim')
 *   createSlimeBlasterModel(options?)  -> blaster prop alone
 *   createSlimeSwimFormModel(options?) -> swim-form puddle alone
 *
 * Conventions:
 * - units: humanoid 1.6 units tall, origin between the feet, feet on y = 0
 * - the character faces +Z, Y is up, the character's own LEFT is +X
 * - parts are tagged with userData.img2Part (selectable / explodable); joints are pivots;
 *   sockets carry userData.socket; root.userData.sculptRuntime holds nodes, parts, sockets,
 *   colliders, destructionGroups and an animation controller (also driven by userData.tick)
 */

export type SlimeTeam = Team;

export interface SlimeAgentOptions {
  team?: SlimeTeam;
  form?: 'humanoid' | 'swim';
  /** Put the blaster in the right hand (hand socket). */
  withBlaster?: boolean;
  /** Start the idle animation immediately (viewer ticks root.userData.tick). */
  animate?: boolean;
}

/** Goggle placement on the head (relative to the head pivot), from the front/side crops. */
const GOGGLES_ON_HEAD = { y: 0.14, frontZ: 0.236, width: 0.54, height: 0.17, bendRadius: 0.3 };

function headGoggles(mats: SlimeMaterials): THREE.Object3D {
  const g = buildGoggles(mats, {
    width: GOGGLES_ON_HEAD.width,
    height: GOGGLES_ON_HEAD.height,
    bendRadius: GOGGLES_ON_HEAD.bendRadius,
    strap: 'none',
  });
  g.position.set(0, GOGGLES_ON_HEAD.y, GOGGLES_ON_HEAD.frontZ);
  return g;
}

export function createSlimeAgentModel(options: SlimeAgentOptions = {}): THREE.Group {
  const team = options.team ?? 'A';
  if (options.form === 'swim') return createSlimeSwimFormModel({ team });

  const mats = createSlimeMaterials(team);
  const rig = buildSlimeAgentRig(mats, {
    goggles: headGoggles,
    buckle: buildHarnessBuckle,
    sneaker: buildSneaker,
    inkTank: buildInkTank,
    blaster: options.withBlaster ? buildSlimeBlasterHeld : undefined,
  });
  const ctrl = createAnimationController(rig);
  attachSculptRuntime(rig, ctrl);
  rig.root.userData.tick = (dt: number) => ctrl.update(dt);
  rig.root.userData.team = team;
  if (options.animate) ctrl.play('idle');
  return rig.root;
}

export function createSlimeBlasterModel(options: { team?: SlimeTeam } = {}): THREE.Group {
  return buildSlimeBlaster(createSlimeMaterials(options?.team ?? 'A'));
}

export function createSlimeSwimFormModel(options: { team?: SlimeTeam } = {}): THREE.Group {
  return buildSwimForm(createSlimeMaterials(options?.team ?? 'A'));
}
