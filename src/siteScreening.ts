import type { ActiveSite, SiteScreeningResult } from "./types";
import type {
  ProviderRegistryStatus,
  ProviderStatus,
  RiskLayerAssessment,
  RiskLayerId,
  HistoricalImageryPlaceholder,
  SiteQualityLabel,
} from "./features/site-intelligence/types/siteIntelligence";
import { clamp, isLikelyIndiaCoordinate } from "./features/site-intelligence/utils/geoMath";

export const requiredProfessionalDisclaimer =
  "This tool provides preliminary screening and decision-support only. It does not replace professional geotechnical investigation, boreholes, SPT/CPT, soil laboratory testing, structural design, legal due diligence, or review by qualified civil/geotechnical engineers. Results must not be used as the sole basis for construction, land purchase, safety, financial, or engineering decisions.";

const stableHash = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
};

const normalizedSignal = (site: ActiveSite, salt: string) => {
  const hash = stableHash(
    [
      site.latitude.toFixed(5),
      site.longitude.toFixed(5),
      site.radiusMeters,
      site.intendedUse,
      site.buildingType,
      site.floors,
      site.loadCategory,
      site.purchaseStage,
      salt,
    ].join("|"),
  );
  return (hash % 10_000) / 10_000;
};

const includesAny = (value: string, tokens: string[]) => tokens.some((token) => value.toLowerCase().includes(token));

const average = (values: number[]) =>
  values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;

const weighted = (entries: Array<[number, number]>) => {
  const totalWeight = entries.reduce((total, [, weight]) => total + weight, 0) || 1;
  return Math.round(entries.reduce((total, [value, weight]) => total + value * weight, 0) / totalWeight);
};

const loadMultiplier = (site: ActiveSite) => {
  const load = site.loadCategory.toLowerCase();
  const use = `${site.intendedUse} ${site.buildingType}`.toLowerCase();
  let multiplier = load.includes("heavy") ? 1.18 : load.includes("medium") ? 1.05 : 0.94;
  if (includesAny(use, ["bridge", "industrial", "warehouse", "hospital", "public", "apartment", "mixed-use"])) {
    multiplier += 0.07;
  }
  if (site.floors >= 12) multiplier += 0.08;
  if (site.floors >= 25) multiplier += 0.07;
  return multiplier;
};

const cautionLevel = (risk: number): SiteScreeningResult["buildabilityCautionLevel"] => {
  if (risk >= 84) return "Critical";
  if (risk >= 68) return "High";
  if (risk >= 42) return "Moderate";
  return "Low";
};

const seismicBand = (seismicRisk: number): SiteScreeningResult["seismicContext"]["cautionLevel"] => {
  if (seismicRisk >= 84) return "critical";
  if (seismicRisk >= 68) return "high";
  if (seismicRisk >= 42) return "moderate";
  return "low";
};

const defaultProviderStatus: ProviderRegistryStatus = {
  elevation: "cached",
  soil: "cached",
  seismic: "cached",
  water: "cached",
  landCover: "cached",
  rainfall: "cached",
  groundwater: "cached",
  legalPlanning: "cached",
  infrastructure: "cached",
  news: "unavailable",
  ai: "fallback",
};

const normalizeProviderStatus = (status: ProviderStatus): ProviderStatus =>
  status === "configured" ? "fallback" : status;

const confidenceFor = (status: ProviderStatus, base: number) => {
  const normalized = normalizeProviderStatus(status);
  if (normalized === "live") return clamp(base + 16, 58, 96);
  if (normalized === "cached") return clamp(base + 6, 48, 88);
  if (normalized === "fallback") return clamp(base - 22, 24, 58);
  return clamp(base - 38, 0, 34);
};

const sourceLabel = (status: ProviderStatus, source: string) => {
  const normalized = normalizeProviderStatus(status);
  if (normalized === "live") return source;
  if (normalized === "cached") return `${source} model-assisted layer`;
  if (normalized === "fallback") return `${source} fallback proxy`;
  return `${source} unavailable`;
};

const buildAssessment = ({
  critical,
  explanation,
  id,
  label,
  limitation,
  provider,
  recommendedAction,
  source,
  status,
  value,
  weight,
}: Omit<RiskLayerAssessment, "confidence" | "generatedAt" | "source" | "status"> & {
  source: string;
  status: ProviderStatus;
}) => ({
  id,
  label,
  value,
  confidence: confidenceFor(status, critical ? 66 : 60),
  provider,
  source: sourceLabel(status, source),
  status: normalizeProviderStatus(status),
  generatedAt: new Date().toISOString(),
  explanation,
  limitation,
  recommendedAction,
  critical,
  weight,
});

