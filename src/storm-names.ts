/**
 * Versioned North Indian Ocean tropical-cyclone naming catalogue.
 *
 * Source: WMO/ESCAP Panel on Tropical Cyclones, April 2020 roster, read
 * column-wise as prescribed by RSMC New Delhi. The catalogue covers both the
 * Arabian Sea and Bay of Bengal. These names identify simulations only: this
 * module never claims or assigns an official agency designation.
 *
 * Source snapshot checked: 2026-07-21
 * https://wmo.int/content/tropical-cyclone-naming/northern-indian-ocean-names-arabian-sea-and-bay-of-bengal
 */

export const STORM_NAME_CATALOG_VERSION = 'wmo-escap-nio-2020-v1';
export const STORM_NAME_SOURCE_URL =
  'https://wmo.int/content/tropical-cyclone-naming/northern-indian-ocean-names-arabian-sea-and-bay-of-bengal';

/** SHA-256 of the lower-case names joined with a single LF. */
export const STORM_NAME_CATALOG_SHA256 =
  '2c4ddfead70eb6429e6348fa521f5a4a86b2861dc334e3b6c0f1f1ea2571fe81';

const NAME_COLUMNS: readonly (readonly string[])[] = [
  [
    'Nisarga', 'Gati', 'Nivar', 'Burevi', 'Tauktae', 'Yaas', 'Gulab',
    'Shaheen', 'Jawad', 'Asani', 'Sitrang', 'Mandous', 'Mocha',
  ],
  [
    'Biparjoy', 'Tej', 'Hamoon', 'Midhili', 'Michaung', 'Remal', 'Asna',
    'Dana', 'Fengal', 'Shakhti', 'Montha', 'Senyar', 'Ditwah',
  ],
  [
    'Arnab', 'Murasu', 'Akvan', 'Kaani', 'Ngamann', 'Sail', 'Sahab', 'Lulu',
    'Ghazeer', 'Gigum', 'Thianyot', 'Afoor', 'Diksam',
  ],
  [
    'Upakul', 'Aag', 'Sepand', 'Odi', 'Kyarthit', 'Naseem', 'Afshan', 'Mouj',
    'Asif', 'Gagana', 'Bulan', 'Nahhaam', 'Sira',
  ],
  [
    'Barshon', 'Vyom', 'Booran', 'Kenau', 'Sapakyee', 'Muzn', 'Manahil',
    'Suhail', 'Sidrah', 'Verambha', 'Phutala', 'Quffal', 'Bakhur',
  ],
  [
    'Rajani', 'Jhar', 'Anahita', 'Endheri', 'Wetwun', 'Sadeem', 'Shujana',
    'Sadaf', 'Hareed', 'Garjana', 'Aiyara', 'Daaman', 'Ghwyzi',
  ],
  [
    'Nishith', 'Probah', 'Azar', 'Riyau', 'Mwaihout', 'Dima', 'Parwaz',
    'Reem', 'Faid', 'Neeba', 'Saming', 'Deem', 'Hawf',
  ],
  [
    'Urmi', 'Neer', 'Pooyan', 'Guruva', 'Kywe', 'Manjour', 'Zannata',
    'Rayhan', 'Kaseer', 'Ninnada', 'Kraison', 'Gargoor', 'Balhaf',
  ],
  [
    'Meghala', 'Prabhanjan', 'Arsham', 'Kurangi', 'Pinku', 'Rukam', 'Sarsar',
    'Anbar', 'Nakheel', 'Viduli', 'Matcha', 'Khubb', 'Brom',
  ],
  [
    'Samiron', 'Ghurni', 'Hengame', 'Kuredhi', 'Yinkaung', 'Watad', 'Badban',
    'Oud', 'Haboob', 'Ogha', 'Mahingsa', 'Degl', 'Shuqra',
  ],
  [
    'Pratikul', 'Ambud', 'Savas', 'Horangu', 'Linyone', 'Al-jarz', 'Sarrab',
    'Bahar', 'Bareq', 'Salitha', 'Phraewa', 'Athmad', 'Fartak',
  ],
  [
    'Sarobor', 'Jaladhi', 'Tahamtan', 'Thundi', 'Kyeekan', 'Rabab', 'Gulnar',
    'Seef', 'Alreem', 'Rivi', 'Asuri', 'Boom', 'Darsah',
  ],
  [
    'Mahanisha', 'Vega', 'Toofan', 'Faana', 'Bautphat', 'Raad', 'Waseq',
    'Fanar', 'Wabil', 'Rudu', 'Thara', 'Saffar', 'Samhah',
  ],
] as const;

/** Official roster order: down each country row, then across to the next column. */
export const NORTH_INDIAN_OCEAN_NAMES: readonly string[] = Object.freeze(
  NAME_COLUMNS.flat(),
);

export interface SimulatedStormName {
  name: string;
  label: string;
  catalogueIndex: number;
  catalogueVersion: string;
  official: false;
}

/** Stable name for a stable unsigned 32-bit seed. */
export function simulatedStormName(seed: number): SimulatedStormName {
  const unsigned = Number.isFinite(seed) ? Math.trunc(seed) >>> 0 : 0;
  const catalogueIndex = unsigned % NORTH_INDIAN_OCEAN_NAMES.length;
  const name = NORTH_INDIAN_OCEAN_NAMES[catalogueIndex];
  return {
    name,
    label: `Simulated Cyclone ${name}`,
    catalogueIndex,
    catalogueVersion: STORM_NAME_CATALOG_VERSION,
    official: false,
  };
}
