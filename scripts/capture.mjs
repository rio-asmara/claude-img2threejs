#!/usr/bin/env node
/**
 * Headless review captures of the slime-agent viewer.
 *
 *   node scripts/capture.mjs --label pass-01 [--views front,side,az=45] [--team A|B]
 *        [--explode 1] [--url http://127.0.0.1:5173/] [--serve snapshot|dev|preview] [--out renders]
 *        [--timeout 60000] [--headed] [--query "ground=0&bg=ffffff"]
 *
 * Saves renders/<label>/<view>.png plus renders/<label>/manifest.json. The manifest follows the
 * img2threejs render-bridge schema (schemaVersion 1; `render_bridge.py validate` accepts it):
 * per-capture URL, viewport, azimuth/elevation, resolved camera, PNG sha256, ready evidence,
 * console errors and a foreground-coverage check that rejects blank/black canvases.
 *
 * View tokens: front, three-quarter, side, back, blaster, swim, turntable (= az 0/90/180/270),
 * az=<deg> (saved as turntable-<ddd>.png). Default: all of them.
 *
 * Serving: `snapshot` (default) runs `vite build` into a temp dir and serves that, so every view in
 * a batch renders the same source even while src/ is being edited (and no HMR reload can land
 * mid-capture). `dev` = vite dev server with HMR/watch off; `preview` = serve the existing dist/.
 * `--url` points at a server you run yourself.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------------ CLI
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const eq = a.indexOf('=');
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
  process.exit(0);
}
const label = String(args.label ?? 'scratch/latest');
const team = String(args.team ?? 'A').toUpperCase() === 'B' ? 'B' : 'A';
const explode = args.explode && args.explode !== true ? String(args.explode) : args.explode === true ? '1' : null;
const outRoot = path.resolve(ROOT, String(args.out ?? 'renders'));
const timeout = Number(args.timeout ?? 90000);
const serveMode = String(args.serve ?? 'snapshot');
/** Extra viewer URL params appended to every capture (e.g. "ground=0&blaster=1"). */
const extraQuery = args.query && args.query !== true ? Object.fromEntries(new URLSearchParams(String(args.query))) : {};
const DEFAULT_VIEWS = 'front,three-quarter,side,back,blaster,swim,turntable';

const FIGURE_VIEWPORT = { width: 800, height: 1230 }; // 2x the 400x615 reference crops
const VIEWPORTS = {
  blaster: { width: 1074, height: 520 }, // 2x reference/blaster.png
  swim: { width: 1196, height: 520 }, // 2x reference/swim-form.png
};
/** Azimuth/elevation each named view uses in src/main.ts (recorded in the manifest). */
const VIEW_CAMERA = {
  front: [0, 5], 'three-quarter': [35, 5], side: [270, 5], back: [180, 5], blaster: [90, 8], swim: [30, 28],
};
const REFERENCE_CROP = {
  front: 'reference/front.png', 'three-quarter': 'reference/three-quarter.png', side: 'reference/side.png',
  back: 'reference/back.png', blaster: 'reference/blaster.png', swim: 'reference/swim-form.png',
};

function expandViews(spec) {
  const jobs = [];
  for (const raw of String(spec).split(',').map((s) => s.trim()).filter(Boolean)) {
    if (raw === 'turntable') {
      for (const az of [0, 90, 180, 270]) jobs.push(turntableJob(az));
    } else if (/^(az=?|turntable-)\d+(\.\d+)?$/.test(raw)) {
      jobs.push(turntableJob(Number(raw.replace(/^(az=?|turntable-)/, ''))));
    } else if (VIEW_CAMERA[raw]) {
      jobs.push({ id: raw, view: raw, query: { view: raw }, az: VIEW_CAMERA[raw][0], el: VIEW_CAMERA[raw][1] });
    } else {
      throw new Error(`unknown view token "${raw}" (use ${Object.keys(VIEW_CAMERA).join(', ')}, turntable, az=<deg>)`);
    }
  }
  return jobs;
}
function turntableJob(az) {
  const norm = ((az % 360) + 360) % 360;
  return { id: `turntable-${String(Math.round(norm)).padStart(3, '0')}`, view: 'turntable', query: { az: String(norm) }, az: norm, el: 5 };
}
const jobs = expandViews(args.views ?? DEFAULT_VIEWS);

// ------------------------------------------------------------------ helpers
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const pngSize = (file) => {
  const b = readFileSync(file);
  return { type: 'png', width: b.readUInt32BE(16), height: b.readUInt32BE(20), bytes: b.length };
};
const freePort = () =>
  new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
const rel = (from, to) => path.relative(from, to).split(path.sep).join('/');

