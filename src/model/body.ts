import * as THREE from 'three';
import type { SlimeMaterials } from './materials';
import {
  ellipsoidPoint, lathe, mesh, pivot, seededRandom, smoothLathe, smoothProfile, tagPart,
  taperedTube, teardrop,
} from './geometry';

/**
 * Body builders for the Slime Agent. Dimensions are measured from the reference crops
 * (reference/front.png, side.png, back.png): the figure is 590 px tall at 1.6 units,
 * so 1 px ≈ 0.00271 units. Character faces +Z, Y up, the character's own LEFT is +X.
 * Left/right pairs are built from one routine with a lateral sign `s` (+1 left, -1 right):
 * every lateral coordinate is multiplied by `s`, i.e. a reflection, never a rotation.
 */

export type Side = 'left' | 'right';
export const sideSign = (side: Side): 1 | -1 => (side === 'left' ? 1 : -1);
const sfx = (side: Side) => (side === 'left' ? 'l' : 'r');

// ---------------------------------------------------------------------------
// Landmarks (world units, measured from the front/side crops)
// ---------------------------------------------------------------------------
export const LANDMARKS = {
  hipsY: 0.62,
  waistY: 0.725,
  jacketHemY: 0.735,
  shoulderY: 0.885,
  shoulderX: 0.185,
  neckBaseY: 0.995,
  headPivotY: 1.06,
  headCenterY: 1.255,
  gogglesY: 1.2,
  hairCenterY: 1.262,
  hipJointX: 0.104,
  legSplay: 0.2, // rad, legs open outward ~10.7°
  toeOut: 0.22, // rad, shoes turned outward
  upperArmLength: 0.168,
  forearmLength: 0.14,
  armSwing: 0.5, // shoulder abduction (A-pose)
  elbowBend: 0.24,
  thighLength: 0.21,
  torsoDepthScale: 0.74, // elliptical torso cross-section (depth / width)
} as const;

const L = LANDMARKS;

// Head ellipsoid (relative to the head pivot).
const HEAD = { rx: 0.215, ry: 0.2, rz: 0.2, cy: L.headCenterY - L.headPivotY };
// Hair cap ellipsoid (relative to the head pivot).
const HAIR = { rx: 0.234, ry: 0.19, rz: 0.236, cy: L.hairCenterY - L.headPivotY, cz: -0.012 };

export interface GogglesBuilder {
  (mats: SlimeMaterials): THREE.Object3D;
}

// ---------------------------------------------------------------------------
// Head: face, mouth, slime hair, goggles strap. Origin = head pivot (top of neck).
// ---------------------------------------------------------------------------
export function buildHead(mats: SlimeMaterials, goggles: GogglesBuilder): THREE.Group {
  const head = new THREE.Group();
  head.name = 'head-assembly';

  // Face / skull volume.
  const skullGeo = new THREE.SphereGeometry(1, 48, 32);
  skullGeo.scale(HEAD.rx, HEAD.ry, HEAD.rz);
  const skull = mesh('head-skull', skullGeo, mats.slime);
  skull.position.y = HEAD.cy;
  head.add(tagPart(skull, 'head'));

  // Smile: a thin dark crease drawn on the lower face surface (no visible eyes —
  // the goggles cover the eye zone on every view of the sheet).
  const smilePts: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const az = -0.33 + 0.66 * t;
    const polar = 2.37 + 0.075 * Math.sin(Math.PI * t);
    const p = ellipsoidPoint(HEAD.rx + 0.002, HEAD.ry + 0.002, HEAD.rz + 0.002, az, polar);
    p.y += HEAD.cy;
    smilePts.push(p);
  }
  const smile = mesh(
    'mouth-smile',
    taperedTube(new THREE.CatmullRomCurve3(smilePts), (u) => 0.0042 * (0.55 + 0.45 * Math.sin(Math.PI * u)), {
      tubularSegments: 24, radialSegments: 8,
    }),
    mats.slimeDeep,
  );
  head.add(tagPart(smile, 'mouth-smile'));

  head.add(buildSlimeHair(mats));

  // Goggles + strap.
  const gogglesGroup = new THREE.Group();
  gogglesGroup.name = 'goggles-assembly';
  const g = goggles(mats);
  gogglesGroup.add(g);
  gogglesGroup.add(buildGoggleStrap(mats));
  tagPart(gogglesGroup, 'goggles');
  head.add(gogglesGroup);

  return head;
}

