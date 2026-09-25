const metersPerDegreeLatitude = 111_320;

export const localOffsetToLatLon = (latitude, longitude, xMeters, yMeters) => {
  const lat = latitude + yMeters / metersPerDegreeLatitude;
  const lon =
    longitude +
    xMeters / (metersPerDegreeLatitude * Math.cos((latitude * Math.PI) / 180) || metersPerDegreeLatitude);
  return { lat, lon };
};

export const latLonToLocalOffset = (latitude, longitude, centerLatitude, centerLongitude) => ({
  x: (longitude - centerLongitude) * metersPerDegreeLatitude * Math.cos((centerLatitude * Math.PI) / 180),
  y: (latitude - centerLatitude) * metersPerDegreeLatitude,
});

export const normalizeStationPosition = (point, project) => {
  const coordinateMode =
    point.coordinateMode === "lat_lon" || (Number.isFinite(point.lat) && Number.isFinite(point.lon))
      ? "lat_lon"
      : "local_xy";

  if (coordinateMode === "lat_lon") {
    const lat = Number(point.lat);
    const lon = Number(point.lon);
    const local = latLonToLocalOffset(lat, lon, project.latitude, project.longitude);
    return {
      ...point,
      x: Number.isFinite(point.x) ? point.x : local.x,
      y: Number.isFinite(point.y) ? point.y : local.y,
      lat,
      lon,
      coordinateMode,
    };
  }

  const { lat, lon } = localOffsetToLatLon(project.latitude, project.longitude, point.x, point.y);
  return {
    ...point,
    lat,
    lon,
    coordinateMode,
  };
};
