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
import { electricityMapsSource } from './sources/electricitymap';
import { openWeatherSource } from './sources/openweather';
import { cloudflareRadarSource } from './sources/cloudflare_radar';
import { ucdpBattleDeathsSource } from './sources/ucdp_battle_deaths';
import { liveuamapSource } from './sources/liveuamap';

/**
 * The single source of truth for which plugins are active and how heavy they
 * weigh in the composite. Adding a new source is a matter of dropping a file
 * in src/lib/sources/ and adding it to this array.
 *
 * Weights are *relative* — the engine renormalizes them at composition time,
 * so feel free to add new sources without re-tuning every entry.
 */
export const SOURCES: DataSource[] = [
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
  liveuamapSource,         // weight 8 — live geo-tagged conflict events
  ucdpBattleDeathsSource,  // weight 4 — historical battle-deaths baseline

  // Sentiment — narrative pressure
  gdeltToneSource,      // weight 7 — global news tone
  cloudflareRadarSource,// weight 6 — internet attack traffic + outages
  openWeatherSource,    // weight 3 — attack-favourable weather over conflict zones

  // Markets (additional)
  electricityMapsSource,// weight 3 — European grid fossil reliance

  // Military / structural
  globalFirepowerSource,    // weight 6 — top-15 power index
  globalPeaceIndexSource,   // weight 6 — peacefulness ranking
  sipriMilitarySpendSource, // weight 5 — global mil spend trend
  n2yoSatellitesSource,     // weight 4 — military sats overhead capitals
];

export function getSource(id: string): DataSource | undefined {
  return SOURCES.find((s) => s.id === id);
}