/** Elastic strap around the hair at goggle height, with metal hinge clips at the temples. */
function buildGoggleStrap(mats: SlimeMaterials): THREE.Group {
  const strap = new THREE.Group();
  strap.name = 'goggle-strap';
  const y = L.gogglesY - L.headPivotY;
  // Band: an open elliptical cylinder sitting on the hair, covering the back 3/4 only
  // (the goggle frame covers the front).
  const bandGeo = new THREE.CylinderGeometry(1, 1, 0.052, 64, 1, true, Math.PI * 0.3, Math.PI * 1.4);
  bandGeo.scale(0.272, 1, 0.318);
  // CylinderGeometry thetaStart 0 is +Z; rotate so the gap faces +Z (front).
  const band = mesh('goggle-strap-band', bandGeo, mats.webbing);
  band.material = mats.webbing.clone();
  (band.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
  band.position.set(0, y, -0.052);
  strap.add(tagPart(band, 'goggle-strap'));

  for (const s of [1, -1]) {
    const clip = mesh(
      `goggle-clip-${s > 0 ? 'l' : 'r'}`,
      new THREE.BoxGeometry(0.018, 0.05, 0.045),
      mats.metal,
    );
    clip.position.set(s * 0.246, y, 0.085);
    clip.rotation.y = s * 0.62;
    const clipGroup = new THREE.Group();
    clipGroup.add(clip);
    strap.add(tagPart(clipGroup, `goggle-clip-${s > 0 ? 'l' : 'r'}`));
    // Black plastic hinge block that joins the frame to the strap.
    const hinge = mesh(
      `goggle-hinge-${s > 0 ? 'l' : 'r'}`,
      new THREE.BoxGeometry(0.022, 0.06, 0.03),
      mats.blackPlastic,
    );
    hinge.position.set(s * 0.232, y, 0.115);
    hinge.rotation.y = s * 0.75;
    clipGroup.add(hinge);
  }
  return strap;
}

interface LockSpec {
  az: number;
  p0: number;
  p1: number;
  r: number;
  tip: number;
  lift: number;
  twist: number;
  drip: boolean;
  /** Extra outward push toward the tip (side locks stick out before drooping). */
  splay: number;
}

/**
 * Slime hair: a shell cap plus draped blob locks. Roots are bound to the hair-cap
 * ellipsoid as (azimuth, polar) — scalp (u, v) coordinates — never absolute positions,
 * and each lock follows the cap surface before hanging vertically, ending in a bulbous
 * droplet tip. Drips and detached droplets reproduce the melting silhouette of the sheet.
 * Hair is rigidly parented to the head (never skinned).
 */
export function buildSlimeHair(mats: SlimeMaterials): THREE.Group {
  const hair = new THREE.Group();
  hair.name = 'slime-hair';
  const rnd = seededRandom(1337);

  const capGeo = new THREE.SphereGeometry(1, 48, 32, 0, Math.PI * 2, 0, Math.PI * 0.62);
  capGeo.scale(HAIR.rx, HAIR.ry, HAIR.rz);
  const cap = mesh('hair-cap', capGeo, mats.slime);
  cap.position.set(0, HAIR.cy, HAIR.cz);
  hair.add(tagPart(cap, 'hair-cap', 'slime-hair'));

  const locks: LockSpec[] = [];
  const push = (lk: Omit<LockSpec, 'twist' | 'drip'> & { drip?: boolean }) =>
    locks.push({ twist: (rnd() - 0.5) * 0.5, drip: false, ...lk });

  // Layer A — drape ring. The fringe stops on the goggle frame; side locks stick out
  // (splay) before drooping, back locks hang to the strap.
  const ring = 14;
  for (let i = 0; i < ring; i++) {
    const az = (i / ring) * Math.PI * 2 + (rnd() - 0.5) * 0.2;
    const wrapped = Math.atan2(Math.sin(az), Math.cos(az)); // -π..π, 0 = front
    const frontness = Math.cos(wrapped);
    const sideness = Math.abs(Math.sin(wrapped));
    if (frontness > 0.6) {
      push({ az, p0: 0.38 + rnd() * 0.12, p1: 1.34 + rnd() * 0.1, r: 0.058 + rnd() * 0.012, tip: 1.35 + rnd() * 0.2, lift: 0.006, splay: 0.012 });
    } else if (frontness > -0.55) {
      push({
        az, p0: 0.42 + rnd() * 0.12, p1: 2.02 + rnd() * 0.36, r: 0.056 + rnd() * 0.014, tip: 1.3 + rnd() * 0.22,
        lift: 0.004, splay: 0.03 + rnd() * 0.035, drip: sideness > 0.6 && rnd() > 0.4,
      });
    } else {
      push({ az, p0: 0.42 + rnd() * 0.12, p1: 1.78 + rnd() * 0.32, r: 0.06 + rnd() * 0.012, tip: 1.3 + rnd() * 0.2, lift: 0.004, splay: 0.02 });
    }
  }
  // Layer B — fat upper locks lying on the drape, giving the bumpy dome.
  const upper = 9;
  for (let i = 0; i < upper; i++) {
    const az = (i / upper) * Math.PI * 2 + 0.35 + (rnd() - 0.5) * 0.3;
    const front = Math.cos(az) > 0.55;
    push({
      az, p0: 0.12 + rnd() * 0.12, p1: front ? 1.02 + rnd() * 0.12 : 1.05 + rnd() * 0.35, r: 0.066 + rnd() * 0.014,
      tip: 1.3 + rnd() * 0.2, lift: 0.018 + rnd() * 0.012, splay: 0.016,
    });
  }
  // Layer C — short crown blobs.
  for (let i = 0; i < 5; i++) {
    const az = (i / 5) * Math.PI * 2 + 0.9;
    push({ az, p0: 0.02, p1: 0.55 + rnd() * 0.2, r: 0.064, tip: 1.3, lift: 0.018, splay: 0.01 });
  }

  const dripSites: THREE.Vector3[] = [];
  locks.forEach((lk, idx) => {
    const pts: THREE.Vector3[] = [];
    const steps = 10;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const polar = lk.p0 + (lk.p1 - lk.p0) * t;
      const az = lk.az + lk.twist * t;
      const radiusNow = lk.r * (0.7 + 0.3 * t);
      const off = radiusNow * 0.6 + lk.lift * (0.4 + 0.6 * Math.sin(Math.PI * t)) + lk.splay * t * t;
      const pc = Math.min(polar, 1.62);
      const p = ellipsoidPoint(HAIR.rx + off, HAIR.ry + off, HAIR.rz + off, az, pc);
      if (polar > 1.62) {
        // Past the equator the lock hangs straight down instead of wrapping under.
        p.multiplyScalar(1 - (polar - 1.62) * 0.04);
        p.y -= (polar - 1.62) * HAIR.ry * 1.05;
      }
      p.y += HAIR.cy;
      p.z += HAIR.cz;
      pts.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const geo = taperedTube(
      curve,
      (u) => {
        const base = lk.r * (0.6 + 0.4 * u);
        const bulb = Math.exp(-((1 - u) ** 2) / 0.02) * (lk.tip - 1);
        return base * (1 + bulb);
      },
      { tubularSegments: 40, radialSegments: 16 },
    );
    const lockId = `hair-lock-${String(idx + 1).padStart(2, '0')}`;
    hair.add(tagPart(mesh(lockId, geo, mats.slime), lockId, 'slime-hair'));
    if (lk.drip) dripSites.push(pts[pts.length - 1].clone());
  });

  // Crown tuft: a tall lock rising from the crown, leaning to the character's left (+X)
  // and curling back, plus a second curl arching behind it (side + back views).
  const tufts: Array<{ pts: Array<[number, number, number]>; r: number }> = [
    { pts: [[0.0, 0.33, 0.0], [0.022, 0.415, -0.005], [0.046, 0.475, -0.02], [0.064, 0.508, -0.045], [0.074, 0.522, -0.078]], r: 0.044 },
    { pts: [[-0.02, 0.33, -0.05], [-0.05, 0.41, -0.11], [-0.07, 0.43, -0.18], [-0.085, 0.39, -0.235]], r: 0.036 },
    { pts: [[0.04, 0.33, 0.05], [0.1, 0.395, 0.06], [0.165, 0.39, 0.045], [0.215, 0.34, 0.025]], r: 0.034 },
  ];
  const tuftGroup = new THREE.Group();
  hair.add(tagPart(tuftGroup, 'hair-tuft', 'slime-hair'));
  tufts.forEach((tf, i) => {
    const curve = new THREE.CatmullRomCurve3(tf.pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)), false, 'centripetal');
    const geo = taperedTube(curve, (u) => tf.r * (0.8 + 0.2 * u) * (1 + 0.35 * Math.exp(-((1 - u) ** 2) / 0.01)), {
      tubularSegments: 36, radialSegments: 14,
    });
    tuftGroup.add(mesh(`hair-tuft-${i}`, geo, mats.slime));
  });

  // Hanging drips under some side locks, and detached droplets falling beside the head.
  dripSites.forEach((p, i) => {
    const d = mesh(`hair-drip-${i + 1}`, teardrop(0.02, 0.075, 0.3), mats.slime);
    d.position.copy(p).add(new THREE.Vector3(0, -0.035, 0));
    hair.add(tagPart(d, `hair-drip-${i + 1}`, 'slime-hair'));
  });
  const droplets: Array<[number, number, number, number]> = [
    [0.3, 0.06, 0.05, 0.014], [-0.3, 0.1, 0.03, 0.013], [0.29, 0.13, -0.07, 0.011],
    [-0.27, 0.03, -0.1, 0.012], [-0.12, 0.46, -0.28, 0.012], [0.2, 0.44, -0.2, 0.009],
    [0.06, 0.03, -0.29, 0.012],
  ];
  droplets.forEach(([x, y, z, r], i) => {
    const d = mesh(`hair-drop-${i + 1}`, teardrop(r, r * 3.2, 0.2), mats.slime);
    d.position.set(x, y + r * 3.2, z);
    hair.add(tagPart(d, `hair-drop-${i + 1}`, 'slime-hair'));
  });

  return tagPart(hair, 'slime-hair');
}

