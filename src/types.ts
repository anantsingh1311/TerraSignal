import type { LucideIcon } from "lucide-react";
import type {
  CoordinateFormat,
  HistoricalImageryPlaceholder,
  ProviderRegistryStatus,
  ProviderStatus,
  RiskLayerAssessment,
  RiskLayerId,
  SiteLayerId,
  SiteQualityLabel,
} from "./features/site-intelligence/types/siteIntelligence";

export type TabId = "globe" | "overview" | "report" | "saved" | "intake" | "interpretation" | "settings";

export type CoordinateMode = "local_xy" | "lat_lon";

export type GlobeLayer =
  | SiteLayerId
  | "elevation"
  | "drainageWaterlogging"
  | "waterbodyProximity"
  | "landCoverChange"
  | "urbanDevelopment"
  | "legalPlanning"
  | "infrastructureAccess"
  | "groundwaterDewatering"
  | "terrain"
  | "drainage"
  | "soil"
  | "water"
  | "seismic"
  | "buildability"
  | "risk"
  | "resistivity"
  | "velocity"
  | "magnetic"
  | "noise"
  | "depth"
  | "confidence"
  | "residuals";

export type ActiveSite = {
  id: string;
  projectName: string;
  clientName: string;
  companyName: string;
  userRole: string;
  latitude: number;
  longitude: number;
  coordinateInputOriginal: string;
  coordinateFormat: CoordinateFormat;
  radiusMeters: number;
  intendedUse: string;
  constructionType: string;
  buildingType: string;
  floors: number;
  approximatePlotArea: number | null;
  plotAreaUnit: "sqm" | "sqyd" | null;
  loadCategory: string;
  purchaseStage: string;
  reportAudience: string;
  createdAt: string;
};

export type SiteScreeningResult = {
  overallPreScreenScore: number;
  buildabilityCautionLevel: "Low" | "Moderate" | "High" | "Critical" | "Unknown";
  overallRiskScore: number;
  constructionRiskScore: number;
  landPurchaseRiskScore: number;
  developmentProfitRiskIndicator: number;
  dataQualityPenalty: number;
  dataQualityLabel: SiteQualityLabel;
  fallbackLayerCount: number;
  criticalFallbackCount: number;
  profitRiskScore: number;
  landPurchaseRisk: number;
  terrainSlopeRisk: number;
  drainageWaterloggingRisk: number;
  groundwaterDewateringRisk: number;
  seismicCodeRisk: number;
  landCoverChangeRisk: number;
  legalTitlePlanningRisk: number;
  infrastructureAccessRisk: number;
  urbanDevelopmentRisk: number;
  slopeRisk: number;
  drainageRisk: number;
  waterProximityRisk: number;
  soilUncertaintyRisk: number;
  looseSoilOrFillProxy: number;
  seismicRisk: number;
  vegetationWetnessProxy: number;
  erosionRisk: number;
  landCoverContext: string;
  dataConfidence: number;
  providerStatus: ProviderRegistryStatus;
  layerAssessments: Record<RiskLayerId, RiskLayerAssessment>;
  historicalImagery: HistoricalImageryPlaceholder;
  seismicContext: {
    providerMode: ProviderStatus;
    recentEventsCount: number;
    largestMagnitude: number;
    nearestEventDistanceKm: number;
    recentActivitySummary: string;
    cautionLevel: "low" | "moderate" | "high" | "critical" | "unknown";
    recommendation: string;
    limitations: string[];
  };
  constructionSuitability: {
    potentiallySuitableUses: string[];
    cautionUses: string[];
    notRecommendedWithoutDetailedInvestigation: string[];
    explanation: string;
  };
  aiAnalysis: {
    executiveSummary: string;
    siteContext: string;
    landBuyerInterpretation: string;
    engineeringInterpretation: string;
    constructionSuitabilityOpinion: string;
    seismicCaution: string;
    soilAndFoundationConcerns: string;
    drainageAndWaterConcerns: string;
    recommendedInvestigations: string[];
    businessRiskNotes: string[];
    limitations: string[];
    disclaimer: string;
    mode: "live" | "rule-based";
  };
  clientReviews: {
    builder: string[];
    engineer: string[];
    purchaser: string[];
  };
  buyerWarnings: string[];
  engineerNotes: string[];
  recommendedNextSteps: string[];
  limitations: string[];
};

export type SurveyMethod = "ERT" | "SRT" | "MASW" | "MAG";

export type ProjectStage =
  | "Feasibility"
  | "Pre-bid"
  | "Borehole planning"
  | "Remediation review";

export type SurveyPoint = {
  id: string;
  x: number;
  y: number;
  lat?: number;
  lon?: number;
  coordinateMode?: CoordinateMode;
  depth: number;
  resistivity: number;
  velocity: number;
  magnetic: number;
  noise: number;
  source: "sample" | "upload";
};

export type ParseWarning = {
  row: number;
  field?: keyof Omit<SurveyPoint, "source">;
  message: string;
};

export type ParseSurveyResult = {
  points: SurveyPoint[];
  warnings: ParseWarning[];
  delimiter: "comma" | "tab" | "semicolon" | "whitespace";
  coordinateMode: CoordinateMode | null;
};

export type BuilderProject = {
  id: string;
  name: string;
  client: string;
  location: string;
  coordinates: string;
  latitude: number;
  longitude: number;
  siteRadiusMeters: number;
  description: string;
  surveyObjective: string;
  riskContext: string;
  visualizationPreset: "urban" | "corridor" | "slope" | "industrial" | "coastal";
  stage: ProjectStage;
  areaHa: number;
  target: string;
  due: string;
  budget: string;
  methods: SurveyMethod[];
  constraints: string[];
  points: SurveyPoint[];
};

export type PublicLayer = {
  id: string;
  label: string;
  provider: string;
  signal: string;
  status: "Matched" | "Benchmark" | "Reference";
  url: string;
};

export type InterpretationSettings = {
  noiseSuppression: number;
  physicsWeight: number;
  anomalyThreshold: number;
  focus: SurveyMethod | "HYBRID";
};

export type AnomalyClass =
  | "Water or clay-rich zone"
  | "Weathered or low-stiffness zone"
  | "Buried utility or magnetic body"
  | "Bedrock interface"
  | "Mixed subsurface contrast";

export type RiskLevel = "HIGH" | "MEDIUM" | "LOW";

export type AnalyzedPoint = SurveyPoint & {
  lat: number;
  lon: number;
  coordinateMode: CoordinateMode;
  anomalyScore: number;
  riskScore: number;
  confidence: number;
  className: AnomalyClass;
  riskLevel: RiskLevel;
  action: string;
  recommendedAction: string;
  physicsResidual: number;
  residual: number;
  signalLift: number;
  reason: string;
  explanation: string;
};

export type AnomalyCluster = {
  id: string;
  label: string;
  className: AnomalyClass;
  riskLevel: RiskLevel;
  count: number;
  averageAnomalyScore: number;
  averageConfidence: number;
  averagePhysicsResidual: number;
  recommendedAction: string;
};

export type AnalysisSummary = {
  flagged: AnalyzedPoint[];
  priorityFindings: AnalyzedPoint[];
  clusters: AnomalyCluster[];
  top: AnalyzedPoint | null;
  meanConfidence: number;
  meanResidual: number;
  highRisk: number;
  boreholesSaved: number | null;
  planningImpactSupported: boolean;
};

export type SourceLink = {
  label: string;
  url: string;
};

export type TabItem = {
  id: TabId;
  label: string;
  icon: LucideIcon;
};
