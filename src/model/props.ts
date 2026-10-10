import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SlimeMaterials } from './materials';
import {
  bendAroundY,
  blobShape,
  lathe,
  mesh,
  ribbedTube,
  roundedRectShape,
  seededRandom,
  tagPart,
  teardrop,
} from './geometry';

/**
 * Procedural props for the Slime Agent: the ink BLASTER (reference/blaster.png), the
 * SWIM FORM puddle (reference/swim-form.png) and the reusable ski GOGGLES.
 *
 * Code-only geometry (lathes, extrusions, tubes); every material comes from
 * `createSlimeMaterials()` except the bubble material below (a light, opaque bead the shared
 * library has no slot for).
 *
 * Blaster frame: muzzle → +Z, up → +Y, origin = the grip's hand-hold point (centre of the
 * pistol grip at mid height), so the group can be parented straight onto a hand socket.
 * Swim form frame: puddle lies on y = 0 centred on the origin, goggles lens facing +Z.
 */

type Profile = Array<[number, number]>;

// ------------------------------------------------------------------ generic local helpers

/** Smooth normals across edges flatter than `angle`, keep harder edges crisp. */
function creased(geo: THREE.BufferGeometry, angle = 0.62): THREE.BufferGeometry {
  return toCreasedNormals(geo, angle);
}

/** Extrude an XY shape symmetric about z = 0 with a rounded bevel (normals left flat). */
function softExtrude(
  shape: THREE.Shape,
  depth: number,
  bevel: number,
  bevelSegments = 5,
  curveSegments = 16,
): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: bevel > 0 ? bevelSegments : 0,
    curveSegments,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/**
 * Side-profile part: a shape authored in (z, y) coordinates, extruded symmetrically along X
 * to a total `thickness` (bevel included). Returned with creased normals.
 */
function sideProfile(shape: THREE.Shape, thickness: number, bevel: number, post?: THREE.Matrix4): THREE.BufferGeometry {
  const geo = softExtrude(shape, Math.max(1e-4, thickness - 2 * bevel), bevel, 4, 20);
  geo.rotateY(-Math.PI / 2); // shape x → world z, extrusion → world x
  if (post) geo.applyMatrix4(post);
  return creased(geo);
}

/** Rounded box (all edges bevelled), centred on the origin. */
function roundedBox(sx: number, sy: number, sz: number, bevel: number): THREE.BufferGeometry {
  const b = Math.min(bevel, sx / 2 - 1e-4, sy / 2 - 1e-4, sz / 2 - 1e-4);
  const shape = roundedRectShape(sx - 2 * b, sy - 2 * b, Math.min(sx, sy) * 0.18);
  return creased(softExtrude(shape, sz - 2 * b, b, 3, 6));
}

/** Lathe profile for a ring/disc running z0 → z1 with rounded outer corners. */
function ringProfile(rIn: number, rOut: number, z0: number, z1: number, round: number, seg = 4): Profile {
  const c = Math.max(1e-4, Math.min(round, (z1 - z0) / 2 - 1e-4, rOut - rIn - 1e-4));
  const pts: Profile = [[rIn, z0]];
  for (let i = 0; i <= seg; i++) {
    const a = -Math.PI / 2 + (i / seg) * (Math.PI / 2);
    pts.push([rOut - c + c * Math.cos(a), z0 + c + c * Math.sin(a)]);
  }
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * (Math.PI / 2);
    pts.push([rOut - c + c * Math.cos(a), z1 - c + c * Math.sin(a)]);
  }
  pts.push([rIn, z1]);
  return pts;
}

/** Hex bolt head sitting on a surface point, its axis along `normal`. */
function bolt(
  name: string,
  radius: number,
  height: number,
  mat: THREE.Material,
  pos: THREE.Vector3,
  normal: THREE.Vector3,
): THREE.Mesh {
  const m = mesh(name, new THREE.CylinderGeometry(radius * 0.85, radius, height, 6), mat);
  const n = normal.clone().normalize();
  m.position.copy(pos).addScaledVector(n, height * 0.25);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  return m;
}

/** Orient a +Y-axis primitive along `dir`, centred at `pos`. */
function alongDir<T extends THREE.Object3D>(obj: T, pos: THREE.Vector3, dir: THREE.Vector3): T {
  obj.position.copy(pos);
  obj.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return obj;
}

/** Group tagged as one explodable part. */
function partGroup(id: string, module: string): THREE.Group {
  const g = new THREE.Group();
  g.name = id;
  return tagPart(g, id, module);
}

const bubbleMats = new WeakMap<SlimeMaterials, THREE.MeshPhysicalMaterial>();
/**
 * Local material (documented exception): bubbles in the ink are small light beads. They are
 * opaque on purpose so they stay visible through the transmissive glass and the blended ink.
 */
function bubbleMaterial(mats: SlimeMaterials): THREE.MeshPhysicalMaterial {
  let m = bubbleMats.get(mats);
  if (!m) {
    m = new THREE.MeshPhysicalMaterial({
      name: 'ink-bubble',
      color: new THREE.Color(mats.palette.inkLight).lerp(new THREE.Color(0xffffff), 0.35),
      roughness: 0.08,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      emissive: new THREE.Color(mats.palette.inkLight),
      emissiveIntensity: 0.25,
    });
    bubbleMats.set(mats, m);
    mats.all.push(m);
  }
  return m;
}

// ------------------------------------------------------------------ BLASTER

/** Barrel axis height above the grip hand-hold point. */
const AXIS_Y = 0.135;
/** Muzzle tip (front) and rear-cap end along +Z. Overall barrel length 0.553. */
const MUZZLE_Z = 0.385;
const REAR_Z = -0.168;
/** Bottom of the grip / canister foot (the prop's resting plane). */
const BLASTER_GROUND_Y = -0.074;
/** Canister stands behind and to the gun's right (-X) side. */
const CANISTER_X = -0.025;
const CANISTER_Z = -0.36;