// ---------------------------------------------------------------------------
// Torso: T-shirt, cropped techwear jacket, collar, piping, harness straps.
// Origin = spine pivot (world y = jacket hem / waist).
// ---------------------------------------------------------------------------

/** Jacket outer profile [x-radius, worldY]; depth is radius × torsoDepthScale. */
const JACKET_PROFILE: Array<[number, number]> = smoothProfile([
  [0.186, L.jacketHemY],
  [0.196, 0.78],
  [0.205, 0.85],
  [0.207, 0.9],
  [0.19, 0.95],
  [0.15, 0.985],
  [0.118, 1.0],
], 40);

function profileRadius(profile: Array<[number, number]>, y: number): number {
  for (let i = 0; i < profile.length - 1; i++) {
    const [r0, y0] = profile[i];
    const [r1, y1] = profile[i + 1];
    if ((y >= y0 && y <= y1) || (y <= y0 && y >= y1)) {
      const t = (y - y0) / (y1 - y0 || 1);
      return r0 + (r1 - r0) * t;
    }
  }
  return profile[profile.length - 1][0];
}

/** Point on the elliptical jacket surface at lathe angle `phi` (0 = +Z) and world height y. */
function jacketPoint(phi: number, y: number, offset = 0): THREE.Vector3 {
  const r = profileRadius(JACKET_PROFILE, y) + offset;
  return new THREE.Vector3(r * Math.sin(phi), y, r * Math.cos(phi) * L.torsoDepthScale);
}

