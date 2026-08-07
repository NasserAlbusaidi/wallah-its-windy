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
  type RegionRainSummary,
} from './impact';
import { rainAccumulationDefinition } from './rain-accumulation';
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

/**
 * Async ensemble state for the board block. Counts are members, never
 * percentages: HF-4 rejected the calibrated-probability claim, so the board
 * reports raw perturbation frequencies as "N of M members".
 */
export interface EnsembleBoardSummary {
  state: 'running' | 'done';
  memberCount: number;
  /** Members completed so far (running state; equals memberCount when done). */
  completed: number;
  /** Members whose peak reached hurricane strength (>= 64 kt 1-min). */
  hurricaneCount: number;
  /** Members that made landfall. */
  landfallCount: number;
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
  /** null hides the ensemble block (no run yet, cleared on spawn). */
  ensemble: EnsembleBoardSummary | null;
  /** Whether member spaghetti is currently shown (drives the toggle label). */
  ensembleMembersShown: boolean;
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

/** One worst-hit-region row: plain text, never flood-tiered (areal proxy). */
export interface ImpactBoardRegionRow {
  id: string;
  label: string;
  windowText: string;
  stormText: string;
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
  /** null hides the regions block (data absent or nothing >= 1 mm yet). */
  regionsTitle: string | null;
  regionRows: ImpactBoardRegionRow[];
  /** null hides the ensemble block. */
  ensembleTitle: string | null;
  ensembleLines: string[];
  /** null hides the member-tracks toggle (while running). */
  ensembleToggleText: string | null;
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
  regionsTitle: null,
  regionRows: [],
  ensembleTitle: null,
  ensembleLines: [],
  ensembleToggleText: null,
  allClearText: null,
  key: '',
};

function regionsBlock(regions: RegionRainSummary | null): {
  title: string | null;
  rows: ImpactBoardRegionRow[];
} {
  if (!regions || regions.rows.length === 0) return { title: null, rows: [] };
  const definition = rainAccumulationDefinition(regions.window);
  const title =
    definition.hours === null
      ? 'worst-hit regions · storm total'
      : `worst-hit regions · trailing ${definition.label}`;
  return {
    title,
    rows: regions.rows.map((row) => ({
      id: `${row.kind}:${row.id}`,
      label: row.name,
      windowText: `${Math.round(row.windowMaxMm)} mm`,
      stormText: `${Math.round(row.stormMaxMm)} mm`,
    })),
  };
}

function ensembleBlock(
  summary: EnsembleBoardSummary | null,
  membersShown: boolean,
): { title: string | null; lines: string[]; toggleText: string | null } {
  if (!summary) return { title: null, lines: [], toggleText: null };
  const title = 'ensemble outlook · perturbation frequency';
  if (summary.state === 'running') {
    return {
      title,
      lines: [`computing members ${summary.completed}/${summary.memberCount}…`],
      toggleText: null,
    };
  }
  const of = `of ${summary.memberCount} members`;
  return {
    title,
    lines: [
      `hurricane-strength — ${summary.hurricaneCount} ${of}`,
      `landfall — ${summary.landfallCount} ${of}`,
    ],
    toggleText: membersShown ? 'hide member tracks' : 'show member tracks',
  };
}

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
  // The landfall milestone is recorded live at the coast crossing, long
  // before the debrief exists — a landfalling storm must not read "over
  // water" for its whole inland phase. Coordinates only ship with the
  // debrief, so live the fact is the hour offset alone.
  if (landfallAgeH !== null) return `ashore +${Math.round(landfallAgeH)} h`;
  return 'over water';
}

export interface ImpactBoardElements {
  root: HTMLElement;
  headline: HTMLElement;
  peak: HTMLElement;
  landfall: HTMLElement;
  rain: HTMLElement;
  flood: HTMLElement;
  cities: HTMLElement;
  /** Regions block wrapper (hidden when the model has no rows). */
  regionsWrap: HTMLElement;
  regionsTitle: HTMLElement;
  regionRows: HTMLElement;
  /** Ensemble block wrapper (hidden when no run exists for this storm). */
  ensembleWrap: HTMLElement;
  ensembleTitle: HTMLElement;
  ensembleLines: HTMLElement;
  ensembleToggle: HTMLButtonElement;
  allClear: HTMLElement;
}

/**
 * Thin DOM writer: repaints only when the model's change-detection key moves
 * (the recorder repaints every rAF; this keeps the board O(1) per frame).
 */
export class ImpactBoardView {
  private key = '';

