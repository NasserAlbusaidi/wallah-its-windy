/**
 * impact.ts — deterministic landfall-impact bookkeeping for one storm run.
 *
 * Two jobs, both pure functions of the recorded physics ticks (no wall-clock,
 * no RNG, so a replayed seed reproduces the identical impact report):
 *
 *  1. A coarse storm-total rain grid (mm). Each fixed sim tick deposits the
 *     sim's separated rain rates (eyewall ring at RMW, spiral rainband annulus,
 *     orographic share on land) using the same spatial envelopes the rain
 *     shader draws, so the map layer and the numbers agree in structure. This
 *     is an explicit PARAMETRIC PROXY — the model publishes mm/h components,
 *     not an observed precipitation analysis — and every consumer labels it so.
 *
 *  2. Per-city exposure: peak parametric surface wind (Holland profile at the
 *     city's range/bearing), closest approach, and accumulated rain at the
 *     city cell, for the coastal cities a landfalling Arabian-Sea storm
 *     threatens. Drives the live impact strip and the debrief impact report.
 *
 * Flood risk is a labelled flash-flood PROXY tiered on storm-total rain —
 * Oman's wadi basins flood on burst totals, hence thresholds well below what a
 * humid climate would use. It is not a discharge or inundation model.
 */

import { DOMAIN, greatCircleKm } from './grid';
import { latLonToCell, cellToLatLon } from './grid';
import { hollandWindSpeedKt } from './structure';
import {
  SIMULATED_WIND_CONVENTION,
  northIndianOceanClassification,
} from './wind-conventions';
import type { BinLayer, LatLon, RainAccumView, StormState } from './types';
import {
  DEFAULT_RAIN_ACCUMULATION_WINDOW,
  rainAccumulationDefinition,
  type RainAccumulationWindow,
} from './rain-accumulation';

/** Grid resolution: 0.1° (~11 km) — impact bookkeeping, not a weather model. */
const GRID_NX = 200;
const GRID_NY = 120;
/** The simulation's fixed 15-minute rain-ledger cadence. */
const HISTORY_STEP_H = 0.25;
const HISTORY_CAPACITY = 24 / HISTORY_STEP_H;

/** Rainband spatial envelope bounds in RMW multiples (mirror of rain.ts). */
const BAND_INNER_Q = 1.45;
const BAND_OUTER_Q = 8;

/** Coastal cities a storm in this domain can matter to. */
export interface ImpactCity extends LatLon {
  id: string;
  label: string;
}

export const IMPACT_CITIES: readonly ImpactCity[] = [
  { id: 'muscat', label: 'muscat', lat: 23.588, lon: 58.383 },
  { id: 'sur', label: 'sur', lat: 22.567, lon: 59.529 },
  { id: 'masirah', label: 'masirah', lat: 20.674, lon: 58.89 },
  { id: 'duqm', label: 'duqm', lat: 19.65, lon: 57.7 },
  { id: 'salalah', label: 'salalah', lat: 17.02, lon: 54.09 },
  { id: 'gwadar', label: 'gwadar', lat: 25.12, lon: 62.325 },
  { id: 'karachi', label: 'karachi', lat: 24.86, lon: 67.01 },
  { id: 'chabahar', label: 'chabahar', lat: 25.29, lon: 60.643 },
] as const;

/** Flash-flood proxy tiers on storm-total rain (mm) near a point. */
export type FloodRisk = 'minimal' | 'moderate' | 'high' | 'extreme';

export function floodRiskTier(stormTotalMm: number): FloodRisk {
  if (stormTotalMm >= 150) return 'extreme';
  if (stormTotalMm >= 80) return 'high';
  if (stormTotalMm >= 30) return 'moderate';
  return 'minimal';
}

export interface CityImpact {
  city: ImpactCity;
  /** Peak parametric sustained wind experienced at the city, knots. */
  peakWindKt: number;
  /** Closest approach of the storm centre, km. */
  closestKm: number;
  /** Storm-total rain at the city cell, mm. */
  rainMm: number;
}

export interface ImpactSummary {
  /** Cities ordered by peak experienced wind, strongest first. */
  cities: CityImpact[];
  /** Highest storm-total rain over any land cell, mm. */
  maxLandRainMm: number;
  /** Flood proxy tier for that maximum. */
  floodRisk: FloodRisk;
  /** The city currently most exposed (closest with meaningful wind), or null. */
  live: CityImpact | null;
}

/**
 * Instantaneous parametric surface wind at one geographic point. Point probes,
 * city-marker glow, and accumulated city exposure all call this function so a
 * given frame can never produce three different footprint answers.
 */
