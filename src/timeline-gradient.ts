/**
 * timeline-gradient.ts — paints the flight-recorder tape as a CSS gradient.
 * Pure: frames in, `linear-gradient(...)` string out. The scrubber track uses
 * it so the storm's whole life is category-readable at a glance (design spec
 * 2026-07-26). Hard stops, no blending: category boundaries are discrete.
 */
import { categoryRgba, stormCategory } from './category';

export function categoryGradientCss(
  frames: readonly { vKt: number; ageH: number }[],
): string {
  if (frames.length === 0) return 'none';

  const endH = frames[frames.length - 1].ageH || 1;
  const stops: string[] = [];
  let currentName = stormCategory(frames[0].vKt).name;
  let currentColor = categoryRgba(frames[0].vKt, 1);
  stops.push(`${currentColor} 0%`);

  for (const frame of frames) {
    const category = stormCategory(frame.vKt);
    if (category.name !== currentName) {
      const pct = ((frame.ageH / endH) * 100).toFixed(1).replace(/\.0$/, '');
      stops.push(
        `${currentColor} ${pct}%`,
        `${categoryRgba(frame.vKt, 1)} ${pct}%`,
      );
      currentName = category.name;
      currentColor = categoryRgba(frame.vKt, 1);
    }
  }

  stops.push(`${currentColor} 100%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