const buildLayerAssessments = (
  site: ActiveSite,
  risks: {
    terrainSlopeRisk: number;
    elevationRisk: number;
    drainageWaterloggingRisk: number;
    waterbodyProximityRisk: number;
    groundwaterDewateringRisk: number;
    soilUncertaintyRisk: number;
    seismicCodeRisk: number;
    landCoverChangeRisk: number;
    urbanDevelopmentRisk: number;
    legalTitlePlanningRisk: number;
    infrastructureAccessRisk: number;
    dataQualityPenalty: number;
    denseUrban: boolean;
  },
  providerStatus: ProviderRegistryStatus,
): Record<RiskLayerId, RiskLayerAssessment> => {
  const fallbackLimitation =
    "Fallback output is a broad screening band and must not be treated as measured or verified site data.";
  const modelLimitation =
    "Model-assisted output is structured decision support from coordinates, project context, and calibrated risk rules. It is not measured field data.";
  const urbanPhrase = risks.denseUrban
    ? "Dense urban context shifts attention toward drainage, prior filling, utilities, approvals, and access."
    : "Open or developing context keeps land-cover history, grading, access, and hydrology uncertainty in focus.";

  return {
    terrainSlopeRisk: buildAssessment({
      id: "terrainSlopeRisk",
      label: "Terrain / slope",
      value: risks.terrainSlopeRisk,
      provider: "DEM terrain provider",
      source: "NASADEM/SRTM/OpenTopography-ready layer",
      status: providerStatus.elevation,
      critical: false,
      explanation:
        risks.denseUrban
          ? "Urban flat-land heuristic is active; terrain risk is capped unless a live DEM proves steep slope or erosion."
          : "Terrain screen estimates slope and roughness as an early grading and stability indicator.",
      limitation: providerStatus.elevation === "cached" ? modelLimitation : fallbackLimitation,
      recommendedAction: "Confirm slope and site levels with a topographic survey or live DEM provider.",
      weight: { buyer: 0.04, builder: 0.1, engineer: 0.06 },
    }),
    elevationRisk: buildAssessment({
      id: "elevationRisk",
      label: "Elevation context",
      value: risks.elevationRisk,
      provider: "Elevation provider",
      source: "DEM elevation context",
      status: providerStatus.elevation,
      critical: false,
      explanation: "Elevation is tracked separately from slope so flat urban parcels are not over-penalized.",
      limitation: providerStatus.elevation === "cached" ? modelLimitation : fallbackLimitation,
      recommendedAction: "Verify finished ground levels, road levels, plinth levels, and stormwater outfall elevations.",
      weight: { buyer: 0.03, builder: 0.05, engineer: 0.05 },
    }),
    drainageWaterloggingRisk: buildAssessment({
      id: "drainageWaterloggingRisk",
      label: "Drainage / waterlogging",
      value: risks.drainageWaterloggingRisk,
      provider: "Hydrology/rainfall provider",
      source: "OSM drainage, rainfall, flood, and waterlogging-ready layer",
      status: providerStatus.water,
      critical: true,
      explanation:
        "Urban drainage receives extra weight because paved catchments, blocked drains, and local road levels can dominate buyer and construction risk.",
      limitation: providerStatus.water === "cached" ? modelLimitation : fallbackLimitation,
      recommendedAction: "Check monsoon waterlogging history, stormwater drains, outfall route, road levels, and basement drainage.",
      weight: { buyer: 0.18, builder: 0.2, engineer: 0.18 },
    }),
    waterbodyProximityRisk: buildAssessment({
      id: "waterbodyProximityRisk",
      label: "Waterbody proximity",
      value: risks.waterbodyProximityRisk,
      provider: "Hydrology provider",
      source: "OSM/surface-water-ready layer",
      status: providerStatus.water,
      critical: true,
      explanation: "Screens nearby waterbody and floodplain sensitivity without claiming exact flood depth.",
      limitation: providerStatus.water === "cached" ? modelLimitation : fallbackLimitation,
      recommendedAction: "Verify waterbody buffers, floodplain restrictions, and seasonal water presence from official maps.",
      weight: { buyer: 0.09, builder: 0.08, engineer: 0.08 },
    }),
    groundwaterDewateringRisk: buildAssessment({
      id: "groundwaterDewateringRisk",
      label: "Groundwater / dewatering",
      value: risks.groundwaterDewateringRisk,
      provider: "Groundwater authority provider",
      source: "Groundwater regulation and observation-well-ready layer",
      status: providerStatus.groundwater,
      critical: true,
      explanation:
        "Groundwater and dewatering are elevated for basement, multi-floor, and urban projects where excavation and permissions can affect cost and schedule.",
      limitation: providerStatus.groundwater === "cached" ? modelLimitation : fallbackLimitation,
      recommendedAction: "Check groundwater level records, dewatering permissions, basement drainage design, and local authority rules.",
      weight: { buyer: 0.08, builder: 0.1, engineer: 0.08 },
    }),
    soilUncertaintyRisk: buildAssessment({
      id: "soilUncertaintyRisk",
      label: "Soil uncertainty",
      value: risks.soilUncertaintyRisk,
      provider: "Soil provider",
      source: "SoilGrids/geological-map-ready layer",
      status: providerStatus.soil,
      critical: true,
      explanation: "Represents uncertainty that must be resolved through boreholes, SPT/CPT, groundwater observation, and laboratory testing.",
      limitation: providerStatus.soil === "cached" ? modelLimitation : fallbackLimitation,
      recommendedAction: "Do not infer bearing capacity, settlement, soil class, or foundation type without field investigation.",
      weight: { buyer: 0.12, builder: 0.25, engineer: 0.12 },
    }),
    seismicCodeRisk: buildAssessment({
      id: "seismicCodeRisk",
      label: "Seismic design context",
      value: risks.seismicCodeRisk,
      provider: "Seismic provider",
      source: "Official seismic-code and catalog-ready layer",
      status: providerStatus.seismic,
      critical: true,
      explanation:
        "Seismic caution reflects design-code context and project sensitivity; recent small events alone are not used as the hazard conclusion.",
      limitation: providerStatus.seismic === "cached" ? modelLimitation : fallbackLimitation,
      recommendedAction: "Review applicable seismic zone/code, liquefaction susceptibility, and structural design requirements.",
      weight: { buyer: 0.05, builder: 0.15, engineer: 0.08 },
    }),
    landCoverChangeRisk: buildAssessment({
      id: "landCoverChangeRisk",
      label: "Land cover / wetness",
      value: risks.landCoverChangeRisk,
      provider: "Satellite land-cover provider",
      source: "Sentinel/Landsat/WorldCover-ready layer",
      status: providerStatus.landCover,
      critical: false,
      explanation: `${urbanPhrase} NDVI/NDWI and impervious-surface trends are structured for future live imagery.`,
      limitation: providerStatus.landCover === "cached" ? modelLimitation : "Historical imagery is not live in this MVP; no land-cover change is certified.",
      recommendedAction: "Compare historical imagery and official land-use records before purchase or design decisions.",
      weight: { buyer: 0.06, builder: 0.04, engineer: 0.08 },
    }),
    urbanDevelopmentRisk: buildAssessment({
      id: "urbanDevelopmentRisk",
      label: "Urban development / imperviousness",
      value: risks.urbanDevelopmentRisk,
      provider: "Urban land-cover provider",
      source: "Impervious-surface-ready layer",
      status: providerStatus.landCover,
      critical: false,
      explanation: "Screens paved-area, utilities, access conflicts, and surrounding development pressure as schedule-risk indicators.",
      limitation: providerStatus.landCover === "cached" ? modelLimitation : fallbackLimitation,
      recommendedAction: "Verify access width, utility conflicts, traffic ingress/egress, drain routes, and surrounding construction constraints.",
      weight: { buyer: 0.08, builder: 0.05, engineer: 0.12 },
    }),
    legalTitlePlanningRisk: buildAssessment({
      id: "legalTitlePlanningRisk",
      label: "Legal / title / planning diligence",
      value: risks.legalTitlePlanningRisk,
      provider: "Planning and public-record provider",
      source: "RERA/land-record/planning-authority-ready layer",
      status: providerStatus.legalPlanning,
      critical: true,
      explanation:
        "Legal and planning diligence is weighted heavily for purchase and development risk because ownership, licence, zoning, and approval gaps can dominate deal viability.",
      limitation: "No title, licence, RERA, land-record, sanction-plan, or litigation status is verified in fallback mode.",
      recommendedAction: "Engage legal due diligence for title chain, encumbrances, land-use permissions, licences, RERA status, and sanctioned plans.",
      weight: { buyer: 0.28, builder: 0.06, engineer: 0.22 },
    }),
    infrastructureAccessRisk: buildAssessment({
      id: "infrastructureAccessRisk",
      label: "Infrastructure / access",
      value: risks.infrastructureAccessRisk,
      provider: "Infrastructure provider",
      source: "Road, utility, public-works, and access-ready layer",
      status: providerStatus.infrastructure,
      critical: true,
      explanation: "Access, roads, utilities, drains, and nearby works are weighted for purchase, construction logistics, and development schedule.",
      limitation: providerStatus.infrastructure === "cached" ? modelLimitation : fallbackLimitation,
      recommendedAction: "Verify approach road width, utilities, storm drains, easements, public works, and construction staging constraints.",
      weight: { buyer: 0.16, builder: 0.05, engineer: 0.2 },
    }),
    dataQualityPenalty: buildAssessment({
      id: "dataQualityPenalty",
      label: "Data quality penalty",
      value: risks.dataQualityPenalty,
      provider: "Provider registry",
      source: "Provider availability model",
      status: risks.dataQualityPenalty >= 20 ? "fallback" : "cached",
      critical: true,
      explanation: "Penalty rises when critical layers are fallback or unavailable, reducing confidence and increasing diligence burden.",
      limitation: "Data quality is a confidence penalty, not a physical ground condition.",
      recommendedAction: "Connect live/cached providers or upload verified site documents before relying on numeric layer scores.",
      weight: { buyer: 0.1, builder: 0.1, engineer: 0.08 },
    }),
  };
};