/** sha256 over every file under src/ (path + bytes), so a manifest names the exact source it rendered. */
function sourceDigest() {
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(full);
    }
  };
  walk(path.join(ROOT, 'src'));
  const h = createHash('sha256');
  for (const f of files) h.update(rel(ROOT, f)).update('\0').update(readFileSync(f)).update('\0');
  return { sha256: h.digest('hex'), files: files.length };
}

async function startServer() {
  const vite = await import('vite');
  const port = await freePort();
  const preview = { host: '127.0.0.1', port, strictPort: true };
  if (serveMode === 'snapshot') {
    const outDir = path.join(ROOT, 'node_modules', '.cache', 'img2-capture', `${process.pid}`);
    const source = sourceDigest();
    await vite.build({ root: ROOT, logLevel: 'error', build: { outDir, emptyOutDir: true, reportCompressedSize: false, chunkSizeWarningLimit: 4096 } });
    const server = await vite.preview({ root: ROOT, logLevel: 'warn', build: { outDir }, preview });
    return {
      url: `http://127.0.0.1:${port}/`, mode: 'snapshot', source,
      close: async () => { await server.close(); rmSync(outDir, { recursive: true, force: true }); },
    };
  }
  if (serveMode === 'preview') {
    if (!existsSync(path.join(ROOT, 'dist', 'index.html'))) throw new Error('dist/ missing: run `npm run build` first or use --serve snapshot');
    const server = await vite.preview({ root: ROOT, logLevel: 'warn', preview });
    return { url: `http://127.0.0.1:${port}/`, mode: 'preview', source: null, close: () => server.close() };
  }
  if (serveMode !== 'dev') throw new Error(`unknown --serve mode "${serveMode}"`);
  const source = sourceDigest();
  const server = await vite.createServer({
    root: ROOT, logLevel: 'warn', server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: null },
  });
  await server.listen();
  return { url: `http://127.0.0.1:${port}/`, mode: 'dev', source, close: () => server.close() };
}

/** Headless Chromium has no GPU here: SwiftShader (via ANGLE) gives a real WebGL2 context. */
const CHROMIUM_ARGS = [
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--enable-webgl',
];

async function launchBrowser(chromium) {
  const headless = !args.headed;
  try {
    return { browser: await chromium.launch({ headless, args: CHROMIUM_ARGS }), executable: 'playwright-default' };
  } catch (err) {
    // Playwright/browser revision mismatch: fall back to the preinstalled full Chromium.
    const executablePath = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium';
    console.warn(`[capture] default launch failed (${String(err.message).split('\n')[0]}); retrying with ${executablePath}`);
    return { browser: await chromium.launch({ headless, executablePath, args: CHROMIUM_ARGS }), executable: executablePath };
  }
}

// Decode the SAVED screenshot in the page and compare every pixel to the background colour
// (top-left pixel), so the blank/black check applies to exactly the bytes on disk.
const COVERAGE_FN = async (b64) => {
  const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  const bg = [data[0], data[1], data[2]];
  let fg = 0, minX = width, minY = height, maxX = -1, maxY = -1, dark = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const d = Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]);
      if (data[i] + data[i + 1] + data[i + 2] < 30) dark++;
      if (d > 48) {
        fg++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const total = width * height;
  return {
    ok: true,
    image: { width, height },
    background: bg,
    foregroundFraction: +(fg / total).toFixed(5),
    darkFraction: +(dark / total).toFixed(5),
    foregroundBBox: maxX >= 0 ? { x0: minX, y0: minY, x1: maxX, y1: maxY } : null,
  };
};

