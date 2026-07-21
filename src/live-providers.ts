import type {
  ForecastCycleIdentity,
  GuidanceTrackPoint,
  LiveProductKind,
  LiveProviderAdapter,
  RawAdvisorySnapshot,
  SourceArtifact,
} from './live-data';

export interface ProviderDescriptor {
  id: string;
  products: LiveProductKind[];
  authority: string;
  documentationUrl: string;
  acquisition: 'advisory' | 'grib2' | 'ghrsst' | 'ocean-analysis' | 'imagery';
}

export const HF5_PROVIDER_DESCRIPTORS: readonly ProviderDescriptor[] = [
  {
    id: 'rsmc-new-delhi',
    products: ['agency-advisory'],
    authority: 'India Meteorological Department, RSMC New Delhi',
    documentationUrl: 'https://rsmcnewdelhi.imd.gov.in/bulletins-products-cwd.php',
    acquisition: 'advisory',
  },
  {
    id: 'ncep-gfs',
    products: ['atmospheric-grid'],
    authority: 'NOAA/NWS/NCEP',
    documentationUrl: 'https://www.nco.ncep.noaa.gov/pmb/products/gfs/',
    acquisition: 'grib2',
  },
  {
    id: 'noaa-nesdis-geosst',
    products: ['sea-surface-temperature'],
    authority: 'NOAA/NESDIS OSPO',
    documentationUrl: 'https://www.ospo.noaa.gov/products/ocean/sst/geo-sst/',
    acquisition: 'ghrsst',
  },
  {
    id: 'noaa-nesdis-ohc',
    products: ['upper-ocean'],
    authority: 'NOAA/NESDIS Ocean Heat Content Suite',
    documentationUrl: 'https://www.aoml.noaa.gov/phod/cyclone/index.php',
    acquisition: 'ocean-analysis',
  },
  {
    id: 'noaa-nesdis-imagery',
    products: ['satellite'],
    authority: 'NOAA/NESDIS',
    documentationUrl: 'https://www.nesdis.noaa.gov/imagery/hurricane-imagery',
    acquisition: 'imagery',
  },
] as const;

export interface NormalizedCyclePayload {
  advisory: RawAdvisorySnapshot;
  artifacts: SourceArtifact[];
  officialGuidance: GuidanceTrackPoint[];
}

/**
 * Adapter for a deployment-owned acquisition service. The service may parse
 * provider PDF/GRIB/GHRSST formats, but must emit this provider-neutral envelope.
 */
export class JsonCycleAdapter implements LiveProviderAdapter<NormalizedCyclePayload> {
  constructor(
    readonly providerId: string,
    private readonly endpoint: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async fetchCycle(
    cycle: ForecastCycleIdentity,
    signal?: AbortSignal,
  ): Promise<NormalizedCyclePayload> {
    if (cycle.providerId !== this.providerId) {
      throw new Error(`cycle provider ${cycle.providerId} does not match ${this.providerId}`);
    }
    const url = new URL(this.endpoint);
    url.searchParams.set('cycle', cycle.cycleId);
    const response = await this.fetchImpl(url, { signal });
    if (!response.ok) throw new Error(`${this.providerId}: HTTP ${response.status}`);
    const contentLength = Number(response.headers.get('content-length'));
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (Number.isFinite(contentLength) && bytes.byteLength !== contentLength) {
      throw new Error(`${this.providerId}: partial response ${bytes.byteLength}/${contentLength}`);
    }
    return JSON.parse(new TextDecoder().decode(bytes)) as NormalizedCyclePayload;
  }

  async normalize(
    raw: NormalizedCyclePayload,
    cycle: ForecastCycleIdentity,
  ): Promise<NormalizedCyclePayload> {
    if (raw.advisory.providerId !== cycle.providerId) {
      throw new Error('adapter returned an advisory from another provider');
    }
    if (raw.advisory.cycleId !== cycle.cycleId) {
      throw new Error('adapter returned an advisory from another cycle');
    }
    return raw;
  }
}

function compactUtc(iso: string): { date: string; hour: string } {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) throw new Error('analysis time is invalid');
  const hour = String(date.getUTCHours()).padStart(2, '0');
  if (!['00', '06', '12', '18'].includes(hour) || date.getUTCMinutes() !== 0) {
    throw new Error('GFS cycle must be 00, 06, 12, or 18 UTC');
  }
  return {
    date: `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`,
    hour,
  };
}

/** Build pinned NCEP NOMADS 0.25-degree GRIB2 + inventory URLs. */
export function buildNomadsGfsProducts(
  analysisTime: string,
  leadsH: readonly number[],
  baseUrl = 'https://nomads.ncep.noaa.gov/pub/data/nccf/com/gfs/prod',
): Array<{ leadH: number; grib2Url: string; inventoryUrl: string }> {
  const { date, hour } = compactUtc(analysisTime);
  return leadsH.map((leadH) => {
    if (!Number.isInteger(leadH) || leadH < 0 || leadH > 384) {
      throw new Error(`invalid GFS forecast lead ${leadH}`);
    }
    const forecast = String(leadH).padStart(3, '0');
    const filename = `gfs.t${hour}z.pgrb2.0p25.f${forecast}`;
    const grib2Url = `${baseUrl}/gfs.${date}/${hour}/atmos/${filename}`;
    return { leadH, grib2Url, inventoryUrl: `${grib2Url}.idx` };
  });
}
