import * as THREE from 'three';
import type { SlimeMaterials } from './materials';
import {
  extrudeCentered,
  lathe,
  mesh,
  ribbedTube,
  roundedRectShape,
  seededRandom,
  smoothLathe,
  tagPart,
} from './geometry';

/**
 * Worn gear for the Slime Agent: chunky sneakers, the backpack ink tank (glass cylinder +
 * harness back plate + corrugated hose) and the chest-strap buckle.
 *
 * Everything is procedural (no textures, no meshes). Conventions: Y up, the character faces +Z,
 * the character's own LEFT is +X; left/right pairs are mirror images (scale.x = -1), never
 * rotations. Units: the humanoid is 1.6 tall.
 */

// =============================================================================================
// small math helpers
// =============================================================================================

const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Hermite smoothstep; works with edge0 > edge1 (falling step). */
function sstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
/** Smooth box pulse: ~1 on [a, b], ~0 outside, edges softened by ±e. */
function pulse(x: number, a: number, b: number, e: number): number {
  return sstep(a - e, a + e, x) * (1 - sstep(b - e, b + e, x));
}
const spow = (v: number, p: number): number => Math.sign(v) * Math.pow(Math.abs(v), p);

/** Flip triangle winding if the mesh's signed volume (about `ref`) is negative. */
function ensureOutward(geo: THREE.BufferGeometry, ref = new THREE.Vector3()): THREE.BufferGeometry {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const idx = geo.getIndex();
  const count = idx ? idx.count : pos.count;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let vol = 0;
  const vi = (k: number): number => (idx ? idx.getX(k) : k);
  for (let k = 0; k < count; k += 3) {
    a.fromBufferAttribute(pos, vi(k)).sub(ref);
    b.fromBufferAttribute(pos, vi(k + 1)).sub(ref);
    c.fromBufferAttribute(pos, vi(k + 2)).sub(ref);
    vol += a.dot(b.cross(c));
  }
  if (vol < 0) {
    if (idx) {
      for (let k = 0; k < count; k += 3) {
        const t = idx.getX(k + 1);
        idx.setX(k + 1, idx.getX(k + 2));
        idx.setX(k + 2, t);
      }
      idx.needsUpdate = true;
    } else {
      // Swap vertices 1 and 2 of every triangle, for every attribute.
      for (const name of Object.keys(geo.attributes)) {
        const attr = geo.getAttribute(name) as THREE.BufferAttribute;
        for (let k = 0; k < attr.count; k += 3) {
          for (let d = 0; d < attr.itemSize; d++) {
            const t = attr.getComponent(k + 1, d);
            attr.setComponent(k + 1, d, attr.getComponent(k + 2, d));
            attr.setComponent(k + 2, d, t);
          }
        }
        attr.needsUpdate = true;
      }
    }
  }
  return geo;
}

/** Bake a transform into a geometry (keeps meshes at identity so later deformers see shoe space). */
function placed(
  geo: THREE.BufferGeometry,
  pos: THREE.Vector3,
  quat = new THREE.Quaternion(),
  scale = new THREE.Vector3(1, 1, 1),
): THREE.BufferGeometry {
  geo.applyMatrix4(new THREE.Matrix4().compose(pos, quat, scale));
  return geo;
}