export interface TorsoDeps {
  buckle?: (mats: SlimeMaterials) => THREE.Object3D;
}

export function buildTorso(mats: SlimeMaterials, deps: TorsoDeps = {}): THREE.Group {
  const torso = new THREE.Group();
  torso.name = 'torso-content';
  const D = L.torsoDepthScale;

  // White T-shirt (visible in the jacket opening and as a hem below the crop).
  const teeGeo = smoothLathe([
    [0.176, 0.708], [0.18, 0.74], [0.19, 0.82], [0.195, 0.9], [0.15, 0.97], [0.098, 1.01], [0.08, 1.04], [0.072, 1.05],
  ], 32, 48);
  teeGeo.scale(1, 1, D);
  torso.add(tagPart(mesh('tee', teeGeo, mats.cotton), 'tee'));

  // Slime body core under the clothes (L0 core; revealed when the garments explode).
  const abdomenGeo = smoothLathe([[0.12, 0.66], [0.158, 0.7], [0.165, 0.76], [0.168, 0.82]], 16, 32);
  abdomenGeo.scale(1, 1, D);
  torso.add(tagPart(mesh('abdomen', abdomenGeo, mats.slime), 'abdomen'));
  const chestGeo = smoothLathe([[0.168, 0.82], [0.18, 0.88], [0.17, 0.95], [0.12, 0.99], [0.06, 1.01]], 16, 32);
  chestGeo.scale(1, 1, D);
  torso.add(tagPart(mesh('chest', chestGeo, mats.slime), 'chest'));

  // Cropped jacket: open front (lathe gap centred on +Z).
  const nylonDouble = mats.nylon.clone();
  nylonDouble.side = THREE.DoubleSide;
  const gapHem = 0.86;
  const jacketGeo = lathe(JACKET_PROFILE, 64, gapHem / 2, Math.PI * 2 - gapHem);
  jacketGeo.scale(1, 1, D);
  const jacket = new THREE.Group();
  jacket.name = 'jacket-body';
  const collar = new THREE.Group();
  collar.name = 'jacket-collar';
  jacket.add(mesh('jacket-shell', jacketGeo, nylonDouble));

  // Elastic hem band.
  const hemGeo = lathe([[0.184, L.jacketHemY - 0.004], [0.191, L.jacketHemY + 0.006], [0.19, L.jacketHemY + 0.026], [0.188, L.jacketHemY + 0.03]], 64, gapHem / 2, Math.PI * 2 - gapHem);
  hemGeo.scale(1, 1, D);
  jacket.add(mesh('jacket-hem', hemGeo, mats.nylon));

  // Stand-up collar: black outside, team-colour lining inside, open at the front.
  const collarGap = 1.05;
  const collarProfile: Array<[number, number]> = [[0.12, 0.99], [0.136, 1.02], [0.164, 1.055], [0.172, 1.066]];
  const collarGeo = lathe(collarProfile, 48, collarGap / 2, Math.PI * 2 - collarGap);
  collarGeo.scale(1, 1, 0.9);
  collar.add(mesh('jacket-collar-shell', collarGeo, mats.nylon));
  const liningMat = mats.piping.clone();
  liningMat.side = THREE.DoubleSide;
  const liningGeo = lathe(collarProfile.map(([r, y]) => [r - 0.006, y] as [number, number]), 48, collarGap / 2, Math.PI * 2 - collarGap);
  liningGeo.scale(1, 1, 0.9);
  collar.add(mesh('jacket-collar-lining', liningGeo, liningMat));
  // Collar rim piping.
  const rimPts: THREE.Vector3[] = [];
  for (let i = 0; i <= 40; i++) {
    const phi = collarGap / 2 + (i / 40) * (Math.PI * 2 - collarGap);
    rimPts.push(new THREE.Vector3(0.17 * Math.sin(phi), 1.063, 0.17 * Math.cos(phi) * 0.9));
  }
  collar.add(mesh('jacket-collar-rim', taperedTube(new THREE.CatmullRomCurve3(rimPts), () => 0.006, { tubularSegments: 80, radialSegments: 6 }), mats.piping));

  // Piping: front opening edges, a vertical panel stripe on each front panel, and
  // diagonal stripes across the back yoke.
  const pipe = (name: string, pts: THREE.Vector3[], r = 0.0062) => {
    const m = mesh(name, taperedTube(new THREE.CatmullRomCurve3(pts), () => r, { tubularSegments: 48, radialSegments: 6 }), mats.piping);
    jacket.add(m);
  };
  for (const s of [1, -1]) {
    const edge: THREE.Vector3[] = [];
    const stripe: THREE.Vector3[] = [];
    const back: THREE.Vector3[] = [];
    for (let i = 0; i <= 12; i++) {
      const y = L.jacketHemY + 0.004 + (i / 12) * (0.985 - L.jacketHemY);
      const phiEdge = s * (gapHem / 2 + (collarGap / 2 - gapHem / 2) * Math.max(0, (y - 0.9) / 0.09));
      edge.push(jacketPoint(phiEdge, y, 0.003));
      if (y < 0.93) stripe.push(jacketPoint(s * 0.82, y, 0.004));
    }
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      back.push(jacketPoint(s * (2.15 + 0.5 * t), 0.94 - 0.13 * t, 0.004));
    }
    const name = s > 0 ? 'l' : 'r';
    pipe(`jacket-piping-edge-${name}`, edge, 0.0075);
    pipe(`jacket-piping-panel-${name}`, stripe);
    pipe(`jacket-piping-back-${name}`, back);

    // Chest pocket zip line (short horizontal piping on each front panel).
    const zip: THREE.Vector3[] = [];
    for (let i = 0; i <= 6; i++) zip.push(jacketPoint(s * (0.5 + i * 0.05), 0.79, 0.004));
    pipe(`jacket-pocket-zip-${name}`, zip, 0.0045);
  }
  torso.add(tagPart(jacket, 'jacket-body', 'jacket'));
  torso.add(tagPart(collar, 'jacket-collar', 'jacket'));

  // Harness straps over the shoulders with metal buckles at the chest (front view:
  // buckles at x ≈ ±0.12, y ≈ 0.925).
  const harness = new THREE.Group();
  harness.name = 'harness';
  for (const s of [1, -1]) {
    const x = s * 0.112;
    const front = (y: number) => {
      const r = profileRadius(JACKET_PROFILE, y) + 0.008;
      const z = Math.sqrt(Math.max(r * r - x * x, 0.0004)) * D;
      return new THREE.Vector3(x, y, z);
    };
    const pts = [
      front(0.78), front(0.86), front(0.94), new THREE.Vector3(x, 0.993, 0.06),
      new THREE.Vector3(x, 1.0, -0.03), new THREE.Vector3(x * 0.95, 0.975, -0.11),
    ];
    // One continuous path, split into the chest strap and the over-shoulder yoke.
    const full = new THREE.CatmullRomCurve3(pts);
    const sub = (u0: number, u1: number) =>
      new THREE.CatmullRomCurve3(Array.from({ length: 13 }, (_, i) => full.getPointAt(u0 + ((u1 - u0) * i) / 12)));
    const webbing = (c: THREE.Curve<THREE.Vector3>) => taperedTube(c, () => 0.02, {
      tubularSegments: 32, radialSegments: 8, capStart: false, capEnd: false, squashN: 1, squashB: 0.25,
    });
    const n = s > 0 ? 'l' : 'r';
    harness.add(tagPart(mesh(`harness-strap-${n}`, webbing(sub(0, 0.6)), mats.webbing), `harness-strap-${n}`, 'harness'));
    harness.add(tagPart(mesh(`harness-yoke-${n}`, webbing(sub(0.58, 1)), mats.webbing), `harness-yoke-${n}`, 'harness'));
    if (deps.buckle) {
      const b = deps.buckle(mats);
      const p = front(0.925);
      b.position.set(p.x, p.y, p.z + 0.008);
      b.rotation.y = s * 0.45;
      b.name = `harness-buckle-${n}`;
      harness.add(tagPart(b, `harness-buckle-${n}`, 'harness'));
    }
  }
  torso.add(harness);

  return torso;
}

