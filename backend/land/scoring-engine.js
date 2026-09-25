export const disclaimer =
  "This platform provides preliminary site intelligence and screening-level land risk indicators only. It is a decision-support tool and is not a certified geotechnical, environmental, structural, legal, surveying, planning, or engineering report. It does not replace certified geotechnical surveys, boreholes, SPT/CPT, soil laboratory testing, civil/structural engineering, environmental consulting, legal due diligence, title review, planning checks, boundary surveys, or other qualified professional services. Results must be verified by certified professionals before land purchase, design, financing, construction, safety, or legal decisions.";

export const mockDataNotice =
  "Demo output using mocked screening indicators, not live authoritative datasets.";

const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const rounded = (value) => Math.round(clamp(Number(value) || 0));
const average = (values) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
const finite = (value) => Number.isFinite(Number(value));
const toPercent = (value) => Math.round(Number(value || 0) * 100);

const useRiskAdjustment = (intendedUse) => {
  const text = String(intendedUse || "").toLowerCase();
  if (text.includes("industrial")) return 8;
  if (text.includes("warehouse")) return 5;
  if (text.includes("infrastructure")) return 9;
  if (text.includes("commercial")) return 4;
  if (text.includes("residential")) return 3;
  if (text.includes("farmland")) return -2;
  return 0;
};

const reportDepthConfidence = (depth) => {
  if (depth === "professional") return 0.06;
  if (depth === "quick") return -0.08;
  return 0;
};

export const classifyRiskBand = (score) => {
  if (!Number.isFinite(score)) {
    return {
      label: "Unknown",
      description: "Provider coverage is not sufficient to classify screening risk responsibly.",
    };
  }
  if (score >= 75) {
    return {
      label: "High",
      description: "Multiple screening indicators require specialist review before material commitments.",
    };
  }
  if (score >= 45) {
    return {
      label: "Moderate",
      description: "Some risk indicators are present; use the result to scope professional due diligence.",
    };
  }
  return {
    label: "Low",
    description: "No major screening-level indicators dominate, but professional verification is still required.",
  };
};

const scoringLayers = (layers) =>
  Object.entries(layers).filter(([, layer]) => layer && typeof layer === "object" && layer.scoringEligible !== false);

const dataModeFrom = (layers, minimumLiveDataPackage) => {
  const layerValues = scoringLayers(layers).map(([, layer]) => layer);
  const statuses = layerValues.map((layer) => layer.dataMode || layer.status);
  if (statuses.includes("mock")) return "mock";
  const liveCount = statuses.filter((status) => status === "live").length;
  if (liveCount === 0) return "unavailable";
  if (minimumLiveDataPackage.satisfied) return "live";
  return "mixed";
};

const providerAvailabilityScore = (layers) => {
  const values = Object.values(layers)
    .filter((layer) => layer && typeof layer === "object" && layer.id)
    .map((layer) => {
      if (layer.dataMode === "live" && layer.scoringEligible !== false) return 100;
      if (layer.dataMode === "live") return 72;
      if (layer.dataMode === "mock") return 15;
      if (layer.dataMode === "unavailable") return 0;
      return 8;
    });
  return Math.round(average(values));
};

const sourceNames = (...layers) =>
  [
    ...new Set(
      layers
        .filter(Boolean)
        .map((layer) => layer.providerName || layer.adapter || layer.source)
        .filter(Boolean),
    ),
  ];