/** Quaternion whose local +Z = `normal`, local +X ≈ `xHint` (orthogonalised). */
function frameQuat(normal: THREE.Vector3, xHint: THREE.Vector3): THREE.Quaternion {
  const z = normal.clone().normalize();
  const x = xHint.clone().addScaledVector(z, -xHint.dot(z)).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/**
 * Padded strip swept along a curve: superellipse cross-section in the (width, up) plane with
 * rounded-square ends. `up(u)` gives the cross-section's "up" (it is orthogonalised against the
 * tangent), so a strip can lie flat on a surface. Used for the tongue, laces and stripes.
 */
function padStrip(
  curve: THREE.Curve<THREE.Vector3>,
  up: (u: number) => THREE.Vector3,
  halfW: (u: number) => number,
  halfT: (u: number) => number,
  opts: { segU?: number; segV?: number; expo?: number; capLen?: number } = {},
): THREE.BufferGeometry {
  const segU = opts.segU ?? 48;
  const segV = opts.segV ?? 20;
  const expo = opts.expo ?? 3;
  const capLen = opts.capLen ?? 0.006;
  const length = curve.getLength();
  const positions: number[] = [];
  const indices: number[] = [];
  const P = new THREE.Vector3();
  const T = new THREE.Vector3();
  const N = new THREE.Vector3();
  const W = new THREE.Vector3();
  for (let i = 0; i <= segU; i++) {
    const t = i / segU;
    const u = 0.5 - 0.5 * Math.cos(Math.PI * t);
    curve.getPointAt(u, P);
    curve.getTangentAt(u, T).normalize();
    N.copy(up(u));
    N.addScaledVector(T, -N.dot(T)).normalize();
    W.crossVectors(T, N).normalize();
    const s = u * length;
    let cap = 1;
    const cl = Math.min(capLen, length * 0.45);
    if (s < cl) cap *= Math.sqrt(Math.max(0, 1 - ((cl - s) / cl) ** 2));
    if (length - s < cl) cap *= Math.sqrt(Math.max(0, 1 - ((cl - (length - s)) / cl) ** 2));
    const hw = halfW(u) * Math.pow(cap, 0.35);
    const ht = halfT(u) * cap;
    for (let j = 0; j < segV; j++) {
      const a = (j / segV) * Math.PI * 2;
      const sx = spow(Math.cos(a), 2 / expo);
      const sy = spow(Math.sin(a), 2 / expo);
      positions.push(
        P.x + W.x * hw * sx + N.x * ht * sy,
        P.y + W.y * hw * sx + N.y * ht * sy,
        P.z + W.z * hw * sx + N.z * ht * sy,
      );
    }
  }
  for (let i = 0; i < segU; i++) {
    for (let j = 0; j < segV; j++) {
      const a = i * segV + j;
      const b = (i + 1) * segV + j;
      const c = (i + 1) * segV + ((j + 1) % segV);
      const d = i * segV + ((j + 1) % segV);
      indices.push(a, b, c, a, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  // Signed volume about a point on the centre curve (strips are thin, so use the mid point).
  ensureOutward(geo, curve.getPointAt(0.5, new THREE.Vector3()));
  geo.computeVertexNormals();
  return geo;
}

// =============================================================================================
// SNEAKER
// =============================================================================================

/** Shoe-space constants (left shoe; origin on the ground under the ankle centre, toe +Z). */
const SH = {
  heelZ: -0.13,
  toeZ: 0.29,
  centreZ: 0.08,
  halfLen: 0.21,
  /** Dome (upper) ray origin: the ankle centre. */
  domeCX: 0,
  domeCZ: -0.004,
  domeInset: 0.0045,
  /** Toe spring: the whole toe lifts this much at the tip. */
  toeSpring: 0.018,
};

interface FootPt { x: number; z: number; nx: number; nz: number }

/**
 * Footprint outline (top view) as a dense closed polygon, ordered from the toe tip toward +X
 * (lateral side of the left shoe), round the heel and back up the medial (−X) side.
 */
function buildFootprint(count: number): FootPt[] {
  const raw: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < count; i++) {
    const psi = (i / count) * Math.PI * 2;
    const c = Math.cos(psi);
    const s = Math.sin(psi);
    const f = (1 + c) / 2; // 1 at the toe, 0 at the heel
    const b = lerp(0.088, 0.1, sstep(0.25, 0.75, f));
    const n = lerp(2.35, 2.75, f);
    const dz = SH.halfLen * spow(c, 2 / n);
    let x = b * spow(s, 2 / n);
    const fore = Math.max(c, 0);
    // Medial forefoot (−X, big-toe side) a touch fuller; toe tip nudged medially.
    x *= x < 0 ? 1 + 0.05 * fore * fore : 1 - 0.03 * fore * fore;
    x -= 0.006 * Math.pow(fore, 6);
    raw.push({ x, z: SH.centreZ + dz });
  }
  return raw.map((p, i) => {
    const a = raw[(i - 1 + count) % count];
    const b = raw[(i + 1) % count];
    const tx = b.x - a.x;
    const tz = b.z - a.z;
    let nx = -tz;
    let nz = tx;
    // Make sure the normal points away from the footprint centre.
    if (nx * p.x + nz * (p.z - SH.centreZ) < 0) {
      nx = -nx;
      nz = -nz;
    }
    const l = Math.hypot(nx, nz) || 1;
    return { x: p.x, z: p.z, nx: nx / l, nz: nz / l };
  });
}

interface LoftRing {
  y: (p: FootPt) => number;
  inset: number;
}

/**
 * Loft the footprint into a solid slab: each ring is the outline offset inward by `inset` (plus an
 * optional per-point `extra` offset, e.g. tread grooves) at a per-point height. Rings run bottom →
 * top; caps are fans from the footprint centre.
 */
function loftFootprint(
  poly: FootPt[],
  rings: LoftRing[],
  extra: ((x: number, z: number, y: number) => number) | null,
  capBottom: boolean,
  capTop: boolean,
): THREE.BufferGeometry {
  const n = poly.length;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const ring of rings) {
    for (const p of poly) {
      const y = ring.y(p);
      const off = ring.inset + (extra ? extra(p.x, p.z, y) : 0);
      positions.push(p.x - p.nx * off, y, p.z - p.nz * off);
    }
  }
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < n; i++) {
      const a = k * n + i;
      const b = k * n + ((i + 1) % n);
      const c = (k + 1) * n + ((i + 1) % n);
      const d = (k + 1) * n + i;
      indices.push(a, b, c, a, c, d);
    }
  }
  const capFan = (k: number, up: boolean): void => {
    let ySum = 0;
    for (let i = 0; i < n; i++) ySum += positions[(k * n + i) * 3 + 1];
    const centre = positions.length / 3;
    positions.push(0, ySum / n, SH.centreZ);
    for (let i = 0; i < n; i++) {
      const a = k * n + i;
      const b = k * n + ((i + 1) % n);
      if (up) indices.push(centre, a, b);
      else indices.push(centre, b, a);
    }
  };
  if (capBottom) capFan(0, false);
  if (capTop) capFan(rings.length - 1, true);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  const c0 = { x: 0, z: SH.centreZ, nx: 0, nz: 1 };
  const ymid = (rings[0].y(c0) + rings[rings.length - 1].y(c0)) / 2;
  ensureOutward(geo, new THREE.Vector3(0, capBottom ? ymid : rings[0].y(c0), SH.centreZ));
  geo.computeVertexNormals();
  return geo;
}

/** Midsole top height along the shoe: the heel cup rises higher than the forefoot. */
const midsoleTop = (z: number): number => 0.066 + 0.014 * sstep(0.0, -0.095, z);

/** Outsole top edge height round the perimeter: lug blocks, flush notches and the toe bumper. */
function outsoleTop(p: FootPt): number {
  const z = p.z;
  const base = 0.018;
  const lugs = Math.max(
    pulse(z, -0.5, -0.062, 0.004),
    pulse(z, -0.046, 0.03, 0.004),
    pulse(z, 0.046, 0.1, 0.004) * 0.45,
  );
  // Toe bumper: tallest dead ahead, falling away round the sides of the toe.
  const bumper = Math.pow(Math.max(p.nz, 0), 2.2) * sstep(0.12, 0.26, z);
  return base + 0.017 * lugs * (1 - bumper) + 0.03 * bumper;
}

/** Narrow vertical tread grooves cut into the outsole sidewall. */
function outsoleGrooves(_x: number, z: number, y: number): number {
  if (y > 0.03) return 0;
  let g = 0;
  for (const zc of [-0.105, -0.085, 0.072, 0.105, 0.138, 0.17]) g = Math.max(g, pulse(z, zc - 0.0025, zc + 0.0025, 0.0012));
  return 0.0035 * g;
}

/** Shoe upper ("dome") built over the midsole by rays from the ankle centre. */
class SneakerDome {
  private readonly table: Float32Array;
  private readonly samples = 1440;

  constructor(poly: FootPt[]) {
    const inset = poly.map((p) => ({ x: p.x - p.nx * SH.domeInset, z: p.z - p.nz * SH.domeInset }));
    this.table = new Float32Array(this.samples + 1);
    for (let s = 0; s <= this.samples; s++) {
      const phi = (s / this.samples) * Math.PI * 2;
      this.table[s] = SneakerDome.rayHit(inset, Math.sin(phi), Math.cos(phi));
    }
  }

