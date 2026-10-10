import * as THREE from 'three';
import { createSlimeAgentModel } from '../generated/createSlimeAgentModel.generated.ts';
const root = createSlimeAgentModel({});
root.updateMatrixWorld(true);
const rt = (root.userData as any).sculptRuntime;
const box = new THREE.Box3().setFromObject(root);
let tris = 0, meshes = 0, skinned = 0;
const perMesh: Record<string, any> = {};
const proud: any[] = [];
root.traverse((o: any) => {
  if (o.isMesh) {
    meshes++; if (o.isSkinnedMesh) skinned++;
    const g = o.geometry as THREE.BufferGeometry;
    const t = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    tris += t * (o.isInstancedMesh ? o.count : 1);
    const b = new THREE.Box3().setFromObject(o);
    perMesh[o.name] = { tris: t, min: b.min.toArray().map((v: number) => +v.toFixed(3)), max: b.max.toArray().map((v: number) => +v.toFixed(3)) };
    if (g.userData.standProud) proud.push({ name: o.name, ...g.userData.standProud });
  }
});
const out = {
  bounds: { min: box.min.toArray(), max: box.max.toArray() },
  meshCount: meshes, skinnedMeshes: skinned, triangles: tris,
  runtimeMeshes: Object.keys(rt.meshes).length, nodes: Object.keys(rt.nodes).length,
  sockets: Object.keys(rt.sockets), skeleton: (root.userData as any).skeleton ? 'yes' : 'no',
  standProud: proud, perMesh,
};
console.log(JSON.stringify(out, null, 1));