/** Lathe around the barrel axis: profile pairs are [radius, z]. */
function barrelLathe(profile: Profile, segments = 48): THREE.BufferGeometry {
  const geo = lathe(profile, segments);
  geo.rotateX(Math.PI / 2); // lathe +Y → +Z
  geo.translate(0, AXIS_Y, 0);
  return geo;
}

export interface SlimeBlasterOptions {
  /** Include the hose + standalone canister (default true). Off when held by the character,
   *  who already wears the backpack tank — `userData.sockets.hosePort` marks where to plug in. */
  withCanister?: boolean;
}

export function buildSlimeBlaster(mats: SlimeMaterials, opts: SlimeBlasterOptions = {}): THREE.Group {
  const withCanister = opts.withCanister ?? true;
  const root = new THREE.Group();
  root.name = withCanister ? 'slime-blaster' : 'slime-blaster-held';

  const chamber = partGroup('blaster-chamber', 'blaster');
  const shell = partGroup('blaster-shell', 'blaster');
  const muzzle = partGroup('blaster-muzzle', 'blaster');
  const handle = partGroup('blaster-handle', 'blaster');
  const grip = partGroup('blaster-grip', 'blaster');

  const { glass, inkLiquid, whitePlastic: white, blackPlastic: black, metal, piping } = mats;
  const bubble = bubbleMaterial(mats);
  const rnd = seededRandom(0xb1a57e5);

  // ---------------------------------------------------------------- chamber
  const CH_R = 0.06;
  chamber.add(mesh('blaster-chamber-glass', barrelLathe([[1e-4, -0.064], [CH_R, -0.064], [CH_R, 0.141], [1e-4, 0.141]], 64), glass));
  {
    // Ink fills ~85% of the chamber: a circular segment extruded along the barrel, so the
    // flat ink surface leaves a clear band at the top like the reference.
    const r = 0.0545;
    const level = 0.034;
    const a0 = Math.atan2(level, Math.sqrt(r * r - level * level));
    const s = new THREE.Shape();
    s.moveTo(Math.cos(a0) * r, level);
    s.absarc(0, 0, r, a0, Math.PI - a0, true);
    s.lineTo(Math.cos(a0) * r, level);
    const len = 0.2;
    const geo = new THREE.ExtrudeGeometry(s, {
      depth: len - 0.006, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.0015, bevelSegments: 2, curveSegments: 48,
    });
    geo.translate(0, AXIS_Y, -0.061 + 0.003);
    chamber.add(mesh('blaster-chamber-ink', creased(geo), inkLiquid));
  }
  {
    const geo = new THREE.SphereGeometry(1, 10, 8);
    for (let i = 0; i < 18; i++) {
      const rad = 0.0025 + rnd() * 0.0045;
      const a = -Math.PI * 0.85 + rnd() * Math.PI * 1.7 - Math.PI / 2; // keep below the ink line
      const rr = 0.0545 - rad * 0.35;
      const y = Math.sin(a) * rr;
      if (y > 0.03) continue;
      const b = mesh(`blaster-bubble-${i}`, geo, bubble);
      b.scale.setScalar(rad);
      b.position.set(Math.cos(a) * rr, AXIS_Y + y, -0.05 + rnd() * 0.18);
      chamber.add(b);
    }
  }

  // ---------------------------------------------------------------- shell (rings, sleeves, keel)
  shell.add(mesh('blaster-rear-cap', barrelLathe(ringProfile(1e-4, 0.065, -0.162, -0.116, 0.011)), black));
  shell.add(mesh('blaster-rear-boss', barrelLathe(ringProfile(1e-4, 0.047, REAR_Z, -0.158, 0.004)), black));
  shell.add(mesh('blaster-rear-band', barrelLathe(ringProfile(0.05, 0.0625, -0.119, -0.099, 0.003)), white));
  shell.add(mesh('blaster-rear-ring', barrelLathe(ringProfile(1e-4, 0.069, -0.101, -0.06, 0.008)), black));
  shell.add(mesh('blaster-front-sleeve', barrelLathe(ringProfile(1e-4, 0.067, 0.137, 0.216, 0.009), 56), white));
  shell.add(mesh('blaster-front-ring', barrelLathe(ringProfile(1e-4, 0.077, 0.212, 0.27, 0.011), 56), black));
  shell.add(mesh('blaster-front-ring-lip', barrelLathe(ringProfile(1e-4, 0.069, 0.266, 0.285, 0.004), 56), black));

  // Side bosses with bolts on the front ring and rear cap (both sides), teal status light on the rear.
  for (const side of [1, -1]) {
    const fb = mesh(`blaster-front-boss-${side > 0 ? 'L' : 'R'}`, roundedBox(0.044, 0.042, 0.016, 0.004), black);
    fb.rotation.y = Math.PI / 2;
    fb.position.set(side * 0.08, AXIS_Y, 0.241);
    shell.add(fb);
    for (const dz of [-0.011, 0.011]) {
      shell.add(bolt('blaster-boss-bolt', 0.0042, 0.004, metal, new THREE.Vector3(side * 0.088, AXIS_Y + 0.008, 0.241 + dz), new THREE.Vector3(side, 0, 0)));
    }
    const rb = mesh(`blaster-rear-boss-${side > 0 ? 'L' : 'R'}`, roundedBox(0.034, 0.036, 0.014, 0.004), black);
    rb.rotation.y = Math.PI / 2;
    rb.position.set(side * 0.068, AXIS_Y, -0.139);
    shell.add(rb);
    const light = mesh('blaster-rear-light', new THREE.CylinderGeometry(0.0048, 0.0048, 0.004, 16), piping);
    light.rotation.z = Math.PI / 2;
    light.position.set(side * 0.0755, AXIS_Y - 0.006, -0.139);
    shell.add(light);
    // Screw dot on the white sleeve.
    shell.add(bolt('blaster-sleeve-screw', 0.0035, 0.003, black, new THREE.Vector3(side * 0.0665, AXIS_Y + 0.012, 0.198), new THREE.Vector3(side, 0.18, 0)));
  }
  // Radial bolts around the front and rear rings (skipping the side bosses).
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    const n = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
    shell.add(bolt('blaster-ring-bolt', 0.0038, 0.004, metal, new THREE.Vector3(n.x * 0.077, AXIS_Y + n.y * 0.077, 0.226), n));
    if (i % 2 === 0) {
      shell.add(bolt('blaster-ring-bolt', 0.0034, 0.004, metal, new THREE.Vector3(n.x * 0.069, AXIS_Y + n.y * 0.069, -0.08), n));
    }
  }
  // Bolts on the rear face.
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + Math.PI / 6;
    shell.add(bolt('blaster-rear-bolt', 0.0038, 0.004, metal, new THREE.Vector3(Math.cos(a) * 0.056, AXIS_Y + Math.sin(a) * 0.056, -0.162), new THREE.Vector3(0, 0, -1)));
  }

  // Keel / lower receiver under the chamber: white body, black under-strip, teal accent.
  shell.add(mesh('blaster-keel', sideProfile(shapeFromRect(-0.08, 0.216, 0.046, AXIS_Y - 0.0575, 0.009), 0.036, 0.004), white));
  shell.add(mesh('blaster-keel-strip', sideProfile(shapeFromRect(-0.03, 0.112, 0.04, 0.052, 0.005), 0.039, 0.0035), black));
  for (const side of [1, -1]) {
    const accent = mesh('blaster-keel-accent', roundedBox(0.075, 0.009, 0.003, 0.0012), piping);
    accent.rotation.y = Math.PI / 2;
    accent.position.set(side * 0.0185, 0.064, 0.165);
    shell.add(accent);
  }

  // Hose port on the underside of the rear cap, angled back-down.
  const portDir = new THREE.Vector3(0, -0.62, -0.78).normalize();
  const portPos = new THREE.Vector3(0, AXIS_Y - 0.046, -0.148);
  shell.add(alongDir(mesh('blaster-hose-port', new THREE.CylinderGeometry(0.019, 0.022, 0.034, 24), black), portPos, portDir));
  shell.add(alongDir(mesh('blaster-hose-port-band', new THREE.CylinderGeometry(0.0225, 0.0225, 0.007, 24), metal), portPos.clone().addScaledVector(portDir, 0.008), portDir));
  const hosePort = portPos.clone().addScaledVector(portDir, 0.017);

  // ---------------------------------------------------------------- muzzle
  muzzle.add(mesh('blaster-nozzle-glass', barrelLathe(ringProfile(1e-4, 0.048, 0.281, 0.339, 0.004), 48), glass));
  muzzle.add(mesh('blaster-nozzle-ink', barrelLathe([[1e-4, 0.284], [0.043, 0.284], [0.043, 0.336], [1e-4, 0.336]], 40), inkLiquid));
  muzzle.add(mesh('blaster-nozzle-ring', barrelLathe(ringProfile(1e-4, 0.0515, 0.335, 0.362, 0.006), 48), black));
  muzzle.add(mesh('blaster-tip-glass', barrelLathe([
    [0.0185, 0.358], [0.031, 0.358], [0.0348, 0.3605], [0.036, 0.366], [0.036, 0.378], [0.0345, 0.383],
    [0.0305, MUZZLE_Z], [0.0225, MUZZLE_Z], [0.0192, 0.383], [0.0185, 0.378], [0.0185, 0.358],
  ], 40), glass));
  muzzle.add(mesh('blaster-tip-ink', barrelLathe([
    [0.0205, 0.36], [0.0325, 0.36], [0.0338, 0.366], [0.0338, 0.378], [0.0315, 0.3825], [0.0205, 0.3825], [0.0205, 0.36],
  ], 40), inkLiquid));
  muzzle.add(mesh('blaster-tip-bore', barrelLathe([[1e-4, 0.34], [0.0188, 0.34], [0.0188, 0.37], [1e-4, 0.37]], 24), black));
  {
    const drip = mesh('blaster-drip', teardrop(0.0125, 0.084, 0.3, 24), mats.slime);
    drip.position.set(0.004, AXIS_Y - 0.029, MUZZLE_Z - 0.002);
    muzzle.add(drip);
    const lip = mesh('blaster-drip-lip', new THREE.SphereGeometry(0.0085, 20, 14), mats.slime);
    lip.scale.set(1.5, 0.8, 1.1);
    lip.position.set(0.003, AXIS_Y - 0.0335, MUZZLE_Z - 0.003);
    muzzle.add(lip);
  }

  // ---------------------------------------------------------------- top carry handle (arch)
  {
    const s = new THREE.Shape();
    // Bar 0.213–0.239: a slim slot over the chamber, as in the reference.
    s.moveTo(0.194, 0.19);
    s.lineTo(0.179, 0.221);
    s.quadraticCurveTo(0.171, 0.239, 0.15, 0.239);
    s.lineTo(-0.08, 0.239);
    s.quadraticCurveTo(-0.102, 0.239, -0.102, 0.218);
    s.lineTo(-0.102, 0.19);
    s.lineTo(-0.065, 0.19);
    s.lineTo(-0.065, 0.206);
    s.quadraticCurveTo(-0.065, 0.213, -0.057, 0.213);
    s.lineTo(0.132, 0.213);
    s.quadraticCurveTo(0.141, 0.213, 0.144, 0.205);
    s.lineTo(0.149, 0.19);
    s.lineTo(0.194, 0.19);
    handle.add(mesh('blaster-handle-arch', sideProfile(s, 0.027, 0.0055), black));
  }

  // ---------------------------------------------------------------- pistol grip
  {
    const slant = Math.tan(THREE.MathUtils.degToRad(15));
    const shear = new THREE.Matrix4().makeShear(0, 0, 0, slant, 0, 0); // z += slant * y (bottom leans back)
    const front = (y: number): number => 0.034 + 0.0042 * Math.cos(((y + 0.045) / 0.027) * Math.PI * 2);

    const core = new THREE.Shape();
    core.moveTo(-0.036, 0.064);
    core.lineTo(-0.04, 0.03);
    core.quadraticCurveTo(-0.0445, -0.01, -0.041, -0.036);
    core.quadraticCurveTo(-0.0405, -0.052, -0.051, -0.058);
    core.quadraticCurveTo(-0.056, -0.06, -0.056, -0.066);
    core.quadraticCurveTo(-0.056, -0.074, -0.048, -0.074);
    core.lineTo(0.036, -0.074);
    core.quadraticCurveTo(0.044, -0.074, 0.044, -0.066);
    core.quadraticCurveTo(0.044, -0.056, front(-0.05), -0.05);
    for (let y = -0.048; y <= 0.05; y += 0.002) core.lineTo(front(y), y);
    core.lineTo(0.04, 0.064);
    core.lineTo(-0.036, 0.064);
    grip.add(mesh('blaster-grip-core', sideProfile(core, 0.038, 0.0045, shear), black));

    // White front panel with the finger grooves, slightly proud of the core on both sides.
    const panel = new THREE.Shape();
    panel.moveTo(-0.003, 0.046);
    panel.lineTo(-0.006, -0.058);
    panel.quadraticCurveTo(-0.005, -0.07, 0.008, -0.07);
    panel.lineTo(0.036, -0.07);
    panel.quadraticCurveTo(0.0455, -0.07, 0.0455, -0.062);
    panel.quadraticCurveTo(0.0455, -0.054, front(-0.05) + 0.0015, -0.05);
    for (let y = -0.048; y <= 0.046; y += 0.002) panel.lineTo(front(y) + 0.0015, y);
    panel.lineTo(-0.003, 0.046);
    grip.add(mesh('blaster-grip-panel', sideProfile(panel, 0.042, 0.004, shear), white));

    // Teal accent strip between the white panel and the black back.
    const strip = new THREE.Shape();
    strip.moveTo(-0.016, 0.036);
    strip.lineTo(-0.0095, 0.036);
    strip.lineTo(-0.0125, -0.046);
    strip.lineTo(-0.019, -0.046);
    strip.lineTo(-0.016, 0.036);
    grip.add(mesh('blaster-grip-accent', sideProfile(strip, 0.0435, 0.001, shear), piping));

    // Trigger guard: rounded loop whose top bar hides inside the keel strip.
    const guard = roundedRectShape(0.075, 0.06, 0.02);
    guard.holes.push(holePath(0.051, 0.041, 0.014, 0, -0.004));
    const guardGeo = softExtrude(guard, 0.009, 0.0035, 4, 20);
    guardGeo.rotateY(-Math.PI / 2);
    guardGeo.translate(0, 0.028, 0.0675);
    grip.add(mesh('blaster-trigger-guard', creased(guardGeo), black));

    // Trigger blade.
    const trig = new THREE.Shape();
    trig.moveTo(0.064, 0.046);
    trig.quadraticCurveTo(0.056, 0.03, 0.062, 0.012);
    trig.quadraticCurveTo(0.065, 0.006, 0.069, 0.01);
    trig.quadraticCurveTo(0.066, 0.028, 0.075, 0.046);
    trig.lineTo(0.064, 0.046);
    grip.add(mesh('blaster-trigger', sideProfile(trig, 0.011, 0.002), piping));
  }

  root.add(chamber, shell, muzzle, handle, grip);

  // ---------------------------------------------------------------- hose + canister
  if (withCanister) {
    const hose = partGroup('blaster-hose', 'blaster');
    const canister = partGroup('blaster-canister', 'blaster');
    const g = BLASTER_GROUND_Y;
    const cx = CANISTER_X;
    const cz = CANISTER_Z;
    const entry = new THREE.Vector3(cx, g + 0.272, cz + 0.044);

    const curve = new THREE.CatmullRomCurve3([
      hosePort.clone(),
      hosePort.clone().addScaledVector(portDir, 0.03),
      // Down-back into a U, up beside the canister, over into its cap.
      new THREE.Vector3(cx * 0.3, 0.0, -0.212),
      new THREE.Vector3(cx * 0.6, 0.008, -0.25),
      new THREE.Vector3(cx * 0.85, 0.07, cz + 0.088),
      new THREE.Vector3(cx, 0.155, cz + 0.09),
      new THREE.Vector3(cx, 0.212, cz + 0.08),
      new THREE.Vector3(cx, g + 0.29, cz + 0.064),
      entry,
    ], false, 'centripetal', 0.5);
    const HOSE_R = 0.0165;
    const ribs = Math.round(curve.getLength() / 0.0115);
    hose.add(mesh('blaster-hose-tube', ribbedTube(curve, HOSE_R, ribs, 0.28, { radialSegments: 14 }), mats.rubberBlack));
    for (const [u, name] of [[0, 'blaster-hose-ferrule-gun'], [1, 'blaster-hose-ferrule-tank']] as const) {
      const p = curve.getPointAt(u);
      const t = curve.getTangentAt(u);
      const fer = mesh(name, new THREE.CylinderGeometry(HOSE_R * 1.28, HOSE_R * 1.28, 0.018, 20), black);
      hose.add(alongDir(fer, p.addScaledVector(t, u === 0 ? 0.004 : -0.004), t));
    }

    // Canister: black foot + bottom cap, metal bands, glass tube with ink, domed top cap, nipple.
    const vLathe = (profile: Profile, segs = 48): THREE.BufferGeometry => {
      const geo = lathe(profile, segs);
      geo.translate(cx, 0, cz);
      return geo;
    };
    canister.add(mesh('blaster-canister-base', vLathe([
      [1e-4, g], [0.042, g], [0.046, g + 0.004], [0.046, g + 0.012], [0.05, g + 0.0145], [0.056, g + 0.019],
      [0.0585, g + 0.026], [0.0585, g + 0.044], [1e-4, g + 0.044],
    ]), black));
    canister.add(mesh('blaster-canister-band-low', vLathe(ringProfile(0.05, 0.0605, g + 0.042, g + 0.068, 0.003)), metal));
    canister.add(mesh('blaster-canister-glass', vLathe([[1e-4, g + 0.066], [0.056, g + 0.066], [0.056, g + 0.228], [1e-4, g + 0.228]], 56), glass));
    canister.add(mesh('blaster-canister-ink', vLathe([[1e-4, g + 0.068], [0.0505, g + 0.068], [0.0505, g + 0.215], [1e-4, g + 0.215]], 48), inkLiquid));
    canister.add(mesh('blaster-canister-band-high', vLathe(ringProfile(0.05, 0.0605, g + 0.226, g + 0.252, 0.003)), metal));
    canister.add(mesh('blaster-canister-cap', vLathe([
      [0.05, g + 0.25], [0.0585, g + 0.25], [0.0585, g + 0.266], [0.0555, g + 0.276], [0.047, g + 0.284],
      [0.034, g + 0.2885], [1e-4, g + 0.2895],
    ]), black));
    canister.add(mesh('blaster-canister-nipple', vLathe(ringProfile(1e-4, 0.019, g + 0.284, g + 0.31, 0.004), 32), black));
    canister.add(mesh('blaster-canister-nipple-ring', vLathe(ringProfile(0.017, 0.021, g + 0.292, g + 0.298, 0.0015), 32), black));
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const n = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
      canister.add(bolt('blaster-canister-bolt', 0.0034, 0.004, metal, new THREE.Vector3(cx + n.x * 0.0585, g + 0.258, cz + n.z * 0.0585), n));
    }
    const geo = new THREE.SphereGeometry(1, 10, 8);
    for (let i = 0; i < 12; i++) {
      const rad = 0.0025 + rnd() * 0.004;
      const a = rnd() * Math.PI * 2;
      const rr = 0.0505 - rad * 0.35;
      const b = mesh(`blaster-canister-bubble-${i}`, geo, bubble);
      b.scale.setScalar(rad);
      b.position.set(cx + Math.sin(a) * rr, g + 0.08 + rnd() * 0.125, cz + Math.cos(a) * rr);
      canister.add(b);
    }
    root.add(hose, canister);
  }

  root.userData.sockets = {
    /** Hand-hold point (this group's origin). */
    grip: new THREE.Vector3(0, 0, 0),
    /** Support-hand spot under the front sleeve. */
    support: new THREE.Vector3(0, AXIS_Y - 0.072, 0.18),
    muzzle: new THREE.Vector3(0, AXIS_Y, MUZZLE_Z),
    hosePort,
    hosePortDir: portDir.clone(),
  };
  root.userData.blaster = { axisY: AXIS_Y, muzzleZ: MUZZLE_Z, rearZ: REAR_Z, groundY: BLASTER_GROUND_Y };
  return root;
}