  private static rayHit(poly: Array<{ x: number; z: number }>, dx: number, dz: number): number {
    let best = Infinity;
    const ox = SH.domeCX;
    const oz = SH.domeCZ;
    for (let i = 0; i < poly.length; i++) {
      const A = poly[i];
      const B = poly[(i + 1) % poly.length];
      const ex = B.x - A.x;
      const ez = B.z - A.z;
      const denom = dx * ez - dz * ex;
      if (Math.abs(denom) < 1e-12) continue;
      const ax = A.x - ox;
      const az = A.z - oz;
      const t = (ax * ez - az * ex) / denom;
      const s = (ax * dz - az * dx) / denom;
      if (s >= 0 && s <= 1 && t > 0 && t < best) best = t;
    }
    return Number.isFinite(best) ? best : 0.08;
  }

  rayLen(phi: number): number {
    let f = (phi / (Math.PI * 2)) % 1;
    if (f < 0) f += 1;
    const x = f * this.samples;
    const i = Math.floor(x);
    return lerp(this.table[i], this.table[Math.min(i + 1, this.samples)], x - i);
  }

  /**
   * Height of the dome above its base at a ground position: low toe box rising over the instep,
   * then the collar zone round the ankle (high heel counter, lower sides), a padded lip and the
   * ankle opening pit.
   */
  static height(x: number, z: number): number {
    const fore = 0.054 + 0.085 * Math.pow(sstep(0.17, -0.01, z), 2.2);
    const dx = x - SH.domeCX;
    const dz = z - SH.domeCZ;
    const r = Math.hypot(dx, dz * 0.95);
    const back = (1 - Math.cos(Math.atan2(dx, dz))) * 0.5; // 0 front, 0.5 sides, 1 back
    const rim = 0.112 + 0.016 * back * back;
    const lip = 0.006 * Math.exp(-(((r - 0.05) / 0.012) ** 2));
    const pit = 0.045 * (1 - sstep(0.028, 0.045, r));
    return lerp(rim, fore, sstep(0.0, 0.075, dz)) + lip - pit;
  }

  /** Superellipse exponent per ray: rounder toe, boxier heel counter. */
  static expo(phi: number): number {
    return 2.8 + 1.1 * (1 - Math.cos(phi)) * 0.5;
  }

  /** Point on the upper: phi = ray angle (0 → toe, +π/2 → +X), a ∈ [−·, π/2] elevation. */
  point(phi: number, a: number, out = new THREE.Vector3()): THREE.Vector3 {
    const e = SneakerDome.expo(phi);
    const L = this.rayLen(phi);
    const q = Math.pow(Math.abs(Math.cos(a)), 2 / e);
    const v = spow(Math.sin(a), 2 / e);
    const x = SH.domeCX + Math.sin(phi) * L * q;
    const z = SH.domeCZ + Math.cos(phi) * L * q;
    const y = midsoleTop(z) - 0.005 + v * SneakerDome.height(x, z);
    return out.set(x, y, z);
  }

  normal(phi: number, a: number, out = new THREE.Vector3()): THREE.Vector3 {
    const h = 1e-4;
    const p1 = this.point(phi + h, a);
    const p0 = this.point(phi - h, a);
    const q1 = this.point(phi, a + h);
    const q0 = this.point(phi, a - h);
    const dPhi = p1.sub(p0);
    const dA = q1.sub(q0);
    // Rays converge at the apex (dPhi → 0): fall back to straight up there.
    if (dPhi.lengthSq() < 1e-18 || dA.lengthSq() < 1e-18) return out.set(0, 1, 0);
    out.crossVectors(dPhi.normalize(), dA.normalize());
    if (out.lengthSq() < 1e-10) return out.set(0, 1, 0);
    return out.normalize();
  }

  pointOff(phi: number, a: number, off: number, out = new THREE.Vector3()): THREE.Vector3 {
    this.point(phi, a, out);
    if (off !== 0) out.addScaledVector(this.normal(phi, a), off);
    return out;
  }

