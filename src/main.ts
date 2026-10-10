import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  createSlimeAgentModel,
  createSlimeBlasterModel,
  createSlimeSwimFormModel,
} from './model/createSlimeAgentModel';
import {
  azimuthOf,
  boundsOfPoints,
  collectFramingPoints,
  fitPerspective,
  orbitDirection,
  type CameraFit,
  type Margins,
} from './framing';

/*
 * Slime-agent review viewer.
 *
 * URL params
 *   view   = front | three-quarter | side | back | blaster | swim | orbit   (default orbit)
 *   team   = A | B
 *   explode= 1 (or any factor, e.g. 0.5) — spread parts away from the bbox centre (units are the
 *            `userData.img2Part`-tagged objects when present, else the model's top-level children)
 *   az     = azimuth in degrees (0 front, 90 camera on +X, 180 back, 270 camera on -X);
 *            with no `view` it gives a fixed figure turntable shot
 *   el     = elevation override in degrees
 *   w, h   = fixed canvas size in CSS px (default: fill the window)
 *   blaster= 1 — humanoid holds the blaster (figure views)
 *   ground = 0 — hide the shadow-catcher ground
 *   bg     = RRGGBB background override
 *   tone   = neutral (default) | aces | agx;  exposure, env, hemi, key = lighting overrides
 */

type ViewName = 'front' | 'three-quarter' | 'side' | 'back' | 'blaster' | 'swim' | 'orbit' | 'turntable';
type Team = 'A' | 'B';

interface ViewSpec {
  subject: 'figure' | 'blaster' | 'swim';
  az: number;
  el: number;
  fov: number;
  margins: Margins;
  anchor: 'bottom' | 'center';
}

/** Reference crops: head top ~3% below the frame edge, soles ~1.5% above the bottom edge. */
const FIGURE_MARGINS: Margins = { top: 0.03, bottom: 0.015, left: 0.03, right: 0.03 };
const PROP_MARGINS: Margins = { top: 0.08, bottom: 0.08, left: 0.05, right: 0.05 };
const REVIEW_FOV = 20;

const VIEWS: Record<Exclude<ViewName, 'orbit'>, ViewSpec> = {
  front: { subject: 'figure', az: 0, el: 5, fov: REVIEW_FOV, margins: FIGURE_MARGINS, anchor: 'bottom' },
  'three-quarter': { subject: 'figure', az: 35, el: 5, fov: REVIEW_FOV, margins: FIGURE_MARGINS, anchor: 'bottom' },
  side: { subject: 'figure', az: 270, el: 5, fov: REVIEW_FOV, margins: FIGURE_MARGINS, anchor: 'bottom' },
  back: { subject: 'figure', az: 180, el: 5, fov: REVIEW_FOV, margins: FIGURE_MARGINS, anchor: 'bottom' },
  turntable: { subject: 'figure', az: 0, el: 5, fov: REVIEW_FOV, margins: FIGURE_MARGINS, anchor: 'bottom' },
  // Muzzle (+Z) points image-left when seen from +X, hose + canister on the right.
  blaster: { subject: 'blaster', az: 90, el: 8, fov: REVIEW_FOV, margins: PROP_MARGINS, anchor: 'center' },
  // Slightly elevated three-quarter of the puddle; goggles lens (+Z) turned toward image-left.
  swim: { subject: 'swim', az: 30, el: 28, fov: REVIEW_FOV, margins: PROP_MARGINS, anchor: 'center' },
};

declare global {
  interface Window {
    __IMG2_READY?: boolean;
    __IMG2?: unknown;
    __IMG2THREEJS_READY__?: boolean;
    __IMG2THREEJS_CAPTURE__?: unknown;
  }
}

// ---------------------------------------------------------------- params
const params = new URLSearchParams(window.location.search);
const num = (key: string): number | null => {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
};
const viewParam = params.get('view');
const azParam = num('az');
const elParam = num('el');
const knownViews = Object.keys(VIEWS).concat('orbit');
const viewName: ViewName = viewParam && knownViews.includes(viewParam)
  ? (viewParam as ViewName)
  : azParam !== null ? 'turntable' : 'orbit';
