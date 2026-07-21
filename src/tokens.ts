/**
 * tokens.ts — the ONE design-token source (design task T5).
 *
 * The dark-nautical-instrument palette (seeded from approved mockup variant A)
 * lives here once and is mirrored two ways:
 *   1. CSS custom properties, injected onto :root by {@link injectCssVars} —
 *      style.css consumes these via var(--ocean-deep) etc.
 *   2. Normalized [r,g,b,a] Float32Arrays, for passing straight to WebGL as
 *      gl.uniform4fv — shaders never hardcode a colour.
 *
 * Tune colours ONLY here. Every rgb triple below is the single source; the CSS
 * string and the shader uniform are both derived from it, so they can never drift.
 */

/** 8px spacing unit and 4px corner radius (design doc Visual Design). */
export const SPACING_UNIT = 8;
export const RADIUS = 4;

interface RawToken {
  key: string;
  cssVar: string;
  rgb: readonly [number, number, number]; // 0..255
  a: number; // 0..1
}

// Palette from the design doc Visual Design block. Order = luminance ranking
// intent (flood glow brightest ... chrome), but order here is not load-bearing.
const RAW: readonly RawToken[] = [
  { key: 'oceanDeep', cssVar: '--ocean-deep', rgb: [5, 10, 18], a: 1 },
  { key: 'oceanShallow', cssVar: '--ocean-shallow', rgb: [10, 21, 34], a: 1 },
  { key: 'terrain', cssVar: '--terrain', rgb: [26, 31, 36], a: 1 },
  { key: 'ridgeHi', cssVar: '--ridge-hi', rgb: [44, 52, 60], a: 1 },
  { key: 'wadiDry', cssVar: '--wadi-dry', rgb: [80, 200, 255], a: 0.18 },
  { key: 'wadiFlood', cssVar: '--wadi-flood', rgb: [77, 216, 255], a: 1 },
  { key: 'sstWarm', cssVar: '--sst-warm', rgb: [255, 140, 40], a: 0.1 },
  { key: 'genesis', cssVar: '--genesis', rgb: [255, 190, 80], a: 0.12 },
  { key: 'stormCore', cssVar: '--storm-core', rgb: [232, 244, 255], a: 1 },
  { key: 'track', cssVar: '--track', rgb: [120, 220, 255], a: 0.5 },
  // Historic ghost tracks (C7): a cool, desaturated cyan distinct from the live
  // track (120,220,255), at genesis-glow luminance (a 0.12) — clearly below the
  // live track's 0.12–0.62 alpha range so ghosts never compete with the storm.
  { key: 'ghostTrack', cssVar: '--ghost-track', rgb: [96, 168, 200], a: 0.12 },
  { key: 'text', cssVar: '--text', rgb: [127, 212, 232], a: 1 },
  { key: 'accent', cssVar: '--accent', rgb: [255, 183, 77], a: 1 },
  // Operational weather-product palettes. These remain tokens—even when only
  // consumed by WebGL—so CSS legends and shader output cannot silently drift.
  { key: 'ir0', cssVar: '--ir-0', rgb: [6, 10, 14], a: 1 },
  { key: 'ir1', cssVar: '--ir-1', rgb: [66, 79, 94], a: 1 },
  { key: 'ir2', cssVar: '--ir-2', rgb: [179, 214, 230], a: 1 },
  { key: 'ir3', cssVar: '--ir-3', rgb: [250, 184, 51], a: 1 },
  { key: 'ir4', cssVar: '--ir-4', rgb: [194, 26, 31], a: 1 },
  { key: 'sst0', cssVar: '--sst-0', rgb: [5, 20, 51], a: 1 },
  { key: 'sst1', cssVar: '--sst-1', rgb: [0, 122, 184], a: 1 },
  { key: 'sst2', cssVar: '--sst-2', rgb: [46, 199, 153], a: 1 },
  { key: 'sst3', cssVar: '--sst-3', rgb: [250, 199, 46], a: 1 },
  { key: 'sst4', cssVar: '--sst-4', rgb: [224, 51, 20], a: 1 },
  { key: 'rh0', cssVar: '--rh-0', rgb: [51, 20, 8], a: 1 },
  { key: 'rh1', cssVar: '--rh-1', rgb: [122, 64, 26], a: 1 },
  { key: 'rh2', cssVar: '--rh-2', rgb: [31, 107, 112], a: 1 },
  { key: 'rh3', cssVar: '--rh-3', rgb: [46, 184, 191], a: 1 },
  { key: 'rh4', cssVar: '--rh-4', rgb: [224, 250, 245], a: 1 },
  { key: 'ohc0', cssVar: '--ohc-0', rgb: [4, 6, 31], a: 1 },
  { key: 'ohc1', cssVar: '--ohc-1', rgb: [26, 31, 107], a: 1 },
  { key: 'ohc2', cssVar: '--ohc-2', rgb: [107, 41, 148], a: 1 },
  { key: 'ohc3', cssVar: '--ohc-3', rgb: [230, 107, 64], a: 1 },
  { key: 'ohc4', cssVar: '--ohc-4', rgb: [255, 232, 107], a: 1 },
  { key: 'shear0', cssVar: '--shear-0', rgb: [8, 31, 66], a: 1 },
  { key: 'shear1', cssVar: '--shear-1', rgb: [0, 143, 179], a: 1 },
  { key: 'shear2', cssVar: '--shear-2', rgb: [115, 199, 77], a: 1 },
  { key: 'shear3', cssVar: '--shear-3', rgb: [250, 173, 31], a: 1 },
  { key: 'shear4', cssVar: '--shear-4', rgb: [217, 20, 64], a: 1 },
  { key: 'radar0', cssVar: '--radar-0', rgb: [5, 31, 66], a: 1 },
  { key: 'radar1', cssVar: '--radar-1', rgb: [0, 184, 209], a: 1 },
  { key: 'radar2', cssVar: '--radar-2', rgb: [51, 219, 77], a: 1 },
  { key: 'radar3', cssVar: '--radar-3', rgb: [250, 224, 26], a: 1 },
  { key: 'radar4', cssVar: '--radar-4', rgb: [250, 82, 20], a: 1 },
  { key: 'radar5', cssVar: '--radar-5', rgb: [204, 15, 122], a: 1 },
  { key: 'rainPlate', cssVar: '--rain-plate', rgb: [3, 6, 14], a: 1 },
  // Wind-speed palette (Windy-style flow map): calm indigo -> teal -> green ->
  // amber -> magenta across 0..50 m/s. Consumed by the wind fill shader, the
  // particle-trail colouring, and the rail legend gradient.
  { key: 'wind0', cssVar: '--wind-0', rgb: [40, 56, 110], a: 1 },
  { key: 'wind1', cssVar: '--wind-1', rgb: [46, 135, 150], a: 1 },
  { key: 'wind2', cssVar: '--wind-2', rgb: [88, 171, 88], a: 1 },
  { key: 'wind3', cssVar: '--wind-3', rgb: [227, 179, 57], a: 1 },
  { key: 'wind4', cssVar: '--wind-4', rgb: [204, 64, 120], a: 1 },
  // Storm-total accumulated-rain palette (impact proxy): dry -> soaked.
  { key: 'precip0', cssVar: '--precip-0', rgb: [10, 20, 34], a: 1 },
  { key: 'precip1', cssVar: '--precip-1', rgb: [38, 108, 168], a: 1 },
  { key: 'precip2', cssVar: '--precip-2', rgb: [62, 186, 130], a: 1 },
  { key: 'precip3', cssVar: '--precip-3', rgb: [240, 208, 74], a: 1 },
  { key: 'precip4', cssVar: '--precip-4', rgb: [201, 79, 157], a: 1 },
  // Saffir–Simpson category ramp — the standard tracker palette every storm map
  // uses (TD blue .. Cat-5 red), so the category of a track segment or chip is
  // readable on sight. Consumed by category.ts, track.ts, and the chip CSS.
  { key: 'catTd', cssVar: '--cat-td', rgb: [94, 186, 255], a: 1 },
  { key: 'catTs', cssVar: '--cat-ts', rgb: [0, 250, 244], a: 1 },
  { key: 'cat1', cssVar: '--cat-1', rgb: [255, 255, 204], a: 1 },
  { key: 'cat2', cssVar: '--cat-2', rgb: [255, 231, 117], a: 1 },
  { key: 'cat3', cssVar: '--cat-3', rgb: [255, 193, 64], a: 1 },
  { key: 'cat4', cssVar: '--cat-4', rgb: [255, 143, 32], a: 1 },
  { key: 'cat5', cssVar: '--cat-5', rgb: [255, 96, 96], a: 1 },
] as const;

