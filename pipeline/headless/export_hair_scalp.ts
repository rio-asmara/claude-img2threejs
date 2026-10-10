// Export inputs for forge/stage4_review/scalp_exposure.py from the EXECUTED factory (no renderer):
//   skull.json  = ring stack [[y, rx, rz, zc], ...] of the head ellipsoid in head-local space
//   hair.json   = every hair-role mesh vertex (after standProud) in head-local space
import * as THREE from 'three';
import { writeFileSync } from 'node:fs';
import { createSlimeAgentModel } from '../generated/createSlimeAgentModel.generated.ts';

const outDir = process.argv[2] ?? '.';
const root = createSlimeAgentModel({});
root.updateMatrixWorld(true);
const rt = (root.userData as any).sculptRuntime;
const headNode: THREE.Object3D = rt.nodes['head'];
const headMesh: THREE.Mesh = rt.meshes['head'];
headMesh.geometry.computeBoundingBox();
const bb = headMesh.geometry.boundingBox!;
const rx = (bb.max.x - bb.min.x) / 2, ry = (bb.max.y - bb.min.y) / 2, rz = (bb.max.z - bb.min.z) / 2;
const rings: number[][] = [];
for (let i = 0; i <= 24; i++) {
  const y = -ry + (2 * ry * i) / 24;
  const k = Math.sqrt(Math.max(0, 1 - (y / ry) ** 2));
  rings.push([+y.toFixed(5), +Math.max(1e-4, rx * k).toFixed(5), +Math.max(1e-4, rz * k).toFixed(5), 0]);
}
const inv = new THREE.Matrix4().copy(headNode.matrixWorld).invert();
const hair: number[][] = [];
const ids: string[] = [];
for (const [id, mesh] of Object.entries(rt.meshes as Record<string, THREE.Mesh>)) {
  const role = (mesh.userData.sculptComponent ?? {}).role;
  if (role !== 'hair') continue;
  ids.push(id);
  const pos = mesh.geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv);
    hair.push([+v.x.toFixed(5), +v.y.toFixed(5), +v.z.toFixed(5)]);
  }
}
writeFileSync(`${outDir}/skull-rings.json`, JSON.stringify(rings));
writeFileSync(`${outDir}/hair-points.json`, JSON.stringify(hair));
console.log(JSON.stringify({ headRadii: [rx, ry, rz], rings: rings.length, hairPoints: hair.length, hairMeshes: ids }));
