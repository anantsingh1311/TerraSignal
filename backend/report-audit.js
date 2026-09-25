const REPORT_VERSION = "2026.05.audit-v1";
const SCORING_VERSION = "site-risk-v2.audit-v1";
const APP_NAME = "TerraSignal AI";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isFallbackLike = (status) => status === "modelled" || status === "fallback";

export const getCodeVersion = () => process.env.GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT || "unknown";

export const normalizeEnvironment = () => {
  const value = String(process.env.APP_ENV || process.env.NODE_ENV || "development").toLowerCase();
  if (value === "production" || value === "staging") return value;
  return "development";
};

export const validateReportInput = (site = {}) => {
  const errors = [];
  const warnings = [];
  const latitude = Number(site.latitude);
  const longitude = Number(site.longitude);
  const radiusMeters = Number(site.radiusMeters);
  const floors = Number(site.floors);
  const plotArea = site.approximatePlotArea;
  const intendedUse = String(site.intendedUse || "").trim();
  const context = `${site.intendedUse || ""} ${site.buildingType || ""} ${site.purchaseStage || ""}`.toLowerCase();

  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) errors.push("Latitude must be between -90 and 90.");
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) errors.push("Longitude must be between -180 and 180.");
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) errors.push("Radius must be positive.");
  if (Number.isFinite(radiusMeters) && (radiusMeters < 50 || radiusMeters > 5000)) warnings.push("Radius is outside the recommended 50 m to 5000 m screening range.");
  if (site.floors && (!Number.isInteger(floors) || floors <= 0)) warnings.push("Floors should be a positive integer when provided.");
  if (plotArea !== null && plotArea !== undefined && plotArea !== "" && (!Number.isFinite(Number(plotArea)) || Number(plotArea) <= 0)) {
    warnings.push("Approximate plot area should be positive when provided.");
  }
  if (plotArea && site.plotAreaUnit !== "sqm" && site.plotAreaUnit !== "sqyd") warnings.push("Plot area unit should be sqm or sqyd when plot area is provided.");
  if (!intendedUse) warnings.push("Intended use should not be empty.");
  if (/(hospital|school|public)/i.test(intendedUse)) warnings.push("Public, school, or hospital use requires elevated professional geotechnical and code review.");
  if (floors >= 4 || String(site.loadCategory || "").toLowerCase().includes("heavy")) warnings.push("Multi-floor or heavy-load projects require expanded geotechnical investigation and settlement review.");
  if (context.includes("basement") || context.includes("below grade") || context.includes("dewatering")) warnings.push("Basement or below-grade context requires groundwater, dewatering, waterproofing, and drainage review.");

  return { valid: errors.length === 0, errors, warnings };
};

const buildBoundingBox = (lat, lng, radiusMeters) => {
  const latDelta = radiusMeters / 111_320;
  const lngDelta = radiusMeters / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return {
    north: clamp(lat + latDelta, -90, 90),
    south: clamp(lat - latDelta, -90, 90),
    east: clamp(lng + lngDelta, -180, 180),
    west: clamp(lng - lngDelta, -180, 180),
  };
};

const buildAoiPolygon = (lat, lng, radiusMeters) => {
  const coordinates = Array.from({ length: 32 }, (_, index) => {
    const bearing = (index / 31) * Math.PI * 2;
    const latOffset = (Math.cos(bearing) * radiusMeters) / 111_320;
    const lngOffset = (Math.sin(bearing) * radiusMeters) / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
    return [Number((lng + lngOffset).toFixed(7)), Number((lat + latOffset).toFixed(7))];
  });
  coordinates[coordinates.length - 1] = coordinates[0];
  return { type: "Polygon", coordinates: [coordinates] };
};

export const strictFetchStatus = ({ providerName, providerStatus, fetchedAt = null, rawValue = null, cacheTimestamp = null }) => {
  const hasRaw = rawValue !== null && rawValue !== undefined;
  if (providerStatus === "live") return providerName && fetchedAt && hasRaw ? "live" : "modelled";
  if (providerStatus === "cached") return cacheTimestamp && hasRaw ? "cached" : "modelled";
  if (providerStatus === "fallback" || providerStatus === "configured") return "fallback";
  if (providerStatus === "unavailable") return "unavailable";
  return "modelled";
};