if (viewParam && !knownViews.includes(viewParam)) console.warn(`[viewer] unknown view "${viewParam}", using ${viewName}`);
const team: Team = params.get('team')?.toUpperCase() === 'B' ? 'B' : 'A';
const explodeRaw = params.get('explode');
const explodeFactor = explodeRaw === null || explodeRaw === '0' ? 0 : Number(explodeRaw) || 1;
const fixedW = num('w');
const fixedH = num('h');
const showGround = params.get('ground') !== '0';
const bgHex = (() => {
  const raw = params.get('bg');
  return raw && /^#?[0-9a-fA-F]{6}$/.test(raw) ? parseInt(raw.replace('#', ''), 16) : 0xf2f1ed;
})();

const isOrbit = viewName === 'orbit';
const spec: ViewSpec = isOrbit
  ? { ...VIEWS['three-quarter'], fov: 30, el: 10 }
  : { ...VIEWS[viewName as Exclude<ViewName, 'orbit'>] };
if (azParam !== null) spec.az = ((azParam % 360) + 360) % 360;
if (elParam !== null) spec.el = elParam;

// ---------------------------------------------------------------- renderer / scene
const mount = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const toneParam = params.get('tone');
// Khronos PBR Neutral keeps the sheet's saturated turquoise/magenta; ACES washes them to pastel.
renderer.toneMapping = toneParam === 'agx' ? THREE.AgXToneMapping
  : toneParam === 'aces' ? THREE.ACESFilmicToneMapping
    : THREE.NeutralToneMapping;
renderer.toneMappingExposure = num('exposure') ?? 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
mount.appendChild(renderer.domElement);

/** Frames still to draw in on-demand (fixed-view) mode; see the render loop. */
let dirtyFrames = 4;
function invalidate(frames = 2): void {
  dirtyFrames = Math.max(dirtyFrames, frames);
}

const scene = new THREE.Scene();
scene.background = new THREE.Color(bgHex);

const pmrem = new THREE.PMREMGenerator(renderer);
const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = envTexture;
scene.environmentIntensity = num('env') ?? 0.7;
pmrem.dispose();

// Studio rig. Positions are expressed relative to the viewing azimuth and re-placed whenever the
// camera azimuth changes, so every review view is lit the same way relative to the viewer — the
// way a character sheet is drawn (key upper-left, cool rim from behind).
const hemi = new THREE.HemisphereLight(0xffffff, 0xd9d4ca, num('hemi') ?? 0.55);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xfff2e0, num('key') ?? 1.9);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0003;
key.shadow.normalBias = 0.02;
key.shadow.radius = 3;
scene.add(key, key.target);

const fill = new THREE.DirectionalLight(0xf4f7ff, 0.45);
scene.add(fill, fill.target);

const rim = new THREE.DirectionalLight(0xcfe8ff, 1.8);
scene.add(rim, rim.target);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.1 }));
ground.name = '__shadow_catcher';
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.visible = showGround;
ground.userData.excludeFromFraming = true;
scene.add(ground);

// ---------------------------------------------------------------- subject
function buildSubject(): THREE.Group {
  if (spec.subject === 'blaster') return createSlimeBlasterModel({ team });
  if (spec.subject === 'swim') return createSlimeSwimFormModel({ team });
  return createSlimeAgentModel({ team, form: 'humanoid', withBlaster: params.get('blaster') === '1' });
}

const model = buildSubject();
model.traverse((o) => {
  const m = o as THREE.Mesh;
  if (m.isMesh) {
    m.castShadow = true;
    m.receiveShadow = true;
  }
});
scene.add(model);

// A prop is shown floating just above the floor so its contact shadow reads, whatever its origin.
if (spec.subject === 'blaster') {
  const b = boundsOfPoints(collectFramingPoints(model));
  if (!b.isEmpty()) model.position.y += 0.03 - b.min.y;
}

/** Nearest ancestor-or-self tagged as a part (`userData.img2Part = { id, module }`). */
function taggedPartOf(o: THREE.Object3D | null): THREE.Object3D | null {
  for (let p = o; p && p !== model; p = p.parent) if (p.userData.img2Part) return p;
  return null;
}

