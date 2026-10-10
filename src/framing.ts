import * as THREE from 'three';

/**
 * Review-camera framing.
 *
 * Azimuth convention (character faces +Z, Y up), degrees:
 *   az = 0   camera on +Z  (front)
 *   az = 90  camera on +X  (character's LEFT side; the character faces image-left)
 *   az = 180 camera on -Z  (back)
 *   az = 270 camera on -X  (character's RIGHT side; faces image-right, like reference/side.png)
 * Elevation > 0 puts the camera above the target looking slightly down.
 */

export interface Margins {
  /** Fractions of the frame height/width kept empty on each side. */
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface CameraFit {
  position: THREE.Vector3;
  target: THREE.Vector3;
  distance: number;
}

/** Unit vector from the target toward the camera. */
export function orbitDirection(azDeg: number, elDeg: number): THREE.Vector3 {
  const az = THREE.MathUtils.degToRad(azDeg);
  const el = THREE.MathUtils.degToRad(elDeg);
  return new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
}

/** Azimuth (deg, 0..360) of a camera position around a target, in the convention above. */
export function azimuthOf(position: THREE.Vector3, target: THREE.Vector3): number {
  const deg = THREE.MathUtils.radToDeg(Math.atan2(position.x - target.x, position.z - target.z));
  return (deg + 360) % 360;
}

function isSilhouetteMesh(o: THREE.Object3D): o is THREE.Mesh {
  const m = o as THREE.Mesh;
  if (!m.isMesh || !m.geometry || !m.visible) return false;
  if (m.userData.isHighlight || m.userData.excludeFromFraming) return false;
  const mats = Array.isArray(m.material) ? m.material : [m.material];
  return !mats.every((mat) => mat instanceof THREE.ShadowMaterial);
}

/**
 * World-space vertex samples of every visible mesh under `root` (flat xyz array).
 * Large models are strided down to ~`budget` points; framing margins absorb the tiny loss.
 */
export function collectFramingPoints(root: THREE.Object3D, budget = 400_000): Float32Array {
  root.updateWorldMatrix(true, true);
  const meshes: THREE.Mesh[] = [];
  let total = 0;
  root.traverse((o) => {
    let visible = true;
    for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) visible = false;
    if (visible && isSilhouetteMesh(o)) {
      meshes.push(o);
      total += o.geometry.getAttribute('position')?.count ?? 0;
    }
  });
  const stride = Math.max(1, Math.ceil(total / budget));
  const out: number[] = [];
  const v = new THREE.Vector3();
  for (const mesh of meshes) {
    const pos = mesh.geometry.getAttribute('position');
    if (!pos) continue;
    const skinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh ? (mesh as THREE.SkinnedMesh) : null;
    for (let i = 0; i < pos.count; i += stride) {
      v.fromBufferAttribute(pos, i);
      if (skinned) skinned.applyBoneTransform(i, v);
      v.applyMatrix4(mesh.matrixWorld);
      out.push(v.x, v.y, v.z);
    }
  }
  return new Float32Array(out);
}

export function boundsOfPoints(points: Float32Array): THREE.Box3 {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (let i = 0; i < points.length; i += 3) box.expandByPoint(v.set(points[i], points[i + 1], points[i + 2]));
  return box;
}

interface Extents {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

function project(points: Float32Array, cam: THREE.Vector3, r: THREE.Vector3, u: THREE.Vector3, f: THREE.Vector3): Extents {
  const e: Extents = { xmin: Infinity, xmax: -Infinity, ymin: Infinity, ymax: -Infinity };
  for (let i = 0; i < points.length; i += 3) {
    const qx = points[i] - cam.x;
    const qy = points[i + 1] - cam.y;
    const qz = points[i + 2] - cam.z;
    const z = qx * f.x + qy * f.y + qz * f.z;
    if (z <= 1e-6) continue;
    const sx = (qx * r.x + qy * r.y + qz * r.z) / z;
    const sy = (qx * u.x + qy * u.y + qz * u.z) / z;
    if (sx < e.xmin) e.xmin = sx;
    if (sx > e.xmax) e.xmax = sx;
    if (sy < e.ymin) e.ymin = sy;
    if (sy > e.ymax) e.ymax = sy;
  }
  return e;
}

/**
 * Fit a perspective camera at (azimuth, elevation) so the projected silhouette of `points`
 * fills the frame inside `margins`. The larger axis touches its margins; the other axis is
 * centred horizontally, and vertically either centred or bottom-anchored (feet near the bottom
 * edge, like the reference crops).
 */
export function fitPerspective(
  points: Float32Array,
  azDeg: number,
  elDeg: number,
  fovDeg: number,
  aspect: number,
  margins: Margins,
  anchor: 'bottom' | 'center' = 'bottom',
): CameraFit {
  const box = boundsOfPoints(points);
  const target = box.getCenter(new THREE.Vector3());
  const radius = Math.max(1e-3, box.getSize(new THREE.Vector3()).length() / 2);

  const o = orbitDirection(azDeg, elDeg);
  const f = o.clone().negate();
  const up = new THREE.Vector3(0, 1, 0);
  const r = new THREE.Vector3().crossVectors(f, up).normalize();
  const u = new THREE.Vector3().crossVectors(r, f).normalize();

  const tV = Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2);
  const tH = tV * aspect;
  const allowW = 2 * tH * (1 - margins.left - margins.right);
  const allowH = 2 * tV * (1 - margins.top - margins.bottom);

  let distance = radius / Math.sin(THREE.MathUtils.degToRad(fovDeg) / 2);
  const cam = new THREE.Vector3();

  // Phase 1: centre + zoom until the dominant axis fills its allowance.
  for (let i = 0; i < 60; i++) {
    cam.copy(target).addScaledVector(o, distance);
    const e = project(points, cam, r, u, f);
    const cx = (e.xmin + e.xmax) / 2;
    const cy = (e.ymin + e.ymax) / 2;
    const k = Math.max((e.xmax - e.xmin) / allowW, (e.ymax - e.ymin) / allowH);
    target.addScaledVector(r, cx * distance).addScaledVector(u, cy * distance);
    distance *= k;
    if (Math.abs(k - 1) < 1e-5 && Math.abs(cx) < 1e-6 && Math.abs(cy) < 1e-6) break;
  }

  // Phase 2: pan (no zoom) to honour asymmetric margins / bottom anchoring.
  for (let i = 0; i < 12; i++) {
    cam.copy(target).addScaledVector(o, distance);
    const e = project(points, cam, r, u, f);
    const h = e.ymax - e.ymin;
    const wantCx = -tH + 2 * tH * margins.left + allowW / 2;
    const bottomEdge = -tV + 2 * tV * margins.bottom;
    const wantCy = anchor === 'bottom' ? bottomEdge + h / 2 : bottomEdge + allowH / 2;
    const dx = (e.xmin + e.xmax) / 2 - wantCx;
    const dy = (e.ymin + e.ymax) / 2 - wantCy;
    target.addScaledVector(r, dx * distance).addScaledVector(u, dy * distance);
    if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) break;
  }

  return { position: target.clone().addScaledVector(o, distance), target, distance };
}