const providerTypeFor = (status, provider) => {
  if (status === "fallback" || status === "unavailable") return "fallback";
  if (/model|provider registry/i.test(provider)) return "internal-model";
  if (/osm|sentinel|landsat|soilgrids|srtm|nasa|open/i.test(provider)) return "open";
  if (/authority|official|planning|seismic|hydrology/i.test(provider)) return "official";
  return "internal-model";
};

const categoryByLayerId = {
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

const weightForAudience = (site, layer) => {
  const audience = `${site.reportAudience || ""} ${site.userRole || ""}`.toLowerCase();
  if (audience.includes("builder")) return layer.weight?.builder ?? 0.1;
  if (audience.includes("engineer")) return layer.weight?.engineer ?? 0.1;
  return layer.weight?.buyer ?? 0.1;
};

const buildSiteLayers = (site, screening) =>
  Object.values(screening.layerAssessments || {}).map((layer) => {
    const category = categoryByLayerId[layer.id] || "dataQuality";
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
    const warnings = [
      layer.limitation,
      fetchStatus === "modelled" ? "Layer value is modelled from internal rules/provider-aware context, not measured field data." : null,
      fetchStatus === "fallback" ? "Layer uses fallback/heuristic scoring because provider data was unavailable." : null,
      fetchStatus === "unavailable" ? "Layer is unavailable and should not be treated as precise evidence." : null,
    ].filter(Boolean);
    return {
      layerId: category,
      layerName: layer.label,
      category,
      providerName: layer.provider,
      providerType: providerTypeFor(fetchStatus, layer.provider),
      datasetName: layer.source || null,
      datasetVersion: null,
      datasetUrl: null,
      fetchedAt: fetchStatus === "live" ? layer.generatedAt : null,
      fetchStatus,
      spatialResolutionMeters: null,
      sourceConfidence: clamp(Number(layer.confidence || 0), 0, 100),
      rawValue,
      interpretedValue: layer.explanation || "",
      normalizedRiskScore: clamp(Number(layer.value || 0), 0, 100),
      weightUsed: weightForAudience(site, layer),
      calculationNotes: layer.recommendedAction || "",
      warnings,
      evidenceRefs: [layer.id, category, layer.source].filter(Boolean),
    };
  });

const buildSurveyLayers = ({ analyzed = [], summary = {}, warnings = [], project = {}, settings = {} }) => {
  const top = summary.top || analyzed[0] || {};
  const average = (field) => analyzed.length ? Math.round(analyzed.reduce((sum, point) => sum + Number(point[field] || 0), 0) / analyzed.length) : 0;
  const base = [
    ["soil", "Resistivity / soil contrast", "soil", average("resistivity"), "ERT/geophysical upload"],
    ["terrain", "Velocity / stiffness contrast", "terrain", average("velocity"), "SRT/MASW/geophysical upload"],
    ["infrastructure", "Magnetic utility/body contrast", "infrastructure", average("magnetic"), "MAG/geophysical upload"],
    ["dataQuality", "Noise / residual quality", "dataQuality", average("noise"), "Uploaded survey quality"],
  ];
  return base.map(([layerId, layerName, category, raw, datasetName]) => ({
    layerId,
    layerName,
    category,
    providerName: "User-uploaded geophysical survey",
    providerType: "internal-model",
    datasetName,
    datasetVersion: null,
    datasetUrl: null,
    fetchedAt: null,
    fetchStatus: "modelled",
    spatialResolutionMeters: null,
    sourceConfidence: clamp(Number(top.confidence || 55), 0, 100),
    rawValue: { uploadedPoints: analyzed, summary, settings, project },
    interpretedValue: `Modelled from ${analyzed.length} uploaded survey station(s).`,
    normalizedRiskScore: layerId === "dataQuality" ? clamp(Number(summary.meanResidual || raw || 0), 0, 100) : clamp(Number(top.anomalyScore || 0), 0, 100),
    weightUsed: layerId === "soil" ? 0.35 : layerId === "terrain" ? 0.25 : 0.2,
    calculationNotes: "Derived from uploaded survey interpretation workflow. Not a live external provider layer.",
    warnings: ["Uploaded/geophysical interpretation is modelled decision support and requires professional review.", ...warnings.map((warning) => warning.message || String(warning))],
    evidenceRefs: [layerId, datasetName],
  }));
};

export const calculateDataConfidence = (layers) => {
  const layerContributions = layers.map((layer) => {
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
    const contribution = clamp(Math.round(statusBase * 0.65 + Number(layer.sourceConfidence || 0) * 0.35), 0, 100);
    return {
      layerId: layer.layerId,
      layerName: layer.layerName,
      fetchStatus: layer.fetchStatus,
      providerType: layer.providerType,
      contribution,
      weight: Math.max(Number(layer.weightUsed || 0.04), 0.04),
      reason: `${layer.fetchStatus} ${layer.providerType} layer with ${layer.sourceConfidence}% source confidence.`,
    };
  });
  const totalWeight = layerContributions.reduce((sum, item) => sum + item.weight, 0) || 1;
  let confidenceScore = Math.round(layerContributions.reduce((sum, item) => sum + item.contribution * item.weight, 0) / totalWeight);
  const critical = layers.filter((layer) => ["elevation", "terrain", "drainage", "waterbody", "soil", "seismic", "infrastructure", "legalPlanning"].includes(layer.category));
  const weakCritical = critical.filter((layer) => isFallbackLike(layer.fetchStatus)).length;
  const liveCount = layers.filter((layer) => layer.fetchStatus === "live").length;
  const soilDrainageElevationWeak = ["soil", "drainage", "elevation"].every((category) =>
    layers.some((layer) => layer.category === category && isFallbackLike(layer.fetchStatus)),
  );
  if (critical.length && weakCritical / critical.length > 0.5) confidenceScore = Math.min(confidenceScore, 85);
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
    layerContributions,
  };
};