export function windAtPointKt(storm: StormState, point: LatLon): number {
  const distanceKm = greatCircleKm(
    { lat: storm.lat, lon: storm.lon },
    point,
  );
  if (distanceKm > 600) return 0;
  const bearingDeg = bearingFromStorm(storm, point);
  return hollandWindSpeedKt(distanceKm, bearingDeg, storm.structure);
}

export class ImpactTracker {
  private readonly nx = GRID_NX;
  private readonly ny = GRID_NY;
  private totalMm = new Float32Array(GRID_NX * GRID_NY);
  private windowMm = new Float32Array(GRID_NX * GRID_NY);
  private depositMm = new Float32Array(GRID_NX * GRID_NY);
  private history = Array.from(
    { length: HISTORY_CAPACITY },
    () => new Float32Array(GRID_NX * GRID_NY),
  );
  private historyHead = 0;
  private historyCount = 0;
  private rainWindow: RainAccumulationWindow =
    DEFAULT_RAIN_ACCUMULATION_WINDOW;
  private version = 0;
  /** Land flag per impact cell, resampled from the terrain mask when it lands. */
  private land = new Uint8Array(GRID_NX * GRID_NY);
  private maxLandRainMm = 0;
  private cityPeakKt = new Float32Array(IMPACT_CITIES.length);
  private cityClosestKm = new Float32Array(IMPACT_CITIES.length).fill(Infinity);
  private view: RainAccumView = {
    nx: GRID_NX,
    ny: GRID_NY,
    bbox: DOMAIN,
    mm: this.totalMm,
    breaksMm: rainAccumulationDefinition(
      DEFAULT_RAIN_ACCUMULATION_WINDOW,
    ).breaksMm,
    version: 0,
  };

  /** Wire the baked land mask; refreshes the per-cell land flags. */
  setLandMask(layer: BinLayer | null): void {
    this.land.fill(0);
    if (!layer) return;
    for (let row = 0; row < this.ny; row++) {
      for (let col = 0; col < this.nx; col++) {
        const { lat, lon } = cellToLatLon(
          { nx: this.nx, ny: this.ny, bbox: DOMAIN },
          col,
          row,
        );
        const cell = latLonToCell(
          { nx: layer.nx, ny: layer.ny, bbox: layer.bbox },
          lat,
          lon,
        );
        const c = Math.max(0, Math.min(layer.nx - 1, Math.round(cell.col)));
        const r = Math.max(0, Math.min(layer.ny - 1, Math.round(cell.row)));
        this.land[row * this.nx + col] =
          layer.data[r * layer.nx + c] > 0.5 ? 1 : 0;
      }
    }
  }

  /** Start a fresh run: zero the grid and the city trackers. */
  reset(): void {
    this.totalMm.fill(0);
    this.windowMm.fill(0);
    this.depositMm.fill(0);
    this.historyHead = 0;
    this.historyCount = 0;
    this.maxLandRainMm = 0;
    this.cityPeakKt.fill(0);
    this.cityClosestKm.fill(Infinity);
    this.version++;
    this.view = {
      ...this.view,
      mm: this.rainWindow === 'storm' ? this.totalMm : this.windowMm,
      version: this.version,
    };
  }

  /** The render-facing grid view (bumped version signals a re-upload). */
  rainView(): RainAccumView {
    return this.view;
  }

  /**
   * Select the displayed ledger window. The storm-total/city bookkeeping stays
   * untouched; a finite window is rebuilt from the bounded 24-hour tick ring.
   */
  setRainWindow(window: RainAccumulationWindow): void {
    if (window === this.rainWindow) return;
    this.rainWindow = window;
    if (window !== 'storm') this.rebuildWindow(window);
    this.version++;
    this.view = {
      ...this.view,
      mm: window === 'storm' ? this.totalMm : this.windowMm,
      breaksMm: rainAccumulationDefinition(window).breaksMm,
      version: this.version,
    };
  }

  /**
   * Deposit one fixed physics step. `dtH` is the tick length in sim hours.
   * Mirrors the rain shader's spatial structure: an eyewall ring at RMW, a
   * spiral-free rainband annulus (azimuthal mean — bookkeeping, not pixels),
   * and the orographic component spread over land cells inside the annulus.
   */
  record(storm: StormState, dtH: number): void {
    if (!storm.alive || dtH <= 0) return;
    this.depositMm.fill(0);
    const d = storm.diagnostics;
    const s = storm.structure;
    const rainCenterLat = storm.lat + s.rainOffsetNorthKm / 111;
    const rainCenterLon =
      storm.lon +
      s.rainOffsetEastKm /
        (111 * Math.max(0.2, Math.cos((storm.lat * Math.PI) / 180)));
    const rmwKm = Math.max(8, s.rmwKm);
    const outerKm = Math.min(500, rmwKm * BAND_OUTER_Q);