/** The blaster as carried by the character: no hose / canister (the backpack tank feeds it). */
export function buildSlimeBlasterHeld(mats: SlimeMaterials): THREE.Group {
  return buildSlimeBlaster(mats, { withCanister: false });
}

/** Rounded rectangle spanning [z0, z1] × [y0, y1] in a side-profile (z, y) shape. */
function shapeFromRect(z0: number, z1: number, y0: number, y1: number, r: number): THREE.Shape {
  const s = roundedRectShape(z1 - z0, y1 - y0, r);
  const out = new THREE.Shape(s.getPoints(8).map((p) => new THREE.Vector2(p.x + (z0 + z1) / 2, p.y + (y0 + y1) / 2)));
  return out;
}

function holePath(w: number, h: number, r: number, cx: number, cy: number): THREE.Path {
  const pts = roundedRectShape(w, h, r).getPoints(8).map((p) => new THREE.Vector2(p.x + cx, p.y + cy));
  return new THREE.Path(pts);
}

// ------------------------------------------------------------------ GOGGLES

export interface GoggleOptions {
  /** Arc-length width of the frame (default 0.47). */
  width?: number;
  /** Frame height (default 0.16). */
  height?: number;
  /** Radius of the cylinder the goggles wrap around (default 0.27). */
  bendRadius?: number;
  /** 'stubs' adds a metal clip + short webbing strap on both sides (default 'stubs'). */
  strap?: 'none' | 'stubs';
}

