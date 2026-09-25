import { BoundedTtlStore } from "../security/http-safety.js";

const stableHash = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
};

const signal = (input, salt) =>
  (stableHash(
    [
      Number(input.location.lat).toFixed(5),
      Number(input.location.lng).toFixed(5),
      Number(input.location.radiusMeters || 500),
      input.intendedUse || "unknown",
      input.reportDepth || "standard",
      salt,
    ].join("|"),
  ) %
    10_000) /
  10_000;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const nowIso = () => new Date().toISOString();
const isInternalDemo = (input) => input.scanMode === "internalDemo";
const isUsRegion = ({ lat, lng }) => lat >= 18 && lat <= 72 && lng >= -170 && lng <= -64;
const isEnglandRegion = ({ lat, lng }) => lat >= 49.8 && lat <= 56.1 && lng >= -6.8 && lng <= 2.2;
const isIndiaRegion = ({ lat, lng }) => lat >= 6 && lat <= 38 && lng >= 68 && lng <= 98;

// Public geodata endpoints (Overpass in particular) reject requests that do not
// identify the caller: without this header Overpass answers HTTP 406 and every
// road/water/land-use indicator silently degrades to "unavailable".
const providerUserAgent = () =>
  process.env.PROVIDER_USER_AGENT ||
  "TerraSignal/1.0 (land intelligence screening; +https://terrasignal.local; contact: ops@terrasignal.local)";

const baseProviderHeaders = (accept) => ({
  "user-agent": providerUserAgent(),
  accept,
});

