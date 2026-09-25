import type { ActiveSite } from "../../../types";

const earthRadiusMeters = 6_371_008.8;
const metersPerDegreeLatitude = 111_320;

export const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

export const offsetCoordinate = (
  latitude: number,
  longitude: number,
  distanceMeters: number,
  bearingDegrees: number,
) => {
  const angularDistance = distanceMeters / earthRadiusMeters;
  const bearing = degreesToRadians(bearingDegrees);
  const lat1 = degreesToRadians(latitude);
  const lon1 = degreesToRadians(longitude);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) +
      Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return {
    latitude: (lat2 * 180) / Math.PI,
    longitude: (lon2 * 180) / Math.PI,
  };
};

export const approximateSiteBounds = (site: ActiveSite) => {
  const latDelta = site.radiusMeters / metersPerDegreeLatitude;
  const lonDelta =
    site.radiusMeters / (metersPerDegreeLatitude * Math.cos(degreesToRadians(site.latitude)) || metersPerDegreeLatitude);

  return {
    north: site.latitude + latDelta,
    south: site.latitude - latDelta,
    east: site.longitude + lonDelta,
    west: site.longitude - lonDelta,
  };
};

export const buildConcentricRingRadii = (radiusMeters: number) =>
  [100, 250, radiusMeters]
    .filter((radius, index, values) => radius <= radiusMeters && values.indexOf(radius) === index)
    .sort((a, b) => a - b);

export const isLikelyIndiaCoordinate = (latitude: number, longitude: number) =>
  latitude >= 6 && latitude <= 38 && longitude >= 68 && longitude <= 98;
