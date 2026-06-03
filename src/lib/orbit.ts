/**
 * Client-side orbit propagation + map projection for the satellite overlay.
 *
 * No topojson here: we rebuild the very same `geoNaturalEarth1` the server fit
 * to the map from the passed scale/translate, so projected sub-satellite points
 * line up pixel-for-pixel with the country paths. Propagation is a light
 * Keplerian model from the TLE mean elements — illustrative, not a tracker.
 */
import { geoNaturalEarth1 } from 'd3-geo';
import type { SatElements } from '@/lib/satellites';

const DEG = Math.PI / 180;
const TWO_PI = Math.PI * 2;

export type Projector = (lng: number, lat: number) => [number, number] | null;

/** Rebuild the server's fitted projection from its scale + translate. */
export function makeProjector(scale: number, translate: [number, number]): Projector {
  const p = geoNaturalEarth1().scale(scale).translate(translate);
  return (lng, lat) => {
    const xy = p([lng, lat]);
    return xy && Number.isFinite(xy[0]) && Number.isFinite(xy[1]) ? [xy[0], xy[1]] : null;
  };
}

/** Greenwich Mean Sidereal Time (radians) for a UTC date — IAU 1982. */
function gmst(date: Date): number {
  const d = date.getTime() / 86400_000 + 2440587.5 - 2451545.0; // days from J2000
  const T = d / 36525.0;
  let g = 280.46061837 + 360.98564736629 * d + 0.000387933 * T * T - (T * T * T) / 38710000.0;
  g = ((g % 360) + 360) % 360;
  return g * DEG;
}

/** Solve Kepler's equation E − e·sinE = M (radians) by Newton iteration. */
function eccentricAnomaly(M: number, e: number): number {
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 8; i++) {
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-7) break;
  }
  return E;
}

/**
 * Sub-satellite geographic point at `date`. The position is treated as a unit
 * vector (magnitude is irrelevant for the ground point), rotated from the
 * orbital plane into ECI, then into ECEF by −GMST. J2 nodal drift over the
 * short animation loop is ignored.
 */
export function subPoint(el: SatElements, date: Date): { lng: number; lat: number } {
  const n = (el.meanMotion * TWO_PI) / 86400; // rad/s
  const dt = (date.getTime() - el.epochMs) / 1000; // s since epoch
  const e = el.ecc;
  const M = (((el.maDeg * DEG + n * dt) % TWO_PI) + TWO_PI) % TWO_PI;
  const E = eccentricAnomaly(M, e);
  const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));

  const i = el.inclDeg * DEG;
  const raan = el.raanDeg * DEG;
  const u = el.argpDeg * DEG + nu; // argument of latitude

  const cosU = Math.cos(u), sinU = Math.sin(u);
  const cosO = Math.cos(raan), sinO = Math.sin(raan);
  const cosI = Math.cos(i), sinI = Math.sin(i);
  // Unit position in ECI.
  const x = cosO * cosU - sinO * sinU * cosI;
  const y = sinO * cosU + cosO * sinU * cosI;
  const z = sinU * sinI;

  // ECI → ECEF: rotate by −GMST about z.
  const th = gmst(date);
  const cosT = Math.cos(th), sinT = Math.sin(th);
  const xe = x * cosT + y * sinT;
  const ye = -x * sinT + y * cosT;

  return {
    lng: Math.atan2(ye, xe) / DEG,
    lat: Math.asin(Math.max(-1, Math.min(1, z))) / DEG, // |r|=1 ⇒ z = sin(lat)
  };
}
