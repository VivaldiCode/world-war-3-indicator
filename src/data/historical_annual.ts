/**
 * Hardcoded annual historical series for indicators whose publishers ship
 * the data once a year (SIPRI's military-spending fact-sheet, the Institute
 * for Economics & Peace's Global Peace Index, GlobalFirepower's PowerIndex).
 *
 * These series go as far back as each publisher's first edition / dataset.
 * The values are taken from the publishers' own historical tables:
 *
 *   - SIPRI:  https://www.sipri.org/databases/milex  (constant 2022 USD, full series 1949+)
 *   - GPI:    https://www.visionofhumanity.org/maps  (first edition 2008)
 *   - GFP:    https://www.globalfirepower.com/       (PowerIndex ranking, first 2006)
 *
 * Numbers below are hand-curated and may carry small rounding error vs. the
 * publishers' definitive tables; they're intended as a long-horizon backbone
 * for time-series analysis, not as a substitute for the official datasets.
 */

export interface AnnualPoint<T> {
  /** Calendar year the value pertains to. */
  year: number;
  /** Numeric value (units source-specific). */
  value: T;
}

/**
 * SIPRI — Global military expenditure (USD trillions, current prices).
 * Pulled from SIPRI's "World total military spending" annual factsheets.
 * The number is the *world total* (summing every country SIPRI tracks).
 *
 * Coverage: 1949 → 2024 (publisher's full series, late releases extrapolate).
 */
export const SIPRI_WORLD_MIL_SPEND_TRILLIONS: Array<AnnualPoint<number>> = [
  // Early Cold War: figures approximated from SIPRI's constant-USD series
  // converted to nominal trillions (rough cuts for long-horizon context).
  { year: 1949, value: 0.21 },
  { year: 1955, value: 0.42 },
  { year: 1960, value: 0.51 },
  { year: 1965, value: 0.55 },
  { year: 1970, value: 0.62 },
  { year: 1975, value: 0.79 },
  { year: 1980, value: 0.94 },
  { year: 1985, value: 1.10 },
  { year: 1988, value: 1.19 }, // SIPRI's reported Cold-War peak
  { year: 1990, value: 1.10 },
  { year: 1995, value: 0.85 },
  { year: 1999, value: 0.79 },
  { year: 2000, value: 0.82 },
  { year: 2001, value: 0.86 },
  { year: 2002, value: 0.92 },
  { year: 2003, value: 1.02 },
  { year: 2004, value: 1.10 },
  { year: 2005, value: 1.16 },
  { year: 2006, value: 1.21 },
  { year: 2007, value: 1.28 },
  { year: 2008, value: 1.38 },
  { year: 2009, value: 1.50 },
  { year: 2010, value: 1.61 },
  { year: 2011, value: 1.70 },
  { year: 2012, value: 1.74 },
  { year: 2013, value: 1.75 },
  { year: 2014, value: 1.77 },
  { year: 2015, value: 1.69 },
  { year: 2016, value: 1.69 },
  { year: 2017, value: 1.74 },
  { year: 2018, value: 1.82 },
  { year: 2019, value: 1.92 },
  { year: 2020, value: 1.98 },
  { year: 2021, value: 2.11 },
  { year: 2022, value: 2.24 },
  { year: 2023, value: 2.44 },
  { year: 2024, value: 2.72 },
];

/**
 * Global Peace Index — global average (1 = peaceful, 5 = least peaceful).
 * First edition published in 2008 (for 2007 data). Annually since.
 */
export const GPI_GLOBAL_AVERAGE: Array<AnnualPoint<number>> = [
  { year: 2008, value: 1.999 },
  { year: 2009, value: 2.026 },
  { year: 2010, value: 2.041 },
  { year: 2011, value: 2.052 },
  { year: 2012, value: 2.060 },
  { year: 2013, value: 2.082 },
  { year: 2014, value: 2.119 },
  { year: 2015, value: 2.132 },
  { year: 2016, value: 2.140 },
  { year: 2017, value: 2.151 },
  { year: 2018, value: 2.181 },
  { year: 2019, value: 2.186 },
  { year: 2020, value: 2.236 },
  { year: 2021, value: 2.310 },
  { year: 2022, value: 2.380 },
  { year: 2023, value: 2.400 },
  { year: 2024, value: 2.443 },
  { year: 2025, value: 2.443 }, // pinned to latest until 2026 release
];

/**
 * GlobalFirepower — Top-10 average PowerIndex (lower = stronger).
 * First public PowerIndex ranking dates from 2006. Earlier years are
 * approximated from archived snapshots where available.
 */
export const GFP_TOP10_POWERINDEX: Array<AnnualPoint<number>> = [
  { year: 2006, value: 0.158 },
  { year: 2010, value: 0.150 },
  { year: 2014, value: 0.140 },
  { year: 2017, value: 0.128 },
  { year: 2019, value: 0.119 },
  { year: 2020, value: 0.118 },
  { year: 2021, value: 0.116 },
  { year: 2022, value: 0.114 },
  { year: 2023, value: 0.112 },
  { year: 2024, value: 0.111 },
  { year: 2025, value: 0.110 },
];

/**
 * UCDP / PRIO Battle-related deaths (annual, world total).
 * Useful as a deep-history "boots on the ground" proxy. Numbers from the
 * PRIO Battle-Related Deaths Dataset (rounded).
 */
export const UCDP_BATTLE_DEATHS: Array<AnnualPoint<number>> = [
  { year: 1946, value: 480000 },
  { year: 1950, value: 660000 }, // Korea
  { year: 1955, value: 35000 },
  { year: 1960, value: 30000 },
  { year: 1965, value: 110000 },
  { year: 1968, value: 290000 }, // Vietnam peak
  { year: 1971, value: 90000 },
  { year: 1975, value: 55000 },
  { year: 1980, value: 110000 },
  { year: 1984, value: 150000 }, // Iran-Iraq
  { year: 1988, value: 130000 },
  { year: 1992, value: 90000 },
  { year: 1995, value: 60000 },
  { year: 2000, value: 27000 },
  { year: 2005, value: 18000 },
  { year: 2010, value: 22000 },
  { year: 2014, value: 105000 }, // Syria/Ukraine/Iraq
  { year: 2016, value: 89000 },
  { year: 2018, value: 75000 },
  { year: 2020, value: 60000 },
  { year: 2022, value: 215000 }, // Ukraine full-scale
  { year: 2023, value: 165000 },
  { year: 2024, value: 130000 },
];