export type TokenKey = (typeof RAW)[number]['key'];

/** A resolved token: its CSS var name, a ready CSS colour, and a shader uniform. */
export interface Token {
  cssVar: string;
  /** CSS-ready colour: `#rrggbb` when opaque, else `rgba(r,g,b,a)`. */
  css: string;
  /** Normalized [r,g,b,a] for gl.uniform4fv (r,g,b,a all in [0,1]). */
  rgba01: Float32Array;
}

function hex2(n: number): string {
  return n.toString(16).padStart(2, '0');
}

function toCss(rgb: readonly [number, number, number], a: number): string {
  if (a >= 1) return `#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}`;
  return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
}

function build(): Record<string, Token> {
  const out: Record<string, Token> = {};
  for (const t of RAW) {
    out[t.key] = {
      cssVar: t.cssVar,
      css: toCss(t.rgb, t.a),
      rgba01: new Float32Array([t.rgb[0] / 255, t.rgb[1] / 255, t.rgb[2] / 255, t.a]),
    };
  }
  return out;
}

/** All tokens keyed by camelCase name, e.g. TOKENS.oceanDeep.css / .rgba01. */
export const TOKENS: Record<TokenKey, Token> = build() as Record<TokenKey, Token>;

/** Shortcut: the shader uniform (normalized [r,g,b,a]) for a token. */
export function uniform(key: TokenKey): Float32Array {
  return TOKENS[key].rgba01;
}

/**
 * Inject every palette token as a CSS custom property, plus --space and
 * --radius, onto `target` (default :root). Call once at boot before styling.
 */
export function injectCssVars(target: HTMLElement = document.documentElement): void {
  for (const key of Object.keys(TOKENS) as TokenKey[]) {
    const t = TOKENS[key];
    target.style.setProperty(t.cssVar, t.css);
  }
  target.style.setProperty('--space', `${SPACING_UNIT}px`);
  target.style.setProperty('--radius', `${RADIUS}px`);
}