/** Explodable units: `img2Part`-tagged objects when the model declares them, else its top-level children. */
function explodeUnits(root: THREE.Object3D): THREE.Object3D[] {
  const tagged: THREE.Object3D[] = [];
  root.traverse((o) => { if (o !== root && o.userData.img2Part) tagged.push(o); });
  return tagged.length > 1 ? tagged : [...root.children];
}

/**
 * Spread parts along their offset from the model's bounding-box centre. Works for flat groups and
 * nested rigs alike: each unit is given a total world displacement, minus what it already inherits
 * from the nearest exploded ancestor.
 */
function applyExplode(root: THREE.Object3D, factor: number): void {
  if (factor <= 0) return;
  root.updateWorldMatrix(true, true);
  const rootBox = boundsOfPoints(collectFramingPoints(root));
  const center = rootBox.getCenter(new THREE.Vector3());
  const rootSize = rootBox.getSize(new THREE.Vector3()).length();
  const units = explodeUnits(root); // traverse order: parents before children
  const unitSet = new Set(units);
  const ownCenter = (u: THREE.Object3D): THREE.Vector3 | null => {
    // Meshes that belong to this unit and not to a nested unit.
    const box = new THREE.Box3();
    u.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || !m.geometry) return;
      let owner: THREE.Object3D | null = m;
      while (owner && !unitSet.has(owner)) owner = owner.parent;
      if (owner !== u) return;
      box.union(boundsOfPoints(collectFramingPoints(m)));
    });
    if (box.isEmpty()) box.copy(boundsOfPoints(collectFramingPoints(u)));
    return box.isEmpty() ? null : box.getCenter(new THREE.Vector3());
  };
  const displacement = new Map<THREE.Object3D, THREE.Vector3>();
  for (const u of units) {
    const c = ownCenter(u);
    if (!c) continue;
    const offset = c.sub(center);
    if (offset.lengthSq() < 1e-8) offset.set(0, 0, 1e-3);
    // Grows with the part's own offset plus a floor so central parts still separate.
    displacement.set(u, offset.clone().multiplyScalar(0.9 * factor)
      .add(offset.clone().normalize().multiplyScalar(0.08 * rootSize * factor)));
  }
  for (const u of units) {
    const want = displacement.get(u);
    if (!want) continue;
    let inherited = new THREE.Vector3();
    for (let p = u.parent; p && p !== root.parent; p = p.parent) {
      const d = displacement.get(p);
      if (d) { inherited = d; break; }
    }
    const delta = want.clone().sub(inherited);
    const parent = u.parent!;
    parent.updateWorldMatrix(true, false);
    const a = parent.worldToLocal(u.getWorldPosition(new THREE.Vector3()));
    const b = parent.worldToLocal(u.getWorldPosition(new THREE.Vector3()).add(delta));
    u.position.add(b.sub(a));
    u.updateWorldMatrix(false, true);
  }
  root.updateWorldMatrix(true, true);
}
applyExplode(model, explodeFactor);

let framingPoints = collectFramingPoints(model);
const subjectBox = boundsOfPoints(framingPoints);
const subjectCenter = subjectBox.getCenter(new THREE.Vector3());
const subjectRadius = Math.max(0.2, subjectBox.getSize(new THREE.Vector3()).length() / 2);

// Shadow frustum sized to the subject.
{
  const s = subjectRadius * 1.4;
  const cam = key.shadow.camera;
  cam.left = -s;
  cam.right = s;
  cam.top = s;
  cam.bottom = -s;
  cam.near = 0.1;
  cam.far = subjectRadius * 12;
  cam.updateProjectionMatrix();
}

let litAzimuth = Number.NaN;
function placeLights(azDeg: number): void {
  if (Math.abs(azDeg - litAzimuth) < 0.05) return;
  litAzimuth = azDeg;
  const toCam = orbitDirection(azDeg, 0);
  const right = new THREE.Vector3(toCam.z, 0, -toCam.x);
  const up = new THREE.Vector3(0, 1, 0);
  const d = subjectRadius * 4;
  const place = (light: THREE.DirectionalLight, r: number, u: number, t: number): void => {
    light.position.copy(subjectCenter)
      .addScaledVector(right, r * d).addScaledVector(up, u * d).addScaledVector(toCam, t * d);
    light.target.position.copy(subjectCenter);
    light.target.updateMatrixWorld();
  };
  // Key high and mostly frontal (upper-left): its cast shadow falls behind the subject, so the
  // review views keep a clean silhouette with only a soft contact shadow at the feet.
  place(key, -0.22, 1.5, 0.8);
  place(fill, 0.75, 0.25, 0.6);
  place(rim, 0.45, 0.6, -0.9);
}

