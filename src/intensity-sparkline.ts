/** Pure geometry for the flight-tape wind-versus-time sparkline. */

export interface IntensityPoint {
  ageH: number;
  vKt: number;
}

export interface SparklinePoint extends IntensityPoint {
  x: number;
  y: number;
}

export interface IntensitySparklineGeometry {
  path: string;
  points: SparklinePoint[];
  peakIndex: number;
  maxWindKt: number;
}

export function buildIntensitySparkline(
  series: readonly IntensityPoint[],
  width = 100,
  height = 32,
): IntensitySparklineGeometry {
  if (series.length === 0) {
    return { path: '', points: [], peakIndex: 0, maxWindKt: 160 };
  }
  const startH = series[0].ageH;
  const endH = series.at(-1)!.ageH;
  const durationH = Math.max(1e-9, endH - startH);
  let peakIndex = 0;
  for (let index = 1; index < series.length; index++) {
    if (series[index].vKt > series[peakIndex].vKt) peakIndex = index;
  }
  const maxWindKt = Math.max(160, Math.ceil(series[peakIndex].vKt / 20) * 20);
  const points = series.map((point) => ({
    ...point,
    x: ((point.ageH - startH) / durationH) * width,
    y: height - (Math.max(0, point.vKt) / maxWindKt) * height,
  }));
  const path = points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`,
    )
    .join(' ');
  return { path, points, peakIndex, maxWindKt };
}

export function nearestIntensityIndex(
  series: readonly IntensityPoint[],
  fraction: number,
): number {
  if (series.length <= 1) return 0;
  const clamped = Math.max(0, Math.min(1, fraction));
  const target =
    series[0].ageH + (series.at(-1)!.ageH - series[0].ageH) * clamped;
  let best = 0;
  let distance = Math.abs(series[0].ageH - target);
  for (let index = 1; index < series.length; index++) {
    const nextDistance = Math.abs(series[index].ageH - target);
    if (nextDistance < distance) {
      best = index;
      distance = nextDistance;
    }
  }
  return best;
}
