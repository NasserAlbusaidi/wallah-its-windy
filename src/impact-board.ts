/**
 * impact-board.ts — the ONE always-visible storm-effects surface.
 *
 * A pure view-model builder (`buildImpactBoardModel`) turns per-frame read
 * views (storm frame, deterministic ImpactSummary ledger, debrief) into fully
 * formatted display strings, and a thin `ImpactBoardView` writes them to the
 * DOM only when the change-detection key moves. Nothing here is recorded
 * output and nothing feeds back into the sim: the board is presentation over
 * parametric proxies, and its copy must keep saying so ("parametric proxy",
 * "flash-flood proxy"). Landfall is always a recorded fact, never an ETA —
 * a predicted landfall would be a forecast claim this product must not make.
 */

import type { StormState } from './types';
import { greatCircleKm } from './grid';
import {
  experiencedWindPhrase,
  IMPACT_CITIES,
  type FloodRisk,
  type ImpactSummary,
} from './impact';
import type { StormDebrief } from './flight-recorder';
import { categoryRgba } from './category';
import {
  SIMULATED_WIND_CONVENTION,
  northIndianOceanClassification,
} from './wind-conventions';

/** "19.7°n 57.4°e" — moved verbatim from ui.ts so both modules share it. */
export function formatLatLon(lat: number, lon: number): string {
  const ns = lat < 0 ? 's' : 'n';
  const ew = lon < 0 ? 'w' : 'e';
  return `${Math.abs(lat).toFixed(1)}°${ns} ${Math.abs(lon).toFixed(1)}°${ew}`;
}

export interface ImpactBoardInput {
  storm: StormState | null;
  isDemo: boolean;
  impact: ImpactSummary | null;
  /** null while the storm is still running. */
  debrief: StormDebrief | null;
  landfallKt: number | null;
  /** Hours into the run at landfall, or null when unknown. */
  landfallAgeH: number | null;
  /** Max recorded 1-min wind so far (falls back to debrief peak on complete). */
  peakSoFarKt: number;
  /** City id -> parametric wind at the displayed frame (replay-aware). */
  nowWindsKt: ReadonlyMap<string, number>;
}

export interface ImpactBoardCityRow {
  id: string;
  label: string;
  nowText: string;
  peakText: string;
  rainText: string;
  /** Category tint for rows whose run peak reached 20 kt, else null. */
  tint: string | null;
}

export interface ImpactBoardModel {
  visible: boolean;
  headline: string;
  peakText: string;
  landfallText: string;
  rainText: string;
  floodRisk: FloodRisk | null;
  floodText: string;
  rows: ImpactBoardCityRow[];
  allClearText: string | null;
  key: string;
}

const HIDDEN_MODEL: ImpactBoardModel = {
  visible: false,
  headline: '',
  peakText: '',
  landfallText: '',
  rainText: '',
  floodRisk: null,
  floodText: '',
  rows: [],
  allClearText: null,
  key: '',
};

/** Threshold below which a city's run exposure counts as no damaging wind. */
const DAMAGING_WIND_KT = 20;

function liveHeadline(storm: StormState, impact: ImpactSummary): string {
  const live = impact.live;
  if (!live) return "open water · no city in the storm's reach";
  const km = Math.round(
    greatCircleKm({ lat: storm.lat, lon: storm.lon }, live.city),
  );
  if (live.peakWindKt >= DAMAGING_WIND_KT) {
    return (
      `${live.city.label} · ${km} km · ` +
      `${experiencedWindPhrase(live.peakWindKt)} so far · ` +
      `${Math.round(live.rainMm)} mm rain`
    );
  }
  return `watching ${live.city.label} · ${km} km out`;
}

function completeHeadline(
  debrief: StormDebrief,
  landfallKt: number | null,
): string {
  if (debrief.landfall && landfallKt !== null) {
    const landfallCategory = northIndianOceanClassification(
      landfallKt,
      SIMULATED_WIND_CONVENTION.averagingMinutes,
    );
    return (
      `ashore in the indicative ${landfallCategory.category.name} band · ` +
      `${Math.round(landfallKt)} kt 1-min near ` +
      formatLatLon(debrief.landfall.lat, debrief.landfall.lon)
    );
  }
  const closestKm = debrief.death.closestApproachKm;
  return !Number.isFinite(closestKm)
    ? 'stayed offshore · never neared muscat'
    : closestKm <= 25
      ? 'stayed offshore · skirted muscat inside 25 km'
      : `stayed offshore · closest pass ${Math.round(closestKm)} km from muscat`;
}

function landfallFact(
  debrief: StormDebrief | null,
  landfallAgeH: number | null,
): string {
  if (debrief?.landfall) {
    const age = landfallAgeH === null ? '' : ` +${Math.round(landfallAgeH)} h`;
    const at = formatLatLon(debrief.landfall.lat, debrief.landfall.lon);
    return `ashore${age} near ${at}`;
  }
  if (debrief) return 'none · stayed offshore';
  return 'over water';
}

export function buildImpactBoardModel(
  input: ImpactBoardInput,
): ImpactBoardModel {
  const { storm, impact, debrief } = input;
  if (!storm || input.isDemo || !impact) return HIDDEN_MODEL;

  const byCityId = new Map(
    impact.cities.map((entry) => [entry.city.id, entry]),
  );
  const rows = IMPACT_CITIES.map((city, catalogueIndex) => {
    const run = byCityId.get(city.id);
    const nowKt = input.nowWindsKt.get(city.id) ?? 0;
    const peakKt = run?.peakWindKt ?? 0;
    const closestKm = run?.closestKm ?? Number.POSITIVE_INFINITY;
    const rainMm = run?.rainMm ?? 0;
    return { city, catalogueIndex, nowKt, peakKt, closestKm, rainMm };
  });
  rows.sort(
    (a, b) =>
      b.nowKt - a.nowKt ||
      b.peakKt - a.peakKt ||
      a.closestKm - b.closestKm ||
      a.catalogueIndex - b.catalogueIndex,
  );
  const cityRows: ImpactBoardCityRow[] = rows.map((row) => ({
    id: row.city.id,
    label: row.city.label,
    nowText: Math.round(row.nowKt) === 0 ? '—' : `${Math.round(row.nowKt)} kt`,
    peakText: `${Math.round(row.peakKt)} kt`,
    rainText: `${Math.round(row.rainMm)} mm`,
    tint: row.peakKt >= DAMAGING_WIND_KT ? categoryRgba(row.peakKt, 0.18) : null,
  }));

  const headline = debrief
    ? completeHeadline(debrief, input.landfallKt)
    : liveHeadline(storm, impact);
  const peakText = `${Math.round(debrief ? debrief.death.peakKt : input.peakSoFarKt)} kt 1-min`;
  const landfallText = landfallFact(debrief, input.landfallAgeH);
  const rainText = `max ${Math.round(impact.maxLandRainMm)} mm over land`;
  const floodText = `flash-flood proxy ${impact.floodRisk}`;
  const allClearText = rows.every((row) => row.peakKt < DAMAGING_WIND_KT)
    ? 'no damaging winds reached any city'
    : null;

  const key = [
    headline,
    peakText,
    landfallText,
    rainText,
    floodText,
    allClearText ?? '',
    ...cityRows.map(
      (row) => `${row.id}:${row.nowText}:${row.peakText}:${row.rainText}`,
    ),
  ].join('|');

  return {
    visible: true,
    headline,
    peakText,
    landfallText,
    rainText,
    floodRisk: impact.floodRisk,
    floodText,
    rows: cityRows,
    allClearText,
    key,
  };
}