    // Cell footprint in grid units around the rain centre.
    const kmPerRow = ((DOMAIN.latMax - DOMAIN.latMin) * 111) / this.ny;
    const cosLat = Math.max(0.2, Math.cos((storm.lat * Math.PI) / 180));
    const kmPerCol =
      ((DOMAIN.lonMax - DOMAIN.lonMin) * 111 * cosLat) / this.nx;
    const centre = latLonToCell(
      { nx: this.nx, ny: this.ny, bbox: DOMAIN },
      rainCenterLat,
      rainCenterLon,
    );
    const colSpan = Math.ceil(outerKm / kmPerCol) + 1;
    const rowSpan = Math.ceil(outerKm / kmPerRow) + 1;
    const c0 = Math.max(0, Math.floor(centre.col - colSpan));
    const c1 = Math.min(this.nx - 1, Math.ceil(centre.col + colSpan));
    const r0 = Math.max(0, Math.floor(centre.row - rowSpan));
    const r1 = Math.min(this.ny - 1, Math.ceil(centre.row + rowSpan));
    if (c1 >= c0 && r1 >= r0) {
      for (let row = r0; row <= r1; row++) {
        const dyKm = (row - centre.row) * kmPerRow;
        for (let col = c0; col <= c1; col++) {
          const dxKm = (col - centre.col) * kmPerCol;
          const radiusKm = Math.hypot(dxKm, dyKm);
          const q = radiusKm / rmwKm;
          const eyewall = Math.exp(-(((q - 1) / 0.38) ** 2));
          const bandEnvelope =
            smoothstep(BAND_INNER_Q, 2.0, q) *
            (1 - smoothstep(6.0, BAND_OUTER_Q, q));
          // Azimuthal mean of the shader's 0.68+0.32·sin spiral is 0.68.
          const index = row * this.nx + col;
          const onLand = this.land[index] === 1;
          const rateMmH =
            d.eyewallRainMmH * eyewall +
            d.rainbandRainMmH * bandEnvelope * 0.68 +
            (onLand ? d.orographicRainMmH * bandEnvelope : 0);
          if (rateMmH <= 0.01) continue;
          const deposited = rateMmH * dtH;
          this.depositMm[index] = deposited;
          const next = this.totalMm[index] + deposited;
          this.totalMm[index] = next;
          if (onLand && next > this.maxLandRainMm) this.maxLandRainMm = next;
        }
      }
    }
    // Push even an all-zero step: elapsed model time must age finite windows
    // out deterministically while a storm crosses a dry part of the domain.
    this.pushHistory(this.depositMm, dtH);
    this.version++;
    this.view = {
      ...this.view,
      mm: this.rainWindow === 'storm' ? this.totalMm : this.windowMm,
      version: this.version,
    };

    // City exposure: parametric Holland wind at the city's range and bearing.
    for (let i = 0; i < IMPACT_CITIES.length; i++) {
      const city = IMPACT_CITIES[i];
      const distanceKm = greatCircleKm(
        { lat: storm.lat, lon: storm.lon },
        city,
      );
      if (distanceKm < this.cityClosestKm[i]) {
        this.cityClosestKm[i] = distanceKm;
      }
      if (distanceKm > 600) continue;
      const windKt = windAtPointKt(storm, city);
      if (windKt > this.cityPeakKt[i]) this.cityPeakKt[i] = windKt;
    }
  }

  /** Rain accumulated at (lat,lon)'s cell, mm. */
  rainAtMm(lat: number, lon: number): number {
    return this.rainGridAtMm(this.totalMm, lat, lon);
  }

  /** Rain in the currently selected display window at (lat,lon), mm. */
  displayRainAtMm(lat: number, lon: number): number {
    return this.rainGridAtMm(this.view.mm, lat, lon);
  }

  private rainGridAtMm(
    grid: Float32Array,
    lat: number,
    lon: number,
  ): number {
    const cell = latLonToCell(
      { nx: this.nx, ny: this.ny, bbox: DOMAIN },
      lat,
      lon,
    );
    const c = Math.max(0, Math.min(this.nx - 1, Math.round(cell.col)));
    const r = Math.max(0, Math.min(this.ny - 1, Math.round(cell.row)));
    return grid[r * this.nx + c];
  }

