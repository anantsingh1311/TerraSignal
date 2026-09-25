import type { ActiveSite, SiteScreeningResult } from "./types";

export type ReportEnvironment = "development" | "staging" | "production";
export type PlotAreaUnit = "sqm" | "sqyd";
export type AuditLayerCategory =
  | "elevation"
  | "terrain"
  | "slope"
  | "drainage"
  | "waterbody"
  | "groundwater"
  | "soil"
  | "seismic"
  | "landCover"
  | "imperviousness"
  | "legalPlanning"
  | "infrastructure"
  | "dataQuality";
export type AuditProviderType = "official" | "open" | "commercial" | "internal-model" | "fallback";
export type AuditFetchStatus = "live" | "cached" | "modelled" | "fallback" | "unavailable" | "error";
export type AuditValidationStatus = "pass" | "warning" | "fail";
export type ConfidenceBand = "low" | "moderate" | "high";

export type ReportAuditDataLayer = {
  layerId: string;
  layerName: string;
  category: AuditLayerCategory;
  providerName: string;
  providerType: AuditProviderType;
  datasetName: string | null;
  datasetVersion: string | null;
  datasetUrl: string | null;
  fetchedAt: string | null;
  fetchStatus: AuditFetchStatus;
  spatialResolutionMeters: number | null;
  sourceConfidence: number;
  rawValue: unknown;
  interpretedValue: string;
  normalizedRiskScore: number;
  weightUsed: number;
  calculationNotes: string;
  warnings: string[];
  evidenceRefs: string[];
};

export type ScoreBreakdown = {
  terrainRisk: number;
  elevationRisk: number;
  drainageRisk: number;
  waterbodyRisk: number;
  groundwaterRisk: number;
  soilUncertaintyRisk: number;
  seismicRisk: number;
  landCoverRisk: number;
  urbanDevelopmentRisk: number;
  legalPlanningRisk: number;
  infrastructureRisk: number;
  dataQualityPenalty: number;
  constructionRisk: number;
  landPurchaseRisk: number;
  developmentRisk: number;
  overallWeightedRisk: number;
  dataConfidence: number;
};

export type ScoringFormula = {
  version: string;
  weights: Record<string, number>;
  formulas: Record<string, string>;
  notes: string[];
};

export type NarrativeProvenanceSection = {
  sectionId: string;
  sectionTitle: string;
  generatedText: string;
  evidenceLayerIds: string[];
  confidence: number;
  warnings: string[];
};

export type DataConfidenceResult = {
  confidenceScore: number;
  confidenceBand: ConfidenceBand;
  explanation: string;
  layerContributions: Array<{
    layerId: string;
    layerName: string;
    fetchStatus: AuditFetchStatus;
    providerType: AuditProviderType;
    contribution: number;
    weight: number;
    reason: string;
  }>;
};

export type ScoreExplanation = {
  score: number;
  riskBand: "low" | "moderate" | "high" | "severe";
  contributingLayers: string[];
  weights: Record<string, number>;
  reason: string;
  confidence: number;
  warnings: string[];
};

export type ReportAuditSnapshot = {
  reportId: string;
  generatedAt: string;
  appName: "TerraSignal AI";
  reportVersion: string;
  scoringVersion: string;
  codeVersion: string;
  environment: ReportEnvironment;
  requestedBy: string | null;
  userInput: {
    originalCoordinateInput: string;
    parsedLatitude: number;
    parsedLongitude: number;
    radiusMeters: number;
    approximatePlotArea: number | null;
    plotAreaUnit: PlotAreaUnit | null;
    intendedUse: string;
    buildingType: string | null;
    floors: number | null;
    loadCategory: string | null;
    audience: string | null;
  };
  normalizedGeometry: {
    center: { lat: number; lng: number };
    radiusMeters: number;
    boundingBox: { north: number; south: number; east: number; west: number };
    aoiGeoJson: {
      type: "Polygon";
      coordinates: number[][][];
    };
    coordinateValidation: {
      valid: boolean;
      warnings: string[];
    };
  };
  dataLayers: ReportAuditDataLayer[];
  scoreBreakdown: ScoreBreakdown;
  scoringFormula: ScoringFormula;
  confidence: DataConfidenceResult;
  scoreExplanations: Record<string, ScoreExplanation>;
  narrativeProvenance: NarrativeProvenanceSection[];
  generatedReportText: string;
  disclaimers: {
    screeningOnly: true;
    notCertifiedGeotechnicalReport: true;
    requiresFieldInvestigation: true;
    notLegalAdvice: true;
    notFinancialAdvice: true;
    notConstructionApproval: true;
  };
  validationStatus: AuditValidationStatus;
  validationErrors: string[];
  validationWarnings: string[];
};

