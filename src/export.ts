/**
 * export.ts — dependency-free storm artifacts.
 *
 * The PNG card and WebM loop are rendered from the immutable flight tape, not
 * by rewinding the engine. The current WebGL map is frozen once as the nautical
 * chart background; the recorded track, storm marker, and summary are redrawn
 * deterministically on a dedicated export canvas.
 */

import type { RunComparison } from './comparison';
import type {
  FlightFrame,
  FlightRunSnapshot,
} from './flight-recorder';
import { DOMAIN, offsetKm } from './grid';
import {
  maxWindRadiusKm,
  windRadiusFromQuadrantsKm,
} from './structure';
import type { WindRadiiKm } from './types';

const WIDTH = 1600;
const HEIGHT = 900;
const CYAN = '#78dcff';
const PALE = '#e8f4ff';
const ORANGE = '#ffb74d';
const DEEP = '#050a12';

export interface StormExport {
  run: FlightRunSnapshot;
  comparison: RunComparison | null;
  mapCanvas: HTMLCanvasElement;
}

function exportCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  return canvas;
}

function freezeMap(source: HTMLCanvasElement): HTMLCanvasElement {
  const frozen = exportCanvas();
  const ctx = frozen.getContext('2d');
  if (!ctx) throw new Error('2D export context unavailable');
  ctx.fillStyle = DEEP;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.drawImage(source, 0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = 'rgba(5, 10, 18, 0.26)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  return frozen;
}

function point(frame: Pick<FlightFrame, 'lat' | 'lon'>): [number, number] {
  return [
    ((frame.lon - DOMAIN.lonMin) / (DOMAIN.lonMax - DOMAIN.lonMin)) * WIDTH,
    ((DOMAIN.latMax - frame.lat) / (DOMAIN.latMax - DOMAIN.latMin)) * HEIGHT,
  ];
}

function drawTrack(
  ctx: CanvasRenderingContext2D,
  frames: readonly Pick<FlightFrame, 'lat' | 'lon'>[],
  color: string,
  width: number,
): void {
  if (frames.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([5, 11]);
  ctx.beginPath();
  frames.forEach((frame, index) => {
    const [x, y] = point(frame);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.restore();
}

function drawWindRing(
  ctx: CanvasRenderingContext2D,
  frame: FlightFrame,
  radii: WindRadiiKm,
  color: string,
  width: number,
  dash: number[],
): void {
  if (maxWindRadiusKm(radii) <= 0) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.lineJoin = 'round';
  ctx.beginPath();
  for (let step = 0; step <= 72; step++) {
    const bearing = step * 5;
    const angle = (bearing * Math.PI) / 180;
    const radiusKm = windRadiusFromQuadrantsKm(radii, bearing);
    const location = offsetKm(
      frame.lat,
      frame.lon,
      Math.sin(angle),
      Math.cos(angle),
      radiusKm,
    );
    const [x, y] = point(location);
    if (step === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function duration(h: number): string {
  return h < 24 ? `${Math.round(h)} h` : `${(h / 24).toFixed(1)} days`;
}

function signed(value: number, unit: string): string {
  const rounded = Math.round(value);
  if (rounded === 0) return `no ${unit} change`;
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)} ${unit}`;
}

function drawType(
  ctx: CanvasRenderingContext2D,
  run: FlightRunSnapshot,
  frame: FlightFrame,
  comparison: RunComparison | null,
): void {
  const death = run.debrief.death;
  const panel = ctx.createLinearGradient(0, HEIGHT * 0.54, 0, HEIGHT);
  panel.addColorStop(0, 'rgba(5, 10, 18, 0)');
  panel.addColorStop(0.32, 'rgba(5, 10, 18, 0.86)');
  panel.addColorStop(1, 'rgba(5, 10, 18, 0.98)');
  ctx.fillStyle = panel;
  ctx.fillRect(0, HEIGHT * 0.48, WIDTH, HEIGHT * 0.52);

  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = ORANGE;
  ctx.font = '500 22px "IBM Plex Mono", monospace';
  ctx.fillText('WALLAH IT’S WINDY · FLIGHT TAPE', 70, 690);

  ctx.fillStyle = PALE;
  ctx.font = '500 42px "IBM Plex Mono", monospace';
  ctx.fillText(run.meta.label.toUpperCase(), 70, 752);

  ctx.fillStyle = CYAN;
  ctx.font = '400 23px "IBM Plex Mono", monospace';
  const structureMetrics = [
    `FRAME ${Math.round(frame.ageH)} H`,
    `WIND ${Math.round(frame.vKt)} KT`,
    `MSLP ${Math.round(frame.structure.centralPressureHpa)} HPA`,
    `RMW ${Math.round(frame.structure.rmwKm)} KM`,
    `R34 ${Math.round(maxWindRadiusKm(frame.structure.r34Km))} KM`,
  ];
  ctx.fillText(structureMetrics.join('   ·   '), 70, 798);

  const outcomeMetrics = [
    `PEAK ${Math.round(death.peakKt)} KT`,
    `LIFE ${duration(death.durationH)}`,
    `MUSCAT ${Math.round(death.closestApproachKm)} KM`,
  ];
  ctx.fillText(outcomeMetrics.join('   ·   '), 70, 832);

  ctx.fillStyle = 'rgba(127, 212, 232, 0.62)';
  ctx.font = '400 18px "IBM Plex Mono", monospace';
  const contract = run.meta.counterfactual
    ? 'COUNTERFACTUAL ENVIRONMENT · OBSERVED TRACK IS REFERENCE, NOT A HINDCAST'
    : `GENESIS ${run.meta.spawn.lat.toFixed(2)}°N ${run.meta.spawn.lon.toFixed(2)}°E · SEED ${run.meta.seed}`;
  ctx.fillText(contract, 70, 870);

  if (comparison) {
    ctx.textAlign = 'right';
    ctx.fillStyle = ORANGE;
    ctx.fillText(
      `${comparison.baseline.meta.label.toUpperCase()} → ${signed(comparison.peakDeltaKt, 'KT PEAK')}`,
      WIDTH - 70,
      690,
    );
    ctx.textAlign = 'left';
  }
}

function drawStorm(
  canvas: HTMLCanvasElement,
  frozenMap: HTMLCanvasElement,
  run: FlightRunSnapshot,
  frameIndex: number,
  comparison: RunComparison | null,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D export context unavailable');
  const index = Math.max(0, Math.min(run.frames.length - 1, frameIndex));
  const frame = run.frames[index];
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.drawImage(frozenMap, 0, 0);

  if (comparison) {
    drawTrack(ctx, comparison.baseline.frames, 'rgba(255, 183, 77, 0.56)', 3);
  }
  drawTrack(ctx, run.frames.slice(0, index + 1), 'rgba(120, 220, 255, 0.78)', 4);
  drawWindRing(
    ctx,
    frame,
    frame.structure.r34Km,
    'rgba(120, 220, 255, 0.22)',
    2,
    [5, 10],
  );
  drawWindRing(
    ctx,
    frame,
    frame.structure.r64Km,
    'rgba(232, 244, 255, 0.34)',
    2,
    [3, 6],
  );
  const rmw = {
    ne: frame.structure.rmwKm,
    se: frame.structure.rmwKm,
    sw: frame.structure.rmwKm,
    nw: frame.structure.rmwKm,
  };
  drawWindRing(ctx, frame, rmw, 'rgba(255, 183, 77, 0.5)', 2, []);

  const [x, y] = point(frame);
  const radius = 24 + Math.max(0, frame.vKt - 20) * 0.32;
  const halo = ctx.createRadialGradient(x, y, 0, x, y, radius);
  halo.addColorStop(0, 'rgba(232, 244, 255, 0.95)');
  halo.addColorStop(0.22, 'rgba(120, 220, 255, 0.72)');
  halo.addColorStop(1, 'rgba(120, 220, 255, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  drawType(ctx, run, frame, comparison);
}

function asBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Export encoding failed'))),
      type,
    );
  });
}

export function exportFileStem(run: FlightRunSnapshot): string {
  const clean = run.meta.label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `wallah-its-windy-${clean || 'storm'}-${run.meta.seed}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function makeDebriefCard(input: StormExport): Promise<Blob> {
  await document.fonts?.ready;
  const canvas = exportCanvas();
  const frozenMap = freezeMap(input.mapCanvas);
  drawStorm(
    canvas,
    frozenMap,
    input.run,
    input.run.frames.length - 1,
    input.comparison,
  );
  return asBlob(canvas, 'image/png');
}

function preferredMimeType(): string {
  for (const candidate of [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ]) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return '';
}

export async function makeReplayVideo(
  input: StormExport,
  durationMs = 10_000,
): Promise<Blob> {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Replay recording is not supported by this browser');
  }
  await document.fonts?.ready;
  const canvas = exportCanvas();
  const frozenMap = freezeMap(input.mapCanvas);
  const stream = canvas.captureStream(30);
  const mimeType = preferredMimeType();
  const recorder = new MediaRecorder(
    stream,
    mimeType ? { mimeType, videoBitsPerSecond: 6_000_000 } : undefined,
  );
  const chunks: BlobPart[] = [];
  recorder.addEventListener('dataavailable', (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });

  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.addEventListener('stop', () => {
      stream.getTracks().forEach((track) => track.stop());
      resolve(new Blob(chunks, { type: recorder.mimeType || 'video/webm' }));
    });
    recorder.addEventListener('error', () => {
      stream.getTracks().forEach((track) => track.stop());
      reject(new Error('Replay recording failed'));
    });
  });

  recorder.start(250);
  const start = performance.now();
  await new Promise<void>((resolve) => {
    const paint = (now: number): void => {
      const fraction = Math.min(1, (now - start) / durationMs);
      const index = Math.round(fraction * (input.run.frames.length - 1));
      drawStorm(canvas, frozenMap, input.run, index, input.comparison);
      if (fraction >= 1) {
        resolve();
        return;
      }
      requestAnimationFrame(paint);
    };
    requestAnimationFrame(paint);
  });
  recorder.stop();
  return stopped;
}
