/**
 * Live military-flight model. Unlike the military / satellite / deployment
 * datasets — scraped from Wikipedia and committed as JSON, refreshed at most
 * once a day — aircraft positions are inherently real-time, so there is no
 * committed file here: `/api/flights` proxies the adsb.fi / airplanes.live
 * community feeds at request time and hands the client this shape.
 *
 * `classifyAircraft` buckets each contact into a broad role from its type code
 * and human description. It is deliberately keyword-driven and therefore fuzzy
 * — good enough for a board-game-style overview, not an order of battle.
 */
export type FlightCategory =
  | 'fighter'
  | 'tanker'
  | 'transport'
  | 'isr'
  | 'helicopter'
  | 'drone'
  | 'other';

export interface Flight {
  hex: string; // ICAO 24-bit address — stable id across polls
  flight: string | null; // callsign
  type: string | null; // ICAO type code, e.g. "H60", "K35R"
  reg: string | null; // tail number
  desc: string | null; // human-readable type
  lat: number;
  lon: number;
  alt: number | null; // barometric altitude in feet; null when on the ground
  gs: number | null; // ground speed, knots
  track: number | null; // true track, degrees clockwise from north
  cat: FlightCategory;
}

export interface FlightDataset {
  updatedAt: string;
  source: string;
  count: number;
  aircraft: Flight[];
}

export const FLIGHT_CATS: Record<FlightCategory, { label: string; color: string }> = {
  fighter: { label: 'Fighter / attack', color: '#d64545' },
  tanker: { label: 'Tanker', color: '#3f9fb0' },
  transport: { label: 'Transport', color: '#4f7fc0' },
  isr: { label: 'ISR / AEW', color: '#9b6fc0' },
  helicopter: { label: 'Helicopter', color: '#5aa15f' },
  drone: { label: 'Drone / UAV', color: '#d99a2b' },
  other: { label: 'Other', color: '#9aa0a6' },
};

// Ordered most-specific first: an unmanned ISR platform (RQ-4) should read as a
// drone, a 737-based AEW (Wedgetail) as ISR rather than a transport, a tanker
// before a generic transport, and so on.
const RULES: Array<[FlightCategory, RegExp]> = [
  ['drone', /\b(drone|unmanned|uav|ucav)\b|reaper|predator|global hawk|triton|bayraktar|\btb-?2\b|heron|hermes 900|\bmq-?\d|\brq-?\d|\banka\b|wing loong/i],
  ['helicopter', /helicopter|black ?hawk|seahawk|knighthawk|jayhawk|pave ?hawk|apache|chinook|sea ?king|merlin|\bpuma\b|wildcat|\blynx\b|kiowa|\bcobra\b|\bhuey\b|nh-?90|ec-?\d{2,3}|aw-?1\d{2}|\bh-?(?:47|53|60|64|92)\b|\b(?:uh|ah|ch|mh|hh|sh|oh)-?\d|\bmi-?\d|\bka-?\d/i],
  ['tanker', /tanker|stratotanker|extender|\bmrtt\b|voyager|refuel|\bkc-?\d|\bk35|\bkdc/i],
  ['isr', /awacs|sentry|sentinel|jstars|joint stars|rivet joint|cobra ball|compass call|\brc-?135|poseidon|\bp-?8\b|\bp-?3\b|\borion\b|hawkeye|\be-?[2378]\b|wedgetail|nimrod|global ?eye|dragon lady|\bu-?2\b|reconnaissance|surveillance|\baew\b|maritime patrol/i],
  ['fighter', /fighter|\bf-?(?:15|16|18|22|35)\b|f\/a-?18|eurofighter|typhoon|rafale|gripen|tornado|harrier|\ba-?10\b|warthog|thunderbolt ii|\bsu-?\d|mig-?\d|\bj-?(?:7|10|11|15|16|20)\b|mirage|hornet|\beagle\b|raptor|lightning ii|fulcrum|flanker|viper/i],
  ['transport', /transport|cargo|airlift|hercules|\bc-?130[a-z]?\b|\bc-?17[a-z]?\b|globemaster|\bc-?5[a-z]?\b|galaxy|\ba400m?\b|atlas|greyhound|spartan|clipper|\bc-?2[a-z]?\b|\bc-?12[a-z]?\b|\bc-?21[a-z]?\b|\bc-?27[a-z]?\b|\bc-?32[a-z]?\b|\bc-?40[a-z]?\b|il-?76|an-?\d|antonov|\bc-?295\b|cn-?235|kc-?390|\bcasa\b/i],
];

/** Bucket an aircraft into a broad role. Falls back to `other`. */
export function classifyAircraft(type?: string | null, desc?: string | null): FlightCategory {
  const s = `${desc ?? ''} ${type ?? ''}`;
  for (const [cat, re] of RULES) if (re.test(s)) return cat;
  return 'other';
}

/** Categories present, ordered by how many aircraft fall in each. */
export function flightCatsPresent(aircraft: Flight[]): FlightCategory[] {
  const count = new Map<FlightCategory, number>();
  for (const a of aircraft) count.set(a.cat, (count.get(a.cat) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([cat]) => cat);
}
