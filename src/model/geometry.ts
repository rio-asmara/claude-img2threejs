import * as THREE from 'three';

/**
 * Deterministic procedural geometry helpers shared by the Slime Agent factories.
 * Everything here is code-only: no textures, no downloaded meshes.
 */

/** Deterministic PRNG (mulberry32) so every build of the model is identical. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Lathe around +Y from a list of [radius, y] pairs (bottom → top).
 * `phiStart`/`phiLength` follow THREE.LatheGeometry (phi = 0 points at +Z).
 */
export function lathe(
  profile: Array<[number, number]>,
  segments = 32,
  phiStart = 0,
  phiLength = Math.PI * 2,
): THREE.LatheGeometry {
  const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y));
  // LatheGeometry faces outward only for profiles ordered bottom → top; normalise so a
  // profile authored top → bottom (e.g. hanging from a hip joint) is not inside-out.
  if (pts.length > 1 && pts[0].y > pts[pts.length - 1].y) pts.reverse();
  return new THREE.LatheGeometry(pts, segments, phiStart, phiLength);
}

/**
 * Open-front lathe whose front gap varies with height (`gapAt(y)` radians, centred on +Z): an
 * A-shaped jacket opening that is narrow under the collar and wide at the hem. Same vertex and
 * winding layout as THREE.LatheGeometry, so it faces outward for a bottom → top profile.
 */
