/**
 * The smallest [west, south, east, north] box around the points, crossing the antimeridian when
 * that is shorter (a San Francisco → Seoul trip spans the Pacific, not the Atlantic). `east` may
 * then exceed 180, which MapLibre's fitBounds takes as "wrap eastwards".
 */
export function shortestBounds(
  points: [lon: number, lat: number][],
): [number, number, number, number] {
  let south = 90
  let north = -90
  for (const [, lat] of points) {
    south = Math.min(south, lat)
    north = Math.max(north, lat)
  }
  const lons = [...new Set(points.map(([lon]) => lon))].sort((a, b) => a - b)
  // The widest empty stretch of longitude, going round: the box is everything else.
  let gap = lons[0] + 360 - lons[lons.length - 1]
  let west = lons[0]
  let east = lons[lons.length - 1]
  for (let i = 1; i < lons.length; i++) {
    if (lons[i] - lons[i - 1] > gap) {
      gap = lons[i] - lons[i - 1]
      west = lons[i]
      east = lons[i - 1] + 360
    }
  }
  return [west, south, east, north]
}