  /** The whole upper as one smooth closed-top surface (bottom open, tucked into the midsole). */
  geometry(segPhi = 160, segA = 40): THREE.BufferGeometry {
    const a0 = -0.09;
    const a1 = Math.PI / 2;
    const positions: number[] = [];
    const indices: number[] = [];
    const p = new THREE.Vector3();
    for (let j = 0; j <= segA; j++) {
      const t = j / segA;
      // Pack rows toward the base (vertical wall) and the top.
      const a = lerp(a0, a1, t < 0.5 ? 0.5 * Math.pow(2 * t, 1.25) : 1 - 0.5 * Math.pow(2 - 2 * t, 1.1));
      for (let i = 0; i < segPhi; i++) {
        this.point((i / segPhi) * Math.PI * 2, a, p);
        positions.push(p.x, p.y, p.z);
      }
    }
    for (let j = 0; j < segA; j++) {
      for (let i = 0; i < segPhi; i++) {
        const a = j * segPhi + i;
        const b = j * segPhi + ((i + 1) % segPhi);
        const c = (j + 1) * segPhi + ((i + 1) % segPhi);
        const d = (j + 1) * segPhi + i;
        indices.push(a, b, c, a, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    ensureOutward(geo, new THREE.Vector3(SH.domeCX, midsoleTop(0) - 0.02, 0.04));
    geo.computeVertexNormals();
    // Apex ring is degenerate: give it a clean up normal.
    const nrm = geo.getAttribute('normal') as THREE.BufferAttribute;
    for (let i = 0; i < segPhi; i++) nrm.setXYZ(segA * segPhi + i, 0, 1, 0);
    return geo;
  }

  /**
   * Thin raised panel conforming to the upper over the parameter region
   * phi ∈ [phi0, phi1], a ∈ [aLo(phi), aHi(phi)], with short side walls.
   */
  panel(
    phi0: number,
    phi1: number,
    aLo: (phi: number) => number,
    aHi: (phi: number) => number,
    off = 0.0028,
    nu = 28,
    nv = 14,
  ): THREE.BufferGeometry {
    const inner = -0.0015;
    const outer: THREE.Vector3[][] = [];
    const outerN: THREE.Vector3[][] = [];
    const innerP: THREE.Vector3[][] = [];
    for (let i = 0; i <= nu; i++) {
      const phi = lerp(phi0, phi1, i / nu);
      const lo = aLo(phi);
      const hi = aHi(phi);
      const row: THREE.Vector3[] = [];
      const rowN: THREE.Vector3[] = [];
      const rowI: THREE.Vector3[] = [];
      for (let j = 0; j <= nv; j++) {
        const a = lerp(lo, hi, j / nv);
        const nn = this.normal(phi, a);
        const base = this.point(phi, a);
        row.push(base.clone().addScaledVector(nn, off));
        rowN.push(nn);
        rowI.push(base.clone().addScaledVector(nn, inner));
      }
      outer.push(row);
      outerN.push(rowN);
      innerP.push(rowI);
    }
    const pos: number[] = [];
    const nor: number[] = [];
    const pushV = (p: THREE.Vector3, n: THREE.Vector3): void => {
      pos.push(p.x, p.y, p.z);
      nor.push(n.x, n.y, n.z);
    };
    // Outer surface (smooth normals from the dome).
    const tmp = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const tri = (
      a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3,
      na: THREE.Vector3, nb: THREE.Vector3, nc: THREE.Vector3, want: THREE.Vector3,
    ): void => {
      e1.subVectors(b, a);
      e2.subVectors(c, a);
      tmp.crossVectors(e1, e2);
      if (tmp.dot(want) >= 0) {
        pushV(a, na); pushV(b, nb); pushV(c, nc);
      } else {
        pushV(a, na); pushV(c, nc); pushV(b, nb);
      }
    };
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const A = outer[i][j];
        const B = outer[i + 1][j];
        const C = outer[i + 1][j + 1];
        const D = outer[i][j + 1];
        const nA = outerN[i][j];
        const nB = outerN[i + 1][j];
        const nC = outerN[i + 1][j + 1];
        const nD = outerN[i][j + 1];
        const want = tmp.copy(nA).add(nC).clone();
        tri(A, B, C, nA, nB, nC, want);
        tri(A, C, D, nA, nC, nD, want);
      }
    }
    // Side walls round the border loop.
    const loop: Array<[number, number]> = [];
    for (let i = 0; i <= nu; i++) loop.push([i, 0]);
    for (let j = 1; j <= nv; j++) loop.push([nu, j]);
    for (let i = nu - 1; i >= 0; i--) loop.push([i, nv]);
    for (let j = nv - 1; j >= 1; j--) loop.push([0, j]);
    const centre = outer[Math.floor(nu / 2)][Math.floor(nv / 2)];
    const wn = new THREE.Vector3();
    for (let k = 0; k < loop.length; k++) {
      const [i0, j0] = loop[k];
      const [i1, j1] = loop[(k + 1) % loop.length];
      const A = outer[i0][j0];
      const B = outer[i1][j1];
      const Ai = innerP[i0][j0];
      const Bi = innerP[i1][j1];
      const want = new THREE.Vector3().addVectors(A, B).multiplyScalar(0.5).sub(centre);
      wn.crossVectors(e1.subVectors(B, A), e2.subVectors(Ai, A)).normalize();
      if (wn.dot(want) < 0) wn.negate();
      const n = wn.clone();
      tri(A, B, Bi, n, n, n, want);
      tri(A, Bi, Ai, n, n, n, want);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    return geo;
  }

  /** Smallest elevation `a` on ray `phi` at which `inside(point)` becomes false (bisection). */
  boundary(phi: number, inside: (p: THREE.Vector3) => boolean, aMin: number, aMax: number): number {
    const p = new THREE.Vector3();
    if (!inside(this.point(phi, aMin, p))) return aMin;
    if (inside(this.point(phi, aMax, p))) return aMax;
    let lo = aMin;
    let hi = aMax;
    for (let k = 0; k < 24; k++) {
      const mid = (lo + hi) / 2;
      if (inside(this.point(phi, mid, p))) lo = mid;
      else hi = mid;
    }
    return lo;
  }
}

/** Toe spring: lift the toe of every shoe mesh (positions + normals via the Jacobian). */
function applyToeSpring(geo: THREE.BufferGeometry): void {
  const z0 = 0.14;
  const z1 = SH.toeZ;
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const nrm = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const t = clamp01((z - z0) / (z1 - z0));
    const s = t * t * (3 - 2 * t);
    const lift = SH.toeSpring * s * s;
    const dsdz = (6 * t * (1 - t)) / (z1 - z0);
    const slope = SH.toeSpring * 2 * s * dsdz;
    pos.setY(i, pos.getY(i) + lift);
    if (nrm) {
      n.fromBufferAttribute(nrm, i);
      n.z -= slope * n.y;
      n.normalize();
      nrm.setXYZ(i, n.x, n.y, n.z);
    }
  }
  pos.needsUpdate = true;
  if (nrm) nrm.needsUpdate = true;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
}

/**
 * Chunky high-top-ish sneaker.
 *
 * Local origin: on the ground (y = 0 is the sole bottom) directly under the ankle centre; toe
 * toward +Z. Length ≈ 0.42 (heel z = −0.13 … toe z = +0.29), width ≈ 0.19, collar top ≈ 0.21
 * (back) with the padded tongue rising to ≈ 0.24 in front of the ankle.
 * The right shoe is the exact mirror (inner group scale.x = −1) of the left one.
 */
export function buildSneaker(mats: SlimeMaterials, side: 'left' | 'right'): THREE.Group {
  const root = new THREE.Group();
  root.name = side === 'left' ? 'sneaker-l' : 'sneaker-r';
  const body = new THREE.Group();
  body.name = `${root.name}-body`;
  if (side === 'right') body.scale.x = -1;
  root.add(body);
  const sfx = side === 'left' ? 'l' : 'r';
  // Sub-parts are tagged groups `shoe-<part>-<l|r>` (pipeline componentTree ids); built per side,
  // so the mirrored right shoe carries its own -r ids.
  const parts = new Map<string, THREE.Group>();
  const partGroup = (key: string): THREE.Group => {
    let g = parts.get(key);
    if (!g) {
      g = new THREE.Group();
      tagPart(g, `shoe-${key}-${sfx}`, root.name);
      body.add(g);
      parts.set(key, g);
    }
    return g;
  };
  const add = (key: string, name: string, geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh => {
    const m = mesh(`sneaker-${sfx}-${name}`, geo, mat);
    partGroup(key).add(m);
    return m;
  };

  const poly = buildFootprint(320);

  // ---- outsole: thin team-colour slab whose sidewall rises into lug blocks + a toe bumper
  const outsole = loftFootprint(
    poly,
    [
      { y: () => 0, inset: 0.009 },
      { y: () => 0.0022, inset: 0.0032 },
      { y: () => 0.007, inset: -0.0028 },
      { y: (p) => outsoleTop(p) - 0.0035, inset: -0.003 },
      { y: (p) => outsoleTop(p), inset: 0.0012 },
    ],
    outsoleGrooves,
    true,
    true,
  );
  add('outsole', 'outsole', outsole, mats.rubberInk);

  // ---- midsole: thick white slab, slight bulge, a crease line and a rounded top edge
  const top = (p: FootPt): number => midsoleTop(p.z);
  const midsole = loftFootprint(
    poly,
    [
      { y: () => 0.009, inset: 0.006 },
      { y: () => 0.016, inset: 0.0008 },
      { y: () => 0.034, inset: 0.0 },
      { y: () => 0.0395, inset: 0.0022 },
      { y: () => 0.0455, inset: -0.0035 },
      { y: (p) => top(p) - 0.013, inset: -0.0042 },
      { y: (p) => top(p) - 0.0045, inset: 0.0015 },
      { y: (p) => top(p) - 0.0008, inset: 0.008 },
      { y: (p) => top(p), inset: 0.014 },
    ],
    null,
    false,
    true,
  );
  add('midsole', 'midsole', midsole, mats.rubberWhite);

  // ---- upper: puffy black dome rising from a low toe box to the high padded collar
  const dome = new SneakerDome(poly);
  add('upper', 'upper', dome.geometry(), mats.rubberBlack);

  const deg = Math.PI / 180;

  // White toe cap: covers the front of the toe box; its back edge slants up and back.
  {
    // Lower-front only: near-vertical edge at the base sweeping forward over the toe (side.png).
    const zCut = (y: number): number => 0.155 + 0.115 * Math.pow(Math.max(0, y - 0.061) / 0.04, 1.8);
    const inside = (p: THREE.Vector3): boolean => p.z > zCut(p.y);
    const phiMax = 62 * deg;
    const geo = dome.panel(
      -phiMax,
      phiMax,
      () => -0.14,
      (phi) => dome.boundary(phi, inside, -0.14, Math.PI / 2 - 0.02),
      0.0045,
      48,
      22,
    );
    add('upper', 'toe-cap', geo, mats.whitePlastic);
  }

  // Team-colour side panels (both sides), low on the quarter just above the midsole.
  for (const sgn of [1, -1]) {
    const p0 = sgn > 0 ? 48 * deg : -78 * deg;
    const p1 = sgn > 0 ? 78 * deg : -48 * deg;
    const geo = dome.panel(
      p0,
      p1,
      () => 0.03,
      (phi) => 0.2 + 0.05 * clamp01((Math.abs(phi) - 48 * deg) / (30 * deg)),
      0.0034,
      16,
      10,
    );
    add('panel', sgn > 0 ? 'panel-lateral' : 'panel-medial', geo, mats.rubberInk);
  }

  // White diagonal quarter stripe near the heel (both sides).
  for (const sgn of [1, -1]) {
    const pts: THREE.Vector3[] = [];
    const ups: THREE.Vector3[] = [];
    const n = 12;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const phi = sgn * lerp(156 * deg, 112 * deg, t);
      const a = lerp(0.52, 0.17, t);
      pts.push(dome.pointOff(phi, a, 0.0015));
      ups.push(dome.normal(phi, a));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = padStrip(
      curve,
      (u) => ups[Math.min(n, Math.round(u * n))].clone(),
      () => 0.0072,
      () => 0.0032,
      { segU: 24, segV: 12, expo: 3, capLen: 0.006 },
    );
    add('upper', sgn > 0 ? 'stripe-lateral' : 'stripe-medial', geo, mats.whitePlastic);
  }

  // White band round the heel counter just under the collar.
  {
    const pts: THREE.Vector3[] = [];
    const ups: THREE.Vector3[] = [];
    const n = 16;
    for (let k = 0; k <= n; k++) {
      const phi = lerp(144 * deg, 216 * deg, k / n);
      const a = dome.boundary(phi, (p) => p.y < 0.16, 0, 1.0);
      pts.push(dome.pointOff(phi, a, 0.0012));
      ups.push(dome.normal(phi, a));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = padStrip(
      curve,
      (u) => ups[Math.min(n, Math.round(u * n))].clone(),
      () => 0.0085,
      () => 0.003,
      { segU: 24, segV: 12, expo: 3, capLen: 0.008 },
    );
    add('collar-trim', 'heel-band', geo, mats.whitePlastic);
  }

  // Heel pull tab (team colour) at the top of the heel.
  {
    const geo = extrudeCentered(roundedRectShape(0.026, 0.034, 0.008), 0.006, 0.002, 8);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.25, 0, 0));
    placed(geo, new THREE.Vector3(SH.domeCX, 0.214, SH.domeCZ - 0.071), q);
    add('heel-tab', 'heel-tab', geo, mats.rubberInk);
  }

  // Padded collar roll riding the lip of the ankle opening.
  {
    const pts: THREE.Vector3[] = [];
    const n = 64;
    for (let k = 0; k < n; k++) {
      const phi = (k / n) * Math.PI * 2;
      const L = dome.rayLen(phi);
      const q = clamp01(0.05 / L);
      const a = Math.acos(Math.pow(q, SneakerDome.expo(phi) / 2));
      pts.push(dome.point(phi, a).add(new THREE.Vector3(0, -0.0055, 0)));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    add('collar', 'collar', new THREE.TubeGeometry(curve, 128, 0.0165, 14, true), mats.nylon);
  }

  // Collar badges (both sides): team-colour rounded square with a dark centre.
  for (const sgn of [1, -1]) {
    const phi = sgn * 74 * deg;
    const a = 0.72;
    const nrm = dome.normal(phi, a);
    const p = dome.pointOff(phi, a, 0.001);
    const q = frameQuat(nrm, new THREE.Vector3(0, 0, -sgn));
    const badge = placed(extrudeCentered(roundedRectShape(0.024, 0.022, 0.007), 0.003, 0.0012, 8), p, q);
    add('panel', sgn > 0 ? 'badge-lateral' : 'badge-medial', badge, mats.rubberInk);
    const dotGeo = new THREE.CylinderGeometry(0.0052, 0.0052, 0.002, 16).rotateX(Math.PI / 2);
    const dot = placed(dotGeo, p.clone().addScaledVector(nrm, 0.0034), q);
    add('panel', sgn > 0 ? 'badge-lateral-dot' : 'badge-medial-dot', dot, mats.blackPlastic);
  }

  // Tongue: tall padded tongue (white padding, black centre panel, team-colour label).
  const domeTop = (z: number): number => {
    // Height of the upper on the centre line (x = 0) at z (z > dome centre).
    const L = dome.rayLen(0);
    const q = clamp01((z - SH.domeCZ) / L);
    const e = SneakerDome.expo(0);
    const a = Math.acos(Math.pow(q, e / 2));
    return dome.point(0, a).y;
  };
  const tongueCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, domeTop(0.168) + 0.003, 0.168),
    new THREE.Vector3(0, domeTop(0.125) + 0.006, 0.125),
    new THREE.Vector3(0, domeTop(0.085) + 0.008, 0.085),
    new THREE.Vector3(0, 0.172, 0.066),
    new THREE.Vector3(0, 0.206, 0.0605),
    new THREE.Vector3(0, 0.236, 0.059),
  ], false, 'centripetal');
  const tongueUp = (u: number): THREE.Vector3 => {
    const T = tongueCurve.getTangentAt(u);
    return new THREE.Vector3(1, 0, 0).cross(T).normalize();
  };
  const tongueHalfT = (u: number): number => lerp(0.0095, 0.0185, sstep(0.45, 1.0, u));
  {
    const geo = padStrip(
      tongueCurve,
      tongueUp,
      (u) => lerp(0.036, 0.043, sstep(0.0, 0.6, u)),
      tongueHalfT,
      { segU: 56, segV: 24, expo: 3.4, capLen: 0.014 },
    );
    add('tongue', 'tongue', geo, mats.whitePlastic);

    // Black centre panel on the tongue's front face, leaving a white padded border.
    const panelPts: THREE.Vector3[] = [];
    for (let k = 0; k <= 16; k++) {
      const u = lerp(0.3, 0.955, k / 16);
      panelPts.push(tongueCurve.getPointAt(u).addScaledVector(tongueUp(u), tongueHalfT(u) - 0.004));
    }
    const panelCurve = new THREE.CatmullRomCurve3(panelPts);
    const panel = padStrip(
      panelCurve,
      (u) => tongueUp(lerp(0.3, 0.955, u)),
      () => 0.03,
      () => 0.0072,
      { segU: 36, segV: 20, expo: 4, capLen: 0.01 },
    );
    add('tongue', 'tongue-panel', panel, mats.blackPlastic);

    // Team-colour label near the top of the tongue.
    const uL = 0.86;
    const pL = tongueCurve.getPointAt(uL).addScaledVector(tongueUp(uL), tongueHalfT(uL) + 0.0042);
    const qL = frameQuat(tongueUp(uL), new THREE.Vector3(1, 0, 0));
    const label = placed(extrudeCentered(roundedRectShape(0.026, 0.017, 0.004), 0.002, 0.001, 6), pL, qL);
    add('tongue', 'tongue-label', label, mats.rubberInk);
  }

  // Eyestays (team colour) either side of the lacing, then white laces across the tongue.
  for (const sgn of [1, -1]) {
    const pts: THREE.Vector3[] = [];
    const ups: THREE.Vector3[] = [];
    const n = 10;
    for (let k = 0; k <= n; k++) {
      const u = lerp(0.04, 0.6, k / n);
      const up = tongueUp(u);
      pts.push(tongueCurve.getPointAt(u).addScaledVector(up, -0.0055).add(new THREE.Vector3(sgn * 0.047, 0, 0)));
      ups.push(up.clone().add(new THREE.Vector3(sgn * 0.45, 0, 0)).normalize());
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const geo = padStrip(
      curve,
      (u) => ups[Math.min(n, Math.round(u * n))].clone(),
      () => 0.0085,
      () => 0.0065,
      { segU: 24, segV: 12, expo: 3, capLen: 0.008 },
    );
    add('panel', sgn > 0 ? 'eyestay-lateral' : 'eyestay-medial', geo, mats.rubberInk);
  }
  {
    const laceUs = [0.1, 0.235, 0.37, 0.505];
    laceUs.forEach((u, k) => {
      const up = tongueUp(u);
      const c = tongueCurve.getPointAt(u).addScaledVector(up, tongueHalfT(u) + 0.003);
      const half = 0.053 - k * 0.002;
      const sag = 0.0105;
      const curve = new THREE.QuadraticBezierCurve3(
        c.clone().add(new THREE.Vector3(-half, 0, 0)).addScaledVector(up, -sag),
        c.clone().addScaledVector(up, 0.006),
        c.clone().add(new THREE.Vector3(half, 0, 0)).addScaledVector(up, -sag),
      );
      const geo = padStrip(curve, () => up.clone(), () => 0.0068, () => 0.0034, {
        segU: 24, segV: 12, expo: 3, capLen: 0.004,
      });
      add(`lace-${k + 1}`, `lace-${k + 1}`, geo, mats.cotton);
    });
  }

  // Toe spring over everything (shoe space, before the mirror).
  body.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) applyToeSpring(m.geometry);
  });

  tagPart(root, side === 'left' ? 'sneaker-l' : 'sneaker-r');
  return root;
}