const fetchJson = async (url, { timeoutMs = 7000, method = "GET", body, headers } = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      body,
      headers: { ...baseProviderHeaders("application/json"), ...headers },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const retryableStatus = new Set([429, 502, 503, 504]);

// Public Overpass instances shed load aggressively: a portfolio of sites
// screened back to back will see several requests rejected with 429 or 504
// even though each one individually is well within policy. Without a retry the
// road, water and land-use indicators for those sites silently degrade to
// "unavailable", which looks identical to genuinely missing coverage.
const fetchJsonWithRetry = async (endpoints, options = {}, { attempts = 3, baseDelayMs = 1200 } = {}) => {
  const urls = Array.isArray(endpoints) ? endpoints.filter(Boolean) : [endpoints];
  let lastError = new Error("No provider endpoint was configured.");

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    // Rotate mirrors across attempts so a single overloaded host does not
    // consume the whole retry budget.
    const url = urls[attempt % urls.length];
    try {
      return await fetchJson(url, options);
    } catch (error) {
      lastError = error;
      const status = Number(String(error?.message || "").match(/HTTP (\d{3})/)?.[1] || 0);
      const isLast = attempt === attempts - 1;
      const shouldRetry = !status || retryableStatus.has(status) || /aborted|timeout|fetch failed/i.test(String(error?.message || ""));
      if (isLast || !shouldRetry) break;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
};

const fetchText = async (url, { timeoutMs = 9000, headers } = {}) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { ...baseProviderHeaders("text/plain,*/*"), ...headers },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
};

export const providerResult = ({
  providerId,
  providerName,
  sourceType,
  dataMode,
  regionCoverage = "unsupported",
  confidence = 0,
  lastUpdated = "",
  citation = "",
  attribution = "",
  rawData = {},
  normalizedIndicators = {},
  limitations = [],
  errors = [],
}) => ({
  providerId,
  providerName,
  sourceType,
  dataMode,
  regionCoverage,
  confidence,
  lastUpdated: lastUpdated || nowIso(),
  citation,
  attribution,
  rawData,
  normalizedIndicators,
  limitations: Array.isArray(limitations) ? limitations : [String(limitations)],
  errors: Array.isArray(errors) ? errors : [String(errors)],
});

const unavailableProvider = ({
  providerId,
  providerName,
  sourceType,
  reason,
  citation = "",
  attribution = "",
  regionCoverage = "unsupported",
  errors = [],
}) =>
  providerResult({
    providerId,
    providerName,
    sourceType,
    dataMode: "unavailable",
    regionCoverage,
    confidence: 0,
    citation,
    attribution,
    limitations: [reason],
    errors,
  });

const parseAsciiGrid = (text) => {
  const lines = String(text || "").trim().split(/\r?\n/);
  const header = {};
  for (const line of lines.slice(0, 6)) {
    const [key, value] = line.trim().split(/\s+/);
    header[String(key || "").toLowerCase()] = Number(value);
  }
  const values = lines
    .slice(6)
    .flatMap((line) => line.trim().split(/\s+/).map(Number))
    .filter((value) => Number.isFinite(value) && value > -9990);
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return { min, max, mean, relief: max - min, sampleCount: values.length, header };
};

const haversineMeters = (a, b) => {
  const toRadians = (value) => (Number(value) * Math.PI) / 180;
  const earthRadius = 6_371_000;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const root =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * earthRadius * Math.atan2(Math.sqrt(root), Math.sqrt(1 - root));
};

const elementPoint = (item) => {
  if (Number.isFinite(item?.lat) && Number.isFinite(item?.lon)) return { lat: item.lat, lng: item.lon };
  if (Number.isFinite(item?.center?.lat) && Number.isFinite(item?.center?.lon)) {
    return { lat: item.center.lat, lng: item.center.lon };
  }
  return null;
};

const samplePointsForRadius = ({ lat, lng, radiusMeters }) => {
  const radius = Math.max(100, Math.min(5000, Number(radiusMeters || 500)));
  const metersPerDegreeLat = 111_320;
  const metersPerDegreeLng = Math.max(30_000, 111_320 * Math.cos((Number(lat) * Math.PI) / 180));
  const offset = (northMeters, eastMeters) => ({
    lat: Number((Number(lat) + northMeters / metersPerDegreeLat).toFixed(5)),
    lng: Number((Number(lng) + eastMeters / metersPerDegreeLng).toFixed(5)),
  });
  const diagonal = radius * 0.7;
  return [
    offset(0, 0),
    offset(radius, 0),
    offset(-radius, 0),
    offset(0, radius),
    offset(0, -radius),
    offset(diagonal, diagonal),
    offset(diagonal, -diagonal),
    offset(-diagonal, diagonal),
    offset(-diagonal, -diagonal),
  ].map((point) => ({
    lat: clamp(point.lat, -89.9, 89.9),
    lng: clamp(point.lng, -179.9, 179.9),
  }));
};

export const opentopographyElevationProvider = async (input) => {
  const apiKey = process.env.OPENTOPOGRAPHY_API_KEY;
  if (!apiKey) {
    return unavailableProvider({
      providerId: "opentopography-dem",
      providerName: "OpenTopography global DEM",
      sourceType: "open-data",
      regionCoverage: "global",
      reason: "OPENTOPOGRAPHY_API_KEY is not configured; no DEM elevation sample was requested.",
      citation: "https://opentopography.org/",
      attribution: "OpenTopography / source DEM attribution applies when configured.",
    });
  }

  const { lat, lng, radiusMeters } = input.location;
  const degrees = clamp(Number(radiusMeters || 500) / 111_320, 0.003, 0.05);
  const url = new URL("https://portal.opentopography.org/API/globaldem");
  url.searchParams.set("demtype", process.env.OPENTOPOGRAPHY_DEM_TYPE || "SRTMGL1");
  url.searchParams.set("south", String(lat - degrees));
  url.searchParams.set("north", String(lat + degrees));
  url.searchParams.set("west", String(lng - degrees));
  url.searchParams.set("east", String(lng + degrees));
  url.searchParams.set("outputFormat", "AAIGrid");
  url.searchParams.set("API_Key", apiKey);

  try {
    const text = await fetchText(url.toString());
    const grid = parseAsciiGrid(text);
    if (!grid) throw new Error("DEM grid contained no usable elevation samples.");
    const relief = Math.round(grid.relief);
    const radius = Math.max(60, Number(radiusMeters || 500));
    return providerResult({
      providerId: "opentopography-dem",
      providerName: "OpenTopography global DEM",
      sourceType: "open-data",
      dataMode: "live",
      regionCoverage: "global",
      confidence: 0.74,
      citation: "https://opentopography.org/",
      attribution: "OpenTopography global DEM API; underlying DEM attribution depends on selected demtype.",
      rawData: {
        demType: url.searchParams.get("demtype"),
        sampleCount: grid.sampleCount,
        ncols: grid.header.ncols,
        nrows: grid.header.nrows,
        cellsizeDegrees: grid.header.cellsize,
      },
      normalizedIndicators: {
        minElevationMeters: Math.round(grid.min),
        maxElevationMeters: Math.round(grid.max),
        meanElevationMeters: Math.round(grid.mean),
        reliefMeters: relief,
        approximateTerrainReliefMeters: relief,
        terrainVariabilityIndex: Number(clamp(relief / 120, 0, 1).toFixed(2)),
        meanSlopeDegrees: Number(clamp((relief / radius) * 22, 0.2, 28).toFixed(1)),
        maxSlopeDegrees: Number(clamp((relief / radius) * 42, 0.8, 42).toFixed(1)),
        resolutionLabel: url.searchParams.get("demtype") || "DEM",
      },
      limitations: [
        "DEM-based slope/relief is screening-level and must be verified with parcel topographic survey data before design or acquisition reliance.",
      ],
    });
  } catch (error) {
    return unavailableProvider({
      providerId: "opentopography-dem",
      providerName: "OpenTopography global DEM",
      sourceType: "open-data",
      regionCoverage: "global",
      reason: `OpenTopography request failed: ${error.message}`,
      citation: "https://opentopography.org/",
      attribution: "OpenTopography",
      errors: [error.message],
    });
  }
};

export const openMeteoElevationProvider = async (input) => {
  if (process.env.OPEN_METEO_ELEVATION_DISABLED === "true") {
    return unavailableProvider({
      providerId: "open-meteo-elevation",
      providerName: "Open-Meteo elevation API",
      sourceType: "open-data",
      regionCoverage: "global",
      reason: "OPEN_METEO_ELEVATION_DISABLED=true; no open-data elevation sample was requested.",
      citation: "https://open-meteo.com/en/docs/elevation-api",
      attribution: "Open-Meteo",
    });
  }
  const { radiusMeters } = input.location;
  const points = samplePointsForRadius(input.location);
  const url = new URL(process.env.OPEN_METEO_ELEVATION_URL || "https://api.open-meteo.com/v1/elevation");
  url.searchParams.set("latitude", points.map((point) => point.lat).join(","));
  url.searchParams.set("longitude", points.map((point) => point.lng).join(","));

  try {
    const payload = await fetchJson(url.toString(), { timeoutMs: 12000 });
    const elevations = Array.isArray(payload?.elevation)
      ? payload.elevation.map(Number).filter(Number.isFinite)
      : [];
    if (elevations.length < 3) throw new Error("Open-Meteo elevation response did not contain enough samples.");
    const min = Math.min(...elevations);
    const max = Math.max(...elevations);
    const mean = elevations.reduce((sum, value) => sum + value, 0) / elevations.length;
    const relief = Math.round(max - min);
    const radius = Math.max(100, Number(radiusMeters || 500));

    return providerResult({
      providerId: "open-meteo-elevation",
      providerName: "Open-Meteo elevation API",
      sourceType: "open-data",
      dataMode: "live",
      regionCoverage: "global",
      confidence: 0.58,
      citation: "https://open-meteo.com/en/docs/elevation-api",
      attribution: "Open-Meteo elevation API; underlying DEM source attribution applies.",
      rawData: {
        requestUrl: url.toString().replace(/([?&]apikey=)[^&]+/i, "$1redacted"),
        samplePoints: points,
        elevationMeters: elevations,
      },
      normalizedIndicators: {
        minElevationMeters: Math.round(min),
        maxElevationMeters: Math.round(max),
        meanElevationMeters: Math.round(mean),
        reliefMeters: relief,
        approximateTerrainReliefMeters: relief,
        terrainVariabilityIndex: Number(clamp(relief / 140, 0, 1).toFixed(2)),
        meanSlopeDegrees: Number(clamp((relief / radius) * 18, 0.1, 24).toFixed(1)),
        maxSlopeDegrees: Number(clamp((relief / radius) * 36, 0.4, 38).toFixed(1)),
        resolutionLabel: "Open-Meteo elevation sampled points",
      },
      limitations: [
        "Open-Meteo elevation is open-data screening context from sampled points, not a parcel topographic survey or certified design surface.",
      ],
    });
  } catch (error) {
    return unavailableProvider({
      providerId: "open-meteo-elevation",
      providerName: "Open-Meteo elevation API",
      sourceType: "open-data",
      regionCoverage: "global",
      reason: `Open-Meteo elevation request failed: ${error.message}`,
      citation: "https://open-meteo.com/en/docs/elevation-api",
      attribution: "Open-Meteo",
      errors: [error.message],
    });
  }
};

export const usgs3DepProvider = async (input) => {
  const { lat, lng } = input.location;
  if (!isUsRegion({ lat, lng })) {
    return unavailableProvider({
      providerId: "usgs-3dep",
      providerName: "USGS 3DEP elevation point query",
      sourceType: "authoritative",
      regionCoverage: "US",
      reason: "USGS 3DEP point query is only attempted for US coordinates.",
      citation: "https://www.usgs.gov/3d-elevation-program",
      attribution: "U.S. Geological Survey",
    });
  }
  const url = new URL("https://epqs.nationalmap.gov/v1/json");
  url.searchParams.set("x", String(lng));
  url.searchParams.set("y", String(lat));
  url.searchParams.set("units", "Meters");
  url.searchParams.set("wkid", "4326");
  url.searchParams.set("includeDate", "true");
  try {
    const payload = await fetchJson(url.toString());
    const elevation = Number(
      payload?.value ?? payload?.elevation ?? payload?.USGS_Elevation_Point_Query_Service?.Elevation_Query?.Elevation,
    );
    if (!Number.isFinite(elevation)) throw new Error("No elevation value in USGS response.");
    return providerResult({
      providerId: "usgs-3dep",
      providerName: "USGS 3DEP elevation point query",
      sourceType: "authoritative",
      dataMode: "live",
      regionCoverage: "US",
      confidence: 0.72,
      citation: "https://www.usgs.gov/3d-elevation-program",
      attribution: "U.S. Geological Survey",
      rawData: payload,
      normalizedIndicators: {
        meanElevationMeters: Math.round(elevation),
        pointElevationMeters: Math.round(elevation),
        scoringScope: "point-only",
      },
      limitations: [
        "The public point query is not a parcel DEM and does not provide a slope model; it is not used as a standalone slope score.",
      ],
    });
  } catch (error) {
    return unavailableProvider({
      providerId: "usgs-3dep",
      providerName: "USGS 3DEP elevation point query",
      sourceType: "authoritative",
      regionCoverage: "US",
      reason: `USGS 3DEP request failed: ${error.message}`,
      citation: "https://www.usgs.gov/3d-elevation-program",
      attribution: "U.S. Geological Survey",
      errors: [error.message],
    });
  }
};

export const ukEnvironmentAgencyFloodProvider = async (input) => {
  const { lat, lng, radiusMeters } = input.location;
  if (!isEnglandRegion({ lat, lng })) {
    return unavailableProvider({
      providerId: "uk-ea-flood",
      providerName: "UK Environment Agency flood monitoring",
      sourceType: "authoritative",
      regionCoverage: "UK",
      reason: "Environment Agency flood monitoring is only attempted for England coordinates.",
      citation: "https://environment.data.gov.uk/flood-monitoring/doc/reference",
      attribution: "Environment Agency flood monitoring API",
    });
  }
  const url = new URL("https://environment.data.gov.uk/flood-monitoring/id/floodAreas");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("long", String(lng));
  url.searchParams.set("dist", String(Math.max(1, Math.round(Number(radiusMeters || 500) / 1000))));
  try {
    const payload = await fetchJson(url.toString());
    const count = Array.isArray(payload?.items) ? payload.items.length : 0;
    return providerResult({
      providerId: "uk-ea-flood",
      providerName: "UK Environment Agency flood monitoring",
      sourceType: "authoritative",
      dataMode: "live",
      regionCoverage: "UK",
      confidence: 0.8,
      citation: "https://environment.data.gov.uk/flood-monitoring/doc/reference",
      attribution: "Environment Agency flood monitoring API",
      rawData: { itemCount: count, sample: payload?.items?.slice?.(0, 8) || [] },
      normalizedIndicators: {
        nearbyFloodAreaCount: count,
        floodContextIndex: clamp(count * 18, 0, 92),
        drainageContextIndex: clamp(18 + count * 8, 10, 84),
      },
      limitations: [
        "Flood-area proximity is not a flood-depth, drainage-design, insurance, planning, or legal conclusion.",
      ],
    });
  } catch (error) {
    return unavailableProvider({
      providerId: "uk-ea-flood",
      providerName: "UK Environment Agency flood monitoring",
      sourceType: "authoritative",
      regionCoverage: "UK",
      reason: `Environment Agency request failed: ${error.message}`,
      citation: "https://environment.data.gov.uk/flood-monitoring/doc/reference",
      attribution: "Environment Agency",
      errors: [error.message],
    });
  }
};

// Additional Overpass mirrors, tried in rotation when the primary sheds load.
// Configure OVERPASS_API_MIRRORS as a comma-separated list to override.
const overpassEndpoints = (primary) => {
  const configured = String(process.env.OVERPASS_API_MIRRORS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([primary, ...configured])].filter(Boolean);
};

export const overpassProvider = async (input) => {
  const endpoint = process.env.OVERPASS_API_URL;
  if (!endpoint) {
    return unavailableProvider({
      providerId: "osm-overpass-context",
      providerName: "OpenStreetMap Overpass context",
      sourceType: "open-data",
      regionCoverage: "global",
      reason: "OVERPASS_API_URL is not configured; roads/water/land-use context was not requested.",
      citation: "https://wiki.openstreetmap.org/wiki/Overpass_API",
      attribution: "OpenStreetMap contributors",
    });
  }

  const { lat, lng, radiusMeters } = input.location;
  const radius = Math.min(5000, Math.max(100, Number(radiusMeters || 500)));
  const query = `
    [out:json][timeout:12];
    (
      way(around:${radius},${lat},${lng})["highway"];
      way(around:${radius},${lat},${lng})["railway"];
      way(around:${radius},${lat},${lng})["waterway"];
      way(around:${radius},${lat},${lng})["natural"="water"];
      way(around:${radius},${lat},${lng})["landuse"];
      node(around:${radius},${lat},${lng})["highway"];
      node(around:${radius},${lat},${lng})["amenity"];
      node(around:${radius},${lat},${lng})["power"];
    );
    out tags center 120;
  `;
  try {
    const payload = await fetchJsonWithRetry(
      overpassEndpoints(endpoint),
      {
        method: "POST",
        body: new URLSearchParams({ data: query }),
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" },
        timeoutMs: 20000,
      },
      { attempts: Number(process.env.OVERPASS_MAX_ATTEMPTS || 3), baseDelayMs: 1500 },
    );
    const elements = Array.isArray(payload?.elements) ? payload.elements : [];
    const center = { lat, lng };
    const roads = elements.filter((item) => item.tags?.highway || item.tags?.railway);
    const water = elements.filter((item) => item.tags?.waterway || item.tags?.natural === "water");
    const landUse = elements.filter((item) => item.tags?.landuse);
    const industrial = elements.filter((item) =>
      /industrial|commercial|landfill|brownfield|quarry/.test(String(item.tags?.landuse || "")),
    );
    const utilities = elements.filter((item) => item.tags?.power || item.tags?.amenity);
    const nearestDistance = (items) => {
      const distances = items.map(elementPoint).filter(Boolean).map((point) => haversineMeters(center, point));
      return distances.length ? Math.round(Math.min(...distances)) : null;
    };
    const nearestRoadMeters = nearestDistance(roads);
    const nearestWaterMeters = nearestDistance(water);

    return providerResult({
      providerId: "osm-overpass-context",
      providerName: "OpenStreetMap Overpass context",
      sourceType: "open-data",
      dataMode: "live",
      regionCoverage: "global",
      confidence: 0.66,
      citation: "https://www.openstreetmap.org/copyright",
      attribution: "OpenStreetMap contributors",
      rawData: {
        elementCount: elements.length,
        sample: elements.slice(0, 20).map((item) => ({ type: item.type, tags: item.tags, center: item.center })),
      },
      normalizedIndicators: {
        roadFeatureCount: roads.length,
        waterFeatureCount: water.length,
        landUseFeatureCount: landUse.length,
        utilityAmenityFeatureCount: utilities.length,
        industrialContextFeatureCount: industrial.length,
        nearestRoadMeters,
        nearestWaterFeatureMeters: nearestWaterMeters,
        roadAccessQualityIndex: clamp(roads.length * 8 + (nearestRoadMeters === null ? 0 : 28), 0, 95),
        waterProximityRiskIndex:
          nearestWaterMeters === null ? clamp(water.length * 8, 0, 30) : clamp(100 - nearestWaterMeters / 35 + water.length * 6, 0, 95),
        landUseContextIndex: clamp(industrial.length * 18 + landUse.length * 4, 0, 95),
        infrastructureContextIndex: clamp(roads.length * 7 + utilities.length * 8, 0, 95),
        dominantClass:
          industrial.length > 2 ? "industrial or commercial context" : roads.length > 8 ? "urban or peri-urban" : "open or mixed land",
      },
      limitations: [
        "OSM completeness varies by region; access, ownership, utilities, restrictions, and land-use permissions require official verification.",
      ],
    });
  } catch (error) {
    return unavailableProvider({
      providerId: "osm-overpass-context",
      providerName: "OpenStreetMap Overpass context",
      sourceType: "open-data",
      regionCoverage: "global",
      reason: `Overpass request failed: ${error.message}`,
      citation: "https://wiki.openstreetmap.org/wiki/Overpass_API",
      attribution: "OpenStreetMap contributors",
      errors: [error.message],
    });
  }
};

export const cesiumTerrainProviderMetadata = async () => {
  if (!process.env.CESIUM_ION_TOKEN) {
    return unavailableProvider({
      providerId: "cesium-ion-terrain",
      providerName: "Cesium ion world terrain",
      sourceType: "commercial-api",
      regionCoverage: "global",
      reason: "CESIUM_ION_TOKEN is not configured; Cesium terrain is unavailable for visualization metadata.",
      citation: "https://cesium.com/platform/cesium-ion/",
      attribution: "Cesium ion attribution applies when configured.",
    });
  }
  return providerResult({
    providerId: "cesium-ion-terrain",
    providerName: "Cesium ion world terrain",
    sourceType: "commercial-api",
    dataMode: "live",
    regionCoverage: "global",
    confidence: 0.5,
    citation: "https://cesium.com/platform/cesium-ion/",
    attribution: "Cesium ion",
    rawData: { tokenConfigured: true },
    normalizedIndicators: { visualizationOnly: true, scoringContribution: false },
    limitations: [
      "Cesium terrain is currently used for visualization metadata only in this backend; it is not treated as a scoring dataset unless terrain sampling is implemented.",
    ],
  });
};

export const mapboxVisualizationProviderMetadata = async () => {
  if (!process.env.MAPBOX_ACCESS_TOKEN) {
    return unavailableProvider({
      providerId: "mapbox-visual-layers",
      providerName: "Mapbox satellite/terrain/contour layers",
      sourceType: "commercial-api",
      regionCoverage: "global",
      reason: "MAPBOX_ACCESS_TOKEN is not configured; Mapbox visual layers are unavailable.",
      citation: "https://www.mapbox.com/",
      attribution: "Mapbox attribution applies when configured.",
    });
  }
  return providerResult({
    providerId: "mapbox-visual-layers",
    providerName: "Mapbox satellite/terrain/contour layers",
    sourceType: "commercial-api",
    dataMode: "live",
    regionCoverage: "global",
    confidence: 0.45,
    citation: "https://www.mapbox.com/",
    attribution: "Mapbox",
    rawData: { tokenConfigured: true },
    normalizedIndicators: { visualizationOnly: true, scoringContribution: false },
    limitations: [
      "Map visualization availability is not engineering evidence by itself. Elevation or terrain scoring requires an explicit sampled data method.",
    ],
  });
};

export const indiaAuthoritativePlaceholderProvider = async (input) => {
  const { lat, lng } = input.location;
  return unavailableProvider({
    providerId: "india-authoritative-placeholder",
    providerName: "India authoritative/open data placeholder",
    sourceType: "authoritative",
    regionCoverage: isIndiaRegion({ lat, lng }) ? "India" : "unsupported",
    reason:
      "No India authoritative/open geotechnical, flood, cadastral, seismic, or environmental adapter is implemented in this build.",
    citation: "",
    attribution: "",
  });
};

const mockProvider = ({ providerId, providerName, normalizedIndicators, rawSeed, regionCoverage = "global" }) =>
  providerResult({
    providerId,
    providerName,
    sourceType: "mock",
    dataMode: "mock",
    regionCoverage,
    confidence: 0.22,
    rawData: { seed: rawSeed },
    normalizedIndicators,
    limitations: [
      "Demo output using mocked screening indicators, not live authoritative datasets.",
      "This adapter exists only for internalDemo mode and cannot support client deliverables.",
    ],
  });

const collectInternalDemoProviderOutputs = async (scanInput) => {
  const { location } = scanInput;
  const radius = Number(location.radiusMeters || 500);
  const relief = Math.round(8 + signal(scanInput, "relief") * clamp(radius / 7, 30, 220));
  const nearestRoad = Math.round(40 + (1 - signal(scanInput, "roads")) * 3600);
  const nearestWater = Math.round(80 + signal(scanInput, "water") * 4200);
  return {
    openTopography: mockProvider({
      providerId: "mock-elevation-dem",
      providerName: "Mock DEM terrain adapter",
      rawSeed: stableHash(`${location.lat}|${location.lng}|mock-elevation`),
      normalizedIndicators: {
        minElevationMeters: Math.round(Math.abs(location.lat) * 2 + 12),
        maxElevationMeters: Math.round(Math.abs(location.lat) * 2 + 12 + relief),
        meanElevationMeters: Math.round(Math.abs(location.lat) * 2 + 12 + relief / 2),
        reliefMeters: relief,
        approximateTerrainReliefMeters: relief,
        terrainVariabilityIndex: Number(clamp(relief / 120, 0.05, 0.95).toFixed(2)),
        meanSlopeDegrees: Number((0.6 + signal(scanInput, "slope") * 18).toFixed(1)),
        maxSlopeDegrees: Number((2 + signal(scanInput, "max-slope") * 31).toFixed(1)),
        resolutionLabel: "mock DEM",
      },
    }),
    openMeteoElevation: unavailableProvider({
      providerId: "open-meteo-elevation",
      providerName: "Open-Meteo elevation API",
      sourceType: "open-data",
      regionCoverage: "global",
      reason: "Skipped in internalDemo mode; mock elevation adapter was used intentionally.",
      citation: "https://open-meteo.com/en/docs/elevation-api",
      attribution: "Open-Meteo",
    }),
    usgs3dep: unavailableProvider({
      providerId: "usgs-3dep",
      providerName: "USGS 3DEP elevation point query",
      sourceType: "authoritative",
      regionCoverage: "US",
      reason: "Skipped in internalDemo mode; mock elevation adapter was used intentionally.",
      citation: "https://www.usgs.gov/3d-elevation-program",
      attribution: "U.S. Geological Survey",
    }),
    flood: mockProvider({
      providerId: "mock-drainage-flood",
      providerName: "Mock drainage/flood context adapter",
      rawSeed: stableHash(`${location.lat}|${location.lng}|mock-flood`),
      normalizedIndicators: {
        nearbyFloodAreaCount: Math.round(signal(scanInput, "flood-count") * 4),
        floodContextIndex: Math.round(12 + signal(scanInput, "flood") * 78),
        drainageContextIndex: Math.round(18 + signal(scanInput, "drainage") * 68),
      },
    }),
    overpass: mockProvider({
      providerId: "mock-osm-context",
      providerName: "Mock roads/water/land-use context adapter",
      rawSeed: stableHash(`${location.lat}|${location.lng}|mock-osm`),
      normalizedIndicators: {
        roadFeatureCount: Math.round(signal(scanInput, "road-count") * 18),
        waterFeatureCount: Math.round(signal(scanInput, "water-count") * 8),
        landUseFeatureCount: Math.round(signal(scanInput, "landuse-count") * 10),
        utilityAmenityFeatureCount: Math.round(signal(scanInput, "utility-count") * 8),
        industrialContextFeatureCount: Math.round(signal(scanInput, "industrial-count") * 5),
        nearestRoadMeters: nearestRoad,
        nearestWaterFeatureMeters: nearestWater,
        roadAccessQualityIndex: Math.round(clamp(88 - nearestRoad / 48, 14, 92)),
        waterProximityRiskIndex: Math.round(clamp(100 - nearestWater / 38, 5, 90)),
        landUseContextIndex: Math.round(10 + signal(scanInput, "landuse-risk") * 78),
        infrastructureContextIndex: Math.round(16 + signal(scanInput, "infra") * 76),
        dominantClass: signal(scanInput, "urban") > 0.58 ? "urban or peri-urban" : "open or mixed land",
      },
    }),
    cesiumTerrain: await cesiumTerrainProviderMetadata(),
    mapboxVisualLayers: await mapboxVisualizationProviderMetadata(),
    indiaPlaceholder: await indiaAuthoritativePlaceholderProvider(scanInput),
  };
};

const layerMeta = ({ id, provider, source = provider.providerName, scoringEligible = true }) => ({
  id,
  adapter: provider.providerId,
  providerName: provider.providerName,
  source,
  sourceType: provider.sourceType,
  status: provider.dataMode,
  dataMode: provider.dataMode,
  generatedAt: nowIso(),
  lastUpdated: provider.lastUpdated,
  regionCoverage: provider.regionCoverage,
  coverage: provider.regionCoverage,
  confidence: provider.confidence,
  citation: provider.citation,
  citationUrl: provider.citation,
  attribution: provider.attribution,
  sourceReliability: provider.sourceType === "mock" ? "mock/demo only" : provider.sourceType,
  limitations: provider.limitations.join(" "),
  errors: provider.errors,
  scoringEligible,
  rawProviderData: provider.rawData,
});

const unavailableLayer = (id, reason) => ({
  ...layerMeta({
    id,
    provider: unavailableProvider({
      providerId: `${id}-unavailable`,
      providerName: `${id} unavailable`,
      sourceType: "computed",
      reason,
    }),
    source: `${id} unavailable`,
    scoringEligible: false,
  }),
});

const chooseElevationProvider = (openTopography, openMeteoElevation, usgs3dep) => {
  if (openTopography.dataMode === "live" || openTopography.dataMode === "mock") return openTopography;
  if (openMeteoElevation?.dataMode === "live") return openMeteoElevation;
  if (usgs3dep.dataMode === "live") return usgs3dep;
  return openTopography;
};

const buildLayersFromProviders = ({ scanInput, providerOutputs }) => {
  const elevationProvider = chooseElevationProvider(
    providerOutputs.openTopography,
    providerOutputs.openMeteoElevation,
    providerOutputs.usgs3dep,
  );
  const elevation = elevationProvider.normalizedIndicators || {};
  const overpass = providerOutputs.overpass;
  const overpassIndicators = overpass.normalizedIndicators || {};
  const flood = providerOutputs.flood;
  const floodIndicators = flood.normalizedIndicators || {};

  const elevationHasSlope =
    elevationProvider.dataMode !== "unavailable" &&
    Number.isFinite(elevation.meanSlopeDegrees) &&
    Number.isFinite(elevation.maxSlopeDegrees);

  const layers = {
    elevationTopography:
      elevationProvider.dataMode !== "unavailable"
        ? {
            ...layerMeta({ id: "elevationTopography", provider: elevationProvider }),
            minElevationMeters: elevation.minElevationMeters ?? null,
            maxElevationMeters: elevation.maxElevationMeters ?? null,
            meanElevationMeters: elevation.meanElevationMeters ?? elevation.pointElevationMeters ?? null,
            reliefMeters: elevation.reliefMeters ?? null,
            terrainVariabilityIndex: elevation.terrainVariabilityIndex ?? null,
            resolutionLabel: elevation.resolutionLabel ?? elevation.scoringScope ?? "not provided",
          }
        : {
            ...unavailableLayer("elevationTopography", "No live elevation/terrain provider returned usable scoring data."),
            minElevationMeters: null,
            maxElevationMeters: null,
            meanElevationMeters: null,
            reliefMeters: null,
            terrainVariabilityIndex: null,
            resolutionLabel: "unavailable",
          },
    slope:
      elevationHasSlope
        ? {
            ...layerMeta({
              id: "slope",
              provider: elevationProvider,
              source: `${elevationProvider.providerName} derived slope indicators`,
            }),
            meanSlopeDegrees: elevation.meanSlopeDegrees,
            maxSlopeDegrees: elevation.maxSlopeDegrees,
            slopeVariance: Number(clamp(elevation.maxSlopeDegrees - elevation.meanSlopeDegrees, 0, 24).toFixed(1)),
          }
        : {
            ...unavailableLayer(
              "slope",
              "No sampled DEM slope indicators are available; point elevation or visualization layers are not treated as slope evidence.",
            ),
            meanSlopeDegrees: null,
            maxSlopeDegrees: null,
            slopeVariance: null,
          },
    drainageFlood:
      flood.dataMode !== "unavailable"
        ? {
            ...layerMeta({ id: "drainageFlood", provider: flood }),
            nearbyFloodAreaCount: floodIndicators.nearbyFloodAreaCount ?? null,
            floodContextIndex: floodIndicators.floodContextIndex ?? null,
            drainageContextIndex: floodIndicators.drainageContextIndex ?? null,
          }
        : {
            ...unavailableLayer("drainageFlood", "No supported live flood authority provider returned data for this location."),
            nearbyFloodAreaCount: null,
            floodContextIndex: null,
            drainageContextIndex: null,
          },
    nearbyWaterBodies:
      overpass.dataMode !== "unavailable"
        ? {
            ...layerMeta({ id: "nearbyWaterBodies", provider: overpass, source: "OSM waterway and waterbody tags" }),
            nearestWaterFeatureMeters: overpassIndicators.nearestWaterFeatureMeters ?? null,
            waterFeatureCount: overpassIndicators.waterFeatureCount ?? 0,
            waterProximityRiskIndex: overpassIndicators.waterProximityRiskIndex ?? null,
          }
        : {
            ...unavailableLayer("nearbyWaterBodies", "No live waterbody provider returned usable data."),
            nearestWaterFeatureMeters: null,
            waterFeatureCount: 0,
            waterProximityRiskIndex: null,
          },
    infrastructure:
      overpass.dataMode !== "unavailable"
        ? {
            ...layerMeta({ id: "infrastructure", provider: overpass, source: "OSM roads/access and infrastructure context" }),
            nearestRoadMeters: overpassIndicators.nearestRoadMeters ?? null,
            roadFeatureCount: overpassIndicators.roadFeatureCount ?? 0,
            utilityAmenityFeatureCount: overpassIndicators.utilityAmenityFeatureCount ?? 0,
            roadAccessQualityIndex: overpassIndicators.roadAccessQualityIndex ?? null,
            infrastructureContextIndex: overpassIndicators.infrastructureContextIndex ?? null,
          }
        : {
            ...unavailableLayer("infrastructure", "No live road/access provider returned usable data."),
            nearestRoadMeters: null,
            roadFeatureCount: 0,
            utilityAmenityFeatureCount: 0,
            roadAccessQualityIndex: null,
            infrastructureContextIndex: null,
          },
    landUseContext:
      overpass.dataMode !== "unavailable"
        ? {
            ...layerMeta({ id: "landUseContext", provider: overpass, source: "OSM land-use/context tags" }),
            dominantClass: overpassIndicators.dominantClass ?? "unknown",
            landUseFeatureCount: overpassIndicators.landUseFeatureCount ?? 0,
            industrialContextFeatureCount: overpassIndicators.industrialContextFeatureCount ?? 0,
            landUseContextIndex: overpassIndicators.landUseContextIndex ?? null,
          }
        : {
            ...unavailableLayer("landUseContext", "No live land-use/context provider returned usable data."),
            dominantClass: "unavailable",
            landUseFeatureCount: 0,
            industrialContextFeatureCount: 0,
            landUseContextIndex: null,
          },
    cesiumTerrain: {
      ...layerMeta({
        id: "cesiumTerrain",
        provider: providerOutputs.cesiumTerrain,
        source: "Cesium terrain visualization metadata",
        scoringEligible: false,
      }),
      visualizationOnly: true,
    },
    mapboxVisualLayers: {
      ...layerMeta({
        id: "mapboxVisualLayers",
        provider: providerOutputs.mapboxVisualLayers,
        source: "Mapbox visual layer metadata",
        scoringEligible: false,
      }),
      visualizationOnly: true,
    },
    geologySoil: {
      ...unavailableLayer("geologySoil", "No real soil/geology provider is implemented or configured for this scan."),
      unavailable: true,
      recommendedVerification: "Boreholes, SPT/CPT, soil lab testing, geology maps, and qualified geotechnical review.",
    },
    seismicGeology: {
      ...unavailableLayer("seismicGeology", "No real seismic/geology hazard provider is implemented for this scan."),
      unavailable: true,
      recommendedVerification: "Official seismic-code maps, liquefaction/geology review, and structural engineering checks.",
    },
    indiaAuthoritativePlaceholder: {
      ...layerMeta({
        id: "indiaAuthoritativePlaceholder",
        provider: providerOutputs.indiaPlaceholder,
        source: "Future India authoritative/open data adapter placeholder",
        scoringEligible: false,
      }),
      unavailable: true,
    },
  };

  Object.defineProperty(layers, "__providerOutputs", {
    value: providerOutputs,
    enumerable: false,
  });
  Object.defineProperty(layers, "__scanMode", {
    value: scanInput.scanMode,
    enumerable: false,
  });
  return layers;
};

// Provider responses depend only on the sampled location, the radius and the
// scan mode, so identical requests inside the TTL reuse one upstream call.
// This is what makes multi-site portfolio comparison affordable: a ten-site
// portfolio re-scanned after a weight change costs zero provider requests.
const providerCache = new BoundedTtlStore({ maxEntries: 500 });
const providerCacheTtlMs = () => Math.max(0, Number(process.env.PROVIDER_CACHE_TTL_MS ?? 15 * 60 * 1000));

const providerCacheKey = (scanInput) => {
  const { lat, lng, radiusMeters } = scanInput.location;
  // ~11 m of precision. Finer keys would defeat the cache without changing
  // any indicator, because every adapter samples a radius, not a point.
  const round = (value) => Number(value).toFixed(4);
  return [
    round(lat),
    round(lng),
    Math.round(Number(radiusMeters || 500)),
    scanInput.scanMode || "live",
    // The demo adapters derive deterministic values from use/depth too.
    isInternalDemo(scanInput) ? `${scanInput.intendedUse}|${scanInput.reportDepth}` : "",
  ].join(":");
};

export const providerCacheStats = () => ({ entries: providerCache.size, ttlMs: providerCacheTtlMs() });
export const clearProviderCache = () => {
  providerCache.entries.clear();
};

const collectProviderOutputsUncached = async (scanInput) => {
  if (isInternalDemo(scanInput)) return collectInternalDemoProviderOutputs(scanInput);
  const [openTopography, openMeteoElevation, usgs3dep, flood, overpass, cesiumTerrain, mapboxVisualLayers, indiaPlaceholder] =
    await Promise.all([
      opentopographyElevationProvider(scanInput),
      openMeteoElevationProvider(scanInput),
      usgs3DepProvider(scanInput),
      ukEnvironmentAgencyFloodProvider(scanInput),
      overpassProvider(scanInput),
      cesiumTerrainProviderMetadata(scanInput),
      mapboxVisualizationProviderMetadata(scanInput),
      indiaAuthoritativePlaceholderProvider(scanInput),
    ]);
  return { openTopography, openMeteoElevation, usgs3dep, flood, overpass, cesiumTerrain, mapboxVisualLayers, indiaPlaceholder };
};

export const collectProviderOutputs = async (scanInput) => {
  const ttlMs = providerCacheTtlMs();
  if (!ttlMs) return collectProviderOutputsUncached(scanInput);

  const key = providerCacheKey(scanInput);
  const cached = providerCache.get(key);
  // Store the in-flight promise so concurrent portfolio scans of the same
  // coordinate collapse into a single upstream request.
  if (cached?.promise) return cached.promise;

  const promise = collectProviderOutputsUncached(scanInput)
    .then((outputs) => {
      providerCache.set(key, { promise: Promise.resolve(outputs), expiresAt: Date.now() + ttlMs });
      return outputs;
    })
    .catch((error) => {
      providerCache.delete(key);
      throw error;
    });

  providerCache.set(key, { promise, expiresAt: Date.now() + ttlMs });
  return promise;
};

export const collectLandScanLayers = async (scanInput) => {
  const providerOutputs = await collectProviderOutputs(scanInput);
  return buildLayersFromProviders({ scanInput, providerOutputs });
};

export const adapterTodos = [
  "Configure OPENTOPOGRAPHY_API_KEY for live OpenTopography SRTM/Copernicus DEM sampling.",
  "Open-Meteo elevation is used as a no-key open-data DEM sampling provider when OpenTopography is unavailable; validate coverage and attribution before paid use in each target market.",
  "Configure OVERPASS_API_URL for live OSM roads, water, land-use, and infrastructure context.",
  "Configure CESIUM_ION_TOKEN and VITE_CESIUM_ION_TOKEN for Cesium terrain visualization.",
  "Configure MAPBOX_ACCESS_TOKEN when Mapbox satellite/terrain/contour visual layers are required.",
  "Use USGS 3DEP automatically for US coordinates where the public point query is reachable.",
  "Use UK Environment Agency flood monitoring automatically for England coordinates where public flood-area data is reachable.",
  "Add live soil/geology providers such as SoilGrids, BGS, USGS, GSI, or uploaded borehole evidence before scoring geology.",
  "Add official seismic-code map adapters before scoring seismic/geology hazards.",
  "Add user-upload adapters for PDFs, borehole logs, CAD, shapefiles, GeoJSON, KML, and survey levels.",
];