// ---------------------------------------------------------------------------
// Pelvis: pants seat + waistband. Origin = hips pivot.
// ---------------------------------------------------------------------------
export function buildPelvis(mats: SlimeMaterials): THREE.Group {
  const pelvis = new THREE.Group();
  pelvis.name = 'pelvis-content';
  const seatGeo = smoothLathe([
    [0.05, 0.52], [0.12, 0.55], [0.158, 0.6], [0.166, 0.66], [0.166, 0.7], [0.166, 0.725],
  ], 24, 48);
  seatGeo.scale(1, 1, 0.78);
  pelvis.add(tagPart(mesh('pelvis', seatGeo, mats.twill), 'pelvis', 'pants'));
  const bandGeo = lathe([[0.166, 0.692], [0.172, 0.698], [0.172, 0.722], [0.166, 0.728]], 48);
  bandGeo.scale(1, 1, 0.78);
  pelvis.add(tagPart(mesh('waistband', bandGeo, mats.webbing), 'waistband', 'pants'));
  return pelvis;
}

// ---------------------------------------------------------------------------
// Arms. Built in the arm's local frame (hanging along -Y from the joint).
// ---------------------------------------------------------------------------
export interface ArmChain {
  shoulder: THREE.Group;
  elbow: THREE.Group;
  wrist: THREE.Group;
  handSocket: THREE.Group;
}