export function variableGapLathe(
  profile: Array<[number, number]>,
  segments: number,
  gapAt: (y: number) => number,
): THREE.BufferGeometry {
  const pts = profile[0][1] > profile[profile.length - 1][1] ? [...profile].reverse() : profile;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const n = pts.length;
  for (let i = 0; i <= segments; i++) {
    for (let j = 0; j < n; j++) {
      const [r, y] = pts[j];
      const gap = gapAt(y);
      const phi = gap / 2 + (i / segments) * (Math.PI * 2 - gap);
      positions.push(Math.max(r, 1e-4) * Math.sin(phi), y, Math.max(r, 1e-4) * Math.cos(phi));
      uvs.push(i / segments, j / (n - 1));
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < n - 1; j++) {
      const a = j + i * n;
      const b = j + (i + 1) * n;
      const c = j + 1 + (i + 1) * n;
      const d = j + 1 + i * n;
      indices.push(a, b, d, c, d, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Smoothly resample a coarse [r, y] profile with a Catmull-Rom spline. */
export function smoothProfile(profile: Array<[number, number]>, samples = 32): Array<[number, number]> {
  const curve = new THREE.CatmullRomCurve3(profile.map(([r, y]) => new THREE.Vector3(r, y, 0)), false, 'centripetal');
  return curve.getPoints(samples).map((p) => [p.x, p.y] as [number, number]);
}

/** Lathe a smoothed profile. */
export function smoothLathe(
  profile: Array<[number, number]>,
  samples = 32,
  segments = 32,
  phiStart = 0,
  phiLength = Math.PI * 2,
): THREE.LatheGeometry {
  return lathe(smoothProfile(profile, samples), segments, phiStart, phiLength);
}

export interface TaperedTubeOptions {
  tubularSegments?: number;
  radialSegments?: number;
  /** Close the start / end with a rounded (hemispherical) cap. */
  capStart?: boolean;
  capEnd?: boolean;
  /** Elliptical cross-section: radius multiplier along the curve normal / binormal. */
  squashN?: number;
  squashB?: number;
}

/**
 * Tube along a curve whose radius varies along its length (`radius(u)`, u ∈ [0,1]).
 * Rounded caps shrink the radius with a circular profile over one radius of arc length,
 * so blobs (slime locks, drips, hose ends) read as continuous closed surfaces.
 */
export function taperedTube(
  curve: THREE.Curve<THREE.Vector3>,
  radius: (u: number) => number,
  opts: TaperedTubeOptions = {},
): THREE.BufferGeometry {
  const tubular = opts.tubularSegments ?? 48;
  const radial = opts.radialSegments ?? 16;
  const capStart = opts.capStart ?? true;
  const capEnd = opts.capEnd ?? true;
  const sqN = opts.squashN ?? 1;
  const sqB = opts.squashB ?? 1;
  const length = curve.getLength();
  const frames = curve.computeFrenetFrames(tubular, false);

  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();

  for (let i = 0; i <= tubular; i++) {
    // Cosine spacing packs rings near the ends so the round caps stay smooth.
    const t = i / tubular;
    const u = capStart || capEnd ? 0.5 - 0.5 * Math.cos(Math.PI * t) : t;
    curve.getPointAt(u, p);
    const fi = Math.min(tubular, Math.round(u * tubular));
    const N = frames.normals[fi];
    const B = frames.binormals[fi];
    let r = radius(u);
    const s = u * length;
    if (capStart) {
      const r0 = Math.max(radius(0), 1e-4);
      if (s < r0) r *= Math.sqrt(Math.max(0, 1 - ((r0 - s) / r0) ** 2));
    }
    if (capEnd) {
      const r1 = Math.max(radius(1), 1e-4);
      const se = length - s;
      if (se < r1) r *= Math.sqrt(Math.max(0, 1 - ((r1 - se) / r1) ** 2));
    }
    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * Math.PI * 2;
      const c = -Math.cos(v);
      const sn = Math.sin(v);
      n.set(0, 0, 0).addScaledVector(N, c * sqN).addScaledVector(B, sn * sqB);
      positions.push(p.x + r * n.x, p.y + r * n.y, p.z + r * n.z);
      uvs.push(t, j / radial);
    }
  }
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = (i + 1) * (radial + 1) + j;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

/** Corrugated hose: a constant-radius tube with sinusoidal ribs along its length. */
export function ribbedTube(
  curve: THREE.Curve<THREE.Vector3>,
  radius: number,
  ribCount: number,
  ribDepth = 0.18,
  opts: TaperedTubeOptions = {},
): THREE.BufferGeometry {
  return taperedTube(
    curve,
    (u) => radius * (1 - ribDepth * 0.5 + ribDepth * 0.5 * Math.cos(u * ribCount * Math.PI * 2)),
    { tubularSegments: Math.max(64, ribCount * 8), radialSegments: 12, capStart: false, capEnd: false, ...opts },
  );
}

/**
 * Teardrop hanging along -Y: round bulb of radius `bulb` at the bottom, tapering to a
 * thin neck at the top. Origin sits at the top (attachment point).
 */
export function teardrop(bulb: number, length: number, neck = 0.25, segments = 20): THREE.BufferGeometry {
  const pts: Array<[number, number]> = [];
  const steps = 18;
  // Bulb: lower hemisphere.
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * (Math.PI / 2);
    pts.push([Math.sin(a) * bulb, -length + bulb - Math.cos(a) * bulb]);
  }
  // Taper toward the neck at the top.
  const taperSteps = 14;
  for (let i = 1; i <= taperSteps; i++) {
    const t = i / taperSteps;
    const r = bulb * (neck + (1 - neck) * Math.pow(1 - t, 1.4));
    pts.push([r, -length + bulb + t * (length - bulb)]);
  }
  pts.push([1e-4, 0]);
  return lathe(pts, segments);
}

/** Rounded-rectangle 2D shape centred on the origin. */
export function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  const rr = Math.min(r, w / 2, h / 2);
  s.moveTo(x + rr, y);
  s.lineTo(x + w - rr, y);
  s.quadraticCurveTo(x + w, y, x + w, y + rr);
  s.lineTo(x + w, y + h - rr);
  s.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  s.lineTo(x + rr, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - rr);
  s.lineTo(x, y + rr);
  s.quadraticCurveTo(x, y, x + rr, y);
  return s;
}

/** Rounded-rectangle path (for holes). */
export function roundedRectPath(w: number, h: number, r: number): THREE.Path {
  const shape = roundedRectShape(w, h, r);
  const path = new THREE.Path();
  path.curves = shape.curves;
  return path;
}

/** Extrude a shape centred on z = 0 (depth along +Z), with an optional bevel. */
export function extrudeCentered(
  shape: THREE.Shape,
  depth: number,
  bevel = 0,
  curveSegments = 12,
): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: bevel > 0 ? 4 : 0,
    curveSegments,
  });
  geo.translate(0, 0, -depth / 2);
  return geo;
}

/**
 * Wrap geometry authored in the XY plane (facing +Z) around a vertical cylinder of
 * radius `R` whose axis passes through the origin: x becomes arc length. The result
 * sits on the +Z side of the axis, so a goggle authored flat hugs a round head.
 */
