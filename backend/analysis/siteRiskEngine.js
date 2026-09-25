import { getGeoProviderSnapshot } from "../geodata/providers.js";
import { generateGeminiSiteAnalysis } from "../ai/geminiProvider.js";

const disclaimer =
  "This tool provides preliminary screening and decision-support only. It does not replace professional geotechnical investigation, boreholes, SPT/CPT, soil laboratory testing, structural design, legal due diligence, or review by qualified civil/geotechnical engineers. Results must not be used as the sole basis for construction, land purchase, safety, financial, or engineering decisions.";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const level = (risk) => (risk >= 84 ? "critical" : risk >= 68 ? "high" : risk >= 42 ? "moderate" : "low");
const providerConfidence = (providers) => {
  const statuses = Object.values(providers.providerStatus || {});
  const values = statuses.map((status) => {
    if (status === "live") return 88;
    if (status === "cached") return 64;
    if (status === "fallback" || status === "configured") return 38;
    return 18;
  });
  const liveCount = statuses.filter((status) => status === "live").length;
  const weakCount = statuses.filter((status) => ["cached", "fallback", "configured"].includes(status)).length;
  const average = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
  if (liveCount === 0) return Math.min(average, 70);
  if (weakCount > statuses.length / 2) return Math.min(average, 85);
  return clamp(average, 0, 95);
};

export const buildSiteAnalysis = async (site) => {
  const providers = await getGeoProviderSnapshot(site);
  const incomingScreening = site.siteScreening ?? null;
  const floors = Number(site.floors || 0);
  const loadBoost = String(site.loadCategory || "").toLowerCase().includes("heavy") ? 10 : 0;
  const seismicRisk = clamp(Math.round(18 + providers.seismic.largestMagnitude * 8 + floors * 0.8), 6, 96);
  const overallRiskScore = clamp(
    Math.round(
      providers.elevation.slopeRisk * 0.15 +
        providers.water.drainageFloodProxy * 0.14 +
        providers.water.waterProximityRisk * 0.1 +
        providers.soil.soilUncertaintyRisk * 0.22 +
        providers.soil.looseSoilOrFillProxy * 0.14 +
        seismicRisk * 0.15 +
        loadBoost,
    ),
    5,
    98,
  );
  const dataConfidence = providerConfidence(providers);

  const aiAnalysis = {
    ...(await generateGeminiSiteAnalysis({
      activeSite: site,
      siteScreening: incomingScreening ?? { overallRiskScore, overallCautionLevel: level(overallRiskScore) },
      providerSnapshot: providers,
    })),
    disclaimer,
  };
  const clientReviews = aiAnalysis.clientReviews;

  return {
    providerResults: providers,
    riskScores: {
      overallRiskScore,
      overallCautionLevel: level(overallRiskScore),
      profitRiskScore: clamp(Math.round(overallRiskScore * 0.78 + loadBoost), 6, 95),
      landPurchaseRisk: clamp(Math.round(overallRiskScore * 0.82 + providers.soil.soilUncertaintyRisk * 0.08), 8, 96),
      terrainAndSlope: providers.elevation.slopeRisk,
      drainageAndFloodProxy: providers.water.drainageFloodProxy,
      waterProximity: providers.water.waterProximityRisk,
      soilUncertainty: providers.soil.soilUncertaintyRisk,
      looseSoilOrFillProxy: providers.soil.looseSoilOrFillProxy,
      seismicContext: seismicRisk,
      dataConfidence,
    },
    aiAnalysis,
    clientReviews,
    aiError: null,
  };
};