export function buildArm(mats: SlimeMaterials, side: Side): ArmChain {
  const s = sideSign(side);
  const n = sfx(side);
  const shoulder = pivot(`shoulder-${n}`, s * L.shoulderX, L.shoulderY, 0);
  shoulder.rotation.z = s * L.armSwing;

  // Upper sleeve: puffy nylon tube with a rounded shoulder cap.
  const upperCurve = new THREE.LineCurve3(new THREE.Vector3(0, 0.012, 0), new THREE.Vector3(0, -L.upperArmLength - 0.01, 0));
  const upperSleeve = mesh(
    `sleeve-upper-${n}`,
    taperedTube(upperCurve, (u) => 0.066 - 0.008 * u + 0.004 * Math.sin(Math.PI * u), { capEnd: false, tubularSegments: 24 }),
    mats.nylon,
  );
  const upperArm = new THREE.Group();
  upperArm.add(upperSleeve);
  shoulder.add(tagPart(upperArm, `upper-arm-${n}`));
  // Sleeve piping on the outer (lateral) side, continuing on the forearm sleeve.
  const sleevePipe = (len: number, y0: number, r: number) =>
    mesh(`sleeve-piping-${n}-${y0.toFixed(2)}`, taperedTube(
      new THREE.LineCurve3(new THREE.Vector3(s * r, y0, 0.004), new THREE.Vector3(s * (r - 0.004), y0 - len, 0.004)),
      () => 0.0062, { tubularSegments: 12, radialSegments: 6 },
    ), mats.piping);
  upperArm.add(sleevePipe(L.upperArmLength - 0.01, 0.0, 0.0665));

  const elbow = pivot(`elbow-${n}`, 0, -L.upperArmLength, 0);
  elbow.rotation.z = s * L.elbowBend;
  shoulder.add(elbow);

  // Lower sleeve ending just below the elbow, with a cuff band and team-colour stripe.
  const lowerSleeve = new THREE.Group();
  lowerSleeve.name = `sleeve-lower-${n}`;
  lowerSleeve.add(mesh(
    `sleeve-lower-shell-${n}`,
    taperedTube(new THREE.LineCurve3(new THREE.Vector3(0, 0.012, 0), new THREE.Vector3(0, -0.07, 0)), (u) => 0.058 - 0.004 * u, {
      capStart: false, capEnd: false, tubularSegments: 10,
    }),
    mats.nylon,
  ));
  const cuff = mesh(`sleeve-cuff-${n}`, new THREE.CylinderGeometry(0.055, 0.053, 0.026, 28), mats.webbing);
  cuff.position.y = -0.075;
  const cuffGroup = new THREE.Group();
  cuffGroup.add(cuff);
  lowerSleeve.add(tagPart(cuffGroup, `sleeve-cuff-${n}`, 'jacket'));
  const cuffStripe = mesh(`sleeve-cuff-stripe-${n}`, new THREE.CylinderGeometry(0.0565, 0.0565, 0.007, 28), mats.piping);
  cuffStripe.position.y = -0.062;
  cuffGroup.add(cuffStripe);
  lowerSleeve.add(sleevePipe(0.06, 0.0, 0.058));
  lowerSleeve.add(mesh(`sleeve-elbow-${n}`, new THREE.SphereGeometry(0.058, 20, 14), mats.nylon));
  elbow.add(tagPart(lowerSleeve, `sleeve-lower-${n}`));

  // Slime forearm + black wristband.
  const forearm = mesh(
    `forearm-${n}`,
    taperedTube(new THREE.LineCurve3(new THREE.Vector3(0, -0.06, 0), new THREE.Vector3(0, -L.forearmLength - 0.01, 0)), (u) => 0.036 - 0.004 * u, {
      capStart: false, tubularSegments: 12,
    }),
    mats.slime,
  );
  elbow.add(tagPart(forearm, `forearm-${n}`));
  const wristband = new THREE.Group();
  wristband.position.y = -0.112;
  wristband.add(mesh(`wristband-band-${n}`, new THREE.CylinderGeometry(0.043, 0.043, 0.032, 24), mats.webbing));
  const bandStrap = mesh(`wristband-strap-${n}`, new THREE.BoxGeometry(0.02, 0.026, 0.012), mats.blackPlastic);
  bandStrap.position.set(0, 0, 0.043);
  wristband.add(bandStrap);
  elbow.add(tagPart(wristband, `wristband-${n}`));

  const wrist = pivot(`wrist-${n}`, 0, -L.forearmLength, 0);
  wrist.rotation.z = -s * 0.3;
  elbow.add(wrist);
  const hand = buildHand(mats, side);
  wrist.add(hand);

  // Grip socket in the palm (the blaster parents here).
  const handSocket = pivot(`socket-hand-${n}`, -s * 0.01, -0.07, 0.012);
  handSocket.userData.socket = { id: `hand-${n}`, purpose: 'grip' };
  wrist.add(handSocket);

  return { shoulder, elbow, wrist, handSocket };
}