export const GOGGLE_DEFAULTS = { width: 0.47, height: 0.16, bendRadius: 0.27 } as const;

/**
 * Ski-goggle outline: rounded rectangle (circular corners) whose bottom edge rises into a soft
 * nose bridge. Every call yields the same number of points per edge / corner, so outlines of
 * different sizes correspond index-by-index (the frame is stitched between two of them), and
 * the long edges are dense enough to bend smoothly.
 */
function goggleOutline(w: number, h: number, r: number, notch: number, cy = 0): THREE.Vector2[] {
  const nEdge = 64;
  const nSide = 10;
  const nCorner = 14;
  const hw = w / 2;
  const hh = h / 2;
  const rr = Math.min(r, hw - 1e-4, hh - 1e-4);
  const pts: THREE.Vector2[] = [];
  const line = (x0: number, y0: number, x1: number, y1: number, n: number): void => {
    for (let i = 0; i < n; i++) pts.push(new THREE.Vector2(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n));
  };
  const arc = (cx: number, cyy: number, a0: number): void => {
    for (let i = 0; i < nCorner; i++) {
      const a = a0 + (i / nCorner) * (Math.PI / 2);
      pts.push(new THREE.Vector2(cx + rr * Math.cos(a), cyy + rr * Math.sin(a)));
    }
  };
  // CCW: bottom → right side ↑ → top ← → left side ↓.
  line(-hw + rr, -hh, hw - rr, -hh, nEdge);
  arc(hw - rr, -hh + rr, -Math.PI / 2);
  line(hw, -hh + rr, hw, hh - rr, nSide);
  arc(hw - rr, hh - rr, 0);
  line(hw - rr, hh, -hw + rr, hh, nEdge);
  arc(-hw + rr, hh - rr, Math.PI / 2);
  line(-hw, hh - rr, -hw, -hh + rr, nSide);
  arc(-hw + rr, -hh + rr, Math.PI);
  const sigma = 0.11 * w;
  for (const p of pts) {
    if (p.y < 0) p.y += notch * Math.exp(-((p.x / sigma) ** 2)) * Math.min(1, -p.y / hh);
    p.y += cy;
  }
  return pts;
}