// ---------------------------------------------------------------- camera
const camera = new THREE.PerspectiveCamera(spec.fov, 1, 0.01, 100);
let controls: OrbitControls | null = null;
let currentFit: CameraFit | null = null;

function viewportSize(): { w: number; h: number } {
  return { w: fixedW ?? window.innerWidth, h: fixedH ?? window.innerHeight };
}

function applyFit(fit: CameraFit): void {
  currentFit = fit;
  camera.position.copy(fit.position);
  camera.lookAt(fit.target);
  // Tight clip range for fixed shots (depth precision); a generous one while orbiting/zooming.
  camera.near = isOrbit ? subjectRadius * 0.02 : Math.max(0.005, fit.distance - subjectRadius * 3);
  camera.far = isOrbit ? subjectRadius * 60 : fit.distance + subjectRadius * 6;
  camera.updateProjectionMatrix();
  if (controls) {
    controls.target.copy(fit.target);
    controls.update();
  }
  placeLights(azimuthOf(fit.position, fit.target));
  invalidate();
}

function frame(): void {
  const { w, h } = viewportSize();
  camera.aspect = w / h;
  camera.fov = spec.fov;
  applyFit(fitPerspective(framingPoints, spec.az, spec.el, spec.fov, camera.aspect, spec.margins, spec.anchor));
}

function resize(): void {
  const { w, h } = viewportSize();
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  if (!isOrbit) frame();
  invalidate();
}

if (isOrbit) {
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = subjectRadius * 0.5;
  controls.maxDistance = subjectRadius * 20;
  document.getElementById('hint')!.style.display = 'block';
}
resize();
frame();

// ---------------------------------------------------------------- clickable structure
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const label = document.getElementById('part-label')!;
let highlight: THREE.BoxHelper | null = null;
let lastPick: { mesh: string; part: string; path: string } | null = null;

function topLevelPart(o: THREE.Object3D): THREE.Object3D {
  let p = o;
  while (p.parent && p.parent !== model) p = p.parent;
  return p;
}

function partLabel(o: THREE.Object3D): string {
  const tagged = taggedPartOf(o);
  if (tagged) {
    const info = tagged.userData.img2Part as { id?: string; module?: string };
    return info.module && info.module !== info.id ? `${info.id} (${info.module})` : String(info.id ?? tagged.name);
  }
  return topLevelPart(o).name || '(unnamed)';
}

function pathOf(o: THREE.Object3D): string {
  const names: string[] = [];
  for (let p: THREE.Object3D | null = o; p && p !== model; p = p.parent) names.unshift(p.name || p.type);
  return names.join('/');
}

function pick(clientX: number, clientY: number): void {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(model, true).find((i) => (i.object as THREE.Mesh).isMesh && i.object.visible);
  if (highlight) {
    scene.remove(highlight);
    highlight.dispose();
    highlight = null;
  }
  if (!hit) {
    lastPick = null;
    label.style.display = 'none';
    invalidate();
    return;
  }
  lastPick = { mesh: hit.object.name || '(unnamed)', part: partLabel(hit.object), path: pathOf(hit.object) };
  console.log(`[part] ${lastPick.part} :: ${lastPick.path}`);
  highlight = new THREE.BoxHelper(hit.object, 0xff3d7f);
  highlight.userData.isHighlight = true;
  scene.add(highlight);
  invalidate();
  label.textContent = `${lastPick.part}  ·  ${lastPick.path}`;
  label.style.display = 'block';
}

let down: { x: number; y: number } | null = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) pick(e.clientX, e.clientY);
  down = null;
});

function listParts(): Array<{ part: string; meshes: string[] }> {
  return explodeUnits(model).map((unit) => {
    const meshes: string[] = [];
    unit.traverse((o) => { if ((o as THREE.Mesh).isMesh && taggedPartOf(o) === taggedPartOf(unit)) meshes.push(o.name || '(unnamed)'); });
    return { part: partLabel(unit), meshes };
  });
}

