/**
 * Where the sun is over a place right now (owner, 3 Nov 2026: "the day time we got there should be the time that is in
 * the key world"): its height above the horizon and its bearing, from the place's latitude and longitude and the time
 * (the usual low-precision formulas, good to a fraction of a degree: plenty for day, dusk and night).
 */
const RAD = Math.PI / 180;

export function sunAt(lat: number, lng: number, when = new Date()) {
  const d = when.getTime() / 86_400_000 - 10957.5; // days from noon on 1 January 2000 (UTC)
  const g = (357.529 + 0.98560028 * d) * RAD; // the mean anomaly
  const q = 280.459 + 0.98564736 * d; // the mean longitude (degrees)
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD; // the sun's place along the ecliptic
  const e = (23.439 - 0.00000036 * d) * RAD; // the tilt of the Earth
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24; // sidereal time at Greenwich (hours)
  const ha = (gmst * 15 + lng) * RAD - ra; // the hour angle here
  const phi = lat * RAD;
  const elevation = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const azimuth = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(phi) - Math.sin(phi) * Math.cos(ha)); // from north, clockwise
  return { elevation: elevation / RAD, azimuth: ((azimuth / RAD) + 360) % 360 };
}

/** How light it is: 1 in full day, 0 at night, in between through dusk and dawn (the sun from 6° below to 8° above). */
export function daylight(elevation: number) {
  return Math.min(1, Math.max(0, (elevation + 6) / 14));
}
