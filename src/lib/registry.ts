import type { DataSource } from './types';
import { goldSource } from './sources/gold';
import { oilSource } from './sources/oil';
import { dxySource } from './sources/dxy';
import { vixSource } from './sources/vix';
import { btcSource } from './sources/btc';
import { wheatSource } from './sources/wheat';
import { treasury10ySource } from './sources/treasury';
import { defenseStocksSource } from './sources/defense_stocks';
import { acledConflictsSource } from './sources/acled';
import { ucdpConflictsSource } from './sources/ucdp';
import { gdeltToneSource } from './sources/gdelt';
import { globalFirepowerSource } from './sources/globalfirepower';
import { globalPeaceIndexSource } from './sources/gpi';
import { sipriMilitarySpendSource } from './sources/sipri';
import { n2yoSatellitesSource } from './sources/n2yo';
import { openWeatherSource } from './sources/openweather';
import { cloudflareRadarSource } from './sources/cloudflare_radar';
import { ucdpBattleDeathsSource } from './sources/ucdp_battle_deaths';
import { ovxSource } from './sources/ovx';
import { taiexSource } from './sources/taiex';
import { ucdpGedSource } from './sources/ucdp_ged';
import { portwatchSource } from './sources/portwatch';
import { polymarketSource } from './sources/polymarket';
import { grokXSocialSource } from './sources/grok_x_social';

/**
 * The single source of truth for which plugins are active and how heavy they
 * weigh in the composite. Adding a new source is a matter of dropping a file
 * in src/lib/sources/ and adding it to this array.
 *
 * Weights are *relative* — the engine renormalizes them at composition time,
 * so feel free to add new sources without re-tuning every entry.
 */
const ALL_SOURCES: DataSource[] = [
  // Markets — fear / safe-haven / risk-off signals
  goldSource,           // weight 9 — classic safe-haven
  oilSource,            // weight 9 — geopolitical premium
  dxySource,            // weight 5 — USD flight-to-safety
  vixSource,            // weight 7 — equity fear gauge
  btcSource,            // weight 3 — alt safe-haven (noisy)
  wheatSource,          // weight 5 — food security shock
  treasury10ySource,    // weight 4 — rates flight-to-safety
  defenseStocksSource,  // weight 6 — re-armament bid

  // Conflicts — boots-on-the-ground reality
  acledConflictsSource,    // weight 10 — political violence events
  ucdpConflictsSource,     // weight 9 — active state-based conflicts
  ucdpBattleDeathsSource,  // weight 4 — historical battle-deaths baseline
  ucdpGedSource,           // weight 8 — UCDP GED candidate events; only with UCDP_API_TOKEN (HOMEL-475)

  // Sentiment — narrative pressure
  gdeltToneSource,      // weight 7 — global news tone
  cloudflareRadarSource,// weight 6 — internet attack traffic + outages
  openWeatherSource,    // weight 3 — attack-favourable weather over conflict zones
  portwatchSource,      // weight 5 — maritime chokepoint traffic (HOMEL-474)
  polymarketSource,     // weight 6 — crowd odds on conflict markets (HOMEL-474)
  grokXSocialSource,    // weight 0 in phase 0 (WW3_GROK_WEIGHT); only registered with XAI_API_KEY (HOMEL-470)

  // Markets (additional)
  ovxSource,            // weight 4 — oil-volatility index (HOMEL-468)
  taiexSource,          // weight 4 — Taiwan equity stress (HOMEL-468)

  // Military / structural
  globalFirepowerSource,    // weight 6 — top-15 power index
  globalPeaceIndexSource,   // weight 6 — peacefulness ranking
  sipriMilitarySpendSource, // weight 5 — global mil spend trend
  n2yoSatellitesSource,     // weight 4 — military sats overhead capitals
];

// Retired (HOMEL-468): electricitymap.ts (token without access to any zone; swap
// for a gas-price source once a keyless one exists) and liveuamap (paid API, no key).
export const SOURCES: DataSource[] = ALL_SOURCES.filter((s) => s.enabled?.() ?? true);

export function getSource(id: string): DataSource | undefined {
  return SOURCES.find((s) => s.id === id);
}