  constructor(
    private readonly el: ImpactBoardElements,
    private readonly onCitySelect: (cityId: string) => void,
    onToggleMembers: () => void,
  ) {
    // Compact-strip expander: CSS only reacts to data-expanded under the
    // mobile breakpoints, so this toggle is inert on desktop.
    el.root.querySelector('header')?.addEventListener('click', () => {
      el.root.dataset.expanded =
        el.root.dataset.expanded === 'true' ? 'false' : 'true';
    });
    el.ensembleToggle.addEventListener('click', onToggleMembers);
  }

  update(model: ImpactBoardModel): void {
    this.el.root.hidden = !model.visible;
    if (!model.visible) {
      this.key = '';
      return;
    }
    if (model.key === this.key) return;
    this.key = model.key;
    this.el.headline.textContent = model.headline;
    this.el.peak.textContent = model.peakText;
    this.el.landfall.textContent = model.landfallText;
    this.el.rain.textContent = model.rainText;
    this.el.flood.dataset.risk = model.floodRisk ?? 'minimal';
    this.el.flood.textContent = model.floodText;
    this.el.allClear.hidden = model.allClearText === null;
    this.el.allClear.textContent = model.allClearText ?? '';
    this.el.regionsWrap.hidden = model.regionsTitle === null;
    this.el.regionsTitle.textContent = model.regionsTitle ?? '';
    this.el.regionRows.replaceChildren(
      ...model.regionRows.map((row) => {
        const item = document.createElement('div');
        item.className = 'impact-board-region';
        item.setAttribute('role', 'listitem');
        // The visual column headers are aria-hidden; give screen readers the
        // column meaning per row instead of two bare numbers.
        item.setAttribute(
          'aria-label',
          `${row.label}: ${row.windowText} in the selected window, ` +
            `${row.stormText} storm total, simulated`,
        );
        const label = document.createElement('span');
        label.className = 'impact-board-city';
        label.textContent = row.label;
        const win = document.createElement('span');
        win.textContent = row.windowText;
        const total = document.createElement('span');
        total.textContent = row.stormText;
        item.append(label, win, total);
        return item;
      }),
    );
    this.el.ensembleWrap.hidden = model.ensembleTitle === null;
    this.el.ensembleTitle.textContent = model.ensembleTitle ?? '';
    this.el.ensembleLines.replaceChildren(
      ...model.ensembleLines.map((line) => {
        const item = document.createElement('div');
        item.className = 'impact-board-ensemble-line';
        item.setAttribute('role', 'listitem');
        item.textContent = line;
        return item;
      }),
    );
    this.el.ensembleToggle.hidden = model.ensembleToggleText === null;
    this.el.ensembleToggle.textContent = model.ensembleToggleText ?? '';
    this.el.cities.replaceChildren(
      ...model.rows.map((row) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'impact-board-row';
        button.setAttribute('role', 'listitem');
        if (row.tint) button.style.setProperty('--row-tint', row.tint);
        const label = document.createElement('span');
        label.className = 'impact-board-city';
        label.textContent = row.label;
        const now = document.createElement('output');
        now.textContent = row.nowText;
        const peak = document.createElement('span');
        peak.textContent = row.peakText;
        const rain = document.createElement('span');
        rain.textContent = row.rainText;
        button.append(label, now, peak, rain);
        button.addEventListener('click', () => this.onCitySelect(row.id));
        return button;
      }),
    );
  }
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
  const rainText = `max storm-total ${Math.round(impact.maxLandRainMm)} mm over land`;
  const floodText = `flash-flood proxy ${impact.floodRisk}`;
  const regions = regionsBlock(impact.regions);
  const ensemble = ensembleBlock(input.ensemble, input.ensembleMembersShown);
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
    regions.title ?? '',
    ...regions.rows.map(
      (row) => `${row.id}:${row.windowText}:${row.stormText}`,
    ),
    ensemble.title ?? '',
    ...ensemble.lines,
    ensemble.toggleText ?? '',
    // tint participates so an unrounded threshold crossing (peak 19.9 -> 20.1
    // or a category boundary) repaints even when every rounded text is stable.
    ...cityRows.map(
      (row) =>
        `${row.id}:${row.nowText}:${row.peakText}:${row.rainText}:${row.tint ?? ''}`,
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
    regionsTitle: regions.title,
    regionRows: regions.rows,
    ensembleTitle: ensemble.title,
    ensembleLines: ensemble.lines,
    ensembleToggleText: ensemble.toggleText,
    allClearText,
    key,
  };
}