// =============================================================================================
// INK TANK + HARNESS FRAME + HOSE
// =============================================================================================

/** Rounded-rectangle hole path centred at (cx, cy). */
function rectHole(w: number, h: number, r: number, cx: number, cy: number): THREE.Path {
  const p = new THREE.Path();
  const x = cx - w / 2;
  const y = cy - h / 2;
  const rr = Math.min(r, w / 2, h / 2);
  p.moveTo(x + rr, y);
  p.lineTo(x + w - rr, y);
  p.quadraticCurveTo(x + w, y, x + w, y + rr);
  p.lineTo(x + w, y + h - rr);
  p.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  p.lineTo(x + rr, y + h);
  p.quadraticCurveTo(x, y + h, x, y + h - rr);
  p.lineTo(x, y + rr);
  p.quadraticCurveTo(x, y, x + rr, y);
  return p;
}

/** Orient a +Y-axis primitive along `dir`, centred at `at`. */
function alongDir(geo: THREE.BufferGeometry, at: THREE.Vector3, dir: THREE.Vector3): THREE.BufferGeometry {
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return placed(geo, at, q);
}

/** Tank layout (mount-local). */
const TK = {
  /** Tank axis z (behind the back plate). */
  z: -0.108,
  r: 0.07,
  glassHalf: 0.125,
  bandY: 0.104,
  plateW: 0.2,
  plateH: 0.3,
  plateT: 0.03,
  /** Bottom of the lower fitting (hose exit). */
  fittingY: -0.186,
};

