export type UserRole = "user" | "admin";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  company: string;
  role: UserRole;
  plan: string;
  createdAt: string;
};

export type IntendedUse =
  | "residential"
  | "commercial"
  | "warehouse"
  | "industrial"
  | "farmland"
  | "infrastructure"
  | "mixed use"
  | "unknown/general feasibility";

export type ReportDepth = "quick" | "standard" | "professional";
export type DataMode = "mock" | "live" | "mixed" | "unavailable";
export type ReportReadiness =
  | "internalDemo"
  | "unavailable"
  | "clientPreview"
  | "clientDeliverableEligible";

export type BoundaryPoint = {
  lat: number;
  lng: number;
};

export type ScanInput = {
  address: string;
  coordinateInput: string;
  latitude: number | "";
  longitude: number | "";
  radiusMeters: number;
  boundary: BoundaryPoint[];
  intendedUse: IntendedUse;
  reportDepth: ReportDepth;
  scanMode?: "internalDemo" | "live" | "mixed";
};

export type SubScore = {
  id: string;
  scoreId: string;
  scoreName: string;
  available?: boolean;
  score: number;
  normalizedScore: number;
  weight: number;
  weightedContribution: number;
  confidence: number;
  rawInputs: Record<string, unknown>;
  inputs: Record<string, unknown>;
  formula: string;
  thresholds: Record<string, unknown>;
  explanation: string;
  explanationShort: string;
  explanationDetailed: string;
  calculation: string;
  dataSource: string;
  provider?: string;
  providerSources: string[];
  calculationSteps: string[];
  limitations: string[] | string;
  recommendedVerification: string[];
  explainability?: string;
};

export type ExplainableLandScan = {
  scanId: string;
  userId: string | null;
  status: "draft" | "running" | "completed" | "failed";
  createdAt: string;
  dataMode: DataMode;
  mockDataNotice: string;
  deliverableStatus: ReportReadiness;
  reportReadiness: ReportReadiness;
  reportLabel: string;
  clientReadyDeliverable: boolean;
  externalUseBlockedReason: string;
  location: {
    lat: number;
    lng: number;
    address: string;
    radiusMeters: number;
    boundary: BoundaryPoint[];
    coordinateInput: string;
    coordinateFormat: string;
  };
  intendedUse: IntendedUse;
  reportDepth: ReportDepth;
  overallRiskScore: number;
  overallSuitabilityScore: number;
  confidence: number;
  riskBands: {
    label: "Low" | "Moderate" | "High" | "Unknown";
    description: string;
  };
  subScores: Record<string, SubScore>;
  scoreExplainability: Record<
    string,
    {
      formula: string;
      rawInputs: Record<string, unknown>;
      normalizedScore: number;
      weight: number;
      weightedContribution?: number;
      confidence: number;
      sourceProvider: string;
      limitation: string;
      calculationSteps?: string[];
      finalScoreEffect: number;
      explanation: string;
      available?: boolean;
    }
  >;
  redFlags: string[];
  positiveIndicators: string[];
  recommendedNextSteps: string[];
  lowConfidenceWarnings: string[];
  dataAvailabilitySummary: {
    dataMode: DataMode;
    score: number;
    providerAvailabilityScore: number;
    warning: string;
    minimumLiveDataPackage?: ExplainableLandScan["minimumLiveDataPackage"];
  };
  dataSources: Array<{
    id: string;
    adapter: string;
    providerName: string;
    source: string;
    status: string;
    dataMode: DataMode;
    sourceType: "authoritative" | "open-data" | "computed" | "commercial-api" | "mock";
    sourceReliability: string;
    regionCoverage?: string;
    coverage: string;
    confidence: number;
    limitations: string;
    citation?: string;
    citationUrl: string;
    attribution?: string;
    errors?: string[];
    scoringEligible?: boolean;
    generatedAt: string;
  }>;
  minimumLiveDataPackage?: {
    satisfied: boolean;
    hasRealElevationOrTerrainProvider: boolean;
    hasRealMapInfrastructureContextProvider: boolean;
    noMockProviderUsedInScore: boolean;
    missing: string[];
  };
  unavailableScores?: string[];
  sourceTable?: ExplainableLandScan["dataSources"];
  limitationsTable?: Array<{
    providerId: string;
    providerName: string;
    dataMode: string;
    limitations: string;
    errors: string[];
  }>;
  rawLayers: Record<string, unknown>;
  providerOutputs: Record<string, unknown>;
  aiStatus?: "completed" | "failed" | "not_configured";
  aiAnalysis?: ProfessionalReport["aiAnalysis"];
  disclaimer: string;
};

export type ProfessionalReport = {
  mode: "deterministic" | "gemini" | "rule-based" | "live";
  generatedAt: string;
  executiveSummary: string;
  aiAnalysis?: {
    aiStatus?: "completed" | "failed" | "not_configured";
    aiProvider?: string;
    provider?: string;
    aiModel?: string;
    model?: string;
    executiveSummary: string;
    detailedScoreReasoning?: string;
    intendedUseSuitabilityExplanation?: string;
    riskInterpretation: string;
    dataQualityAssessment?: string;
    scoreReasoning?: {
      overallRisk: string;
      overallConfidence: string;
      missingDataImpact: string;
    };
    subscoreMeanings?: Record<string, string>;
    subScoreAnalysis?: Array<{
      scoreId: string;
      plainEnglishExplanation: string;
      technicalExplanation: string;
      whyItMatters: string;
      confidenceCommentary: string;
      recommendedVerification: string[];
    }>;
    confidenceExplanation?: string;
    recommendedCertifiedFollowUpChecks?: string[];
    professionalVerificationChecklist?: string[];
    clientFriendlyExplanation?: string;
    clientFriendlySummary?: string;
    intendedUseAssessment?: string;
    redFlagsExplained?: string[];
    positiveIndicatorsExplained?: string[];
    limitations: string[];
    cannotConclude?: string[];
    recommendedNextSteps?: string[];
    disclaimer?: string;
    aiSafetyFallback?: boolean;
  };
  sections: Array<{ title: string; body: string }>;
  narrative: string;
};

export type LandScanSummary = {
  id: string;
  status: "draft" | "running" | "completed" | "failed";
  createdAt: string;
  location: ExplainableLandScan["location"];
  intendedUse: IntendedUse;
  reportDepth: ReportDepth;
  overallRiskScore: number;
  overallSuitabilityScore: number;
  confidence: number;
  dataMode: DataMode;
  deliverableStatus: ReportReadiness;
  reportReadiness: ReportReadiness;
  reportLabel: string;
  clientReadyDeliverable: boolean;
  mockDataNotice: string;
  riskBand: "Low" | "Moderate" | "High" | "Unknown";
  redFlagCount: number;
  reportAvailable: boolean;
};

export type LandScanDetail = LandScanSummary & {
  scan: ExplainableLandScan;
  report: ProfessionalReport;
};

export type SampleReportSummary = {
  id: string;
  title: string;
  market: string;
  demo: boolean;
  overallRiskScore: number;
  riskBand: "Low" | "Moderate" | "High";
  confidence: number;
  dataMode: DataMode;
  deliverableStatus: ReportReadiness;
  reportReadiness: ReportReadiness;
  reportLabel: string;
};
