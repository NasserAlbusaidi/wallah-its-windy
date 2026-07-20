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