/**
 * Backpack ink tank rig. Local origin: the mount point on the upper back = centre of the back
 * plate's FRONT face (z = 0 touches the jacket); the tank hangs behind it toward −Z, +Y up.
 * Children (each tagged): `ink-tank` (glass + liquid + caps + bands), `tank-harness-frame`
 * (plate, rails, clamp brackets), `tank-hose` (corrugated hose ending at the right hip at
 * ≈ (−0.17, −0.24, +0.02)).
 */
export function buildInkTank(mats: SlimeMaterials): THREE.Group {
  const root = new THREE.Group();
  root.name = 'ink-tank-rig';

  // ------------------------------------------------------------------ tank
  const tank = new THREE.Group();
  tank.name = 'ink-tank';
  tank.position.set(0, 0, TK.z);
  root.add(tank);
  const R = TK.r;

  // Liquid first (opaque-ish, inside), then the glass shell.
  const liquidTop = 0.08;
  const liquid = lathe([
    [0.0001, -0.119], [0.0635, -0.119], [0.0645, -0.114], [0.0645, liquidTop - 0.004],
    [0.0625, liquidTop], [0.0001, liquidTop],
  ], 48);
  const liquidMesh = mesh('ink-liquid', liquid, mats.inkLiquid);
  // Drawn after the (depth-write-free) glass so the ink keeps its saturated sheet colour.
  liquidMesh.renderOrder = 2;
  tank.add(liquidMesh);
  // Meniscus ring: a thin brighter lip where the liquid meets the glass.
  const meniscus = new THREE.TorusGeometry(0.0632, 0.0022, 8, 48).rotateX(Math.PI / 2).translate(0, liquidTop - 0.0015, 0);
  tank.add(mesh('ink-meniscus', meniscus, mats.inkLiquid));

  const rnd = seededRandom(4021);
  // Bubbles: small pale beads floating in the ink (read as the sheet's white dots).
  for (let i = 0; i < 11; i++) {
    const r = 0.0018 + rnd() * 0.0032;
    const ang = rnd() * Math.PI * 2;
    const rad = 0.03 + rnd() * 0.03;
    const y = -0.105 + rnd() * 0.17;
    const b = new THREE.SphereGeometry(r, 10, 8).translate(Math.sin(ang) * rad, y, Math.cos(ang) * rad);
    tank.add(mesh(`ink-bubble-${i + 1}`, b, mats.whitePlastic));
  }

  const glass = new THREE.CylinderGeometry(R, R, TK.glassHalf * 2, 56, 1, true);
  const glassMesh = mesh('tank-glass', glass, mats.glass);
  glassMesh.renderOrder = 1;
  glassMesh.castShadow = false;
  tank.add(glassMesh);

  // Metal bands near each end of the glass (two-tone: a dark groove in the middle).
  const bandProfile = (h: number): Array<[number, number]> => [
    [0.0702, -h], [0.0748, -h], [0.0762, -h + 0.002], [0.0764, -0.0045], [0.0748, -0.003],
    [0.0748, 0.003], [0.0764, 0.0045], [0.0762, h - 0.002], [0.0748, h], [0.0702, h],
    [0.0702, -h],
  ];
  for (const sgn of [1, -1]) {
    const band = lathe(bandProfile(sgn > 0 ? 0.019 : 0.0165), 56).translate(0, sgn * TK.bandY, 0);
    tank.add(mesh(sgn > 0 ? 'tank-band-top' : 'tank-band-bottom', band, mats.metal));
    const groove = new THREE.CylinderGeometry(0.0751, 0.0751, 0.0062, 56, 1, true).translate(0, sgn * TK.bandY, 0);
    tank.add(mesh(sgn > 0 ? 'tank-band-top-groove' : 'tank-band-bottom-groove', groove, mats.blackPlastic));
  }

  // Top cap: black dome with a neck, a metal collar and a small valve nub.
  const topCap = smoothLathe([
    [0.0738, 0.114], [0.0744, 0.126], [0.0722, 0.142], [0.064, 0.156], [0.05, 0.166], [0.034, 0.171], [0.0001, 0.172],
  ], 28, 56);
  tank.add(mesh('tank-cap-top', topCap, mats.blackPlastic));
  tank.add(mesh('tank-cap-top-inner', new THREE.CircleGeometry(0.0702, 48).rotateX(Math.PI / 2).translate(0, TK.glassHalf - 0.004, 0), mats.blackPlastic));
  const neck = lathe([
    [0.0001, 0.166], [0.027, 0.166], [0.028, 0.172], [0.028, 0.199], [0.026, 0.205], [0.016, 0.208], [0.0001, 0.2085],
  ], 40);
  tank.add(mesh('tank-neck', neck, mats.blackPlastic));
  const collar = lathe([
    [0.029, 0.17], [0.0325, 0.1705], [0.0335, 0.1745], [0.0325, 0.1785], [0.029, 0.179],
  ], 40);
  tank.add(mesh('tank-neck-ring', collar, mats.metal));
  const valve = alongDir(new THREE.CylinderGeometry(0.0075, 0.0085, 0.022, 16), new THREE.Vector3(0.033, 0.19, 0), new THREE.Vector3(1, 0, 0));
  tank.add(mesh('tank-valve', valve, mats.blackPlastic));
  const valveKnob = alongDir(new THREE.CylinderGeometry(0.0105, 0.0105, 0.006, 20), new THREE.Vector3(0.045, 0.19, 0), new THREE.Vector3(1, 0, 0));
  tank.add(mesh('tank-valve-knob', valveKnob, mats.metal));

  // Bottom cap + fitting.
  const botCap = smoothLathe([
    [0.0001, -0.164], [0.042, -0.164], [0.056, -0.158], [0.067, -0.147], [0.0732, -0.132], [0.0744, -0.122], [0.0738, -0.114],
  ], 28, 56);
  tank.add(mesh('tank-cap-bottom', botCap, mats.blackPlastic));
  tank.add(mesh('tank-cap-bottom-inner', new THREE.CircleGeometry(0.0702, 48).rotateX(-Math.PI / 2).translate(0, -TK.glassHalf + 0.004, 0), mats.blackPlastic));
  const fitting = lathe([
    [0.0001, -0.16], [0.04, -0.16], [0.042, -0.164], [0.042, -0.18], [0.039, -0.184], [0.024, TK.fittingY], [0.0001, TK.fittingY],
  ], 40);
  tank.add(mesh('tank-fitting', fitting, mats.blackPlastic));
  tagPart(tank, 'ink-tank');

  // ------------------------------------------------------------------ harness frame
  const frame = new THREE.Group();
  frame.name = 'tank-harness-frame';
  root.add(frame);
  {
    const bevel = 0.004;
    const shape = roundedRectShape(TK.plateW - 2 * bevel, TK.plateH - 2 * bevel, 0.03);
    // Strap slots in the four corners (the harness webbing threads through them).
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) shape.holes.push(rectHole(0.036, 0.011, 0.004, sx * 0.058, sy * 0.122));
    }
    const plate = extrudeCentered(shape, TK.plateT - 2 * bevel, bevel, 10).translate(0, 0, -TK.plateT / 2);
    frame.add(mesh('tank-back-plate', plate, mats.blackPlastic));
    // Side rails along the plate's back edges.
    for (const sx of [-1, 1]) {
      const rail = new THREE.CapsuleGeometry(0.0105, 0.235, 6, 14).translate(sx * 0.086, 0, -TK.plateT - 0.004);
      frame.add(mesh(sx > 0 ? 'tank-rail-l' : 'tank-rail-r', rail, mats.rubberBlack));
    }
    // Clamp brackets: metal half-bands round the tank on the plate side + a mount block each.
    for (const y of [0.066, -0.066]) {
      const clamp = lathe([
        [0.0703, -0.0085], [0.0772, -0.0085], [0.0785, -0.0065], [0.0785, 0.0065], [0.0772, 0.0085],
        [0.0703, 0.0085], [0.0703, -0.0085],
      ], 40, -1.1, 2.2).translate(0, y, TK.z);
      frame.add(mesh(y > 0 ? 'tank-bracket-top' : 'tank-bracket-bottom', clamp, mats.metal));
      const blockShape = roundedRectShape(0.066, 0.036, 0.006);
      const blockDepth = Math.abs(TK.z + R - 0.002 + TK.plateT) + 0.006;
      const block = extrudeCentered(blockShape, blockDepth - 0.004, 0.002, 6)
        .translate(0, y, -TK.plateT - blockDepth / 2 + 0.003);
      frame.add(mesh(y > 0 ? 'tank-bracket-top-block' : 'tank-bracket-bottom-block', block, mats.blackPlastic));
      for (const sx of [-1, 1]) {
        const bolt = alongDir(new THREE.CylinderGeometry(0.0045, 0.0045, 0.006, 12),
          new THREE.Vector3(sx * 0.022, y, -TK.plateT - blockDepth + 0.004), new THREE.Vector3(0, 0, -1));
        frame.add(mesh(`tank-bracket-bolt-${y > 0 ? 't' : 'b'}${sx > 0 ? 'l' : 'r'}`, bolt, mats.metal));
      }
    }
  }
  tagPart(frame, 'tank-harness-frame');

  // ------------------------------------------------------------------ hose
  const hose = new THREE.Group();
  hose.name = 'tank-hose';
  root.add(hose);
  {
    const z0 = TK.z;
    const pts = [
      new THREE.Vector3(0, TK.fittingY + 0.004, z0),
      new THREE.Vector3(0, TK.fittingY - 0.026, z0 + 0.001),
      new THREE.Vector3(-0.026, -0.262, z0 + 0.01),
      new THREE.Vector3(-0.085, -0.29, -0.085),
      new THREE.Vector3(-0.15, -0.281, -0.07),
      new THREE.Vector3(-0.198, -0.24, -0.051),
      new THREE.Vector3(-0.212, -0.186, -0.032),
      new THREE.Vector3(-0.2, -0.164, -0.012),
      new THREE.Vector3(-0.182, -0.188, 0.006),
      new THREE.Vector3(-0.172, -0.224, 0.016),
      new THREE.Vector3(-0.17, -0.24, 0.02),
    ];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const len = curve.getLength();
    const ribs = Math.round(len / 0.0135);
    const geo = ribbedTube(curve, 0.018, ribs, 0.2, { radialSegments: 14 });
    hose.add(mesh('tank-hose-tube', geo, mats.rubberBlack));
    // Ferrules at both ends.
    const t0 = curve.getTangentAt(0);
    const startFerrule = alongDir(new THREE.CylinderGeometry(0.0215, 0.0215, 0.016, 24), curve.getPointAt(0).addScaledVector(t0, 0.004), t0);
    hose.add(mesh('tank-hose-ferrule-top', startFerrule, mats.metal));
    const t1 = curve.getTangentAt(1);
    const endFerrule = alongDir(new THREE.CylinderGeometry(0.023, 0.023, 0.02, 24), curve.getPointAt(1).addScaledVector(t1, -0.006), t1);
    hose.add(mesh('tank-hose-ferrule-hip', endFerrule, mats.blackPlastic));
    const endRing = alongDir(new THREE.CylinderGeometry(0.0245, 0.0245, 0.006, 24), curve.getPointAt(1).addScaledVector(t1, -0.017), t1);
    hose.add(mesh('tank-hose-ferrule-hip-ring', endRing, mats.metal));
  }
  tagPart(hose, 'tank-hose');

  return root;
}

/**
 * Silver chest-strap buckle (tri-glide style: rectangular frame with two strap slots).
 * ≈ 0.045 wide × 0.035 tall × 0.007 thick, centred on the origin, face toward +Z.
 */
export function buildHarnessBuckle(mats: SlimeMaterials): THREE.Group {
  const g = new THREE.Group();
  g.name = 'harness-buckle';
  const bevel = 0.0012;
  const shape = roundedRectShape(0.045 - 2 * bevel, 0.035 - 2 * bevel, 0.0055);
  shape.holes.push(rectHole(0.031, 0.0075, 0.0028, 0, 0.0068));
  shape.holes.push(rectHole(0.031, 0.0075, 0.0028, 0, -0.0068));
  const geo = extrudeCentered(shape, 0.007 - 2 * bevel, bevel, 10);
  g.add(mesh('harness-buckle-frame', geo, mats.metal));
  return g;
}