const qualityLabelFor = (
  fallbackLayerCount: number,
  unavailableLayerCount: number,
  cachedLayerCount: number,
  liveLayerCount: number,
  totalLayerCount: number,
): SiteQualityLabel => {
  if (fallbackLayerCount === totalLayerCount) return "Demo-quality estimate only";
  if (fallbackLayerCount + unavailableLayerCount > totalLayerCount / 2) return "Fallback-heavy screening";
  if (liveLayerCount === totalLayerCount) return "Live provider screening";
  if (cachedLayerCount > totalLayerCount / 2) return "Model-assisted screening";
  if (fallbackLayerCount > 0 || unavailableLayerCount > 0) return "Mixed provider screening";
  return "Mixed provider screening";
};

const suitabilityFor = (
  site: ActiveSite,
  result: Pick<
    SiteScreeningResult,
    | "terrainSlopeRisk"
    | "drainageWaterloggingRisk"
    | "groundwaterDewateringRisk"
    | "soilUncertaintyRisk"
    | "seismicCodeRisk"
    | "legalTitlePlanningRisk"
    | "infrastructureAccessRisk"
    | "dataConfidence"
  >,
): SiteScreeningResult["constructionSuitability"] => {
  const useText = `${site.intendedUse} ${site.buildingType}`.toLowerCase();
  const highWater = result.drainageWaterloggingRisk >= 68 || result.groundwaterDewateringRisk >= 68;
  const highSlope = result.terrainSlopeRisk >= 68;
  const highSoil = result.soilUncertaintyRisk >= 68;
  const highSeismic = result.seismicCodeRisk >= 68;
  const highLegal = result.legalTitlePlanningRisk >= 68;
  const plannedUrbanResidential = includesAny(useText, ["residential apartment", "apartment", "mixed-use"]);
  const intendedUse = site.intendedUse || "Proposed use";

  const potentiallySuitableUses = [
    plannedUrbanResidential
      ? "Residential apartment (conditional)"
      : `${intendedUse} (conditional)`,
    "Low-rise/light structures subject to investigation",
  ];
  const cautionUses = [
    highWater ? "Basements and below-grade works" : "Basements where groundwater/drainage is uncertain",
    highSoil ? "Heavy loads or settlement-sensitive structures" : "Medium/heavy loads pending soil investigation",
    highLegal ? "Purchase or development commitments before legal clearance" : "Schedule commitments before approvals are checked",
  ];
  const notRecommendedWithoutDetailedInvestigation = [
    highSlope ? "Hillside/retaining-wall works" : null,
    highSeismic ? "Critical/public buildings without seismic/geotechnical review" : null,
    highWater ? "Deep basement excavation without groundwater and drainage design" : null,
    result.dataConfidence < 45 ? "Any final foundation decision based only on this screening" : null,
  ].filter((item): item is string => Boolean(item));

  return {
    potentiallySuitableUses: [...new Set(potentiallySuitableUses)].slice(0, 6),
    cautionUses: [...new Set(cautionUses)].slice(0, 6),
    notRecommendedWithoutDetailedInvestigation: [...new Set(notRecommendedWithoutDetailedInvestigation)].slice(0, 6),
    explanation:
      plannedUrbanResidential && !highSlope
        ? "Potentially feasible subject to professional geotechnical investigation, sanctioned plans, drainage verification, and code-compliant structural design. The screening does not certify suitability."
        : `The intended use "${site.intendedUse}" is screened against use, floors/load, drainage, soil uncertainty, seismic code context, legal/planning diligence, infrastructure access, and data confidence. This matrix scopes diligence; it does not approve construction.`,
  };
};