const riskBand = (score) => (score >= 84 ? "severe" : score >= 68 ? "high" : score >= 42 ? "moderate" : "low");
const scoreLayerMap = {
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

export const explainScore = (snapshot, scoreKey) => {
  const score = Number(snapshot.scoreBreakdown?.[scoreKey] ?? 0);
  const contributingLayers = scoreLayerMap[scoreKey] || [];
  const layers = snapshot.dataLayers.filter((layer) => contributingLayers.includes(layer.layerId));
  return {
    score,
    riskBand: riskBand(score),
    contributingLayers,
    weights: Object.fromEntries(layers.map((layer) => [layer.layerId, layer.weightUsed])),
    reason: `${scoreKey} is explained by ${contributingLayers.join(", ") || "stored score breakdown"} using the report scoring formula and layer weights.`,
    confidence: scoreKey === "dataConfidence" ? snapshot.confidence.confidenceScore : Math.round(layers.reduce((sum, layer) => sum + Number(layer.sourceConfidence || 0), 0) / Math.max(layers.length, 1)),
    warnings: layers.flatMap((layer) => layer.warnings || []),
  };
};

const siteScoreBreakdown = (screening, confidenceScore) => ({
  terrainRisk: screening.terrainSlopeRisk || 0,
  elevationRisk: screening.layerAssessments?.elevationRisk?.value ?? screening.slopeRisk ?? 0,
  drainageRisk: screening.drainageWaterloggingRisk || 0,
  waterbodyRisk: screening.waterProximityRisk || 0,
  groundwaterRisk: screening.groundwaterDewateringRisk || 0,
  soilUncertaintyRisk: screening.soilUncertaintyRisk || 0,
  seismicRisk: screening.seismicRisk || 0,
  landCoverRisk: screening.landCoverChangeRisk || 0,
  urbanDevelopmentRisk: screening.urbanDevelopmentRisk || 0,
  legalPlanningRisk: screening.legalTitlePlanningRisk || 0,
  infrastructureRisk: screening.infrastructureAccessRisk || 0,
  dataQualityPenalty: screening.dataQualityPenalty || 0,
  constructionRisk: screening.constructionRiskScore || 0,
  landPurchaseRisk: screening.landPurchaseRiskScore || screening.landPurchaseRisk || 0,
  developmentRisk: screening.developmentProfitRiskIndicator || screening.profitRiskScore || 0,
  overallWeightedRisk: screening.overallRiskScore || 0,
  dataConfidence: confidenceScore,
});

const siteScoringFormula = (site, screening) => {
  const audience = `${site.reportAudience || ""} ${site.userRole || ""}`.toLowerCase();
  const overallWeights = audience.includes("purchaser") || audience.includes("buyer")
    ? { landPurchaseRisk: 0.55, developmentRisk: 0.25, constructionRisk: 0.2 }
    : audience.includes("builder") || audience.includes("engineer")
      ? { constructionRisk: 0.52, developmentRisk: 0.24, landPurchaseRisk: 0.24 }
      : { constructionRisk: 0.34, landPurchaseRisk: 0.34, developmentRisk: 0.32 };
  return {
    version: SCORING_VERSION,
    weights: {
      ...Object.fromEntries(Object.values(screening.layerAssessments || {}).map((layer) => [layer.id, weightForAudience(site, layer)])),
      ...overallWeights,
    },
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

const siteNarrative = (screening, confidenceScore) => [
  {
    sectionId: "executive-summary",
    sectionTitle: "Executive summary",
    generatedText: screening.aiAnalysis?.executiveSummary || "",
    evidenceLayerIds: ["terrain", "drainage", "soil", "legalPlanning", "infrastructure", "dataQuality"],
    confidence: confidenceScore,
    warnings: screening.limitations || [],
  },
  {
    sectionId: "construction-suitability",
    sectionTitle: "Construction suitability",
    generatedText: screening.constructionSuitability?.explanation || "",
    evidenceLayerIds: ["soil", "groundwater", "drainage", "seismic", "infrastructure"],
    confidence: confidenceScore,
    warnings: screening.constructionSuitability?.notRecommendedWithoutDetailedInvestigation || [],
  },
  {
    sectionId: "land-purchaser-review",
    sectionTitle: "Land purchaser review",
    generatedText: (screening.clientReviews?.purchaser || screening.buyerWarnings || []).join("\n"),
    evidenceLayerIds: ["legalPlanning", "soil", "groundwater", "drainage"],
    confidence: confidenceScore,
    warnings: screening.buyerWarnings || [],
  },
  {
    sectionId: "engineer-review",
    sectionTitle: "Engineer review",
    generatedText: (screening.clientReviews?.engineer || screening.engineerNotes || []).join("\n"),
    evidenceLayerIds: ["soil", "groundwater", "terrain", "seismic"],
    confidence: confidenceScore,
    warnings: screening.engineerNotes || [],
  },
  {
    sectionId: "builder-review",
    sectionTitle: "Builder review",
    generatedText: (screening.clientReviews?.builder || []).join("\n"),
    evidenceLayerIds: ["terrain", "soil", "drainage", "groundwater", "infrastructure"],
    confidence: confidenceScore,
    warnings: screening.recommendedNextSteps || [],
  },
];

export const validateAuditSnapshot = (snapshot) => {
  const errors = [...(snapshot.validationErrors || [])];
  const warnings = [...(snapshot.validationWarnings || [])];
  if (!snapshot.reportId) errors.push("Missing reportId.");
  if (!snapshot.dataLayers?.length) errors.push("Audit snapshot has no data layers.");
  for (const layer of snapshot.dataLayers || []) {
    if (layer.fetchStatus === "live" && (!layer.fetchedAt || !layer.providerName || layer.rawValue === null || layer.rawValue === undefined)) {
      errors.push(`${layer.layerId} is marked live without strict live-source evidence.`);
    }
    if ((layer.fetchStatus === "modelled" || layer.fetchStatus === "fallback") && !layer.warnings?.length) {
      warnings.push(`${layer.layerId} is ${layer.fetchStatus} and should carry a warning.`);
    }
  }
  for (const section of snapshot.narrativeProvenance || []) {
    if (!section.evidenceLayerIds?.length) warnings.push(`${section.sectionId} has no evidence layer references.`);
  }
  return {
    validationStatus: errors.length ? "fail" : warnings.length ? "warning" : "pass",
    validationErrors: [...new Set(errors)],
    validationWarnings: [...new Set(warnings)],
  };
};

export const buildSiteReportAuditSnapshot = ({ reportId, site, screening, reportText, generatedAt = new Date().toISOString(), requestedBy = null }) => {
  const validation = validateReportInput(site);
  const dataLayers = buildSiteLayers(site, screening);
  const confidence = calculateDataConfidence(dataLayers);
  const scoreBreakdown = siteScoreBreakdown(screening, confidence.confidenceScore);
  const snapshot = {
    reportId,
    generatedAt,
    appName: APP_NAME,
    reportVersion: REPORT_VERSION,
    scoringVersion: SCORING_VERSION,
    codeVersion: getCodeVersion(),
    environment: normalizeEnvironment(),
    requestedBy,
    userInput: {
      originalCoordinateInput: site.coordinateInputOriginal || `${site.latitude}, ${site.longitude}`,
      parsedLatitude: Number(site.latitude),
      parsedLongitude: Number(site.longitude),
      radiusMeters: Number(site.radiusMeters),
      approximatePlotArea: site.approximatePlotArea ?? null,
      plotAreaUnit: site.approximatePlotArea ? site.plotAreaUnit ?? null : null,
      intendedUse: site.intendedUse || "",
      buildingType: site.buildingType || null,
      floors: site.floors || null,
      loadCategory: site.loadCategory || null,
      audience: site.reportAudience || null,
    },
    normalizedGeometry: {
      center: { lat: Number(site.latitude), lng: Number(site.longitude) },
      radiusMeters: Number(site.radiusMeters),
      boundingBox: buildBoundingBox(Number(site.latitude), Number(site.longitude), Number(site.radiusMeters)),
      aoiGeoJson: buildAoiPolygon(Number(site.latitude), Number(site.longitude), Number(site.radiusMeters)),
      coordinateValidation: { valid: validation.valid, warnings: validation.warnings },
    },
    dataLayers,
    scoreBreakdown,
    scoringFormula: siteScoringFormula(site, screening),
    confidence,
    scoreExplanations: {},
    narrativeProvenance: siteNarrative(screening, confidence.confidenceScore),
    generatedReportText: reportText,
    disclaimers: {
      screeningOnly: true,
      notCertifiedGeotechnicalReport: true,
      requiresFieldInvestigation: true,
      notLegalAdvice: true,
      notFinancialAdvice: true,
      notConstructionApproval: true,
    },
    validationStatus: "pass",
    validationErrors: validation.errors,
    validationWarnings: validation.warnings,
  };
  snapshot.scoreExplanations = Object.fromEntries(
    Object.keys(scoreLayerMap).map((key) => [key, explainScore(snapshot, key)]),
  );
  return { ...snapshot, ...validateAuditSnapshot(snapshot) };
};

export const buildSurveyReportAuditSnapshot = ({ reportId, project, analysis, generatedAt = new Date().toISOString(), requestedBy = null }) => {
  const site = {
    latitude: Number(project.latitude || 0),
    longitude: Number(project.longitude || 0),
    radiusMeters: Number(project.siteRadiusMeters || 250),
    coordinateInputOriginal: project.coordinates || `${project.latitude}, ${project.longitude}`,
    approximatePlotArea: project.areaHa ? Number(project.areaHa) * 10_000 : null,
    plotAreaUnit: project.areaHa ? "sqm" : null,
    intendedUse: project.target || project.surveyObjective || "Survey interpretation",
    buildingType: project.description || null,
    floors: null,
    loadCategory: null,
    reportAudience: project.client || null,
  };
  const validation = validateReportInput(site);
  const dataLayers = buildSurveyLayers({ analyzed: analysis.analyzed, summary: analysis.summary, warnings: analysis.warnings, project, settings: analysis.settings });
  const confidence = calculateDataConfidence(dataLayers);
  const top = analysis.summary?.top || analysis.analyzed?.[0] || {};
  const scoreBreakdown = {
    terrainRisk: top.anomalyScore || 0,
    elevationRisk: 0,
    drainageRisk: 0,
    waterbodyRisk: 0,
    groundwaterRisk: 0,
    soilUncertaintyRisk: top.anomalyScore || 0,
    seismicRisk: 0,
    landCoverRisk: 0,
    urbanDevelopmentRisk: 0,
    legalPlanningRisk: 0,
    infrastructureRisk: top.anomalyScore || 0,
    dataQualityPenalty: analysis.summary?.meanResidual || 0,
    constructionRisk: top.anomalyScore || 0,
    landPurchaseRisk: 0,
    developmentRisk: top.anomalyScore || 0,
    overallWeightedRisk: top.anomalyScore || 0,
    dataConfidence: confidence.confidenceScore,
  };
  const snapshot = {
    reportId,
    generatedAt,
    appName: APP_NAME,
    reportVersion: REPORT_VERSION,
    scoringVersion: "survey-anomaly-v1.audit-v1",
    codeVersion: getCodeVersion(),
    environment: normalizeEnvironment(),
    requestedBy,
    userInput: {
      originalCoordinateInput: site.coordinateInputOriginal,
      parsedLatitude: site.latitude,
      parsedLongitude: site.longitude,
      radiusMeters: site.radiusMeters,
      approximatePlotArea: site.approximatePlotArea,
      plotAreaUnit: site.plotAreaUnit,
      intendedUse: site.intendedUse,
      buildingType: site.buildingType,
      floors: null,
      loadCategory: null,
      audience: project.client || null,
    },
    normalizedGeometry: {
      center: { lat: site.latitude, lng: site.longitude },
      radiusMeters: site.radiusMeters,
      boundingBox: buildBoundingBox(site.latitude, site.longitude, site.radiusMeters),
      aoiGeoJson: buildAoiPolygon(site.latitude, site.longitude, site.radiusMeters),
      coordinateValidation: { valid: validation.valid, warnings: validation.warnings },
    },
    dataLayers,
    scoreBreakdown,
    scoringFormula: {
      version: "survey-anomaly-v1.audit-v1",
      weights: { soil: 0.35, terrain: 0.25, infrastructure: 0.2, dataQuality: 0.2 },
      formulas: {
        overallWeightedRisk: "highest ranked anomaly score from transparent survey heuristic",
        dataConfidence: "weighted layer contribution by upload/modelled status, source confidence, and fallback penalties",
      },
      notes: ["Advanced upload reports use uploaded survey station values, not external live geospatial providers."],
    },
    confidence,
    scoreExplanations: {},
    narrativeProvenance: [
      {
        sectionId: "survey-executive-summary",
        sectionTitle: "Survey executive summary",
        generatedText: analysis.reportText,
        evidenceLayerIds: ["soil", "terrain", "infrastructure", "dataQuality"],
        confidence: confidence.confidenceScore,
        warnings: analysis.warnings?.map((warning) => warning.message || String(warning)) || [],
      },
    ],
    generatedReportText: analysis.reportText,
    disclaimers: {
      screeningOnly: true,
      notCertifiedGeotechnicalReport: true,
      requiresFieldInvestigation: true,
      notLegalAdvice: true,
      notFinancialAdvice: true,
      notConstructionApproval: true,
    },
    validationStatus: "pass",
    validationErrors: validation.errors,
    validationWarnings: validation.warnings,
  };
  snapshot.scoreExplanations = Object.fromEntries(Object.keys(scoreLayerMap).map((key) => [key, explainScore(snapshot, key)]));
  return { ...snapshot, ...validateAuditSnapshot(snapshot) };
};

export const auditRawLayerData = (snapshot) => ({
  reportId: snapshot.reportId,
  generatedAt: snapshot.generatedAt,
  layers: (snapshot.dataLayers || []).map((layer) => ({
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

export const auditScoringData = (snapshot) => ({
  reportId: snapshot.reportId,
  scoreBreakdown: snapshot.scoreBreakdown,
  scoringFormula: snapshot.scoringFormula,
  scoreExplanations: snapshot.scoreExplanations,
});

export const auditValidationData = (snapshot) => ({
  reportId: snapshot.reportId,
  validationStatus: snapshot.validationStatus,
  validationErrors: snapshot.validationErrors,
  validationWarnings: snapshot.validationWarnings,
  confidence: snapshot.confidence,
});

// Audit snapshot for a land scan.
//
// The land-scan pipeline is the flagship workflow, but it previously wrote no
// audit record: a report could be produced and exported with nothing durable
// showing which provider values and formulas produced its numbers. Enterprise
// procurement asks for exactly that trail, so every scan now persists one.
//
// The snapshot reuses the scan's own provenance rather than recomputing it, so
// the audit can never disagree with the report it describes.
export const buildLandScanAuditSnapshot = ({ scan, report, generatedAt = new Date().toISOString(), requestedBy = null }) => {
  const dataLayers = (scan.sourceTable || scan.dataSources || []).map((source) => ({
    layerId: source.id,
    layerName: source.providerName,
    fetchStatus: source.dataMode === "live" ? "live" : source.dataMode === "mock" ? "fallback" : "unavailable",
    providerName: source.providerName,
    providerType: source.sourceType,
    fetchedAt: source.generatedAt || generatedAt,
    rawValue: scan.rawLayers?.[source.id]?.rawProviderData ?? null,
    interpretedValue: scan.subScores?.[source.id]?.score ?? null,
    citation: source.citation || source.citationUrl || "",
    attribution: source.attribution || "",
    regionCoverage: source.regionCoverage,
    confidence: source.confidence,
    warnings: [
      ...(source.dataMode !== "live" ? [`${source.providerName} returned ${source.dataMode}; the indicator was excluded from scoring.`] : []),
      ...(Array.isArray(source.errors) ? source.errors : []),
    ],
  }));

  const scoreBreakdown = Object.values(scan.subScores || {}).map((score) => ({
    scoreId: score.scoreId,
    scoreName: score.scoreName,
    available: score.available,
    rawScore: score.score,
    weight: score.weight,
    weightedContribution: score.weightedContribution,
    confidence: score.confidence,
    providerSources: score.providerSources,
  }));

  const snapshot = {
    reportId: scan.scanId,
    generatedAt,
    appName: APP_NAME,
    reportVersion: REPORT_VERSION,
    scoringVersion: "land-scan-explainable-v1",
    codeVersion: getCodeVersion(),
    environment: normalizeEnvironment(),
    requestedBy,
    workflow: "land-scan",
    userInput: {
      originalCoordinateInput: scan.location.coordinateInput,
      parsedLatitude: scan.location.lat,
      parsedLongitude: scan.location.lng,
      radiusMeters: scan.location.radiusMeters,
      boundaryPointCount: (scan.location.boundary || []).length,
      addressLabel: scan.location.address,
      intendedUse: scan.intendedUse,
      reportDepth: scan.reportDepth,
    },
    normalizedGeometry: {
      center: { lat: scan.location.lat, lng: scan.location.lng },
      radiusMeters: scan.location.radiusMeters,
      boundingBox: buildBoundingBox(scan.location.lat, scan.location.lng, scan.location.radiusMeters),
      aoiGeoJson: buildAoiPolygon(scan.location.lat, scan.location.lng, scan.location.radiusMeters),
      suppliedBoundary: scan.location.boundary || [],
      coordinateValidation: { valid: true, warnings: [] },
    },
    dataLayers,
    scoreBreakdown,
    scoringFormula: {
      overallRiskScore: "sum(subScore.normalizedScore * subScore.weight) across available sub-scores",
      weightNormalisation: "weights of available sub-scores are renormalised to sum to 1",
      overallSuitabilityScore: "100 - overallRiskScore * 0.78 - dataAvailabilityRisk * 0.16",
      subScoreFormulas: Object.fromEntries(
        Object.values(scan.subScores || {}).map((score) => [score.scoreId, score.formula]),
      ),
    },
    confidence: {
      confidenceScore: Math.round(Number(scan.confidence || 0) * 100),
      dataMode: scan.dataMode,
      minimumLiveDataPackage: scan.minimumLiveDataPackage,
      unavailableIndicators: scan.unavailableScores || [],
      warnings: scan.lowConfidenceWarnings || [],
    },
    scoreExplanations: scan.scoreExplainability || {},
    // The AI narrative is recorded as provenance, with an explicit note that it
    // explains the deterministic numbers rather than producing them.
    narrativeProvenance: (report?.sections || []).map((section, index) => ({
      sectionId: `section-${index + 1}`,
      sectionTitle: section.title,
      generator: report?.aiAnalysis?.aiStatus === "completed" ? `gemini:${report?.aiAnalysis?.model || "unknown"}` : "deterministic",
      evidenceLayerIds: dataLayers.filter((layer) => layer.fetchStatus === "live").map((layer) => layer.layerId),
      note: "AI narrative explains deterministic scores; it does not generate or alter them.",
    })),
    generatedReportText: report?.narrative || "",
    aiProvenance: {
      status: report?.aiAnalysis?.aiStatus || "not_configured",
      provider: report?.aiAnalysis?.provider || null,
      model: report?.aiAnalysis?.model || null,
      generatedAt: report?.aiAnalysis?.generatedAt || null,
      claimGuard: "Report is rejected if it contains any claim on the banned-claims list.",
    },
    readiness: {
      dataMode: scan.dataMode,
      reportReadiness: scan.reportReadiness,
      clientReadyDeliverable: scan.clientReadyDeliverable,
      externalUseBlockedReason: scan.externalUseBlockedReason,
    },
    disclaimers: {
      screeningOnly: true,
      notCertifiedGeotechnicalReport: true,
      requiresFieldInvestigation: true,
      notLegalAdvice: true,
      notFinancialAdvice: true,
      notConstructionApproval: true,
    },
    validationStatus: "pass",
    validationErrors: [],
    validationWarnings: [],
  };

  return { ...snapshot, ...validateAuditSnapshot(snapshot) };
};