const limitationsOf = (...layers) =>
  [
    ...new Set(
      layers
        .filter(Boolean)
        .flatMap((layer) => String(layer.limitations || "").split(/ (?=Demo output|OSM|DEM|No |The |Map |Cesium |Flood)/g))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];

const confidenceFrom = (reportDepth, ...layers) => {
  const base = average(
    layers.filter(Boolean).map((layer) => {
      if (layer.dataMode === "mock") return Math.min(Number(layer.confidence || 0.2), 0.28);
      if (layer.dataMode === "unavailable") return 0.05;
      return Number(layer.confidence || 0.4);
    }),
  );
  return Number(clamp(base + reportDepthConfidence(reportDepth), 0.05, 0.92).toFixed(2));
};

const unavailableScore = ({ scoreId, scoreName, providerSources, limitations, recommendedVerification }) => ({
  scoreId,
  id: scoreId,
  scoreName,
  available: false,
  score: 0,
  rawInputs: {},
  inputs: {},
  formula: "Unavailable: no real scoring dataset was returned for this indicator.",
  calculation: "Unavailable: no real scoring dataset was returned for this indicator.",
  thresholds: {},
  normalizedScore: 0,
  weight: 0,
  weightedContribution: 0,
  confidence: 0,
  providerSources,
  dataSource: providerSources.join(" + ") || "Provider unavailable",
  provider: providerSources.join(" + ") || "Provider unavailable",
  calculationSteps: ["Provider returned unavailable or no implemented adapter exists.", "The indicator was excluded from the weighted risk score."],
  explanationShort: `${scoreName} was not scored because the required dataset is unavailable.`,
  explanation:
    `${scoreName} was not scored because the required dataset is unavailable. The overall confidence and data availability risk reflect this gap.`,
  explanationDetailed:
    `${scoreName} was not scored because TerraSignal does not have a real provider output for this location and indicator. No proxy or mock value was substituted.`,
  limitations,
  recommendedVerification,
  explainability:
    `${scoreName} is unavailable. Missing data reduces confidence and should be verified by certified professionals or official datasets.`,
});

const scoreObject = ({
  scoreId,
  scoreName,
  rawInputs,
  formula,
  thresholds,
  score,
  baseWeight,
  confidence,
  providerSources,
  calculationSteps,
  explanationShort,
  explanationDetailed,
  limitations,
  recommendedVerification,
}) => {
  const normalizedScore = rounded(score);
  return {
    scoreId,
    id: scoreId,
    scoreName,
    available: true,
    score: normalizedScore,
    rawInputs,
    inputs: rawInputs,
    formula,
    calculation: formula,
    thresholds,
    normalizedScore,
    weight: baseWeight,
    weightedContribution: 0,
    confidence,
    providerSources,
    dataSource: providerSources.join(" + "),
    provider: providerSources.join(" + "),
    calculationSteps,
    explanationShort,
    explanation: explanationShort,
    explanationDetailed,
    limitations,
    recommendedVerification,
    explainability:
      `${explanationDetailed} Formula: ${formula}. Raw inputs: ${JSON.stringify(rawInputs)}. Confidence is ${toPercent(
        confidence,
      )}% because the source is ${providerSources.join(" + ")}.`,
  };
};

const normalizeWeights = (subScores) => {
  const available = Object.values(subScores).filter((score) => score.available && score.weight > 0);
  const total = available.reduce((sum, score) => sum + score.weight, 0);
  if (!total) return;
  for (const score of available) {
    score.weight = Number((score.weight / total).toFixed(4));
    score.weightedContribution = Number((score.score * score.weight).toFixed(2));
  }
};

const buildMinimumPackage = (layers) => {
  const elevationLive =
    layers.elevationTopography?.dataMode === "live" &&
    layers.elevationTopography?.scoringEligible !== false &&
    (finite(layers.elevationTopography.reliefMeters) || finite(layers.elevationTopography.meanElevationMeters));
  const terrainLive =
    layers.slope?.dataMode === "live" &&
    layers.slope?.scoringEligible !== false &&
    finite(layers.slope.meanSlopeDegrees);
  const contextLive =
    layers.infrastructure?.dataMode === "live" &&
    layers.infrastructure?.scoringEligible !== false &&
    (finite(layers.infrastructure.roadAccessQualityIndex) || finite(layers.infrastructure.nearestRoadMeters));
  const waterOrLandUseLive =
    layers.nearbyWaterBodies?.dataMode === "live" || layers.landUseContext?.dataMode === "live";
  const anyMock = scoringLayers(layers).some(([, layer]) => layer.dataMode === "mock");
  const hasElevationTerrainProvider = elevationLive || terrainLive;
  const hasContextProvider = contextLive || waterOrLandUseLive;
  const satisfied = hasElevationTerrainProvider && hasContextProvider && !anyMock;
  return {
    satisfied,
    hasRealElevationOrTerrainProvider: hasElevationTerrainProvider,
    hasRealMapInfrastructureContextProvider: hasContextProvider,
    noMockProviderUsedInScore: !anyMock,
    missing: [
      hasElevationTerrainProvider ? null : "real elevation/terrain provider",
      hasContextProvider ? null : "real map/infrastructure/context provider",
      anyMock ? "no mock provider may be used in a client deliverable score" : null,
    ].filter(Boolean),
  };
};

const reportReadinessFrom = ({ dataMode, minimumLiveDataPackage }) => {
  if (dataMode === "mock") return "internalDemo";
  if (dataMode === "unavailable") return "unavailable";
  if (dataMode === "mixed") return "clientPreview";
  if (dataMode === "live" && minimumLiveDataPackage.satisfied) return "clientPreview";
  return "unavailable";
};

const dataSourcesFrom = (layers) =>
  Object.entries(layers)
    .filter(([, layer]) => layer && typeof layer === "object" && layer.id)
    .map(([key, layer]) => ({
      id: key,
      adapter: layer.adapter,
      providerName: layer.providerName || layer.adapter,
      source: layer.source,
      status: layer.status,
      dataMode: layer.dataMode || layer.status,
      sourceType: layer.sourceType || "computed",
      sourceReliability: layer.sourceReliability,
      regionCoverage: layer.regionCoverage || layer.coverage || "unsupported",
      coverage: layer.coverage || layer.regionCoverage || "unsupported",
      confidence: layer.confidence,
      limitations: layer.limitations,
      citation: layer.citation || layer.citationUrl || "",
      citationUrl: layer.citationUrl || layer.citation || "",
      attribution: layer.attribution || "",
      errors: layer.errors || [],
      generatedAt: layer.generatedAt,
      scoringEligible: layer.scoringEligible !== false,
    }));

const physicalAvailableCount = (subScores) =>
  [
    "slopeTerrainRisk",
    "elevationVariabilityRisk",
    "drainageWaterProximityRisk",
    "infrastructureAccessIndicator",
    "landUseContextIndicator",
    "floodContextIndicator",
  ].filter((key) => subScores[key]?.available).length;

export const buildExplainableLandScan = ({ scanId, userId = null, input, layers }) => {
  const minimumLiveDataPackage = buildMinimumPackage(layers);
  const dataMode = dataModeFrom(layers, minimumLiveDataPackage);
  const providerScore = providerAvailabilityScore(layers);
  const dataAvailabilityRisk = rounded(100 - providerScore);
  const useAdjustment = useRiskAdjustment(input.intendedUse);

  const subScores = {};
  const slope = layers.slope;
  const elevation = layers.elevationTopography;
  const water = layers.nearbyWaterBodies;
  const infrastructure = layers.infrastructure;
  const landUse = layers.landUseContext;
  const flood = layers.drainageFlood;

  subScores.slopeTerrainRisk =
    slope?.dataMode !== "unavailable" && finite(slope.meanSlopeDegrees) && finite(slope.maxSlopeDegrees)
      ? scoreObject({
          scoreId: "slopeTerrainRisk",
          scoreName: "Slope/terrain risk",
          rawInputs: {
            meanSlopeDegrees: slope.meanSlopeDegrees,
            maxSlopeDegrees: slope.maxSlopeDegrees,
            slopeVariance: slope.slopeVariance,
          },
          formula: "meanSlopeDegrees * 3.4 + maxSlopeDegrees * 1.3 + slopeVariance * 1.1, clamped to 0-100.",
          thresholds: { low: "<45", moderate: "45-74", high: ">=75" },
          score: slope.meanSlopeDegrees * 3.4 + slope.maxSlopeDegrees * 1.3 + Number(slope.slopeVariance || 0) * 1.1,
          baseWeight: 0.18,
          confidence: confidenceFrom(input.reportDepth, slope),
          providerSources: sourceNames(slope),
          calculationSteps: [
            `Mean slope ${slope.meanSlopeDegrees} degrees was multiplied by 3.4.`,
            `Maximum slope ${slope.maxSlopeDegrees} degrees was multiplied by 1.3.`,
            "The result was clamped to the 0-100 screening scale.",
          ],
          explanationShort:
            "Screens terrain steepness and slope variation as early indicators of grading, erosion, access, retaining, and slope-stability diligence.",
          explanationDetailed:
            `This slope risk score increased because the sampled slope indicators were ${slope.meanSlopeDegrees} degrees mean and ${slope.maxSlopeDegrees} degrees maximum across the selected radius.`,
          limitations: limitationsOf(slope),
          recommendedVerification: ["Parcel topographic survey", "Slope stability review where slopes, cuts, or retaining are material"],
        })
      : unavailableScore({
          scoreId: "slopeTerrainRisk",
          scoreName: "Slope/terrain risk",
          providerSources: sourceNames(slope),
          limitations: limitationsOf(slope),
          recommendedVerification: ["Parcel topographic survey", "DEM or LiDAR-derived slope model"],
        });

  subScores.elevationVariabilityRisk =
    elevation?.dataMode !== "unavailable" && finite(elevation.reliefMeters)
      ? scoreObject({
          scoreId: "elevationVariabilityRisk",
          scoreName: "Elevation variability risk",
          rawInputs: {
            minElevationMeters: elevation.minElevationMeters,
            maxElevationMeters: elevation.maxElevationMeters,
            meanElevationMeters: elevation.meanElevationMeters,
            reliefMeters: elevation.reliefMeters,
            terrainVariabilityIndex: elevation.terrainVariabilityIndex,
            resolutionLabel: elevation.resolutionLabel,
          },
          formula: "reliefMeters * 0.55 + terrainVariabilityIndex * 45, clamped to 0-100.",
          thresholds: { low: "relief under about 35 m", moderate: "35-95 m", high: "above about 95 m" },
          score: Number(elevation.reliefMeters || 0) * 0.55 + Number(elevation.terrainVariabilityIndex || 0) * 45,
          baseWeight: 0.12,
          confidence: confidenceFrom(input.reportDepth, elevation),
          providerSources: sourceNames(elevation),
          calculationSteps: [
            `Elevation relief was ${elevation.reliefMeters} m.`,
            `Terrain variability index was ${elevation.terrainVariabilityIndex}.`,
            "Both were normalized to a 0-100 screening risk.",
          ],
          explanationShort:
            "Screens terrain relief and variability that can affect grading, cut/fill, access, drainage, and construction logistics.",
          explanationDetailed:
            `Elevation variability reflects a sampled relief of ${elevation.reliefMeters} m from ${elevation.providerName}. Resolution/source limits control confidence.`,
          limitations: limitationsOf(elevation),
          recommendedVerification: ["Topographic survey", "Cut/fill and drainage levels review"],
        })
      : unavailableScore({
          scoreId: "elevationVariabilityRisk",
          scoreName: "Elevation variability risk",
          providerSources: sourceNames(elevation),
          limitations: limitationsOf(elevation),
          recommendedVerification: ["DEM/terrain provider", "Surveyed elevation levels"],
        });

  subScores.drainageWaterProximityRisk =
    water?.dataMode !== "unavailable" && (finite(water.waterProximityRiskIndex) || finite(water.nearestWaterFeatureMeters))
      ? scoreObject({
          scoreId: "drainageWaterProximityRisk",
          scoreName: "Drainage/water proximity risk",
          rawInputs: {
            nearestWaterFeatureMeters: water.nearestWaterFeatureMeters,
            waterFeatureCount: water.waterFeatureCount,
            waterProximityRiskIndex: water.waterProximityRiskIndex,
          },
          formula:
            "waterProximityRiskIndex when supplied; otherwise 100 - nearestWaterFeatureMeters / 35 + waterFeatureCount * 6, clamped to 0-100.",
          thresholds: { low: "<45", moderate: "45-74", high: ">=75" },
          score: finite(water.waterProximityRiskIndex)
            ? water.waterProximityRiskIndex
            : 100 - Number(water.nearestWaterFeatureMeters || 5000) / 35 + Number(water.waterFeatureCount || 0) * 6,
          baseWeight: 0.16,
          confidence: confidenceFrom(input.reportDepth, water),
          providerSources: sourceNames(water),
          calculationSteps: [
            `Nearest mapped water feature was ${water.nearestWaterFeatureMeters ?? "not returned"} m.`,
            `Mapped water feature count was ${water.waterFeatureCount}.`,
            "The proximity/count indicators were normalized to a screening risk.",
          ],
          explanationShort:
            "Screens nearby mapped water and drainage context that may affect flood checks, stormwater routing, access levels, and environmental buffers.",
          explanationDetailed:
            `This score reflects mapped OSM water context. It is a proximity/context indicator, not flood depth or drainage design evidence.`,
          limitations: limitationsOf(water),
          recommendedVerification: ["Official floodplain maps", "Drainage/stormwater design review", "Seasonal site observations"],
        })
      : unavailableScore({
          scoreId: "drainageWaterProximityRisk",
          scoreName: "Drainage/water proximity risk",
          providerSources: sourceNames(water),
          limitations: limitationsOf(water),
          recommendedVerification: ["Official flood/drainage records", "Site drainage survey"],
        });

  subScores.infrastructureAccessIndicator =
    infrastructure?.dataMode !== "unavailable" &&
    (finite(infrastructure.roadAccessQualityIndex) || finite(infrastructure.nearestRoadMeters))
      ? scoreObject({
          scoreId: "infrastructureAccessIndicator",
          scoreName: "Infrastructure/access indicator",
          rawInputs: {
            nearestRoadMeters: infrastructure.nearestRoadMeters,
            roadFeatureCount: infrastructure.roadFeatureCount,
            utilityAmenityFeatureCount: infrastructure.utilityAmenityFeatureCount,
            roadAccessQualityIndex: infrastructure.roadAccessQualityIndex,
            infrastructureContextIndex: infrastructure.infrastructureContextIndex,
          },
          formula:
            "(100 - roadAccessQualityIndex) * 0.65 + distancePenalty * 0.2 + (100 - infrastructureContextIndex) * 0.15.",
          thresholds: { low: "<45", moderate: "45-74", high: ">=75" },
          score:
            (100 - Number(infrastructure.roadAccessQualityIndex || 0)) * 0.65 +
            clamp(Number(infrastructure.nearestRoadMeters || 5000) / 35, 0, 100) * 0.2 +
            (100 - Number(infrastructure.infrastructureContextIndex || 0)) * 0.15,
          baseWeight: 0.15,
          confidence: confidenceFrom(input.reportDepth, infrastructure),
          providerSources: sourceNames(infrastructure),
          calculationSteps: [
            `Road access quality index was ${infrastructure.roadAccessQualityIndex}.`,
            `Nearest mapped road was ${infrastructure.nearestRoadMeters ?? "not returned"} m.`,
            "Lower mapped access increases the screening risk contribution.",
          ],
          explanationShort:
            "Screens mapped road/access and basic infrastructure context; lower mapped access raises logistics and due-diligence burden.",
          explanationDetailed:
            "This indicator uses OSM context and must be verified against legal access, road classification, utilities, easements, and authority records.",
          limitations: limitationsOf(infrastructure),
          recommendedVerification: ["Legal access check", "Road classification and utility availability", "Easement and right-of-way review"],
        })
      : unavailableScore({
          scoreId: "infrastructureAccessIndicator",
          scoreName: "Infrastructure/access indicator",
          providerSources: sourceNames(infrastructure),
          limitations: limitationsOf(infrastructure),
          recommendedVerification: ["Official road/access and utility records", "Site access inspection"],
        });

  subScores.landUseContextIndicator =
    landUse?.dataMode !== "unavailable" && finite(landUse.landUseContextIndex)
      ? scoreObject({
          scoreId: "landUseContextIndicator",
          scoreName: "Land-use/context indicator",
          rawInputs: {
            dominantClass: landUse.dominantClass,
            landUseFeatureCount: landUse.landUseFeatureCount,
            industrialContextFeatureCount: landUse.industrialContextFeatureCount,
            landUseContextIndex: landUse.landUseContextIndex,
          },
          formula: "landUseContextIndex + industrialContextFeatureCount * 4, clamped to 0-100.",
          thresholds: { low: "<45", moderate: "45-74", high: ">=75" },
          score: Number(landUse.landUseContextIndex || 0) + Number(landUse.industrialContextFeatureCount || 0) * 4,
          baseWeight: 0.1,
          confidence: confidenceFrom(input.reportDepth, landUse),
          providerSources: sourceNames(landUse),
          calculationSteps: [
            `Dominant mapped context was ${landUse.dominantClass}.`,
            `Industrial/commercial context features counted: ${landUse.industrialContextFeatureCount}.`,
          ],
          explanationShort:
            "Screens mapped land-use and surrounding context that may affect environmental, planning, access, and compatibility diligence.",
          explanationDetailed:
            "This is an OSM land-use context indicator. It cannot establish zoning, ownership, permitted use, contamination, or planning status.",
          limitations: limitationsOf(landUse),
          recommendedVerification: ["Official zoning/planning records", "Environmental desktop review", "Historical land-use review"],
        })
      : unavailableScore({
          scoreId: "landUseContextIndicator",
          scoreName: "Land-use/context indicator",
          providerSources: sourceNames(landUse),
          limitations: limitationsOf(landUse),
          recommendedVerification: ["Official planning/zoning records", "Environmental desktop review"],
        });

  subScores.floodContextIndicator =
    flood?.dataMode !== "unavailable" && finite(flood.floodContextIndex)
      ? scoreObject({
          scoreId: "floodContextIndicator",
          scoreName: "Flood context indicator",
          rawInputs: {
            nearbyFloodAreaCount: flood.nearbyFloodAreaCount,
            floodContextIndex: flood.floodContextIndex,
            drainageContextIndex: flood.drainageContextIndex,
          },
          formula: "floodContextIndex * 0.72 + drainageContextIndex * 0.28, clamped to 0-100.",
          thresholds: { low: "<45", moderate: "45-74", high: ">=75" },
          score: Number(flood.floodContextIndex || 0) * 0.72 + Number(flood.drainageContextIndex || 0) * 0.28,
          baseWeight: 0.12,
          confidence: confidenceFrom(input.reportDepth, flood),
          providerSources: sourceNames(flood),
          calculationSteps: [
            `Nearby flood area count was ${flood.nearbyFloodAreaCount}.`,
            "Flood and drainage context indexes were blended into a screening score.",
          ],
          explanationShort:
            "Uses a supported flood authority/open dataset where available; this is not a flood-depth or drainage-design result.",
          explanationDetailed:
            "Flood context is included only where a real supported provider returned data. Unsupported regions are shown as unavailable.",
          limitations: limitationsOf(flood),
          recommendedVerification: ["Official flood maps", "Drainage engineer review", "Planning and insurance checks where relevant"],
        })
      : unavailableScore({
          scoreId: "floodContextIndicator",
          scoreName: "Flood context indicator",
          providerSources: sourceNames(flood),
          limitations: limitationsOf(flood),
          recommendedVerification: ["Official flood authority datasets", "Drainage/stormwater review"],
        });

  subScores.dataAvailabilityConfidence = scoreObject({
    scoreId: "dataAvailabilityConfidence",
    scoreName: "Data availability confidence risk",
    rawInputs: {
      providerAvailabilityScore: providerScore,
      providerStatuses: Object.fromEntries(
        Object.entries(layers)
          .filter(([, layer]) => layer && typeof layer === "object" && layer.id)
          .map(([key, layer]) => [key, layer.dataMode || layer.status]),
      ),
      minimumLiveDataPackage,
    },
    formula: "100 - providerAvailabilityScore.",
    thresholds: { low: "availability risk <35", moderate: "35-64", high: ">=65" },
    score: dataAvailabilityRisk,
    baseWeight: physicalAvailableCount(subScores) ? 0.17 : 0,
    confidence: Number((providerScore / 100).toFixed(2)),
    providerSources: ["Provider registry"],
    calculationSteps: [
      `Provider availability score was ${providerScore}/100.`,
      `Data availability risk was calculated as ${dataAvailabilityRisk}/100.`,
    ],
    explanationShort:
      "Makes missing, unavailable, or mock-heavy data visible as a risk factor instead of hiding it in raw JSON.",
    explanationDetailed:
      "Data availability risk rises when required live providers are unavailable, visualization-only, or mock/internal-demo only.",
    limitations: ["This is an evidence-quality indicator, not a ground-condition measurement."],
    recommendedVerification: ["Connect live providers", "Upload verified site documents", "Collect certified professional evidence"],
  });

  const availablePhysical = Object.values(subScores).filter(
    (score) =>
      score.available &&
      !["dataAvailabilityConfidence", "intendedUsePreliminarySuitability"].includes(score.scoreId),
  );
  const physicalRisk = availablePhysical.length ? average(availablePhysical.map((score) => score.score)) : null;

  subScores.intendedUsePreliminarySuitability =
    physicalRisk !== null
      ? scoreObject({
          scoreId: "intendedUsePreliminarySuitability",
          scoreName: "Intended-use preliminary suitability pressure",
          rawInputs: {
            intendedUse: input.intendedUse,
            reportDepth: input.reportDepth,
            physicalRiskAverage: Math.round(physicalRisk),
            intendedUseAdjustment: useAdjustment,
            dataAvailabilityRisk,
          },
          formula: "physicalRiskAverage + intendedUseAdjustment + dataAvailabilityRisk * 0.22, clamped to 0-100.",
          thresholds: { low: "<45", moderate: "45-74", high: ">=75" },
          score: physicalRisk + useAdjustment + dataAvailabilityRisk * 0.22,
          baseWeight: 0.1,
          confidence: Number(average(availablePhysical.map((score) => score.confidence)).toFixed(2)),
          providerSources: ["Deterministic scoring engine"],
          calculationSteps: [
            `Available physical indicators averaged ${Math.round(physicalRisk)}/100.`,
            `Intended-use adjustment for ${input.intendedUse} was ${useAdjustment}.`,
            "Data availability risk was added as a confidence pressure.",
          ],
          explanationShort:
            "Combines available real-data indicators into an intended-use pressure score. Higher values mean more certified due diligence should be scoped.",
          explanationDetailed:
            "This is not a feasibility certificate, design basis, planning result, or investment recommendation. It is a preliminary indicator for due-diligence scoping.",
          limitations: ["Depends on available provider coverage and does not include certified site investigation."],
          recommendedVerification: ["Professional discipline review based on intended use and local requirements"],
        })
      : unavailableScore({
          scoreId: "intendedUsePreliminarySuitability",
          scoreName: "Intended-use preliminary suitability pressure",
          providerSources: ["Deterministic scoring engine"],
          limitations: ["No physical/provider-based subscores were available to combine."],
          recommendedVerification: ["Connect live providers before generating external reports."],
        });

  normalizeWeights(subScores);

  const includedScores = Object.values(subScores).filter((score) => score.available && score.weight > 0);
  const hasPhysicalScores = physicalAvailableCount(subScores) > 0;
  const overallRiskScore = hasPhysicalScores ? rounded(includedScores.reduce((sum, score) => sum + score.weightedContribution, 0)) : 0;
  const confidence = hasPhysicalScores
    ? Number(
        clamp(
          average(includedScores.map((score) => score.confidence)) -
            dataAvailabilityRisk / 260 +
            reportDepthConfidence(input.reportDepth),
          dataMode === "mock" ? 0.12 : 0.05,
          dataMode === "mock" ? 0.38 : 0.92,
        ).toFixed(2),
      )
    : 0.08;
  const overallSuitabilityScore = hasPhysicalScores ? rounded(100 - overallRiskScore * 0.78 - dataAvailabilityRisk * 0.16) : 0;
  const riskBands = hasPhysicalScores ? classifyRiskBand(overallRiskScore) : classifyRiskBand(Number.NaN);

  const reportReadiness = reportReadinessFrom({ dataMode, minimumLiveDataPackage });
  const dataSources = dataSourcesFrom(layers);
  const unavailableScores = Object.values(subScores).filter((score) => !score.available).map((score) => score.scoreId);

  const redFlags = [
    dataMode === "mock"
      ? `${mockDataNotice} This scan is internal-demo only and must not be presented as a client-ready deliverable.`
      : null,
    dataMode === "unavailable"
      ? "Minimum live provider coverage is not met; the scan cannot be used as an external client report."
      : null,
    dataMode === "mixed"
      ? "Only partial live provider coverage is available; missing datasets must remain visible in any preview."
      : null,
    !minimumLiveDataPackage.satisfied
      ? `Minimum live data package is incomplete: ${minimumLiveDataPackage.missing.join(", ")}.`
      : null,
    subScores.slopeTerrainRisk.available && subScores.slopeTerrainRisk.score >= 68
      ? "Slope/terrain indicator is elevated; verify with a topographic survey and slope stability review."
      : null,
    subScores.drainageWaterProximityRisk.available && subScores.drainageWaterProximityRisk.score >= 68
      ? "Mapped drainage/water proximity indicator is elevated; verify floodplain, drainage, stormwater, and seasonal water conditions."
      : null,
    subScores.infrastructureAccessIndicator.available && subScores.infrastructureAccessIndicator.score >= 68
      ? "Access/infrastructure context may require additional diligence around legal access, utilities, logistics, and schedule."
      : null,
    dataAvailabilityRisk >= 45
      ? "Data availability is limited and materially reduces confidence; unsupported indicators are not scored."
      : null,
  ].filter(Boolean);

  const positiveIndicators = [
    subScores.slopeTerrainRisk.available && subScores.slopeTerrainRisk.score < 42
      ? "Slope/terrain indicator is not dominant in this preliminary screen."
      : null,
    subScores.drainageWaterProximityRisk.available && subScores.drainageWaterProximityRisk.score < 42
      ? "Mapped drainage/water proximity indicator is not dominant in this preliminary screen."
      : null,
    subScores.infrastructureAccessIndicator.available && subScores.infrastructureAccessIndicator.score < 42
      ? "Mapped road/access context appears favorable at screening level, subject to official verification."
      : null,
    minimumLiveDataPackage.satisfied ? "Minimum live-data package is present for a preliminary live-data screening workflow." : null,
  ].filter(Boolean);

  const recommendedNextSteps = [
    "Commission a qualified geotechnical investigation before purchase, design, financing, or construction reliance.",
    "Verify coordinates, parcel boundary, title, zoning/planning status, legal access, utilities, easements, and official environmental records.",
    "Scope boreholes, SPT/CPT, groundwater monitoring, and lab testing based on intended use, loads, basements, and site radius.",
    "Validate drainage/flood indicators with local authority records, site visit, stormwater levels, and seasonal observations.",
    dataMode === "mock"
      ? "Use internalDemo output only for product testing; connect real providers before client previews."
      : dataMode === "unavailable"
        ? "Connect live elevation and map/context providers before creating any client-facing report."
        : "Use this report to prioritize certified due-diligence questions and professional verification.",
  ];

  const lowConfidenceWarnings = [
    dataAvailabilityRisk >= 45
      ? "Data availability is a visible risk factor because required live providers are incomplete or unavailable."
      : null,
    confidence < 0.55 ? "Overall confidence is low; treat numeric outputs as early screening indicators only." : null,
    dataMode === "mock" ? mockDataNotice : null,
    dataMode === "unavailable"
      ? "Provider coverage is insufficient; live scans do not silently fall back to mock data."
      : null,
    unavailableScores.length ? `Unavailable indicators were excluded from scoring: ${unavailableScores.join(", ")}.` : null,
  ].filter(Boolean);

  return {
    scanId,
    userId,
    status: "completed",
    createdAt: new Date().toISOString(),
    dataMode,
    mockDataNotice: dataMode === "mock" ? mockDataNotice : "",
    reportReadiness,
    deliverableStatus: reportReadiness,
    reportLabel:
      dataMode === "mock"
        ? "Internal Demo Report - Mock Data"
        : dataMode === "mixed"
          ? "Partial Live-Data Preliminary Screening Preview"
          : dataMode === "live"
            ? "Preliminary Site Intelligence Report"
            : "Unavailable-data screening record",
    clientReadyDeliverable: false,
    externalUseBlockedReason:
      dataMode === "mock"
        ? "Pure mock reports are blocked from client-ready export."
        : dataMode === "unavailable"
          ? "Minimum live provider coverage is not met."
          : "Gemini analysis and final readiness checks must complete before client-deliverable eligibility.",
    minimumLiveDataPackage,
    unavailableScores,
    location: {
      lat: input.location.lat,
      lng: input.location.lng,
      address: input.location.address || "",
      radiusMeters: input.location.radiusMeters,
      boundary: input.location.boundary || [],
      coordinateInput: input.location.coordinateInput,
      coordinateFormat: input.location.coordinateFormat,
    },
    intendedUse: input.intendedUse,
    reportDepth: input.reportDepth,
    overallRiskScore,
    overallSuitabilityScore,
    confidence,
    riskBands,
    subScores,
    scoreExplainability: Object.fromEntries(
      Object.entries(subScores).map(([key, score]) => [
        key,
        {
          formula: score.formula,
          rawInputs: score.rawInputs,
          thresholds: score.thresholds,
          normalizedScore: score.normalizedScore,
          weight: score.weight,
          weightedContribution: score.weightedContribution,
          confidence: score.confidence,
          sourceProvider: score.providerSources.join(" + "),
          limitation: score.limitations.join(" "),
          calculationSteps: score.calculationSteps,
          finalScoreEffect: score.weightedContribution,
          explanation: score.explainability,
          recommendedVerification: score.recommendedVerification,
          available: score.available,
        },
      ]),
    ),
    redFlags,
    positiveIndicators,
    recommendedNextSteps,
    lowConfidenceWarnings,
    dataAvailabilitySummary: {
      dataMode,
      score: dataAvailabilityRisk,
      providerAvailabilityScore: providerScore,
      warning: dataAvailabilityRisk >= 45 ? "Low provider availability increases uncertainty and is treated as a material screening risk." : "",
      minimumLiveDataPackage,
    },
    dataSources,
    sourceTable: dataSources,
    limitationsTable: dataSources.map((source) => ({
      providerId: source.adapter,
      providerName: source.providerName,
      dataMode: source.dataMode,
      limitations: source.limitations,
      errors: source.errors,
    })),
    rawLayers: layers,
    providerOutputs: layers.__providerOutputs || {},
    disclaimer,
  };
};

export const validateExplainableLandScan = (scan) => {
  const errors = [];
  if (!scan || typeof scan !== "object") errors.push("Scan result must be an object.");
  if (!scan?.scanId) errors.push("scanId is required.");
  if (!Number.isFinite(scan?.location?.lat) || !Number.isFinite(scan?.location?.lng)) {
    errors.push("location.lat and location.lng are required numeric values.");
  }
  if (!Number.isFinite(scan?.overallRiskScore)) errors.push("overallRiskScore is required.");
  if (!Number.isFinite(scan?.overallSuitabilityScore)) errors.push("overallSuitabilityScore is required.");
  if (!["mock", "live", "mixed", "unavailable"].includes(scan?.dataMode)) errors.push("dataMode must be mock, live, mixed, or unavailable.");
  if (scan?.dataMode === "mock" && scan?.mockDataNotice !== mockDataNotice) errors.push("Mock scans must carry the standard mock data notice.");
  if (scan?.dataMode === "mock" && scan?.clientReadyDeliverable !== false) errors.push("Mock scans must not be client-ready deliverables.");
  if (scan?.dataMode === "mock" && scan?.reportReadiness !== "internalDemo") errors.push("Mock scans must use internalDemo readiness.");
  if (scan?.dataMode === "unavailable" && scan?.clientReadyDeliverable !== false) errors.push("Unavailable scans must not be client-ready deliverables.");
  if (!scan?.scoreExplainability || typeof scan.scoreExplainability !== "object") errors.push("scoreExplainability is required.");
  if (!scan?.minimumLiveDataPackage || typeof scan.minimumLiveDataPackage !== "object") errors.push("minimumLiveDataPackage is required.");
  if (!scan?.subScores || typeof scan.subScores !== "object") errors.push("subScores object is required.");
  for (const key of [
    "slopeTerrainRisk",
    "elevationVariabilityRisk",
    "drainageWaterProximityRisk",
    "infrastructureAccessIndicator",
    "landUseContextIndicator",
    "floodContextIndicator",
    "dataAvailabilityConfidence",
    "intendedUsePreliminarySuitability",
  ]) {
    const item = scan?.subScores?.[key];
    if (!item) {
      errors.push(`${key} sub-score is required.`);
      continue;
    }
    for (const field of [
      "scoreId",
      "scoreName",
      "rawInputs",
      "formula",
      "thresholds",
      "normalizedScore",
      "weight",
      "weightedContribution",
      "confidence",
      "providerSources",
      "calculationSteps",
      "explanationShort",
      "explanationDetailed",
      "limitations",
      "recommendedVerification",
    ]) {
      if (item[field] === undefined) errors.push(`${key}.${field} is required.`);
    }
    if (!Number.isFinite(item.score) || item.score < 0 || item.score > 100) errors.push(`${key} score must be 0-100.`);
    if (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) errors.push(`${key} confidence must be 0-1.`);
    if (!Array.isArray(item.providerSources)) errors.push(`${key} providerSources must be an array.`);
    if (!Array.isArray(item.limitations)) errors.push(`${key} limitations must be an array.`);
  }
  for (const source of scan?.dataSources || []) {
    for (const field of [
      "id",
      "adapter",
      "providerName",
      "sourceType",
      "dataMode",
      "regionCoverage",
      "confidence",
      "limitations",
      "citation",
      "attribution",
    ]) {
      if (source[field] === undefined) errors.push(`dataSources.${source.id || "unknown"}.${field} is required.`);
    }
  }
  if (!String(scan?.disclaimer || "").includes("preliminary site intelligence")) {
    errors.push("Safety disclaimer must position the report as preliminary site intelligence.");
  }
  return { valid: errors.length === 0, errors };
};