// ------------------------------------------------------------------ main
async function main() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('playwright is not installed: run `npm install` (devDependency playwright@1.56.1)');
  }
  const outDir = path.join(outRoot, label);
  mkdirSync(outDir, { recursive: true });

  const server = args.url
    ? { url: String(args.url), mode: 'external', source: null, close: async () => {} }
    : await startServer();
  const baseUrl = server.url.endsWith('/') ? server.url : `${server.url}/`;
  console.log(`[capture] viewer at ${baseUrl}  →  ${rel(ROOT, outDir)}/`);

  const { browser, executable } = await launchBrowser(chromium);
  const pwVersion = JSON.parse(readFileSync(path.join(ROOT, 'node_modules/playwright/package.json'), 'utf8')).version;
  const threeVersion = JSON.parse(readFileSync(path.join(ROOT, 'node_modules/three/package.json'), 'utf8')).version;
  const captures = [];
  const saved = [];
  let failures = 0;

  try {
    for (const job of jobs) {
      const viewport = VIEWPORTS[job.view] ?? FIGURE_VIEWPORT;
      const query = new URLSearchParams({ ...job.query, team, ...(explode ? { explode } : {}), ...extraQuery });
      const url = `${baseUrl}?${query}`;
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      const consoleErrors = [];
      page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
      page.on('pageerror', (e) => consoleErrors.push(String(e)));
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
        await page.waitForFunction(() => window.__IMG2_READY === true, null, { timeout });
        // Two extra frames so shadows/env are settled in the drawing buffer.
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const file = path.join(outDir, `${job.id}.png`);
        await page.screenshot({ path: file, fullPage: false, timeout });
        const state = await page.evaluate(() => {
          const v = window.__IMG2;
          return {
            ready: window.__IMG2_READY === true,
            fit: v?.fit ?? null,
            spec: v?.spec ?? null,
            gl: (() => {
              const gl = v?.renderer?.getContext?.();
              if (!gl) return null;
              const ext = gl.getExtension('WEBGL_debug_renderer_info');
              return {
                version: gl.getParameter(gl.VERSION),
                renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
              };
            })(),
            canvas: (() => {
              const c = document.querySelector('#app canvas');
              return c ? { width: c.width, height: c.height } : null;
            })(),
          };
        });
        const coverage = await page.evaluate(COVERAGE_FN, readFileSync(file).toString('base64'));
        const blank = !coverage.ok || coverage.foregroundFraction < 0.005 || coverage.darkFraction > 0.9;
        if (blank) failures++;
        const crop = REFERENCE_CROP[job.view];
        captures.push({
          id: job.id === 'front' ? 'hero' : job.id,
          view: job.view,
          role: job.id === 'front' ? 'reference-match' : job.view === 'blaster' || job.view === 'swim' ? 'prop' : 'orbit',
          azimuthDegrees: job.az,
          elevationDegrees: job.el,
          fovDegrees: state.spec?.fov ?? null,
          camera: state.fit,
          url,
          viewport: [viewport.width, viewport.height],
          devicePixelRatio: 1,
          path: rel(outDir, file),
          referenceCrop: crop ? rel(outDir, path.join(ROOT, crop)) : null,
          status: blank ? 'rejected-blank' : 'recorded',
          recordedAt: new Date().toISOString(),
          readySignal: state.ready,
          screenshotSha256: sha256(file),
          image: pngSize(file),
          consoleErrors,
          browserSnapshot: { canvas: state.canvas, webgl: state.gl },
          diagnostics: coverage,
        });
        saved.push(file);
        console.log(`  ${blank ? 'BLANK?' : 'ok    '} ${rel(ROOT, file)}  fg=${(coverage.foregroundFraction * 100).toFixed(1)}%${consoleErrors.length ? `  console errors: ${consoleErrors.length}` : ''}`);
      } catch (err) {
        failures++;
        console.error(`  FAIL   ${job.id}: ${String(err.message).split('\n')[0]}`);
        captures.push({ id: job.id, view: job.view, url, status: 'failed', error: String(err.message), consoleErrors });
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const reference = path.join(ROOT, 'reference/front.png');
  const sheet = path.join(ROOT, 'reference/slime-agent-sheet.jpg');
  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    generator: 'scripts/capture.mjs',
    label,
    params: { team, explode, query: extraQuery },
    runtime: {
      url: baseUrl,
      route: '/',
      viewport: [FIGURE_VIEWPORT.width, FIGURE_VIEWPORT.height],
      devicePixelRatio: 1,
      renderer: 'WebGLRenderer',
      threeVersion,
      toneMapping: 'ACESFilmic',
      outputColorSpace: 'srgb',
      readySignal: 'window.__IMG2_READY',
      serve: server.mode,
      source: server.source,
      captureContract: 'url-params (view, az, el, team, explode)',
      cameraConvention: 'faces +Z, Y up; az 0=+Z front, 90=+X (char left), 180=back, 270=-X (char right)',
    },
    reference: existsSync(reference)
      ? { kind: 'image', path: rel(outDir, reference), sha256: sha256(reference), comparisonBasis: 'source-image', renderRequired: false,
          sheet: existsSync(sheet) ? { path: rel(outDir, sheet), sha256: sha256(sheet) } : null }
      : null,
    captures,
    evidence: {
      browser: { adapter: 'playwright', version: pwVersion, browser: 'chromium', executable, headless: !args.headed, args: CHROMIUM_ARGS },
      diagnostics: [],
      comparisonSheet: null,
      consoleErrors: captures.flatMap((c) => c.consoleErrors ?? []),
    },
  };
  const manifestFile = path.join(outDir, 'manifest.json');
  writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log('\nSaved:');
  for (const f of saved) console.log(`  ${rel(ROOT, f)}`);
  console.log(`  ${rel(ROOT, manifestFile)}`);
  if (failures) {
    console.error(`\n${failures} capture(s) failed or look blank`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`[capture] ${err.stack ?? err}`);
  process.exit(2);
});