  private pushHistory(deposit: Float32Array, dtH: number): void {
    // Runtime calls are exactly 0.25 h. Splitting keeps tests/tools that batch
    // several fixed steps honest without changing the production cadence.
    const pieces = Math.max(1, Math.round(dtH / HISTORY_STEP_H));
    const fraction = 1 / pieces;
    for (let piece = 0; piece < pieces; piece++) {
      const activeSteps = this.activeWindowSteps();
      if (activeSteps !== null && this.historyCount >= activeSteps) {
        const outgoing =
          (this.historyHead - activeSteps + HISTORY_CAPACITY) %
          HISTORY_CAPACITY;
        const old = this.history[outgoing];
        for (let index = 0; index < this.windowMm.length; index++) {
          this.windowMm[index] = Math.max(0, this.windowMm[index] - old[index]);
        }
      }

      const slot = this.history[this.historyHead];
      for (let index = 0; index < slot.length; index++) {
        const amount = deposit[index] * fraction;
        slot[index] = amount;
        if (activeSteps !== null) this.windowMm[index] += amount;
      }
      this.historyHead = (this.historyHead + 1) % HISTORY_CAPACITY;
      this.historyCount = Math.min(HISTORY_CAPACITY, this.historyCount + 1);
    }
  }

  private activeWindowSteps(): number | null {
    const hours = rainAccumulationDefinition(this.rainWindow).hours;
    return hours === null ? null : Math.round(hours / HISTORY_STEP_H);
  }

  private rebuildWindow(window: RainAccumulationWindow): void {
    this.windowMm.fill(0);
    const hours = rainAccumulationDefinition(window).hours;
    if (hours === null) return;
    const steps = Math.min(
      this.historyCount,
      Math.round(hours / HISTORY_STEP_H),
    );
    for (let offset = 1; offset <= steps; offset++) {
      const slot =
        this.history[
          (this.historyHead - offset + HISTORY_CAPACITY) % HISTORY_CAPACITY
        ];
      for (let index = 0; index < this.windowMm.length; index++) {
        this.windowMm[index] += slot[index];
      }
    }
  }

  /** Assemble the presentation summary. `storm` selects the live-exposure city. */
  summary(storm: StormState | null): ImpactSummary {
    const cities: CityImpact[] = IMPACT_CITIES.map((city, i) => ({
      city,
      peakWindKt: this.cityPeakKt[i],
      closestKm: this.cityClosestKm[i],
      rainMm: this.rainAtMm(city.lat, city.lon),
    })).sort((a, b) => b.peakWindKt - a.peakWindKt);

    let live: CityImpact | null = null;
    if (storm && storm.alive) {
      let bestKm = Infinity;
      for (const impact of cities) {
        const distanceKm = greatCircleKm(
          { lat: storm.lat, lon: storm.lon },
          impact.city,
        );
        const r34 = maxRadius(storm);
        // "In play": inside ~1.6× the gale footprint or within 250 km.
        if (
          distanceKm < Math.max(250, r34 * 1.6) &&
          distanceKm < bestKm
        ) {
          bestKm = distanceKm;
          live = impact;
        }
      }
    }
    return {
      cities,
      maxLandRainMm: this.maxLandRainMm,
      floodRisk: floodRiskTier(this.maxLandRainMm),
      live,
    };
  }
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  if (edge1 <= edge0) return value >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Bearing from the storm centre to a point, degrees clockwise from north. */
function bearingFromStorm(storm: StormState, to: LatLon): number {
  const cosLat = Math.max(0.2, Math.cos((storm.lat * Math.PI) / 180));
  const eastKm = (to.lon - storm.lon) * 111 * cosLat;
  const northKm = (to.lat - storm.lat) * 111;
  return ((Math.atan2(eastKm, northKm) * 180) / Math.PI + 360) % 360;
}

function maxRadius(storm: StormState): number {
  const r = storm.structure.r34Km;
  return Math.max(r.ne, r.se, r.sw, r.nw);
}

/**
 * Regional phrase for a city's modeled sustained wind. Simulator values retain
 * their one-minute convention; the phrase is an indicative RSMC band, not an
 * averaging-period conversion or a gust/damage forecast.
 */
export function experiencedWindPhrase(peakWindKt: number): string {
  if (peakWindKt < 20) return 'light winds';
  const { category } = northIndianOceanClassification(
    peakWindKt,
    SIMULATED_WIND_CONVENTION.averagingMinutes,
  );
  return `${category.name} winds (indicative)`;
}