// ---------------------------------------------------------------- render loop + readiness
// Orbit mode renders continuously and advances any `userData.tick(dt, elapsed)` the model exposes.
// Fixed review views are static (bind pose) and render on demand only, which keeps headless
// SwiftShader captures fast and deterministic; `invalidate()` schedules fresh frames.
let framesRendered = 0;
let ready = false;
const clock = new THREE.Clock();
const tickers: Array<(dt: number, elapsed: number) => void> = [];
if (isOrbit) {
  model.traverse((o) => {
    const t = (o.userData as { tick?: unknown }).tick;
    if (typeof t === 'function') tickers.push(t as (dt: number, elapsed: number) => void);
  });
}
function markReady(): void {
  ready = true;
  window.__IMG2_READY = true;
  window.__IMG2THREEJS_READY__ = true;
  document.body.dataset.ready = '1';
}

function tick(): void {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 1 / 15);
  if (controls) {
    controls.update();
    placeLights(azimuthOf(camera.position, controls.target));
    for (const t of tickers) t(dt, clock.elapsedTime);
  } else if (dirtyFrames <= 0) {
    return;
  }
  dirtyFrames--;
  renderer.render(scene, camera);
  framesRendered++;
  if (!ready && framesRendered >= 3) markReady();
}
window.addEventListener('resize', resize);
requestAnimationFrame(tick);

const nextFrames = (n: number): Promise<void> =>
  new Promise((resolve) => {
    let left = n;
    const step = (): void => { if (--left <= 0) resolve(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });

// ---------------------------------------------------------------- automation APIs
/** Re-aim the fixed camera (same convention as `az`/`el`) and re-fit. */
function setView(azDeg: number, elDeg = spec.el): void {
  spec.az = ((azDeg % 360) + 360) % 360;
  spec.el = elDeg;
  framingPoints = collectFramingPoints(model);
  frame();
}

window.__IMG2 = {
  THREE,
  scene,
  camera,
  renderer,
  model,
  view: viewName,
  team,
  explode: explodeFactor,
  get spec() { return { ...spec }; },
  get fit() { return currentFit && { position: currentFit.position.toArray(), target: currentFit.target.toArray(), distance: currentFit.distance }; },
  get lastPick() { return lastPick; },
  parts: listParts,
  pick,
  setView,
  nextFrames,
  invalidate,
};

/**
 * img2threejs render-bridge contract (SKILL/scripts/capture_threejs_playwright.py).
 * Azimuth uses this viewer's convention. With no `distance` the camera auto-frames the subject
 * (the bridge's default target [0,0,0] is the feet, so it is ignored unless distance is given).
 */
window.__IMG2THREEJS_CAPTURE__ = {
  async setCamera(c: {
    azimuthDegrees?: number;
    elevationDegrees?: number;
    target?: [number, number, number];
    distance?: number;
    fovDegrees?: number;
    near?: number;
    far?: number;
  }): Promise<void> {
    if (typeof c.fovDegrees === 'number') spec.fov = c.fovDegrees;
    const az = c.azimuthDegrees ?? spec.az;
    const el = c.elevationDegrees ?? spec.el;
    if (typeof c.distance === 'number' && c.target) {
      const target = new THREE.Vector3(...c.target);
      const position = target.clone().addScaledVector(orbitDirection(az, el), c.distance);
      spec.az = az;
      spec.el = el;
      camera.fov = spec.fov;
      applyFit({ position, target, distance: c.distance });
    } else {
      setView(az, el);
    }
    if (typeof c.near === 'number') camera.near = c.near;
    if (typeof c.far === 'number') camera.far = c.far;
    camera.updateProjectionMatrix();
    invalidate(3);
    await nextFrames(3);
  },
  async capturePass({ passId }: { passId: string; mode?: string }) {
    if (passId === 'beauty') {
      invalidate(2);
      await nextFrames(2);
      return { ok: true, selector: 'canvas' };
    }
    return { ok: false, reason: `pass "${passId}" is not implemented by this viewer` };
  },
};
