import { describe, expect, it } from 'vitest';
import {
  buildImpactBoardModel,
  formatLatLon,
  type ImpactBoardInput,
} from '../src/impact-board';
import { IMPACT_CITIES, type ImpactSummary } from '../src/impact';
import type { StormState } from '../src/types';
import type { StormDebrief } from '../src/flight-recorder';

const storm = { lat: 20.0, lon: 60.0, alive: true } as unknown as StormState;

function summaryWith(over: Partial<ImpactSummary> = {}): ImpactSummary {
  return {
    cities: IMPACT_CITIES.map((city) => ({
      city,
      peakWindKt: 0,
      closestKm: Number.POSITIVE_INFINITY,
      rainMm: 0,
    })),
    maxLandRainMm: 0,
    floodRisk: 'minimal',
    live: null,
    ...over,
  };
}

function inputWith(over: Partial<ImpactBoardInput> = {}): ImpactBoardInput {
  return {
    storm,
    isDemo: false,
    impact: summaryWith(),
    debrief: null,
    landfallKt: null,
    landfallAgeH: null,
    peakSoFarKt: 45,
    nowWindsKt: new Map(),
    ...over,
  };
}

describe('impact board model', () => {
  it('hides without a storm, on demo, or without impact data', () => {
    expect(buildImpactBoardModel(inputWith({ storm: null })).visible).toBe(
      false,
    );
    expect(buildImpactBoardModel(inputWith({ isDemo: true })).visible).toBe(
      false,
    );
    expect(buildImpactBoardModel(inputWith({ impact: null })).visible).toBe(
      false,
    );
    expect(buildImpactBoardModel(inputWith()).visible).toBe(true);
  });

  it('ranks rows by now-wind, then peak, then closest approach, then catalogue', () => {
    const impact = summaryWith();
    const sur = impact.cities.find((c) => c.city.id === 'sur')!;
    const duqm = impact.cities.find((c) => c.city.id === 'duqm')!;
    const masirah = impact.cities.find((c) => c.city.id === 'masirah')!;
    sur.peakWindKt = 80; // high peak, no current wind
    duqm.peakWindKt = 40; // lower peak but current wind below
    masirah.peakWindKt = 40; // ties duqm on peak, closer approach
    duqm.closestKm = 120;
    masirah.closestKm = 60;
    const model = buildImpactBoardModel(
      inputWith({
        impact,
        nowWindsKt: new Map([
          ['duqm', 55],
          ['masirah', 55],
        ]),
      }),
    );
    const order = model.rows.map((row) => row.id);
    // duqm & masirah lead on now-wind (tie) -> equal peaks -> masirah closer
    expect(order.slice(0, 3)).toEqual(['masirah', 'duqm', 'sur']);
    expect(model.rows).toHaveLength(IMPACT_CITIES.length);
  });

  it('live headline tracks the most exposed city and never shows an ETA', () => {
    const impact = summaryWith();
    const live = impact.cities.find((c) => c.city.id === 'masirah')!;
    live.peakWindKt = 52;
    live.rainMm = 31.6;
    impact.live = live;
    const model = buildImpactBoardModel(inputWith({ impact }));
    expect(model.headline).toContain('masirah');
    expect(model.headline).toContain('so far');
    expect(model.landfallText).toBe('over water');
    expect(model.key.toLowerCase()).not.toContain('eta');
  });

  it('watching-state headline when the live city is under 20 kt', () => {
    const impact = summaryWith();
    const live = impact.cities.find((c) => c.city.id === 'sur')!;
    live.peakWindKt = 8;
    impact.live = live;
    const model = buildImpactBoardModel(inputWith({ impact }));
    expect(model.headline).toMatch(/^watching sur · \d+ km out$/);
  });

  it('open-water headline when nothing is in reach', () => {
    const model = buildImpactBoardModel(inputWith());
    expect(model.headline).toBe("open water · no city in the storm's reach");
  });

  it('landfall vitals are recorded fact, with hour offset when known', () => {
    const debrief = {
      death: { peakKt: 97.2, durationH: 139, closestApproachKm: 42, reason: 0 },
      landfall: { lat: 19.71, lon: 57.42, frameIndex: 154 },
    } as unknown as StormDebrief;
    const withAge = buildImpactBoardModel(
      inputWith({ debrief, landfallKt: 88, landfallAgeH: 38.4 }),
    );
    expect(withAge.landfallText).toBe(
      `ashore +38 h near ${formatLatLon(19.71, 57.42)}`,
    );
    const noAge = buildImpactBoardModel(
      inputWith({ debrief, landfallKt: 88, landfallAgeH: null }),
    );
    expect(noAge.landfallText).toBe(`ashore near ${formatLatLon(19.71, 57.42)}`);
    expect(withAge.peakText).toBe('97 kt 1-min');
  });

  it('live post-landfall storms report the ashore fact, not over water', () => {
    // The landfall milestone is recorded at the coast crossing while the
    // storm is still alive; the vital must flip immediately, without waiting
    // for the debrief.
    const model = buildImpactBoardModel(inputWith({ landfallAgeH: 41.8 }));
    expect(model.landfallText).toBe('ashore +42 h');
  });

  it('no-landfall completion reads none · stayed offshore', () => {
    const debrief = {
      death: { peakKt: 61, durationH: 80, closestApproachKm: 310, reason: 0 },
      landfall: null,
    } as unknown as StormDebrief;
    const model = buildImpactBoardModel(inputWith({ debrief }));
    expect(model.landfallText).toBe('none · stayed offshore');
    expect(model.headline).toContain('stayed offshore');
  });

  it('flood vitals pass through every tier', () => {
    for (const [mm, tier] of [
      [10, 'minimal'],
      [45, 'moderate'],
      [110, 'high'],
      [220, 'extreme'],
    ] as const) {
      const impact = summaryWith({ maxLandRainMm: mm, floodRisk: tier });
      const model = buildImpactBoardModel(inputWith({ impact }));
      expect(model.floodRisk).toBe(tier);
      expect(model.floodText).toBe(`flash-flood proxy ${tier}`);
      expect(model.rainText).toBe(`max storm-total ${mm} mm over land`);
    }
  });

  it('all-clear line appears only when no city peak reaches 20 kt', () => {
    expect(buildImpactBoardModel(inputWith()).allClearText).toBe(
      'no damaging winds reached any city',
    );
    const impact = summaryWith();
    impact.cities[0].peakWindKt = 25;
    expect(buildImpactBoardModel(inputWith({ impact })).allClearText).toBeNull();
  });

  it('key is stable for identical inputs and moves on any visible change', () => {
    const a = buildImpactBoardModel(inputWith());
    const b = buildImpactBoardModel(inputWith());
    expect(a.key).toBe(b.key);
    const c = buildImpactBoardModel(
      inputWith({ nowWindsKt: new Map([['muscat', 30]]) }),
    );
    expect(c.key).not.toBe(a.key);
  });

  it('now column follows the provided frame winds (replay scrub)', () => {
    const model = buildImpactBoardModel(
      inputWith({ nowWindsKt: new Map([['muscat', 41.6]]) }),
    );
    const muscat = model.rows.find((row) => row.id === 'muscat')!;
    expect(muscat.nowText).toBe('42 kt');
    const zero = buildImpactBoardModel(inputWith());
    expect(zero.rows.every((row) => row.nowText === '—')).toBe(true);
  });
});