/**
 * Mitten-like slime hand: chunky palm, three fat fingers and a thumb (the sheet draws
 * big toon gloves-like hands, roughly as long as the lower face). Palm faces the body.
 */
function buildHand(mats: SlimeMaterials, side: Side): THREE.Group {
  const s = sideSign(side);
  const n = sfx(side);
  const hand = new THREE.Group();
  hand.name = `hand-${n}`;
  const palmGeo = new THREE.SphereGeometry(1, 28, 20);
  palmGeo.scale(0.034, 0.056, 0.05);
  const palm = mesh(`palm-${n}`, palmGeo, mats.slime);
  palm.position.set(0, -0.05, 0);
  hand.add(palm);
  const fingers: Array<[number, number, number]> = [
    // [z offset, length, curl toward the palm side]
    [0.03, 0.066, 0.28], [0.0, 0.074, 0.34], [-0.03, 0.064, 0.4],
  ];
  fingers.forEach(([z, len, curl], i) => {
    const start = new THREE.Vector3(0, -0.075, z);
    const mid = new THREE.Vector3(-s * len * 0.12, -0.075 - len * 0.6, z * 1.1);
    const end = new THREE.Vector3(-s * len * curl, -0.075 - len, z * 1.15);
    const fingerId = `${['index', 'middle', 'ring'][i]}-${n}-1`;
    const f = mesh(fingerId, taperedTube(new THREE.QuadraticBezierCurve3(start, mid, end), (u) => 0.0185 - 0.002 * u, {
      tubularSegments: 16, radialSegments: 12,
    }), mats.slime);
    hand.add(tagPart(f, fingerId, `hand-${n}`));
  });
  const thumb = mesh(`thumb-${n}-1`, taperedTube(new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-s * 0.01, -0.035, 0.034),
    new THREE.Vector3(-s * 0.028, -0.06, 0.066),
    new THREE.Vector3(-s * 0.04, -0.088, 0.07),
  ), (u) => 0.019 - 0.002 * u, { tubularSegments: 16, radialSegments: 12 }), mats.slime);
  hand.add(tagPart(thumb, `thumb-${n}-1`, `hand-${n}`));
  return tagPart(hand, `hand-${n}`);
}

// ---------------------------------------------------------------------------
// Legs. Built in the leg's local frame (hanging along -Y from the hip joint).
// ---------------------------------------------------------------------------
export interface LegChain {
  hip: THREE.Group;
  knee: THREE.Group;
  ankle: THREE.Group;
  footSocket: THREE.Group;
}