export const generateSiteScreening = (site: ActiveSite): SiteScreeningResult => {
  const providerStatus = { ...defaultProviderStatus };
  const load = loadMultiplier(site);
  const floorPressure = clamp(site.floors / 35, 0, 1);
  const radiusFactor = clamp(site.radiusMeters / 2500, 0.08, 1);
  const useText = `${site.intendedUse} ${site.buildingType} ${site.purchaseStage}`.toLowerCase();
  const basement = includesAny(useText, ["basement", "below grade", "dewatering"]);
  const hillsideOrRetaining = includesAny(useText, ["hillside", "retaining", "slope", "hill"]);
  const denseUrban =
    normalizedSignal(site, "urban") > 0.52 ||
    (includesAny(useText, ["apartment", "commercial", "mixed-use", "builder", "urban"]) && !hillsideOrRetaining);
  const inIndia = isLikelyIndiaCoordinate(site.latitude, site.longitude);

  const rawSlopeRisk = clamp(
    Math.round(16 + normalizedSignal(site, "slope") * 48 + floorPressure * 8 + (hillsideOrRetaining ? 30 : 0)),
    5,
    96,
  );
  const terrainSlopeRisk =
    denseUrban && !hillsideOrRetaining ? clamp(Math.min(rawSlopeRisk, 38 + floorPressure * 10), 5, 52) : rawSlopeRisk;
  const elevationRisk = clamp(
    Math.round(18 + normalizedSignal(site, "elevation") * 36 + (hillsideOrRetaining ? 16 : 0)),
    5,
    86,
  );
  const drainageWaterloggingRisk = clamp(
    Math.round(
      28 +
        normalizedSignal(site, "drainage") * 44 +
        radiusFactor * 8 +
        (basement ? 12 : 0) +
        (denseUrban ? 14 : 0) +
        (inIndia ? 5 : 0),
    ),
    8,
    96,
  );
  const waterbodyProximityRisk = clamp(
    Math.round(18 + normalizedSignal(site, "water") * 42 + (basement ? 9 : 0) + (denseUrban ? 5 : 0)),
    6,
    92,
  );
  const groundwaterDewateringRisk = clamp(
    Math.round(
      22 +
        drainageWaterloggingRisk * 0.25 +
        waterbodyProximityRisk * 0.08 +
        (basement ? 20 : 0) +
        (site.floors >= 12 ? 8 : 0) +
        (inIndia ? 6 : 0),
    ),
    7,
    96,
  );
  const soilUncertaintyRisk = clamp(
    Math.round((24 + normalizedSignal(site, "soil") * 44 + floorPressure * 16 + (denseUrban ? 4 : 0)) * load),
    10,
    98,
  );
  const looseSoilOrFillProxy = clamp(
    Math.round(20 + normalizedSignal(site, "fill") * 48 + soilUncertaintyRisk * 0.16 + (denseUrban ? 10 : 0)),
    8,
    96,
  );
  const seismicCodeRisk = clamp(
    Math.round(24 + normalizedSignal(site, "seismic") * 34 + floorPressure * 10 + (inIndia ? 8 : 0)),
    8,
    88,
  );
  const vegetationWetnessProxy = clamp(
    Math.round(16 + normalizedSignal(site, "wetness") * 48 + drainageWaterloggingRisk * 0.16),
    5,
    90,
  );
  const erosionRisk =
    denseUrban && !hillsideOrRetaining
      ? clamp(Math.round(terrainSlopeRisk + 6 + normalizedSignal(site, "erosion") * 6), 8, 44)
      : clamp(Math.round(18 + normalizedSignal(site, "erosion") * 42 + terrainSlopeRisk * 0.2), 8, 94);
  const landCoverChangeRisk = clamp(
    Math.round((denseUrban ? 46 : 34) + normalizedSignal(site, "land-cover") * 24 + vegetationWetnessProxy * 0.08),
    12,
    86,
  );
  const urbanDevelopmentRisk = clamp(
    Math.round((denseUrban ? 48 : 36) + normalizedSignal(site, "urban-dev") * 28 + drainageWaterloggingRisk * 0.08),
    10,
    92,
  );
  const legalTitlePlanningRisk = clamp(
    Math.round(
      38 +
        (site.purchaseStage.toLowerCase().includes("before purchase") ? 12 : 5) +
        (includesAny(useText, ["apartment", "commercial", "mixed-use", "industrial", "warehouse"]) ? 12 : 4) +
        (denseUrban ? 8 : 3) +
        (inIndia ? 5 : 0) +
        normalizedSignal(site, "legal") * 10,
    ),
    18,
    94,
  );
  const infrastructureAccessRisk = clamp(
    Math.round((denseUrban ? 38 : 44) + normalizedSignal(site, "infrastructure") * 32 + drainageWaterloggingRisk * 0.1),
    12,
    92,
  );

  const provisionalRisks = {
    terrainSlopeRisk,
    elevationRisk,
    drainageWaterloggingRisk,
    waterbodyProximityRisk,
    groundwaterDewateringRisk,
    soilUncertaintyRisk,
    seismicCodeRisk,
    landCoverChangeRisk,
    urbanDevelopmentRisk,
    legalTitlePlanningRisk,
    infrastructureAccessRisk,
    dataQualityPenalty: 0,
    denseUrban,
  };
  const provisionalAssessments = buildLayerAssessments(site, provisionalRisks, providerStatus);
  const fallbackLayerCount = Object.values(provisionalAssessments).filter(
    (assessment) => assessment.status === "fallback" || assessment.status === "configured",
  ).length;
  const unavailableLayerCount = Object.values(provisionalAssessments).filter(
    (assessment) => assessment.status === "unavailable",
  ).length;
  const cachedLayerCount = Object.values(provisionalAssessments).filter(
    (assessment) => assessment.status === "cached",
  ).length;
  const liveLayerCount = Object.values(provisionalAssessments).filter(
    (assessment) => assessment.status === "live",
  ).length;
  const criticalFallbackCount = Object.values(provisionalAssessments).filter(
    (assessment) => assessment.critical && (assessment.status === "fallback" || assessment.status === "unavailable"),
  ).length;
  const dataQualityPenalty = clamp(Math.round(8 + criticalFallbackCount * 3.2 + unavailableLayerCount * 4), 0, 30);
  const risks = { ...provisionalRisks, dataQualityPenalty };
  const layerAssessments = buildLayerAssessments(site, risks, providerStatus);
  const dataConfidence = clamp(
    Math.round(average(Object.values(layerAssessments).map((assessment) => assessment.confidence)) - criticalFallbackCount * 1.8),
    18,
    92,
  );
  const dataQualityLabel = qualityLabelFor(
    fallbackLayerCount,
    unavailableLayerCount,
    cachedLayerCount,
    liveLayerCount,
    Object.values(layerAssessments).length,
  );

  const constructionRiskScore = clamp(
    weighted([
      [terrainSlopeRisk, 0.1],
      [drainageWaterloggingRisk, 0.2],
      [groundwaterDewateringRisk, 0.1],
      [soilUncertaintyRisk, 0.25],
      [looseSoilOrFillProxy, 0.08],
      [seismicCodeRisk, 0.15],
      [landCoverChangeRisk, 0.04],
      [infrastructureAccessRisk, 0.04],
      [dataQualityPenalty, 0.12],
    ]),
    5,
    98,
  );
  const landPurchaseRiskScore = clamp(
    weighted([
      [legalTitlePlanningRisk, 0.28],
      [drainageWaterloggingRisk, 0.18],
      [infrastructureAccessRisk, 0.16],
      [soilUncertaintyRisk, 0.12],
      [groundwaterDewateringRisk, 0.08],
      [landCoverChangeRisk, 0.06],
      [waterbodyProximityRisk, 0.06],
      [seismicCodeRisk, 0.04],
      [dataQualityPenalty, 0.12],
    ]),
    5,
    98,
  );
  const developmentProfitRiskIndicator = clamp(
    weighted([
      [legalTitlePlanningRisk, 0.22],
      [infrastructureAccessRisk, 0.2],
      [drainageWaterloggingRisk, 0.18],
      [soilUncertaintyRisk, 0.12],
      [urbanDevelopmentRisk, 0.12],
      [groundwaterDewateringRisk, 0.08],
      [landCoverChangeRisk, 0.08],
      [dataQualityPenalty, 0.1],
    ]),
    5,
    98,
  );
  const audience = `${site.reportAudience} ${site.userRole}`.toLowerCase();
  const overallRiskScore = clamp(
    audience.includes("buyer") || audience.includes("purchaser")
      ? weighted([
          [landPurchaseRiskScore, 0.55],
          [developmentProfitRiskIndicator, 0.25],
          [constructionRiskScore, 0.2],
        ])
      : audience.includes("builder") || audience.includes("engineer") || audience.includes("contractor")
        ? weighted([
            [constructionRiskScore, 0.52],
            [developmentProfitRiskIndicator, 0.24],
            [landPurchaseRiskScore, 0.24],
          ])
        : weighted([
              [constructionRiskScore, 0.34],
              [landPurchaseRiskScore, 0.34],
              [developmentProfitRiskIndicator, 0.32],
            ]),
    5,
    98,
  );

  const buildabilityCautionLevel = cautionLevel(overallRiskScore);
  const overallPreScreenScore = clamp(100 - overallRiskScore, 2, 96);
  const seismicContext = {
    providerMode: providerStatus.seismic,
    recentEventsCount: Math.round(normalizedSignal(site, "quake-count") * 8),
    largestMagnitude: Number((2.4 + normalizedSignal(site, "quake-mag") * 2.8).toFixed(1)),
    nearestEventDistanceKm: Math.round(12 + normalizedSignal(site, "quake-distance") * 180),
    recentActivitySummary:
      "Fallback seismic context uses deterministic regional placeholders. It does not classify hazard from recent small earthquakes.",
    cautionLevel: seismicBand(seismicCodeRisk),
    recommendation:
      "Review applicable seismic design code, official hazard maps, liquefaction susceptibility, and structural/geotechnical requirements with qualified professionals.",
    limitations: [
      "No guarantee of earthquake safety.",
      "Fallback mode does not replace official seismic hazard maps, local code review, or site-specific liquefaction analysis.",
    ],
  };
  const baseResult = {
    terrainSlopeRisk,
    drainageWaterloggingRisk,
    groundwaterDewateringRisk,
    soilUncertaintyRisk,
    seismicCodeRisk,
    legalTitlePlanningRisk,
    infrastructureAccessRisk,
    dataConfidence,
  };
  const constructionSuitability = suitabilityFor(site, baseResult);
  const landCoverContext = denseUrban
    ? "Dense urban/peri-urban context: prioritize drainage, prior filling, road levels, utilities, title/licence/planning diligence, and groundwater/dewatering checks."
    : "Open/developing land context: verify land history, grading/fill, drainage paths, waterbody buffers, access, and approvals.";
  const groundwaterWarning = inIndia
    ? "Check groundwater extraction/dewatering requirements with the relevant state authority and CGWA where applicable."
    : "Check groundwater extraction/dewatering permissions with the relevant local authority where applicable.";
  const clientReviews: SiteScreeningResult["clientReviews"] = {
    builder: [
      `Buildability review: ${site.intendedUse} is conditional until geotechnical site investigation and topographic survey confirm load-bearing capacity, settlement behavior, groundwater, drainage, utilities, and access constraints.`,
      `Structure fit: low-rise/light work may remain feasible if shallow-foundation bearing capacity is confirmed; high-rise, heavy, basement, industrial, bridge, or settlement-sensitive work should assume deeper investigation and possible piles, ground improvement, or redesign until proven otherwise.`,
      "Construction planning maps needed: topographic/contour map, geotechnical/geological map, cadastral/boundary map, floodplain/hydrological map, utility/access map, and drainage outfall route.",
      groundwaterWarning,
      "Build risk blockers: soft clays, seasonal swelling soils, undocumented fill, liquefaction susceptibility, shallow water table, unknown bedrock depth, slope instability, floodplain exposure, or unresolved boundary/zoning issues.",
    ],
    engineer: [
      `Engineering review: calculate allowable bearing capacity, shear strength, soil reactivity, settlement risk, liquefaction/seismic susceptibility, groundwater/dewatering risk, and slope stability before foundation or structural design decisions.`,
      "Required analyses: subsurface profiling from boreholes, CPT/SPT, rock coring where needed, groundwater observations, laboratory testing for density, moisture, grain size, Atterberg behavior where relevant, and shear strength.",
      "Map/model requirements: topographic elevations and drainage paths, subsurface soil/rock strata, bedrock and water-table indicators, geohazard/fault/landslide context, legal boundaries, and flood/runoff constraints.",
      "Do not use this AI screening as a final engineering conclusion; use it to define field investigation scope and send final interpretation to qualified geotechnical/civil reviewers.",
    ],
    purchaser: [
      `Purchase review: land purchase risk is ${landPurchaseRiskScore}/100; treat this as a due-diligence checklist before buying, financing, or deciding what can be built.`,
      "Ask for existing geotechnical reports, borehole logs, SPT/CPT results, groundwater records, soil lab tests, flood/drainage history, topographic survey, utility records, title chain, zoning/land-use permissions, and sanctioned plans.",
      "Public information to check: local municipal/county planning and zoning records, assessor/land registry or cadastral records, official floodplain/hydrology maps, national geological/topographic datasets, and satellite/terrain viewers for broad context.",
      "Do not assume the land can support the desired building until professional investigations confirm soil capacity, settlement, groundwater, seismic/geohazard, access, zoning, and legal status.",
    ],
  };
  const buyerWarnings = clientReviews.purchaser;
  const engineerNotes = clientReviews.engineer;
  const businessRiskNotes = [
    ...clientReviews.builder.slice(0, 2),
    ...clientReviews.purchaser.slice(0, 2),
  ];
  const recommendedNextSteps = [
    "Commission professional geotechnical investigation before purchase/design/construction decisions.",
    "Plan boreholes and SPT/CPT coverage appropriate to intended use, floors/load, basement, and site radius.",
    "Request soil laboratory testing, groundwater observations, settlement review, liquefaction/seismic review where relevant, and drainage verification.",
    "Complete title, licence, planning, RERA/approval, land-use, access, and utility due diligence before closing or design freeze.",
  ];
  const limitations = [
    `${dataQualityLabel}: current layer values are provider-aware decision-support indicators, not verified field measurements.`,
    "No borehole, SPT/CPT, lab, structural, legal, title, sanction-plan, RERA, approval, groundwater permission, flood-depth, or government record status is certified here.",
    "Fallback numeric scores express relative diligence priority only and should not be read as precise measured values.",
    "The result is not a construction approval, final foundation recommendation, safety guarantee, legal opinion, or financial guarantee.",
  ];
  const historicalImagery: HistoricalImageryPlaceholder = {
    supported: false as const,
    timelineYears: [2018, 2020, 2022, 2024, 2026],
    plannedSignals: ["NDVI", "NDWI", "impervious_surface", "waterbody_change", "construction_expansion"],
    limitation:
      "Historical imagery/change detection is structured for future Sentinel/Landsat/WorldCover integration; this run does not certify land-cover change.",
  };

  return {
    overallPreScreenScore,
    buildabilityCautionLevel,
    overallRiskScore,
    constructionRiskScore,
    landPurchaseRiskScore,
    developmentProfitRiskIndicator,
    dataQualityPenalty,
    dataQualityLabel,
    fallbackLayerCount,
    criticalFallbackCount,
    profitRiskScore: developmentProfitRiskIndicator,
    landPurchaseRisk: landPurchaseRiskScore,
    terrainSlopeRisk,
    drainageWaterloggingRisk,
    groundwaterDewateringRisk,
    seismicCodeRisk,
    landCoverChangeRisk,
    legalTitlePlanningRisk,
    infrastructureAccessRisk,
    urbanDevelopmentRisk,
    slopeRisk: terrainSlopeRisk,
    drainageRisk: drainageWaterloggingRisk,
    waterProximityRisk: waterbodyProximityRisk,
    soilUncertaintyRisk,
    looseSoilOrFillProxy,
    seismicRisk: seismicCodeRisk,
    vegetationWetnessProxy,
    erosionRisk,
    landCoverContext,
    dataConfidence,
    providerStatus,
    layerAssessments,
    historicalImagery,
    seismicContext,
    constructionSuitability,
    aiAnalysis: {
      executiveSummary:
        `${site.projectName} produced ${buildabilityCautionLevel.toLowerCase()} preliminary screening caution with weighted risk ${overallRiskScore}/100 and data confidence ${dataConfidence}%. ` +
        `${dataQualityLabel}. The strongest diligence themes are geotechnical site investigation, topographic survey, load-bearing capacity, drainage/waterlogging, soil/geotechnical uncertainty, legal/planning checks, infrastructure/access, and professional review before any purchase or construction decision.`,
      siteContext:
        `${site.clientName || site.companyName || "Client"} is evaluating ${site.intendedUse} at ${site.latitude.toFixed(6)}, ${site.longitude.toFixed(6)} within a ${site.radiusMeters} m radius. ${landCoverContext}`,
      landBuyerInterpretation:
        `Land purchase risk is ${landPurchaseRiskScore}/100. Land purchasers should use this as a due-diligence scope and request geotechnical, drainage, title, licence, planning, access, and approval documents before purchase.`,
      engineeringInterpretation:
        `Construction risk is ${constructionRiskScore}/100. Engineering review should focus on soil uncertainty (${soilUncertaintyRisk}/100), drainage/waterlogging (${drainageWaterloggingRisk}/100), groundwater/dewatering (${groundwaterDewateringRisk}/100), and seismic code context (${seismicCodeRisk}/100).`,
      constructionSuitabilityOpinion: constructionSuitability.explanation,
      seismicCaution: seismicContext.recommendation,
      soilAndFoundationConcerns:
        `Soil uncertainty is ${soilUncertaintyRisk}/100 and loose/fill proxy is ${looseSoilOrFillProxy}/100. Do not infer bearing capacity, settlement, soil class, or foundation type without boreholes, SPT/CPT, lab tests, and qualified review.`,
      drainageAndWaterConcerns:
        `Drainage/waterlogging is ${drainageWaterloggingRisk}/100 and groundwater/dewatering is ${groundwaterDewateringRisk}/100. Review monsoon history, stormwater routing, road/plinth levels, waterbody buffers, and basement drainage.`,
      recommendedInvestigations: recommendedNextSteps,
      businessRiskNotes,
      limitations,
      disclaimer: requiredProfessionalDisclaimer,
      mode: "rule-based",
    },
    clientReviews,
    buyerWarnings,
    engineerNotes,
    recommendedNextSteps,
    limitations,
  };
};

