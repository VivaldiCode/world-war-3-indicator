/**
 * Country flag helpers. The world-atlas topojson keys countries by ISO 3166-1
 * *numeric* id (e.g. "840" → USA); flag CDNs key by ISO 3166-1 *alpha-2*
 * (e.g. "us"). This module bridges the two with a static table — no network,
 * no generated data file — and builds flagcdn.com SVG URLs.
 */

/** ISO 3166-1 numeric → alpha-2. Covers UN members + common territories. */
const NUMERIC_TO_ALPHA2: Record<string, string> = {
  '004': 'AF', '008': 'AL', '012': 'DZ', '016': 'AS', '020': 'AD', '024': 'AO',
  '028': 'AG', '031': 'AZ', '032': 'AR', '036': 'AU', '040': 'AT', '044': 'BS',
  '048': 'BH', '050': 'BD', '051': 'AM', '052': 'BB', '056': 'BE', '060': 'BM',
  '064': 'BT', '068': 'BO', '070': 'BA', '072': 'BW', '076': 'BR', '084': 'BZ',
  '090': 'SB', '092': 'VG', '096': 'BN', '100': 'BG', '104': 'MM', '108': 'BI',
  '112': 'BY', '116': 'KH', '120': 'CM', '124': 'CA', '132': 'CV', '136': 'KY',
  '140': 'CF', '144': 'LK', '148': 'TD', '152': 'CL', '156': 'CN', '158': 'TW',
  '170': 'CO', '174': 'KM', '178': 'CG', '180': 'CD', '184': 'CK', '188': 'CR',
  '191': 'HR', '192': 'CU', '196': 'CY', '203': 'CZ', '204': 'BJ', '208': 'DK',
  '212': 'DM', '214': 'DO', '218': 'EC', '222': 'SV', '226': 'GQ', '231': 'ET',
  '232': 'ER', '233': 'EE', '242': 'FJ', '246': 'FI', '250': 'FR', '254': 'GF',
  '258': 'PF', '262': 'DJ', '266': 'GA', '268': 'GE', '270': 'GM', '275': 'PS',
  '276': 'DE', '288': 'GH', '292': 'GI', '300': 'GR', '304': 'GL', '308': 'GD',
  '320': 'GT', '324': 'GN', '328': 'GY', '332': 'HT', '340': 'HN', '344': 'HK',
  '348': 'HU', '352': 'IS', '356': 'IN', '360': 'ID', '364': 'IR', '368': 'IQ',
  '372': 'IE', '376': 'IL', '380': 'IT', '384': 'CI', '388': 'JM', '392': 'JP',
  '398': 'KZ', '400': 'JO', '404': 'KE', '408': 'KP', '410': 'KR', '414': 'KW',
  '417': 'KG', '418': 'LA', '422': 'LB', '426': 'LS', '428': 'LV', '430': 'LR',
  '434': 'LY', '438': 'LI', '440': 'LT', '442': 'LU', '446': 'MO', '450': 'MG',
  '454': 'MW', '458': 'MY', '462': 'MV', '466': 'ML', '470': 'MT', '478': 'MR',
  '480': 'MU', '484': 'MX', '492': 'MC', '496': 'MN', '498': 'MD', '499': 'ME',
  '504': 'MA', '508': 'MZ', '512': 'OM', '516': 'NA', '524': 'NP', '528': 'NL',
  '540': 'NC', '548': 'VU', '554': 'NZ', '558': 'NI', '562': 'NE', '566': 'NG',
  '578': 'NO', '583': 'FM', '584': 'MH', '585': 'PW', '586': 'PK', '591': 'PA',
  '598': 'PG', '600': 'PY', '604': 'PE', '608': 'PH', '616': 'PL', '620': 'PT',
  '624': 'GW', '626': 'TL', '630': 'PR', '634': 'QA', '642': 'RO', '643': 'RU',
  '646': 'RW', '659': 'KN', '662': 'LC', '670': 'VC', '674': 'SM', '678': 'ST',
  '682': 'SA', '686': 'SN', '688': 'RS', '690': 'SC', '694': 'SL', '702': 'SG',
  '703': 'SK', '704': 'VN', '705': 'SI', '706': 'SO', '710': 'ZA', '716': 'ZW',
  '724': 'ES', '728': 'SS', '729': 'SD', '732': 'EH', '740': 'SR', '748': 'SZ',
  '752': 'SE', '756': 'CH', '760': 'SY', '762': 'TJ', '764': 'TH', '768': 'TG',
  '776': 'TO', '780': 'TT', '784': 'AE', '788': 'TN', '792': 'TR', '795': 'TM',
  '798': 'TV', '800': 'UG', '804': 'UA', '807': 'MK', '818': 'EG', '826': 'GB',
  '834': 'TZ', '840': 'US', '854': 'BF', '858': 'UY', '860': 'UZ', '862': 'VE',
  '882': 'WS', '887': 'YE', '894': 'ZM',
};

/** Alpha-2 for a numeric topojson id, or null if we have no flag for it. */
export function alpha2ById(id: string): string | null {
  return NUMERIC_TO_ALPHA2[id] ?? null;
}

/**
 * Same-origin flag URL (PNG), served by `/api/flag/[code]` which proxies
 * flagcdn.com. Must be same-origin: browsers won't rasterize a cross-origin
 * image inside an SVG `<image>`, so a direct flagcdn URL paints the country
 * black. The proxy sanitizes the code and caches aggressively.
 */
export function flagUrl(alpha2: string): string {
  return `/api/flag/${alpha2.toLowerCase()}`;
}
