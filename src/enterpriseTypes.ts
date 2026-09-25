// Types for the enterprise decision-intelligence surface: portfolio ranking,
// the capacity envelope, the grounded site assistant and the scenario model.
// These mirror the backend contracts in backend/portfolio and backend/land.

export type RankingFactorId =
  | "slopeTerrainRisk"
  | "elevationVariabilityRisk"
  | "drainageWaterProximityRisk"
  | "floodContextIndicator"
  | "infrastructureAccessIndicator"
  | "landUseContextIndicator"
  | "dataAvailabilityConfidence";

export type WeightingProfileId =
  | "residential"
  | "office"
  | "retail"
  | "warehouse"
  | "industrial"
  | "balanced";

export type WeightingProfile = {
  id: WeightingProfileId;
  label: string;
  rationale: string;
  weights: Record<string, number>;
  customised?: boolean;
};

export type RankedFactor = {
  factorId: RankingFactorId;
  label: string;
  meaning: string;
  available: boolean;
  riskScore: number | null;
  confidence: number;
  profileWeight: number;
  appliedWeight: number;
  contribution: number;
  formula: string | null;
  rawInputs: Record<string, unknown>;
  providerSources: string[];
  unavailableReason: string | null;
};

export type RankedSite = {
  scanId: string;
  label: string;
  location: { lat: number; lng: number; address: string; radiusMeters: number } | null;
  intendedUse: string | null;
  dataMode: string;
  reportReadiness: string;
  confidence: number;
  baselineRiskScore: number | null;
  weightedRiskScore: number | null;
  opportunityScore: number | null;
  evidencePenalty: number;
  coverage: {
    factorsAvailable: number;
    factorsTotal: number;
    weightCoverage: number;
    missingFactors: string[];
  };
  factors: RankedFactor[];
  redFlags: string[];
  rankable: boolean;
  rank?: number;
  gapToLeader?: number;
  whyNotLeader?: string[];
  nextAction?: string;
};

export type PortfolioRanking = {
  generatedAt: string;
  profile: WeightingProfile;
  factors: Array<{ id: RankingFactorId; label: string; direction: string; meaning: string }>;
  ranked: RankedSite[];
  unrankable: RankedSite[];
  portfolioSummary: {
    siteCount: number;
    rankableCount: number;
    leaderScanId: string | null;
    leaderLabel: string | null;
    leaderOpportunityScore: number | null;
    spread: number;
    meanWeightCoverage: number;
    evidenceWarning: string;
    sitesBlockedFromClientReport: number;
  };
  methodology: {
    steps: string[];
    formulas: Record<string, string>;
    limitations: string[];
  };
};

export type ExecutiveSummary = {
  opportunity: { headline: string; detail: string; rankedCount: number };
  risk: {
    headline: string;
    items: Array<{ site: string; factor: string; score: number }>;
    detail: string;
  };
  feasibility: { headline: string; detail: string };
  confidence: {
    headline: string;
    detail: string;
    blockedFromClientReport: number;
    warning: string;
  };
  nextAction: {
    headline: string;
    queue: Array<{ site: string; rank: number; action: string }>;
  };
  disclaimer: string;
};

export type Portfolio = {
  id: string;
  userId?: string;
  name: string;
  description: string;
  profileId: WeightingProfileId;
  weightOverrides: Record<string, number>;
  scanIds: string[];
  createdAt: string | null;
  updatedAt?: string;
};

export type PortfolioView = {
  portfolio: Portfolio;
  ranking: PortfolioRanking;
  inaccessibleScans: Array<{ scanId: string; reason: string }>;
  availableProfiles: WeightingProfile[];
  executiveSummary: ExecutiveSummary;
};

export type PlanningInputs = {
  floorAreaRatio: number | "";
  groundCoveragePercent: number | "";
  carpetEfficiencyPercent: number | "";
  averageUnitAreaSqm: number | "";
  siteAreaSqmOverride?: number | "";
};

export type CapacityEnvelope = {
  available: boolean;
  blockers: string[];
  measurement: {
    basis: "measured" | "declared" | "unavailable";
    siteAreaSqm: number | null;
    siteAreaHectares: number | null;
    siteAreaAcres: number | null;
    siteAreaSqft: number | null;
    boundaryPointCount: number;
    perimeterMeters: number | null;
    method: string;
  };
  planningInputs: Record<string, number | null>;
  terrainAllowance: { factor: number; notes: string[]; formula: string };
  derived: {
    permittedBuiltUpSqm: number;
    permittedBuiltUpSqft: number;
    terrainAdjustedBuiltUpSqm: number;
    terrainAdjustedBuiltUpSqft: number;
    saleableSqm: number;
    saleableSqft: number;
    footprintSqm: number | null;
    indicativeFloors: number | null;
    indicativeUnits: number | null;
  } | null;
  formulas?: Record<string, string>;
  provenance: {
    measured: string[];
    declared: string[];
    derived: string[];
    notHeld: string[];
  };
  disclaimer: string;
};

export type SiteQaAnswer = {
  answer: string;
  model: string;
  generatedAt: string;
  groundedOn: Array<{
    scanId: string;
    label: string;
    dataMode: string;
    confidence: number;
    unavailableIndicators: string[];
  }>;
  guarantees: string[];
};

export type ValueModelInputs = {
  sitesEvaluatedPerYear: number;
  averageSiteValueCr: number;
  acquisitionsPerYear: number;
  screeningHoursPerSiteToday: number;
  screeningHoursPerSiteWithPlatform: number;
  blendedAnalystCostPerHour: number;
  probabilityOfCostlyConstraintPerAcquisition: number;
  costOfLateConstraintDiscoveryPercent: number;
  probabilityPlatformSurfacesConstraintEarly: number;
  weeksSavedPerAcquisition: number;
  costOfCapitalPercent: number;
};

export type ValueScenario = {
  generatedAt: string;
  inputs: ValueModelInputs;
  levers: Array<{
    id: string;
    label: string;
    valueCr: number;
    formula: string;
    workings: string;
    confidence: string;
    evidenceNeeded: string;
  }>;
  totalIllustrativeAnnualValueCr: number;
  perSiteIllustrativeValueRupees: number;
  analystHoursReleased: number;
  label: string;
  disclaimers: string[];
  validationPlan: string[];
};

export type PilotRequestInput = {
  organisation: string;
  contactName: string;
  contactEmail: string;
  role: string;
  useCase: string;
  message: string;
};