export function buildLeg(mats: SlimeMaterials, side: Side): LegChain {
  const s = sideSign(side);
  const n = sfx(side);
  const hip = pivot(`hip-${n}`, s * L.hipJointX, L.hipsY, 0);
  hip.rotation.z = s * L.legSplay;
  const cosS = Math.cos(L.legSplay);
  const groundLocal = -L.hipsY / cosS; // local y of the ground along the tilted leg axis
  const cuffLocal = -(L.hipsY - 0.25) / cosS;

  // Baggy jogger profile [radius, localY] measured along the leg axis.
  const thighProfile: Array<[number, number]> = [[0.104, 0.04], [0.116, -0.04], [0.118, -0.12], [0.108, -L.thighLength]];
  const shinProfile: Array<[number, number]> = [
    [0.108, -L.thighLength], [0.113, -0.26], [0.108, -0.31], [0.09, -0.343], [0.068, cuffLocal + 0.02],
  ];
  const outerPhi = s > 0 ? Math.PI / 2 : (3 * Math.PI) / 2;
  const stripeWidth = 0.42;

  const thigh = new THREE.Group();
  thigh.name = `thigh-${n}`;
  thigh.add(mesh(`pants-thigh-${n}`, smoothLathe(thighProfile, 16, 40), mats.twill));
  thigh.add(mesh(`pants-stripe-thigh-${n}`, smoothLathe(thighProfile.map(([r, y]) => [r + 0.003, y] as [number, number]), 16, 8, outerPhi - stripeWidth / 2, stripeWidth), mats.piping));
  // Cargo pocket with flap on the outer thigh.
  const pocket = new THREE.Group();
  pocket.name = `cargo-pocket-${n}`;
  const pocketBody = mesh(`cargo-pocket-body-${n}`, new THREE.BoxGeometry(0.026, 0.1, 0.082), mats.twill);
  pocket.add(pocketBody);
  const flap = mesh(`cargo-flap-${n}`, new THREE.BoxGeometry(0.032, 0.03, 0.09), mats.nylon);
  flap.position.set(s * 0.003, 0.045, 0);
  pocket.add(tagPart(flap, `cargo-flap-${n}`, 'pants'));
  const snap = mesh(`cargo-pocket-snap-${n}`, new THREE.CylinderGeometry(0.007, 0.007, 0.006, 12), mats.metal);
  snap.rotation.z = Math.PI / 2;
  snap.position.set(s * 0.019, 0.04, 0);
  pocket.add(snap);
  // Pocket sits on the outer side just in front of the side stripe.
  pocket.position.set(s * 0.12, -0.15, 0.03);
  pocket.rotation.z = -s * 0.04;
  thigh.add(tagPart(pocket, `cargo-pocket-${n}`, 'pants'));
  hip.add(tagPart(thigh, `thigh-${n}`));

  const knee = pivot(`knee-${n}`, 0, -L.thighLength, 0);
  hip.add(knee);
  const shin = new THREE.Group();
  shin.name = `shin-${n}`;
  const shinLocal = shinProfile.map(([r, y]) => [r, y + L.thighLength] as [number, number]);
  shin.add(mesh(`pants-shin-${n}`, smoothLathe(shinLocal, 20, 40), mats.twill));
  shin.add(mesh(`pants-stripe-shin-${n}`, smoothLathe(shinLocal.map(([r, y]) => [r + 0.003, y] as [number, number]), 20, 8, outerPhi - stripeWidth / 2, stripeWidth), mats.piping));
  // Elastic jogger cuff.
  const cuff = mesh(`pant-cuff-${n}`, smoothLathe([
    [0.064, cuffLocal + L.thighLength + 0.03], [0.068, cuffLocal + L.thighLength + 0.015], [0.066, cuffLocal + L.thighLength - 0.005], [0.06, cuffLocal + L.thighLength - 0.01],
  ], 8, 32), mats.webbing);
  shin.add(tagPart(cuff, `pant-cuff-${n}`, 'pants'));
  // Slime ankle between cuff and shoe collar.
  const ankleMesh = mesh(`foot-${n}`, new THREE.CylinderGeometry(0.046, 0.05, 0.12, 20), mats.slime);
  ankleMesh.position.y = cuffLocal + L.thighLength - 0.04;
  shin.add(tagPart(ankleMesh, `foot-${n}`, `leg-${n}`));
  knee.add(tagPart(shin, `shin-${n}`));

  // Ankle pivot at ground level under the leg axis; it levels the foot and turns the toe out.
  const ankle = pivot(`ankle-${n}`, 0, groundLocal + L.thighLength, 0);
  ankle.rotation.set(0, s * L.toeOut, -s * L.legSplay, 'ZYX');
  knee.add(ankle);
  const footSocket = pivot(`socket-foot-${n}`, 0, 0, 0);
  ankle.add(footSocket);

  return { hip, knee, ankle, footSocket };
}

/** Neck: a short slime cylinder mostly hidden by the collar. Origin = neck pivot. */
export function buildNeck(mats: SlimeMaterials): THREE.Mesh {
  const neck = mesh('neck', new THREE.CylinderGeometry(0.05, 0.055, 0.11, 24), mats.slime);
  neck.position.y = 0.05;
  return tagPart(neck, 'neck');
}