const list = (items: string[]) => items.map((item, index) => `${index + 1}. ${item}`).join("\n");

const providerList = (result: SiteScreeningResult) =>
  Object.entries(result.providerStatus)
    .map(([provider, status]) => `- ${provider}: ${status === "configured" ? "fallback" : status}`)
    .join("\n");

const layerList = (result: SiteScreeningResult) =>
  Object.values(result.layerAssessments)
    .map(
      (layer) =>
        `- ${layer.label}: ${layer.value ?? "insufficient data"}/100, confidence ${layer.confidence}%, source ${layer.source}, status ${layer.status}. ${layer.explanation} Limitation: ${layer.limitation}`,
    )
    .join("\n");

export const buildSiteReport = (site: ActiveSite, result: SiteScreeningResult) => `TerraSignal private site intelligence report

Report type
Preliminary screening for land purchaser, builder, and engineer diligence
Quality label: ${result.dataQualityLabel}

Client / project details
Project: ${site.projectName}
Client/company: ${site.clientName || site.companyName || "Not specified"}
User role: ${site.userRole}
Report audience: ${site.reportAudience}
Purchase/development stage: ${site.purchaseStage}

Coordinate and site radius
Original coordinate input: ${site.coordinateInputOriginal || "Separate decimal fields"}
Parsed coordinates: ${site.latitude.toFixed(6)}, ${site.longitude.toFixed(6)} (${site.coordinateFormat})
Site radius: ${site.radiusMeters} m
Intended use: ${site.intendedUse}
Building/use details: ${site.buildingType}
Floors: ${site.floors || "Not specified"}
Load category: ${site.loadCategory}

Executive summary
${result.aiAnalysis.executiveSummary}

Transparent score model
Overall weighted risk: ${result.overallRiskScore}/100
Construction risk score: ${result.constructionRiskScore}/100
Land purchase risk score: ${result.landPurchaseRiskScore}/100
Development/profit risk indicator: ${result.developmentProfitRiskIndicator}/100
Data confidence score: ${result.dataConfidence}%
Data quality penalty: ${result.dataQualityPenalty}/100
Caution level: ${result.buildabilityCautionLevel}

Layer score breakdown
${layerList(result)}

Terrain map view
The report UI includes a model-assisted topographic map for the submitted coordinate radius.
Modelled relief range: terrain and elevation values are derived from provider-aware screening layers, not certified survey contours.
Terrain/slope score: ${result.terrainSlopeRisk}/100
Elevation score: ${result.layerAssessments.elevationRisk?.value ?? "insufficient data"}/100
Terrain confidence: ${result.layerAssessments.terrainSlopeRisk?.confidence ?? 0}%
Elevation confidence: ${result.layerAssessments.elevationRisk?.confidence ?? 0}%
Accuracy guardrail: replace or validate this map with live DEM, drone/topographic survey, licensed contour data, and qualified field review before engineering reliance.

Construction suitability
${result.constructionSuitability.explanation}

Potentially feasible subject to professional investigation:
${list(result.constructionSuitability.potentiallySuitableUses)}

Caution uses:
${list(result.constructionSuitability.cautionUses)}

Detailed investigation required before relying on:
${list(result.constructionSuitability.notRecommendedWithoutDetailedInvestigation)}

Land purchaser client review
${list(result.clientReviews.purchaser)}

Builder client review
${list(result.clientReviews.builder)}

Engineer client review
${list(result.clientReviews.engineer)}

Recommended professional investigation plan
${list(result.recommendedNextSteps)}

Minimum geotechnical/legal checklist
1. Borehole investigation.
2. SPT/CPT as appropriate for intended use, floors/load, and basement.
3. Groundwater monitoring and dewatering permission review where relevant.
4. Soil classification and laboratory testing.
5. Bearing capacity assessment by a qualified engineer.
6. Settlement analysis.
7. Liquefaction/seismic assessment where relevant.
8. Slope stability assessment where relevant.
9. Drainage/flood/waterlogging study where relevant.
10. Local code, land-use, title, licence, RERA/planning, approval, access, and utility review.
11. Seller/builder geotechnical and sanction-plan document review for land/home buyers.

Historical imagery/change detection placeholder
${result.historicalImagery.limitation}
Planned signals: ${result.historicalImagery.plannedSignals.join(", ")}

Provider status
${providerList(result)}

Limitations
${list(result.limitations)}

Disclaimer
${requiredProfessionalDisclaimer}
`;

