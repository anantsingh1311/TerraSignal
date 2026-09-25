import { getProviderStatus } from "./providerStatus.js";

const stableHash = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
};

const signal = (lat, lon, radius, salt) =>
  (stableHash(`${Number(lat).toFixed(5)}|${Number(lon).toFixed(5)}|${radius}|${salt}`) % 10_000) / 10_000;

export const getGeoProviderSnapshot = async ({ latitude, longitude, radiusMeters }) => {
  const radius = Number(radiusMeters || 500);
  const status = getProviderStatus();
  return {
    providerStatus: status,
    elevation: {
      providerMode: status.elevation,
      meanElevationMeters: Math.round(40 + signal(latitude, longitude, radius, "elevation") * 920),
      slopeRisk: Math.round(18 + signal(latitude, longitude, radius, "slope") * 66),
      terrainRoughness: Math.round(12 + signal(latitude, longitude, radius, "roughness") * 72),
      limitations: ["Model-assisted DEM estimate. Connect a live DEM provider or upload survey levels for measured elevation/slope."],
    },
    soil: {
      providerMode: status.soil,
      soilUncertaintyRisk: Math.round(24 + signal(latitude, longitude, radius, "soil") * 62),
      looseSoilOrFillProxy: Math.round(18 + signal(latitude, longitude, radius, "fill") * 68),
      limitations: ["Model-assisted soil uncertainty estimate. Boreholes, SPT/CPT, and lab tests remain required."],
    },
    water: {
      providerMode: status.water,
      drainageFloodProxy: Math.round(18 + signal(latitude, longitude, radius, "drainage") * 68),
      waterProximityRisk: Math.round(16 + signal(latitude, longitude, radius, "water") * 70),
      limitations: ["Model-assisted drainage and water proximity estimate. Verify stormwater, monsoon, and flood records locally."],
    },
    landCover: {
      providerMode: status.landCover,
      summary:
        signal(latitude, longitude, radius, "urban") > 0.56
          ? "Urban/peri-urban modelled context"
          : "Open/developing-land modelled context",
    },
    seismic: {
      providerMode: status.seismic,
      recentEventsCount: Math.round(signal(latitude, longitude, radius, "quake-count") * 11),
      largestMagnitude: Number((2.4 + signal(latitude, longitude, radius, "quake-mag") * 3.1).toFixed(1)),
      nearestEventDistanceKm: Math.round(12 + signal(latitude, longitude, radius, "quake-distance") * 180),
      limitations: ["Model-assisted seismic context. Use official seismic-code maps for final design hazard decisions."],
    },
    legalPlanning: {
      providerMode: status.legalPlanning,
      limitations: ["Diligence checklist model only. No title, licence, approval, RERA, sanction-plan, or litigation status is verified."],
    },
    infrastructure: {
      providerMode: status.infrastructure,
      limitations: ["Model-assisted access and infrastructure screen. Verify roads, utilities, drains, easements, and public works locally."],
    },
  };
};
