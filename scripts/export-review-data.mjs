#!/usr/bin/env node
/**
 * Dump the BUILT model's structure for the img2threejs structural gates (no pixels involved):
 *
 *   node scripts/export-review-data.mjs [--out pipeline/review-data] [--team A|B]
 *
 * Writes into --out:
 *   parts.json        part manifest for forge/stage4_review/check_part_coverage.py
 *                     ({model, parts:[{name,module,kind,triangles,materials}], unnamedMeshes, integralMeshes})
 *   head_rings.json   skull cross-sections [[y, rx, rz, zc], ...] (world units) for scalp_exposure.py
 *   hair_points.json  every hair vertex in world space [[x, y, z], ...] for scalp_exposure.py
 *   meshes.json       closed meshes (skull, hair locks/tufts, hands) in world space, with vertex
 *                     normals, for self_intersection.py
 *   rig.json          joints (pivots) with world positions + parents, sockets and colliders
 *   measured.json     measured world anchors of attached parts (goggles, ink tank, sneakers, hands)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const outDir = path.resolve(ROOT, arg('out', 'pipeline/review-data'));
const team = arg('team', 'A');

const freePort = () => new Promise((resolve, reject) => {
  const srv = createNetServer();
  srv.once('error', reject);
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});

const CHROMIUM_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'];

/** Runs in the page: walks window.__IMG2.model and returns every dump. */
const EXTRACT = () => {
  const { model, THREE } = window.__IMG2;
  model.updateWorldMatrix(true, true);
  const v = new THREE.Vector3();
  const round = (n) => Math.round(n * 1e5) / 1e5;
  const partOf = (o) => {
    for (let p = o; p && p !== model; p = p.parent) if (p.userData.img2Part) return p;
    return null;
  };
  const triCount = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

  // ---- parts manifest
  const parts = [];
  let unnamedMeshes = 0;
  let integralMeshes = 0;
  model.traverse((o) => {
    if (o.userData.img2Part) {
      let triangles = 0;
      const mats = new Set();
      o.traverse((m) => {
        if (m.isMesh && partOf(m) === o) {
          triangles += triCount(m.geometry);
          (Array.isArray(m.material) ? m.material : [m.material]).forEach((mm) => mats.add(mm.name || mm.type));
        }
      });
      parts.push({ name: o.userData.img2Part.id, module: o.userData.img2Part.module, kind: 'part', triangles, materials: [...mats] });
    }
    if (o.isMesh) {
      if (partOf(o)) integralMeshes++;
      else unnamedMeshes++;
    }
  });

  // ---- scalp: skull cross-sections + hair vertices
  const skull = model.getObjectByName('head-skull');
  const rings = [];
  if (skull) {
    const box = new THREE.Box3().setFromObject(skull);
    const g = skull.geometry;
    const pos = g.attributes.position;
    const pts = [];
    for (let i = 0; i < pos.count; i++) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(skull.matrixWorld).clone());
    const n = 24;
    for (let k = 0; k <= n; k++) {
      const y = box.min.y + ((box.max.y - box.min.y) * k) / n;
      const band = pts.filter((p) => Math.abs(p.y - y) < (box.max.y - box.min.y) / n);
      if (band.length < 4) continue;
      const xs = band.map((p) => p.x);
      const zs = band.map((p) => p.z);
      const rx = (Math.max(...xs) - Math.min(...xs)) / 2;
      const zMin = Math.min(...zs);
      const zMax = Math.max(...zs);
      rings.push([round(y), round(Math.max(rx, 1e-4)), round(Math.max((zMax - zMin) / 2, 1e-4)), round((zMax + zMin) / 2)]);
    }
  }
  const hairPoints = [];
  const hair = model.getObjectByName('slime-hair');
  if (hair) {
    hair.traverse((m) => {
      if (!m.isMesh) return;
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        hairPoints.push([round(v.x), round(v.y), round(v.z)]);
      }
    });
  }

  // ---- closed meshes for the self-intersection gate
  const closedNames = (name) => /^(head-skull|hair-lock-\d+|hair-tuft-\d+|palm-[lr]|(index|middle|ring|thumb)-[lr]-1)$/.test(name);
  const meshes = [];
  model.traverse((m) => {
    if (!m.isMesh || !closedNames(m.name)) return;
    const g = m.geometry;
    const pos = g.attributes.position;
    const vertices = [];
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      vertices.push([round(v.x), round(v.y), round(v.z)]);
    }
    const normals = [];
    const nrm = g.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(m.matrixWorld);
    if (nrm) {
      for (let i = 0; i < nrm.count; i++) {
        v.fromBufferAttribute(nrm, i).applyMatrix3(nm).normalize();
        normals.push([round(v.x), round(v.y), round(v.z)]);
      }
    }
    const indices = g.index ? Array.from(g.index.array) : vertices.map((_, i) => i);
    meshes.push({ id: m.name, vertices, indices, ...(normals.length === vertices.length ? { normals } : {}) });
  });

  // ---- rig: pivots, sockets, colliders
  const runtime = model.userData.sculptRuntime || {};
  const joints = [];
  const jointRe = /^(hips|spine|neck-joint|head-joint|shoulder-[lr]|elbow-[lr]|wrist-[lr]|hip-[lr]|knee-[lr]|ankle-[lr])$/;
  model.traverse((o) => {
    if (!jointRe.test(o.name)) return;
    o.getWorldPosition(v);
    let parent = o.parent;
    while (parent && parent !== model && !jointRe.test(parent.name)) parent = parent.parent;
    joints.push({ name: o.name, parent: parent && parent !== model ? parent.name : null, world: [round(v.x), round(v.y), round(v.z)] });
  });
  const sockets = Object.entries(runtime.sockets || {}).map(([key, o]) => {
    o.getWorldPosition(v);
    return { key, node: o.name, parent: o.parent?.name ?? null, world: [round(v.x), round(v.y), round(v.z)], ...o.userData.socket };
  });

  // ---- measured anchors of attached parts (world bounding boxes)
  const measured = {};
  for (const id of ['goggles', 'ink-tank', 'tank-hose', 'sneaker-l', 'sneaker-r', 'hand-l', 'hand-r', 'slime-hair', 'head', 'harness']) {
    let obj = null;
    model.traverse((o) => { if (!obj && o.userData.img2Part?.id === id) obj = o; });
    if (!obj) continue;
    const b = new THREE.Box3().setFromObject(obj);
    measured[id] = { min: b.min.toArray().map(round), max: b.max.toArray().map(round), center: b.getCenter(v).toArray().map(round) };
  }
  const box = new THREE.Box3().setFromObject(model);
  return {
    parts: { model: 'slime-agent', parts, unnamedMeshes, integralMeshes },
    rings, hairPoints, meshes,
    rig: { joints, sockets, colliders: runtime.colliders || {}, actions: runtime.animationController?.actions ?? [] },
    measured: { model: 'slime-agent', bounds: { min: box.min.toArray().map(round), max: box.max.toArray().map(round) }, parts: measured },
  };
};