export const exportSiteScreeningCsv = (site: ActiveSite, result: SiteScreeningResult) =>
  [
    "project_name,client_name,user_role,latitude,longitude,radius_m,intended_use,building_type,floors,load_category,purchase_stage,overall_weighted_risk,construction_risk,land_purchase_risk,development_profit_risk,data_confidence,data_quality_label,terrain_slope,drainage_waterlogging,groundwater_dewatering,soil_uncertainty,seismic_code,legal_title_planning,infrastructure_access,data_quality_penalty",
    [
      `"${site.projectName.replaceAll('"', '""')}"`,
      `"${(site.clientName || site.companyName || "").replaceAll('"', '""')}"`,
      `"${site.userRole.replaceAll('"', '""')}"`,
      site.latitude,
      site.longitude,
      site.radiusMeters,
      `"${site.intendedUse.replaceAll('"', '""')}"`,
      `"${site.buildingType.replaceAll('"', '""')}"`,
      site.floors,
      `"${site.loadCategory.replaceAll('"', '""')}"`,
      `"${site.purchaseStage.replaceAll('"', '""')}"`,
      result.overallRiskScore,
      result.constructionRiskScore,
      result.landPurchaseRiskScore,
      result.developmentProfitRiskIndicator,
      result.dataConfidence,
      `"${result.dataQualityLabel}"`,
      result.terrainSlopeRisk,
      result.drainageWaterloggingRisk,
      result.groundwaterDewateringRisk,
      result.soilUncertaintyRisk,
      result.seismicCodeRisk,
      result.legalTitlePlanningRisk,
      result.infrastructureAccessRisk,
      result.dataQualityPenalty,
    ].join(","),
  ].join("\n");