const reportVersion = "2026.05.audit-v1";
const scoringVersion = "site-risk-v2.audit-v1";
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const isFallbackLike = (status: AuditFetchStatus) => status === "modelled" || status === "fallback";

export const validateReportInput = (site: ActiveSite) => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const latitude = Number(site.latitude);
  const longitude = Number(site.longitude);
  const radiusMeters = Number(site.radiusMeters);
  const floors = Number(site.floors);
  const plotArea = site.approximatePlotArea;
  const intendedUse = String(site.intendedUse || "").trim();
  const useContext = `${site.intendedUse} ${site.buildingType} ${site.purchaseStage}`.toLowerCase();

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) errors.push("Latitude must be between -90 and 90.");
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) errors.push("Longitude must be between -180 and 180.");
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) errors.push("Radius must be positive.");
  if (Number.isFinite(radiusMeters) && (radiusMeters < 50 || radiusMeters > 5000)) {
    warnings.push("Radius is outside the recommended 50 m to 5000 m screening range.");
  }
  if (site.floors && (!Number.isInteger(floors) || floors <= 0)) warnings.push("Floors should be a positive integer when provided.");
  if (plotArea !== null && plotArea !== undefined && (!Number.isFinite(Number(plotArea)) || Number(plotArea) <= 0)) {
    warnings.push("Approximate plot area should be positive when provided.");
  }
  if (plotArea && site.plotAreaUnit !== "sqm" && site.plotAreaUnit !== "sqyd") {
    warnings.push("Plot area unit should be sqm or sqyd when plot area is provided.");
  }
  if (!intendedUse) warnings.push("Intended use should not be empty.");
  if (/(hospital|school|public)/i.test(intendedUse)) {
    warnings.push("Public, school, or hospital use requires elevated professional geotechnical and code review.");
  }
  if (floors >= 4 || String(site.loadCategory || "").toLowerCase().includes("heavy")) {
    warnings.push("Multi-floor or heavy-load projects require expanded geotechnical investigation and settlement review.");
  }
  if (useContext.includes("basement") || useContext.includes("below grade") || useContext.includes("dewatering")) {
    warnings.push("Basement or below-grade context requires groundwater, dewatering, waterproofing, and drainage review.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
};

const buildBoundingBox = (lat: number, lng: number, radiusMeters: number) => {
  const latDelta = radiusMeters / 111_320;
  const lngDelta = radiusMeters / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return {
    north: clamp(lat + latDelta, -90, 90),
    south: clamp(lat - latDelta, -90, 90),
    east: clamp(lng + lngDelta, -180, 180),
    west: clamp(lng - lngDelta, -180, 180),
  };
};

const buildAoiPolygon = (lat: number, lng: number, radiusMeters: number) => {
  const coordinates = Array.from({ length: 32 }, (_, index) => {
    const bearing = (index / 31) * Math.PI * 2;
    const latOffset = (Math.cos(bearing) * radiusMeters) / 111_320;
    const lngOffset = (Math.sin(bearing) * radiusMeters) / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
    return [Number((lng + lngOffset).toFixed(7)), Number((lat + latOffset).toFixed(7))];
  });
  coordinates[coordinates.length - 1] = coordinates[0];
  return { type: "Polygon" as const, coordinates: [coordinates] };
};

const layerCategory: Record<string, AuditLayerCategory> = {
  terrainSlopeRisk: "terrain",
  elevationRisk: "elevation",
  drainageWaterloggingRisk: "drainage",
  waterbodyProximityRisk: "waterbody",
  groundwaterDewateringRisk: "groundwater",
  soilUncertaintyRisk: "soil",
  seismicCodeRisk: "seismic",
  landCoverChangeRisk: "landCover",
  urbanDevelopmentRisk: "imperviousness",
  legalTitlePlanningRisk: "legalPlanning",
  infrastructureAccessRisk: "infrastructure",
  dataQualityPenalty: "dataQuality",
};

const providerTypeFor = (status: string, provider: string): AuditProviderType => {
  if (status === "fallback" || status === "unavailable") return "fallback";
  if (/model|provider registry/i.test(provider)) return "internal-model";
  if (/osm|sentinel|landsat|soilgrids|srtm|nasa|open/i.test(provider)) return "open";
  if (/authority|official|planning|seismic|hydrology/i.test(provider)) return "official";
  return "internal-model";
};

export const strictFetchStatus = (input: {
  providerName: string;
  providerStatus: string;
  fetchedAt?: string | null;
  rawValue?: unknown;
  cacheTimestamp?: string | null;
}): AuditFetchStatus => {
  const hasRaw = input.rawValue !== null && input.rawValue !== undefined;
  if (input.providerStatus === "live") {
    return input.providerName && input.fetchedAt && hasRaw ? "live" : "modelled";
  }
  if (input.providerStatus === "cached") {
    return input.cacheTimestamp && hasRaw ? "cached" : "modelled";
  }
  if (input.providerStatus === "fallback" || input.providerStatus === "configured") return "fallback";
  if (input.providerStatus === "unavailable") return "unavailable";
  return "modelled";
};

const weightForAudience = (site: ActiveSite, layer: SiteScreeningResult["layerAssessments"][keyof SiteScreeningResult["layerAssessments"]]) => {
  const audience = `${site.reportAudience} ${site.userRole}`.toLowerCase();
  if (audience.includes("builder")) return layer.weight.builder;
  if (audience.includes("engineer")) return layer.weight.engineer;
  return layer.weight.buyer;
};

export const buildAuditDataLayers = (site: ActiveSite, screening: SiteScreeningResult): ReportAuditDataLayer[] =>
  Object.values(screening.layerAssessments).map((layer) => {
    const category = layerCategory[layer.id] ?? "dataQuality";
    const rawValue = {
      layerAssessment: layer,
      siteSignals: {
        latitude: site.latitude,
        longitude: site.longitude,
        radiusMeters: site.radiusMeters,
        intendedUse: site.intendedUse,
        buildingType: site.buildingType,
        floors: site.floors,
        loadCategory: site.loadCategory,
      },
    };
    const fetchStatus = strictFetchStatus({
      providerName: layer.provider,
      providerStatus: layer.status,
      fetchedAt: layer.status === "live" ? layer.generatedAt : null,
      rawValue,
    });
    const providerType = providerTypeFor(fetchStatus, layer.provider);
    const warnings = [
      layer.limitation,
      fetchStatus === "modelled" ? "Layer value is modelled from internal rules/provider-aware context, not measured field data." : null,
      fetchStatus === "fallback" ? "Layer uses fallback/heuristic scoring because provider data was unavailable." : null,
      fetchStatus === "unavailable" ? "Layer is unavailable and should not be treated as precise evidence." : null,
    ].filter((item): item is string => Boolean(item));

    return {
      layerId: category,
      layerName: layer.label,
      category,
      providerName: layer.provider,
      providerType,
      datasetName: layer.source || null,
      datasetVersion: null,
      datasetUrl: null,
      fetchedAt: fetchStatus === "live" ? layer.generatedAt : null,
      fetchStatus,
      spatialResolutionMeters: null,
      sourceConfidence: clamp(layer.confidence, 0, 100),
      rawValue,
      interpretedValue: layer.explanation,
      normalizedRiskScore: clamp(layer.value ?? 0, 0, 100),
      weightUsed: weightForAudience(site, layer),
      calculationNotes: layer.recommendedAction,
      warnings,
      evidenceRefs: [layer.id, category, layer.source].filter(Boolean),
    };
  });

export const calculateDataConfidence = (layers: ReportAuditDataLayer[]): DataConfidenceResult => {
  const contributions = layers.map((layer) => {
    const statusBase =
      layer.fetchStatus === "live"
        ? layer.providerType === "official"
          ? 92
          : 84
        : layer.fetchStatus === "cached"
          ? 72
          : layer.fetchStatus === "modelled"
            ? 56
            : layer.fetchStatus === "fallback"
              ? 36
              : 18;
    const contribution = clamp(Math.round(statusBase * 0.65 + layer.sourceConfidence * 0.35), 0, 100);
    return {
      layerId: layer.layerId,
      layerName: layer.layerName,
      fetchStatus: layer.fetchStatus,
      providerType: layer.providerType,
      contribution,
      weight: Math.max(layer.weightUsed, 0.04),
      reason: `${layer.fetchStatus} ${layer.providerType} layer with ${layer.sourceConfidence}% source confidence.`,
    };
  });
  const totalWeight = contributions.reduce((sum, item) => sum + item.weight, 0) || 1;
  let confidenceScore = Math.round(contributions.reduce((sum, item) => sum + item.contribution * item.weight, 0) / totalWeight);
  const critical = layers.filter((layer) =>
    ["elevation", "terrain", "drainage", "waterbody", "soil", "seismic", "infrastructure", "legalPlanning"].includes(layer.category),
  );
  const criticalModelledFallback = critical.filter((layer) => isFallbackLike(layer.fetchStatus)).length;
  const liveCount = layers.filter((layer) => layer.fetchStatus === "live").length;
  const soilDrainageElevationWeak = ["soil", "drainage", "elevation"].every((category) =>
    layers.some((layer) => layer.category === category && isFallbackLike(layer.fetchStatus)),
  );

  if (critical.length && criticalModelledFallback / critical.length > 0.5) confidenceScore = Math.min(confidenceScore, 85);
  if (liveCount === 0) confidenceScore = Math.min(confidenceScore, 70);
  if (soilDrainageElevationWeak) confidenceScore = Math.min(confidenceScore, 60);
  confidenceScore = clamp(confidenceScore, 0, 100);

  return {
    confidenceScore,
    confidenceBand: confidenceScore >= 75 ? "high" : confidenceScore >= 45 ? "moderate" : "low",
    explanation:
      liveCount === 0
        ? "Confidence is capped because no layer has strict live-provider evidence stored with a response timestamp and raw value."
        : "Confidence is calculated from provider status, provider type, source confidence, critical-layer coverage, and fallback/modelled penalties.",
    layerContributions: contributions,
  };
};

const riskBand = (score: number) => (score >= 84 ? "severe" : score >= 68 ? "high" : score >= 42 ? "moderate" : "low");

const scoreLayerMap: Record<string, string[]> = {
  overallWeightedRisk: ["terrain", "drainage", "soil", "legalPlanning", "infrastructure", "dataQuality"],
  constructionRisk: ["terrain", "drainage", "groundwater", "soil", "seismic", "infrastructure", "dataQuality"],
  landPurchaseRisk: ["legalPlanning", "drainage", "infrastructure", "soil", "groundwater", "waterbody", "seismic", "dataQuality"],
  developmentRisk: ["legalPlanning", "infrastructure", "drainage", "soil", "imperviousness", "groundwater", "landCover", "dataQuality"],
  terrainRisk: ["terrain"],
  elevationRisk: ["elevation"],
  drainageRisk: ["drainage"],
  soilUncertaintyRisk: ["soil"],
  seismicRisk: ["seismic"],
  infrastructureRisk: ["infrastructure"],
  legalPlanningRisk: ["legalPlanning"],
  dataConfidence: ["dataQuality", "terrain", "drainage", "soil", "legalPlanning", "infrastructure"],
};

export const explainScore = (snapshot: Pick<ReportAuditSnapshot, "scoreBreakdown" | "dataLayers" | "confidence">, scoreKey: keyof ScoreBreakdown): ScoreExplanation => {
  const score = snapshot.scoreBreakdown[scoreKey];
  const contributingLayers = scoreLayerMap[scoreKey] ?? [];
  const layers = snapshot.dataLayers.filter((layer) => contributingLayers.includes(layer.layerId));
  const weights = Object.fromEntries(layers.map((layer) => [layer.layerId, layer.weightUsed]));
  const warnings = layers.flatMap((layer) => layer.warnings);
  return {
    score,
    riskBand: riskBand(score),
    contributingLayers,
    weights,
    reason: `${scoreKey} is explained by ${contributingLayers.join(", ") || "stored score breakdown"} using the report scoring formula and layer weights.`,
    confidence: scoreKey === "dataConfidence" ? snapshot.confidence.confidenceScore : Math.round(layers.reduce((sum, layer) => sum + layer.sourceConfidence, 0) / Math.max(layers.length, 1)),
    warnings,
  };
};

const buildScoreBreakdown = (screening: SiteScreeningResult): ScoreBreakdown => ({
  terrainRisk: screening.terrainSlopeRisk,
  elevationRisk: screening.layerAssessments.elevationRisk?.value ?? screening.slopeRisk,
  drainageRisk: screening.drainageWaterloggingRisk,
  waterbodyRisk: screening.waterProximityRisk,
  groundwaterRisk: screening.groundwaterDewateringRisk,
  soilUncertaintyRisk: screening.soilUncertaintyRisk,
  seismicRisk: screening.seismicRisk,
  landCoverRisk: screening.landCoverChangeRisk,
  urbanDevelopmentRisk: screening.urbanDevelopmentRisk,
  legalPlanningRisk: screening.legalTitlePlanningRisk,
  infrastructureRisk: screening.infrastructureAccessRisk,
  dataQualityPenalty: screening.dataQualityPenalty,
  constructionRisk: screening.constructionRiskScore,
  landPurchaseRisk: screening.landPurchaseRiskScore,
  developmentRisk: screening.developmentProfitRiskIndicator,
  overallWeightedRisk: screening.overallRiskScore,
  dataConfidence: screening.dataConfidence,
});

export const buildScoringFormula = (site: ActiveSite, screening: SiteScreeningResult): ScoringFormula => {
  const audience = `${site.reportAudience} ${site.userRole}`.toLowerCase();
  const overallWeights = audience.includes("purchaser") || audience.includes("buyer")
    ? { landPurchaseRisk: 0.55, developmentRisk: 0.25, constructionRisk: 0.2 }
    : audience.includes("builder") || audience.includes("engineer")
      ? { constructionRisk: 0.52, developmentRisk: 0.24, landPurchaseRisk: 0.24 }
      : { constructionRisk: 0.34, landPurchaseRisk: 0.34, developmentRisk: 0.32 };
  const layerWeights = Object.fromEntries(
    Object.values(screening.layerAssessments).map((layer) => [layer.id, weightForAudience(site, layer)]),
  );
  return {
    version: scoringVersion,
    weights: { ...layerWeights, ...overallWeights },
    formulas: {
      constructionRisk: "weighted(terrain 0.10, drainage 0.20, groundwater 0.10, soil 0.25, loose/fill 0.08, seismic 0.15, landCover 0.04, infrastructure 0.04, dataQualityPenalty 0.12)",
      landPurchaseRisk: "weighted(legalPlanning 0.28, drainage 0.18, infrastructure 0.16, soil 0.12, groundwater 0.08, landCover 0.06, waterbody 0.06, seismic 0.04, dataQualityPenalty 0.12)",
      developmentRisk: "weighted(legalPlanning 0.22, infrastructure 0.20, drainage 0.18, soil 0.12, urbanDevelopment 0.12, groundwater 0.08, landCover 0.08, dataQualityPenalty 0.10)",
      overallWeightedRisk: `audience weighted blend ${JSON.stringify(overallWeights)}`,
      dataConfidence: "weighted layer contribution by strict fetch status, provider type, source confidence, critical-layer caps, and fallback/modelled penalties",
    },
    notes: [
      "Scores are preliminary decision-support indicators, not measured geotechnical values.",
      "LIVE status requires a successful provider response timestamp and stored raw/extracted value.",
      "Modelled and fallback values must be verified by professional survey/geotechnical investigation before reliance.",
    ],
  };
};

const narrative = (screening: SiteScreeningResult, confidence: number): NarrativeProvenanceSection[] => [
  {
    sectionId: "executive-summary",
    sectionTitle: "Executive summary",
    generatedText: screening.aiAnalysis.executiveSummary,
    evidenceLayerIds: ["terrain", "drainage", "soil", "legalPlanning", "infrastructure", "dataQuality"],
    confidence,
    warnings: screening.limitations,
  },
  {
    sectionId: "construction-suitability",
    sectionTitle: "Construction suitability",
    generatedText: screening.constructionSuitability.explanation,
    evidenceLayerIds: ["soil", "groundwater", "drainage", "seismic", "infrastructure"],
    confidence,
    warnings: screening.constructionSuitability.notRecommendedWithoutDetailedInvestigation,
  },
  {
    sectionId: "land-purchaser-review",
    sectionTitle: "Land purchaser review",
    generatedText: screening.clientReviews.purchaser.join("\n"),
    evidenceLayerIds: ["legalPlanning", "soil", "groundwater", "drainage"],
    confidence,
    warnings: screening.buyerWarnings,
  },
  {
    sectionId: "engineer-review",
    sectionTitle: "Engineer review",
    generatedText: screening.clientReviews.engineer.join("\n"),
    evidenceLayerIds: ["soil", "groundwater", "terrain", "seismic"],
    confidence,
    warnings: screening.engineerNotes,
  },
  {
    sectionId: "builder-review",
    sectionTitle: "Builder review",
    generatedText: screening.clientReviews.builder.join("\n"),
    evidenceLayerIds: ["terrain", "soil", "drainage", "groundwater", "infrastructure"],
    confidence,
    warnings: screening.recommendedNextSteps,
  },
];

export const validateAuditSnapshot = (snapshot: ReportAuditSnapshot) => {
  const errors: string[] = [];
  const warnings: string[] = [...snapshot.validationWarnings];
  if (!snapshot.reportId) errors.push("Missing reportId.");
  if (!snapshot.dataLayers.length) errors.push("Audit snapshot has no data layers.");
  for (const layer of snapshot.dataLayers) {
    if (layer.fetchStatus === "live" && (!layer.fetchedAt || !layer.providerName || layer.rawValue === null || layer.rawValue === undefined)) {
      errors.push(`${layer.layerId} is marked live without strict live-source evidence.`);
    }
    if ((layer.fetchStatus === "modelled" || layer.fetchStatus === "fallback") && !layer.warnings.length) {
      warnings.push(`${layer.layerId} is ${layer.fetchStatus} and should carry a warning.`);
    }
  }
  for (const section of snapshot.narrativeProvenance) {
    if (!section.evidenceLayerIds.length) warnings.push(`${section.sectionId} has no evidence layer references.`);
  }
  return {
    validationStatus: errors.length ? "fail" as const : warnings.length ? "warning" as const : "pass" as const,
    validationErrors: errors,
    validationWarnings: [...new Set(warnings)],
  };
};

export const buildReportAuditSnapshot = ({
  codeVersion = "unknown",
  environment = "development",
  generatedAt = new Date().toISOString(),
  reportId,
  reportText,
  requestedBy = null,
  screening,
  site,
}: {
  codeVersion?: string;
  environment?: ReportEnvironment;
  generatedAt?: string;
  reportId: string;
  reportText: string;
  requestedBy?: string | null;
  screening: SiteScreeningResult;
  site: ActiveSite;
}): ReportAuditSnapshot => {
  const inputValidation = validateReportInput(site);
  const dataLayers = buildAuditDataLayers(site, screening);
  const confidence = calculateDataConfidence(dataLayers);
  const scoreBreakdown = { ...buildScoreBreakdown(screening), dataConfidence: confidence.confidenceScore };
  const baseSnapshot = {
    reportId,
    generatedAt,
    appName: "TerraSignal AI" as const,
    reportVersion,
    scoringVersion,
    codeVersion,
    environment,
    requestedBy,
    userInput: {
      originalCoordinateInput: site.coordinateInputOriginal,
      parsedLatitude: site.latitude,
      parsedLongitude: site.longitude,
      radiusMeters: site.radiusMeters,
      approximatePlotArea: site.approximatePlotArea ?? null,
      plotAreaUnit: site.approximatePlotArea ? site.plotAreaUnit ?? null : null,
      intendedUse: site.intendedUse,
      buildingType: site.buildingType || null,
      floors: site.floors || null,
      loadCategory: site.loadCategory || null,
      audience: site.reportAudience || null,
    },
    normalizedGeometry: {
      center: { lat: site.latitude, lng: site.longitude },
      radiusMeters: site.radiusMeters,
      boundingBox: buildBoundingBox(site.latitude, site.longitude, site.radiusMeters),
      aoiGeoJson: buildAoiPolygon(site.latitude, site.longitude, site.radiusMeters),
      coordinateValidation: {
        valid: inputValidation.valid,
        warnings: inputValidation.warnings,
      },
    },
    dataLayers,
    scoreBreakdown,
    scoringFormula: buildScoringFormula(site, screening),
    confidence,
    scoreExplanations: {},
    narrativeProvenance: narrative(screening, confidence.confidenceScore),
    generatedReportText: reportText,
    validationWarnings: inputValidation.warnings,
    disclaimers: {
      screeningOnly: true as const,
      notCertifiedGeotechnicalReport: true as const,
      requiresFieldInvestigation: true as const,
      notLegalAdvice: true as const,
      notFinancialAdvice: true as const,
      notConstructionApproval: true as const,
    },
    validationStatus: "pass" as AuditValidationStatus,
    validationErrors: inputValidation.errors,
  };
  const scoreExplanations = Object.fromEntries(
    ([
      "overallWeightedRisk",
      "constructionRisk",
      "landPurchaseRisk",
      "developmentRisk",
      "terrainRisk",
      "elevationRisk",
      "drainageRisk",
      "soilUncertaintyRisk",
      "seismicRisk",
      "infrastructureRisk",
      "legalPlanningRisk",
      "dataConfidence",
    ] as Array<keyof ScoreBreakdown>).map((key) => [key, explainScore(baseSnapshot, key)]),
  );
  const snapshot = { ...baseSnapshot, scoreExplanations };
  return { ...snapshot, ...validateAuditSnapshot(snapshot) };
};

export const auditRawLayerData = (snapshot: ReportAuditSnapshot) => ({
  reportId: snapshot.reportId,
  generatedAt: snapshot.generatedAt,
  layers: snapshot.dataLayers.map((layer) => ({
    layerId: layer.layerId,
    layerName: layer.layerName,
    fetchStatus: layer.fetchStatus,
    providerName: layer.providerName,
    providerType: layer.providerType,
    fetchedAt: layer.fetchedAt,
    rawValue: layer.rawValue,
    interpretedValue: layer.interpretedValue,
    warnings: layer.warnings,
  })),
});

export const auditScoringData = (snapshot: ReportAuditSnapshot) => ({
  reportId: snapshot.reportId,
  scoreBreakdown: snapshot.scoreBreakdown,
  scoringFormula: snapshot.scoringFormula,
  scoreExplanations: snapshot.scoreExplanations,
});

export const auditValidationData = (snapshot: ReportAuditSnapshot) => ({
  reportId: snapshot.reportId,
  validationStatus: snapshot.validationStatus,
  validationErrors: snapshot.validationErrors,
  validationWarnings: snapshot.validationWarnings,
  confidence: snapshot.confidence,
});
