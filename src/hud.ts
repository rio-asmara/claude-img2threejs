/*
 * Visitor control panel (top-left) for the published viewer.
 *
 * Every control is a plain link that reloads the page with one query param changed and every other
 * param preserved, so the panel never touches the scene: what renders is still decided by the URL
 * alone (see the param list in main.ts). `hud=0` leaves the panel out entirely (review captures).
 * Styles live in index.html (`.hud*`).
 */

export interface HudState {
  /** Resolved view name from main.ts ('turntable' when only `az` is given). */
  view: string;
  team: 'A' | 'B';
  explode: boolean;
}

const VIEW_LINKS: ReadonlyArray<[view: string, label: string]> = [
  ['orbit', 'Orbit'], ['front', 'Front'], ['three-quarter', '3/4'], ['side', 'Side'], ['back', 'Back'],
  ['blaster', 'Blaster'], ['swim', 'Swim form'],
];
/** Team ink colours (src/model/materials.ts). */
const TEAM_LINKS: ReadonlyArray<[team: 'A' | 'B', label: string, ink: string]> = [
  ['A', 'A turquoise', '#03d4cc'],
  ['B', 'B magenta', '#fd2d99'],
];
const OPEN_KEY = 'img2-hud-open';

/** Current URL with `changes` applied (null deletes a param); other params are kept as they are. */
function hrefWith(changes: Record<string, string | null>): string {
  const q = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) q.delete(k);
    else q.set(k, v);
  }
  const s = q.toString();
  return s ? `?${s}` : window.location.pathname;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A link chip, or an inert one when `href` is null (control does not apply to this view). */
function chip(label: string, href: string | null, opts: { current?: boolean; on?: boolean; title?: string } = {}): HTMLElement {
  const node = href === null ? el('span', 'hud-chip', label) : el('a', 'hud-chip', label);
  if (node instanceof HTMLAnchorElement && href !== null) node.href = href;
  else node.setAttribute('aria-disabled', 'true');
  if (opts.current) node.setAttribute('aria-current', 'page');
  if (opts.on !== undefined) {
    node.classList.add('hud-toggle');
    if (opts.on) node.classList.add('on');
    node.setAttribute('aria-label', `${label}: ${opts.on ? 'on' : 'off'}`);
  }
  if (opts.title) node.title = opts.title;
  return node;
}

function row(name: string, chips: HTMLElement[]): HTMLElement {
  const r = el('div', 'hud-row');
  r.setAttribute('role', 'group');
  r.setAttribute('aria-label', name);
  const list = el('div', 'hud-chips');
  list.append(...chips);
  r.append(el('span', 'hud-k', name), list);
  return r;
}

export function mountHud(state: HudState): void {
  const params = new URLSearchParams(window.location.search);
  if (params.get('hud') === '0') return;

  const isFigure = state.view !== 'blaster' && state.view !== 'swim';
  const isOrbit = state.view === 'orbit';

  const views = VIEW_LINKS.map(([view, label]) =>
    // Dropping `view` means orbit, unless `az` is set (that alone selects the turntable shot).
    chip(label, hrefWith({ view: view === 'orbit' && !params.has('az') ? null : view }), { current: state.view === view }));

  const teams = TEAM_LINKS.map(([team, label, ink]) => {
    const c = chip(label, hrefWith({ team }), { current: state.team === team });
    const swatch = el('span', 'hud-swatch');
    swatch.style.background = ink;
    c.prepend(swatch);
    return c;
  });

  // A toggle that does not apply to this view reads as off (its param is still carried along).
  const blasterOn = isFigure && params.get('blaster') === '1';
  const outlineOn = isFigure && params.get('outline') !== '0';
  const animOn = isOrbit && params.get('anim') !== '0';
  const toggles = [
    chip('Blaster in hand', isFigure ? hrefWith({ blaster: blasterOn ? null : '1' }) : null,
      { on: blasterOn, title: isFigure ? undefined : 'Figure views only' }),
    chip('Explode', hrefWith({ explode: state.explode ? null : '1' }), { on: state.explode }),
    chip('Outline', isFigure ? hrefWith({ outline: outlineOn ? '0' : null }) : null,
      { on: outlineOn, title: isFigure ? undefined : 'Figure views only' }),
    chip('Animate', isOrbit ? hrefWith({ anim: animOn ? '0' : null }) : null,
      { on: animOn, title: isOrbit ? undefined : 'Orbit view only' }),
  ];

  const panel = el('details', 'hud');
  const summary = el('summary', 'hud-title');
  summary.append(el('strong', '', 'Slime Agent'), el('span', 'hud-sub', ' — procedural Three.js (img2threejs)'));
  const body = el('div', 'hud-body');
  body.append(
    el('div', 'hud-hint', isOrbit ? 'drag to orbit · click a part to name it' : 'fixed review camera · click a part to name it'),
    row('View', views),
    row('Team', teams),
    row('Show', toggles),
  );
  panel.append(summary, body);

  // Open by default on roomy screens, collapsed on phones; the choice survives the reloads.
  let saved: string | null = null;
  try { saved = window.sessionStorage.getItem(OPEN_KEY); } catch { /* storage blocked */ }
  panel.open = saved !== null ? saved === '1' : window.matchMedia('(min-width: 640px) and (min-height: 480px)').matches;
  const sync = (): void => { document.body.classList.toggle('hud-open', panel.open); };
  panel.addEventListener('toggle', () => {
    sync();
    try { window.sessionStorage.setItem(OPEN_KEY, panel.open ? '1' : '0'); } catch { /* storage blocked */ }
  });
  sync();
  document.body.appendChild(panel);
}