/**
 * Bumper frame swept between two corresponding outlines: a rounded-square cross-section
 * (superellipse) spans outer → inner edge in XY and ±depth/2 in Z. No earcut caps, so the
 * long top / bottom bars stay curved after bendAroundY.
 */
function frameSweep(outer: THREE.Vector2[], inner: THREE.Vector2[], depth: number, profileSegs = 32, squareness = 3.4): THREE.BufferGeometry {
  const n = outer.length;
  const m = profileSegs;
  const e = 2 / squareness;
  const pos: number[] = [];
  for (let i = 0; i < n; i++) {
    const o = outer[i];
    const q = inner[i];
    for (let j = 0; j < m; j++) {
      const th = (j / m) * Math.PI * 2;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      const u = 0.5 - 0.5 * Math.sign(c) * Math.pow(Math.abs(c), e);
      const z = (depth / 2) * Math.sign(sn) * Math.pow(Math.abs(sn), e);
      pos.push(o.x + (q.x - o.x) * u, o.y + (q.y - o.y) * u, z);
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n;
    for (let j = 0; j < m; j++) {
      const j1 = (j + 1) % m;
      const a = i * m + j, b = i1 * m + j, c = i1 * m + j1, d = i * m + j1;
      idx.push(a, b, c, a, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Front-face sample (θ = π/2) must point +Z; flip the winding otherwise.
  if (geo.getAttribute('normal').getZ(Math.round(m / 4)) < 0) {
    for (let k = 0; k < idx.length; k += 3) [idx[k + 1], idx[k + 2]] = [idx[k + 2], idx[k + 1]];
    geo.setIndex(idx);
    geo.computeVertexNormals();
  }
  return geo;
}

/**
 * Lens slab from an outline: slightly domed front face, straight rim, flat back. Built as
 * concentric rings (not an earcut cap) so it stays smooth once bent around the head.
 */
function lensGeometry(outline: THREE.Vector2[], center: THREE.Vector2, zFront: number, thickness: number, dome: number, rings = 10): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = outline.length;
  const zBack = zFront - thickness;

  const face = (front: boolean): void => {
    const base = pos.length / 3;
    pos.push(center.x, center.y, front ? zFront + dome : zBack);
    for (let k = 1; k <= rings; k++) {
      const t = k / rings;
      const z = front ? zFront + dome * (1 - t * t) : zBack;
      for (const q of outline) pos.push(center.x + (q.x - center.x) * t, center.y + (q.y - center.y) * t, z);
    }
    const ring = (k: number, i: number): number => base + 1 + (k - 1) * n + (i % n);
    for (let i = 0; i < n; i++) {
      if (front) idx.push(base, ring(1, i), ring(1, i + 1));
      else idx.push(base, ring(1, i + 1), ring(1, i));
    }
    for (let k = 1; k < rings; k++) {
      for (let i = 0; i < n; i++) {
        const a = ring(k, i), b = ring(k + 1, i), c = ring(k + 1, i + 1), d = ring(k, i + 1);
        if (front) idx.push(a, b, c, a, c, d);
        else idx.push(a, c, b, a, d, c);
      }
    }
  };
  face(true);
  face(false);
  // Rim wall.
  const base = pos.length / 3;
  for (const q of outline) pos.push(q.x, q.y, zFront);
  for (const q of outline) pos.push(q.x, q.y, zBack);
  for (let i = 0; i < n; i++) {
    const f0 = base + i, f1 = base + ((i + 1) % n), k0 = base + n + i, k1 = base + n + ((i + 1) % n);
    idx.push(f0, k0, k1, f0, k1, f1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * Ski goggles: white bumper frame around a glossy black lens, both wrapped around a vertical
 * cylinder of radius `bendRadius`. Origin = goggle centre (frame mid-depth at x = 0), lens
 * facing +Z; the ends curve back toward -Z. The wrap axis sits at (0, 0, -bendRadius), which
 * is also stored as `userData.goggles.bendAxisZ` so it can be lined up with a head centre.
 */
export function buildGoggles(mats: SlimeMaterials, opts: GoggleOptions = {}): THREE.Group {
  const w = opts.width ?? GOGGLE_DEFAULTS.width;
  const h = opts.height ?? GOGGLE_DEFAULTS.height;
  const R = opts.bendRadius ?? GOGGLE_DEFAULTS.bendRadius;
  const strap = opts.strap ?? 'stubs';
  const s = h / 0.16; // proportions authored for the 0.16-tall default

  const root = new THREE.Group();
  root.name = 'goggles';
  const wrap = new THREE.Group();
  wrap.name = 'goggles-wrap';
  wrap.position.z = -R;
  root.add(wrap);

  // Frame proportions (from the front / side crops): ~0.018 top, ~0.022 sides and bottom.
  const tTop = 0.0175 * s;
  const tSide = 0.022 * s;
  const tBottom = 0.021 * s;
  const rOuter = 0.062 * s;
  const notch = 0.021 * s;
  const wi = w - 2 * tSide;
  const hi = h - tTop - tBottom;
  const cyi = (tBottom - tTop) / 2;
  const ri = Math.max(0.01, rOuter - tSide * 0.9);

  const depth = 0.034 * s; // chunky bumper, as in the side crop
  const outer = goggleOutline(w, h, rOuter, notch);
  const inner = goggleOutline(wi, hi, ri, notch * 0.9, cyi);
  wrap.add(tagPart(mesh('goggles-frame', bendAroundY(frameSweep(outer, inner, depth), R), mats.whitePlastic), 'goggle-body', 'goggles'));

  // Lens tucks ~0.007 under the frame and sits ~0.01 behind its front face.
  const lensOutline = goggleOutline(wi + 0.014 * s, hi + 0.014 * s, ri + 0.007 * s, notch * 0.9, cyi);
  const lensFront = depth / 2 - 0.0115 * s;
  const lensGeo = bendAroundY(lensGeometry(lensOutline, new THREE.Vector2(0, cyi), lensFront, 0.01 * s, 0.0035 * s), R);
  wrap.add(tagPart(mesh('goggles-lens', lensGeo, mats.lens), 'goggle-lens', 'goggles'));

  if (strap === 'stubs') {
    // Segmented boxes (no earcut caps) bent with the frame.
    const bentBox = (sx: number, sy: number, sz: number, cx: number, cz: number, segX: number): THREE.BufferGeometry => {
      const g = new THREE.BoxGeometry(sx, sy, sz, segX, 1, 1);
      g.translate(cx, 0, cz);
      return bendAroundY(g, R);
    };
    const bentPoint = (x: number, y: number, z: number): THREE.Vector3 =>
      new THREE.Vector3((R + z) * Math.sin(x / R), y, (R + z) * Math.cos(x / R));
    for (const side of [1, -1]) {
      const tag = side > 0 ? 'L' : 'R';
      // One tagged part per side (+X = wearer's left): clip plate, rivets and webbing stub.
      const stub = partGroup(`goggle-strap-stub-${tag.toLowerCase()}`, 'goggles');
      wrap.add(stub);
      // Metal clip plate bridging frame and strap.
      const clipX = side * (w / 2 + 0.006 * s);
      stub.add(mesh(`goggles-clip-${tag}`, bentBox(0.022 * s, 0.06 * s, 0.006 * s, clipX, -0.004 * s, 6), mats.metal));
      for (const dy of [-0.018, 0.018]) {
        const rivet = mesh('goggles-clip-rivet', new THREE.CylinderGeometry(0.0032 * s, 0.0036 * s, 0.003 * s, 12), mats.metal);
        rivet.rotation.set(Math.PI / 2, 0, 0);
        const ax = clipX + side * 0.002 * s;
        const holder = new THREE.Group();
        holder.position.copy(bentPoint(ax, dy * s, -0.0005 * s));
        holder.rotation.y = ax / R;
        holder.add(rivet);
        stub.add(holder);
      }
      // Webbing stub.
      const L = 0.085 * s;
      stub.add(mesh(`goggles-strap-${tag}`, bentBox(L, 0.047 * s, 0.005 * s, side * (w / 2 + 0.013 * s + L / 2), -0.009 * s, 16), mats.webbing));
    }
  }

  root.userData.goggles = { width: w, height: h, bendRadius: R, bendAxisZ: -R };
  return root;
}

// ------------------------------------------------------------------ SWIM FORM

interface PuddleOptions {
  /** Height of the flat top above y = 0. */
  height: number;
  /** Inward width of the rounded liquid lip. */
  lip: number;
  /** Rings between the lip and the centre. */
  rings?: number;
  /** Extra height field on the top (faded out toward the lip). */
  surface?: (x: number, z: number) => number;
}

/**
 * Thin liquid puddle from a star-shaped outline in the XZ plane: flat bottom on y = 0,
 * bulging rounded lip (slight undercut, so it reads as a meniscus), top at `height` plus an
 * optional height field. Built as rings around the centre for smooth glossy normals.
 */
function puddleGeometry(outline: THREE.Vector2[], o: PuddleOptions): THREE.BufferGeometry {
  const n = outline.length;
  const H = o.height;
  const L = o.lip;
  const K = o.rings ?? 18;
  const lipSteps = 10;
  const cy = 0.38 * H; // lip ellipse centre height
  const phi0 = Math.asin(-cy / (H - cy));
  const surface = o.surface ?? (() => 0);

  // Station list: d = inward distance from the outline, y = height (before surface field).
  const stations: Array<{ d: number; y: number; top: boolean }> = [];
  for (let j = 0; j <= lipSteps; j++) {
    const phi = phi0 + (j / lipSteps) * (Math.PI / 2 - phi0);
    stations.push({ d: L * (1 - Math.cos(phi)), y: Math.max(0, cy + (H - cy) * Math.sin(phi)), top: false });
  }
  const pos: number[] = [];
  const idx: number[] = [];
  const P = new THREE.Vector2();
  const add = (i: number, d: number, y: number, top: boolean): void => {
    const q = outline[i];
    const len = q.length();
    const f = Math.max(0, 1 - d / len);
    P.set(q.x * f, q.y * f);
    let yy = y;
    if (top) {
      const fade = THREE.MathUtils.smoothstep(d, L, L * 3.5);
      yy += surface(P.x, P.y) * fade;
    }
    pos.push(P.x, yy, P.y);
  };
  // Lip rings.
  for (const st of stations) for (let i = 0; i < n; i++) add(i, st.d, st.y, false);
  // Top rings (excluding the lip-top ring already added and the centre).
  for (let k = 1; k < K; k++) {
    for (let i = 0; i < n; i++) {
      const len = outline[i].length();
      const t = k / K;
      const d = L + (len - L) * (1 - Math.pow(1 - t, 1.15));
      add(i, d, H, true);
    }
  }
  const ringCount = stations.length + K - 1;
  const centerTop = pos.length / 3;
  pos.push(0, H + surface(0, 0), 0);
  const centerBottom = pos.length / 3;
  pos.push(0, 0, 0);

  const v = (r: number, i: number): number => r * n + (i % n);
  for (let r = 0; r < ringCount - 1; r++) {
    for (let i = 0; i < n; i++) {
      const a = v(r, i), b = v(r, i + 1), c = v(r + 1, i + 1), d = v(r + 1, i);
      idx.push(a, b, c, a, c, d);
    }
  }
  for (let i = 0; i < n; i++) idx.push(v(ringCount - 1, i), v(ringCount - 1, i + 1), centerTop);
  for (let i = 0; i < n; i++) idx.push(v(0, i + 1), v(0, i), centerBottom);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // Make sure the top faces up regardless of the outline's winding.
  const nrm = geo.getAttribute('normal');
  if (nrm.getY(centerTop) < 0) {
    const arr = geo.getIndex()!.array as Uint16Array | Uint32Array;
    for (let i = 0; i < arr.length; i += 3) {
      const tmp = arr[i + 1];
      arr[i + 1] = arr[i + 2];
      arr[i + 2] = tmp;
    }
    geo.getIndex()!.needsUpdate = true;
    geo.computeVertexNormals();
  }
  return geo;
}

/** Small bulging droplet sitting on y = 0 (flat bottom, rounded overhanging rim, domed top). */
function dropletGeometry(r: number, h: number): THREE.BufferGeometry {
  const cy = 0.38 * h;
  const phi0 = Math.asin(-cy / (h - cy));
  const pts: Profile = [[1e-4, 0]];
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const phi = phi0 + (i / steps) * (Math.PI / 2 - phi0);
    pts.push([Math.max(1e-4, r * Math.cos(phi)), Math.max(0, cy + (h - cy) * Math.sin(phi))]);
  }
  return lathe(pts, 28);
}

/** Outline of the puddle in XZ (x, z), dense and without a closing duplicate. */
function puddleOutline(): THREE.Vector2[] {
  const pts = blobShape(0.5, 7, 5, 0.22, 260).getPoints();
  if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) pts.pop();
  return pts.map((p) => new THREE.Vector2(p.x * 1.1, p.y * 0.72));
}

/** Outline radius toward an azimuth (angle measured in the XZ plane from +X toward +Z). */
function outlinePointToward(outline: THREE.Vector2[], angle: number): THREE.Vector2 {
  let best = outline[0];
  let bestD = Infinity;
  for (const p of outline) {
    let d = Math.abs(Math.atan2(p.y, p.x) - angle);
    d = Math.min(d, Math.PI * 2 - d);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

export function buildSwimForm(mats: SlimeMaterials): THREE.Group {
  const root = new THREE.Group();
  root.name = 'slime-swim-form';
  const rnd = seededRandom(0x5a1f0e);

  // Goggles rest a little left of and behind the centre, on a low mound.
  const gx = -0.04;
  const gz = 0.12;
  // Goggle pose (Euler YXZ, degrees) and wrap radius.
  const pose = { y: 0.12, pitch: -40, yaw: 24, roll: 8, bend: 0.36 };
  const H = 0.026;
  const bumps = Array.from({ length: 7 }, () => ({
    x: (rnd() - 0.5) * 0.9,
    z: (rnd() - 0.5) * 0.5,
    a: 0.003 + rnd() * 0.005,
    s: 0.08 + rnd() * 0.08,
  }));
  const surface = (x: number, z: number): number => {
    let y = 0.03 * Math.exp(-(((x - gx) / 0.24) ** 2) - (((z - gz) / 0.14) ** 2));
    for (const b of bumps) y += b.a * Math.exp(-(((x - b.x) ** 2 + (z - b.z) ** 2) / (b.s * b.s)));
    return y;
  };

  const outline = puddleOutline();
  const puddle = partGroup('swim-puddle', 'swim-form');
  puddle.add(mesh('swim-puddle-body', puddleGeometry(outline, { height: H, lip: 0.034, rings: 20, surface }), mats.slime));
  root.add(puddle);

  // Detached droplets around the rim: [azimuth°, gap, radius, elongation].
  const droplets = partGroup('swim-droplets', 'swim-form');
  const drops: Array<[number, number, number, number]> = [
    [186, 0.05, 0.042, 1.5],
    [158, 0.035, 0.026, 1.2],
    [128, 0.04, 0.03, 1.3],
    [100, 0.06, 0.018, 1.0],
    [58, 0.03, 0.02, 1.2],
    [-12, 0.045, 0.04, 1.7],
    [12, 0.05, 0.022, 1.1],
    [-150, 0.04, 0.02, 1.2],
  ];
  drops.forEach(([deg, gap, r, elong], i) => {
    const a = THREE.MathUtils.degToRad(deg) + (rnd() - 0.5) * 0.08;
    const edge = outlinePointToward(outline, a);
    const dir = edge.clone().normalize();
    const p = edge.clone().addScaledVector(dir, gap + r * elong);
    const d = mesh(`swim-droplet-${i}`, dropletGeometry(r, Math.min(0.022, r * 0.55)), mats.slime);
    d.scale.set(elong, 1, 1);
    // Long axis along the rim tangent (-dir.z, dir.x), with a little jitter.
    d.rotation.y = Math.atan2(-dir.x, -dir.y) + (rnd() - 0.5) * 0.5;
    d.position.set(p.x, 0, p.y);
    droplets.add(d);
  });
  root.add(droplets);

  // Goggles lying in the slime on a low mound: Euler YXZ = roll in the lens plane, tip back so
  // the lens faces up toward the viewer, then yaw toward +X. A looser wrap than on the head
  // (bend 0.36) lets the strap stubs splay sideways; the lower rim and strap ends sink in.
  const goggles = partGroup('swim-goggles', 'swim-form');
  const g = buildGoggles(mats, { strap: 'stubs', bendRadius: pose.bend });
  const gy = pose.y;
  const deg = THREE.MathUtils.degToRad;
  g.rotation.set(deg(pose.pitch), deg(pose.yaw), deg(pose.roll), 'YXZ');
  g.position.set(gx, gy, gz);
  goggles.add(g);
  root.add(goggles);

  root.userData.swimForm = { width: 1.1, goggleAnchor: new THREE.Vector3(gx, gy, gz) };
  return root;
}
