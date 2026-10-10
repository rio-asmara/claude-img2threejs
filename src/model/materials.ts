import * as THREE from 'three';

/**
 * Material library for the Slime Agent reconstruction.
 *
 * Values come from the reference sheet (reference/slime-agent-sheet.jpg) and the
 * pipeline's material analysis (pipeline/): turquoise slime is a glossy dielectric
 * with a clearcoat; the outfit is matte black nylon/twill with saturated team-colour
 * piping; the ink tank is clear glass over a team-coloured liquid.
 */

export type Team = 'A' | 'B';

export interface TeamPalette {
  /** Main slime / ink colour (sRGB hex). */
  ink: number;
  /** Darker shade used for creases, mouth line and liquid depth. */
  inkDeep: number;
  /** Lighter shade for highlights / glass tint. */
  inkLight: number;
}

export const TEAM_PALETTES: Record<Team, TeamPalette> = {
  // Median RGB of the sheet's Team A glossy swatch (reference/team-palette.png).
  A: { ink: 0x03d4cc, inkDeep: 0x067f7a, inkLight: 0x7ff5ec },
  // Median RGB of the Team B glossy swatch.
  B: { ink: 0xfd2d99, inkDeep: 0x9c0a5d, inkLight: 0xff9ad0 },
};

export interface SlimeMaterials {
  palette: TeamPalette;
  /** Glossy slime skin (head, hair, hands, ankles). */
  slime: THREE.MeshPhysicalMaterial;
  /** Slightly darker slime for the mouth crease. */
  slimeDeep: THREE.MeshStandardMaterial;
  /** Translucent ink liquid inside tanks / barrels. */
  inkLiquid: THREE.MeshPhysicalMaterial;
  /** Clear glass shell for tanks and the blaster chamber. */
  glass: THREE.MeshPhysicalMaterial;
  /** Black glossy goggle lens. */
  lens: THREE.MeshPhysicalMaterial;
  /** White plastic (goggle frame, blaster shell). */
  whitePlastic: THREE.MeshPhysicalMaterial;
  /** Black hard plastic (blaster body, caps, shoe upper accents). */
  blackPlastic: THREE.MeshStandardMaterial;
  /** Black nylon (jacket). */
  nylon: THREE.MeshStandardMaterial;
  /** Charcoal cotton twill (pants). */
  twill: THREE.MeshStandardMaterial;
  /** Black elastic webbing (goggle strap, harness, cuffs). */
  webbing: THREE.MeshStandardMaterial;
  /** White cotton jersey (T-shirt, laces). */
  cotton: THREE.MeshStandardMaterial;
  /** Team-colour piping / stripes on clothes (saturated, faint self-illumination). */
  piping: THREE.MeshStandardMaterial;
  /** White rubber midsole. */
  rubberWhite: THREE.MeshStandardMaterial;
  /** Team-colour rubber outsole / shoe panels. */
  rubberInk: THREE.MeshStandardMaterial;
  /** Black rubber (hose, shoe upper). */
  rubberBlack: THREE.MeshStandardMaterial;
  /** Brushed aluminium (buckles, tank bands, clips). */
  metal: THREE.MeshStandardMaterial;
  /** Every material, for disposal / bulk tweaks. */
  all: THREE.Material[];
}

export function createSlimeMaterials(team: Team = 'A'): SlimeMaterials {
  const palette = TEAM_PALETTES[team];

  const slime = new THREE.MeshPhysicalMaterial({
    name: 'slime-skin',
    color: palette.ink,
    roughness: 0.16,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    // A touch of self-illumination keeps the toon-saturated turquoise of the sheet
    // instead of letting the shadow side fall to a dull teal.
    emissive: new THREE.Color(palette.ink),
    emissiveIntensity: 0.12,
    envMapIntensity: 0.9,
  });

  const slimeDeep = new THREE.MeshStandardMaterial({
    name: 'slime-deep',
    color: palette.inkDeep,
    roughness: 0.4,
  });

  const inkLiquid = new THREE.MeshPhysicalMaterial({
    name: 'ink-liquid',
    color: palette.ink,
    roughness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.05,
    emissive: new THREE.Color(palette.ink),
    emissiveIntensity: 0.22,
    transparent: true,
    opacity: 0.88,
  });

  const glass = new THREE.MeshPhysicalMaterial({
    name: 'tank-glass',
    color: palette.inkLight,
    roughness: 0.05,
    metalness: 0,
    transmission: 0.92,
    thickness: 0.01,
    ior: 1.5,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });

  const lens = new THREE.MeshPhysicalMaterial({
    name: 'goggle-lens',
    color: 0x0c0d10,
    roughness: 0.06,
    metalness: 0.1,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.6,
  });

  const whitePlastic = new THREE.MeshPhysicalMaterial({
    name: 'white-plastic',
    color: 0xf3f4f2,
    roughness: 0.32,
    clearcoat: 0.4,
    clearcoatRoughness: 0.3,
  });

  const blackPlastic = new THREE.MeshStandardMaterial({
    name: 'black-plastic',
    color: 0x1b1d21,
    roughness: 0.45,
  });

  const nylon = new THREE.MeshStandardMaterial({
    name: 'jacket-nylon',
    color: 0x1d1f23,
    roughness: 0.62,
  });

  const twill = new THREE.MeshStandardMaterial({
    name: 'pants-twill',
    color: 0x222428,
    roughness: 0.86,
  });

  const webbing = new THREE.MeshStandardMaterial({
    name: 'webbing',
    color: 0x16171a,
    roughness: 0.78,
  });

  const cotton = new THREE.MeshStandardMaterial({
    name: 'tee-cotton',
    color: 0xf4f4f1,
    roughness: 0.92,
  });

  const piping = new THREE.MeshStandardMaterial({
    name: 'piping',
    color: palette.ink,
    roughness: 0.45,
    emissive: new THREE.Color(palette.ink),
    emissiveIntensity: 0.25,
  });

  const rubberWhite = new THREE.MeshStandardMaterial({
    name: 'rubber-white',
    color: 0xf1f2f0,
    roughness: 0.55,
  });

  const rubberInk = new THREE.MeshStandardMaterial({
    name: 'rubber-ink',
    color: palette.ink,
    roughness: 0.4,
    emissive: new THREE.Color(palette.ink),
    emissiveIntensity: 0.15,
  });

  const rubberBlack = new THREE.MeshStandardMaterial({
    name: 'rubber-black',
    color: 0x18191c,
    roughness: 0.55,
  });

  const metal = new THREE.MeshStandardMaterial({
    name: 'aluminium',
    color: 0xc9ccd0,
    metalness: 1,
    roughness: 0.32,
  });

  const all: THREE.Material[] = [
    slime, slimeDeep, inkLiquid, glass, lens, whitePlastic, blackPlastic, nylon, twill,
    webbing, cotton, piping, rubberWhite, rubberInk, rubberBlack, metal,
  ];

  return {
    palette, slime, slimeDeep, inkLiquid, glass, lens, whitePlastic, blackPlastic, nylon,
    twill, webbing, cotton, piping, rubberWhite, rubberInk, rubberBlack, metal, all,
  };
}
