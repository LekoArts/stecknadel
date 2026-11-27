const EARTH = 6_371_008.8
const RAD = Math.PI / 180

/** Great-circle distance in meters (mean Earth radius). */
export function haversineMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const dLat = (b.lat - a.lat) * RAD
  const dLon = (b.lon - a.lon) * RAD
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH * Math.asin(Math.min(1, Math.sqrt(h)))
}