export function bendAroundY(geo: THREE.BufferGeometry, R: number): THREE.BufferGeometry {
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const a = x / R;
    const rr = R + z;
    pos.setXYZ(i, rr * Math.sin(a), pos.getY(i), rr * Math.cos(a));
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** Irregular closed blob outline (puddles, splats): radius modulated by seeded sines. */
export function blobShape(baseRadius: number, seed: number, lobes = 7, wobble = 0.22, points = 96): THREE.Shape {
  const rnd = seededRandom(seed);
  const terms = Array.from({ length: 4 }, (_, k) => ({
    freq: lobes - 2 + k * 2 + Math.floor(rnd() * 2),
    amp: wobble * (0.6 + rnd() * 0.6) / (k + 1),
    phase: rnd() * Math.PI * 2,
  }));
  const shape = new THREE.Shape();
  for (let i = 0; i <= points; i++) {
    const a = (i / points) * Math.PI * 2;
    let r = 1;
    for (const t of terms) r += t.amp * Math.sin(a * t.freq + t.phase);
    const x = Math.cos(a) * baseRadius * r;
    const y = Math.sin(a) * baseRadius * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  return shape;
}

/** Point on an ellipsoid from (azimuth, polar) angles; azimuth 0 = +Z, polar 0 = +Y. */
export function ellipsoidPoint(
  rx: number, ry: number, rz: number, azimuth: number, polar: number, out = new THREE.Vector3(),
): THREE.Vector3 {
  return out.set(
    rx * Math.sin(polar) * Math.sin(azimuth),
    ry * Math.cos(polar),
    rz * Math.sin(polar) * Math.cos(azimuth),
  );
}

/** Create a mesh with shadows enabled and a part name. */
export function mesh(name: string, geo: THREE.BufferGeometry, mat: THREE.Material): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/**
 * Mark an object as a named, selectable, explodable part of the model. The viewer's
 * part-manifest dump (for forge/stage4_review/check_part_coverage.py) lists every object
 * carrying `userData.img2Part`; meshes under it count as integral meshes of that part.
 * `id` must match a componentTree id in pipeline/object-sculpt-spec.json.
 */
export function tagPart<T extends THREE.Object3D>(obj: T, id: string, module = id): T {
  obj.name = obj.name || id;
  obj.userData.img2Part = { id, module };
  return obj;
}

/** A named pivot group positioned at `pos`. */
export function pivot(name: string, x = 0, y = 0, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  return g;
}

export interface ToonOutlineOptions {
  /** Object-space push along vertex normals (≈ the sheet's 2 px line weight at review size). */
  thickness?: number;
  color?: number;
  /** Skip meshes whose material is transparent (glass, liquid) or whose name matches. */
  skip?: RegExp;
}

/**
 * Inverted-hull ink outline, matching the line-art style of the character sheet. Every opaque
 * mesh gets a child that shares its geometry, renders back faces only in flat ink colour and is
 * expanded along its normals in the vertex shader (no geometry is duplicated). Outline meshes are
 * flagged `isOutline` + `explodeWithParent`, so part manifests and pickers ignore them.
 */
export function addToonOutline(root: THREE.Object3D, opts: ToonOutlineOptions = {}): THREE.Material {
  const thickness = opts.thickness ?? 0.0042;
  const mat = new THREE.MeshBasicMaterial({ color: opts.color ?? 0x0d1012, side: THREE.BackSide });
  mat.name = 'toon-outline';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.outlineThickness = { value: thickness };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float outlineThickness;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += normalize(normal) * outlineThickness;');
  };
  // `normal` is always declared as an attribute in three's vertex prefix (objectNormal is not:
  // MeshBasicMaterial only computes it with an env map or skinning).
  const targets: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || m.userData.isOutline) return;
    const materials = Array.isArray(m.material) ? m.material : [m.material];
    if (materials.some((mm) => mm.transparent)) return;
    if (opts.skip && opts.skip.test(m.name)) return;
    if (!m.geometry.getAttribute('normal')) return;
    targets.push(m);
  });
  for (const m of targets) {
    const outline = new THREE.Mesh(m.geometry, mat);
    outline.name = `${m.name}__outline`;
    outline.userData.isOutline = true;
    outline.userData.explodeWithParent = true;
    outline.castShadow = false;
    outline.receiveShadow = false;
    outline.raycast = () => {};
    m.add(outline);
  }
  return mat;
}