async function main() {
  const vite = await import('vite');
  const { chromium } = await import('playwright');
  const port = await freePort();
  const server = await vite.createServer({
    root: ROOT, logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null },
  });
  await server.listen();
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: CHROMIUM_ARGS }).catch(() =>
      chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium', args: CHROMIUM_ARGS }));
    const page = await browser.newPage({ viewport: { width: 400, height: 600 } });
    await page.goto(`http://127.0.0.1:${port}/?view=front&team=${team}`);
    await page.waitForFunction(() => window.__IMG2_READY === true, null, { timeout: 120000 });
    const data = await page.evaluate(EXTRACT);
    mkdirSync(outDir, { recursive: true });
    const write = (name, obj) => writeFileSync(path.join(outDir, name), `${JSON.stringify(obj, null, name === 'meshes.json' || name === 'hair_points.json' ? 0 : 2)}\n`);
    write('parts.json', data.parts);
    write('head_rings.json', data.rings);
    write('hair_points.json', data.hairPoints);
    write('meshes.json', { meshes: data.meshes });
    write('rig.json', data.rig);
    write('measured.json', data.measured);
    console.log(`[export] ${data.parts.parts.length} parts, ${data.parts.integralMeshes} integral meshes, ${data.parts.unnamedMeshes} unnamed`);
    console.log(`[export] ${data.rings.length} skull rings, ${data.hairPoints.length} hair points, ${data.meshes.length} closed meshes`);
    console.log(`[export] ${data.rig.joints.length} joints, ${data.rig.sockets.length} sockets → ${path.relative(ROOT, outDir)}/`);
  } finally {
    await browser?.close();
    await server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
