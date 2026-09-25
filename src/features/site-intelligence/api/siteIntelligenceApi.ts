import type { SiteScreeningResult } from "../../../types";
import type { ProviderRegistryStatus, ProviderStatus } from "../types/siteIntelligence";

type BackendRiskScores = Partial<{
  overallRiskScore: number;
  overallCautionLevel: string;
  profitRiskScore: number;
  landPurchaseRisk: number;
  constructionRiskScore: number;
  terrainAndSlope: number;
  drainageAndFloodProxy: number;
  waterProximity: number;
  soilUncertainty: number;
  looseSoilOrFillProxy: number;
  seismicContext: number;
  dataConfidence: number;
}>;

type BackendProviderResults = {
  providerStatus?: Partial<Record<string, ProviderStatus>>;
};

export type BackendSiteAnalysisResponse = {
  aiAnalysis?: Partial<SiteScreeningResult["aiAnalysis"]> & { model?: string };
  clientReviews?: Partial<SiteScreeningResult["clientReviews"]>;
  providerResults?: BackendProviderResults;
  riskScores?: BackendRiskScores;
};

const providerKeys: Array<keyof ProviderRegistryStatus> = [
  "elevation",
  "soil",
  "seismic",
  "water",
  "landCover",
  "rainfall",
  "groundwater",
  "legalPlanning",
  "infrastructure",
  "news",
  "ai",
];

export const normalizeProviderStatus = (status: ProviderStatus | undefined): ProviderStatus => {
  if (status === "live" || status === "cached" || status === "fallback" || status === "unavailable") return status;
  if (status === "configured") return "fallback";
  return "unavailable";
};

export const normalizeProviderRegistry = (
  current: SiteScreeningResult["providerStatus"],
  incoming?: Partial<Record<string, ProviderStatus>>,
): SiteScreeningResult["providerStatus"] => {
  const next = { ...current };
  for (const key of providerKeys) {
    next[key] = normalizeProviderStatus(incoming?.[key] ?? current[key]);
  }
  return next;
};

export const providerStatusLabel = (status: ProviderStatus) => {
  if (status === "live") return "Live";
  if (status === "cached") return "Modelled";
  if (status === "configured") return "Fallback";
  if (status === "fallback") return "Fallback";
  return "Unavailable";
};

export const mergeBackendSiteAnalysis = (
  current: SiteScreeningResult,
  response: BackendSiteAnalysisResponse,
): SiteScreeningResult => {
  const providerStatus = normalizeProviderRegistry(current.providerStatus, response.providerResults?.providerStatus);
  const aiMode = response.aiAnalysis?.mode ?? current.aiAnalysis.mode;
  const aiStatus: ProviderStatus = aiMode === "live" ? "live" : providerStatus.ai;
  const nextProviderStatus = { ...providerStatus, ai: normalizeProviderStatus(aiStatus) };

  const incomingAi = response.aiAnalysis
    ? {
        ...response.aiAnalysis,
        executiveSummary: current.aiAnalysis.executiveSummary,
        landBuyerInterpretation: current.aiAnalysis.landBuyerInterpretation,
        engineeringInterpretation: current.aiAnalysis.engineeringInterpretation,
        constructionSuitabilityOpinion: current.aiAnalysis.constructionSuitabilityOpinion,
        seismicCaution: current.aiAnalysis.seismicCaution,
        soilAndFoundationConcerns: current.aiAnalysis.soilAndFoundationConcerns,
        drainageAndWaterConcerns: current.aiAnalysis.drainageAndWaterConcerns,
      }
    : null;

  return {
    ...current,
    providerStatus: nextProviderStatus,
    clientReviews: response.clientReviews
      ? {
          builder: response.clientReviews.builder ?? current.clientReviews.builder,
          engineer: response.clientReviews.engineer ?? current.clientReviews.engineer,
          purchaser: response.clientReviews.purchaser ?? current.clientReviews.purchaser,
        }
      : current.clientReviews,
    aiAnalysis: incomingAi
      ? {
          ...current.aiAnalysis,
          ...incomingAi,
          mode: incomingAi.mode ?? current.aiAnalysis.mode,
          disclaimer: incomingAi.disclaimer ?? current.aiAnalysis.disclaimer,
          recommendedInvestigations:
            incomingAi.recommendedInvestigations ?? current.aiAnalysis.recommendedInvestigations,
          businessRiskNotes: incomingAi.businessRiskNotes ?? current.aiAnalysis.businessRiskNotes,
          limitations: incomingAi.limitations ?? current.aiAnalysis.limitations,
        }
      : current.aiAnalysis,
  };
};
