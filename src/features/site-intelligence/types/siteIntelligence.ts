export type CoordinateFormat =
  | "decimal"
  | "labeled-decimal"
  | "cardinal-decimal"
  | "dms"
  | "unknown";

export type ParsedCoordinate = {
  latitude: number;
  longitude: number;
  originalInput: string;
  normalizedInput: string;
  format: CoordinateFormat;
};

export type CoordinateParseFailure = {
  ok: false;
  error: string;
  examples: string[];
};

export type CoordinateParseSuccess = {
  ok: true;
  coordinate: ParsedCoordinate;
};

export type CoordinateParseResult = CoordinateParseSuccess | CoordinateParseFailure;

export type ProviderStatus = "live" | "cached" | "fallback" | "unavailable" | "configured";



export type ProviderRegistryStatus = Record<
  | "elevation"
  | "soil"
  | "seismic"
  | "water"
  | "landCover"
  | "rainfall"
  | "groundwater"
  | "legalPlanning"
  | "infrastructure"
  | "news"
  | "ai",
  ProviderStatus
> &
  Record<string, ProviderStatus>;

export type RiskAudience = "buyer" | "builder" | "engineer";

export type RiskLayerId =
  | "terrainSlopeRisk"
  | "elevationRisk"
  | "drainageWaterloggingRisk"
  | "waterbodyProximityRisk"
  | "groundwaterDewateringRisk"
  | "soilUncertaintyRisk"
  | "seismicCodeRisk"
  | "landCoverChangeRisk"
  | "urbanDevelopmentRisk"
  | "legalTitlePlanningRisk"
  | "infrastructureAccessRisk"
  | "dataQualityPenalty";

export type SiteLayerId = RiskLayerId | "buildability";

export type RiskLayerAssessment = {
  id: RiskLayerId;
  label: string;
  value: number | null;
  confidence: number;
  provider: string;
  source: string;
  status: ProviderStatus;
  generatedAt: string;
  explanation: string;
  limitation: string;
  recommendedAction: string;
  critical: boolean;
  weight: {
    buyer: number;
    builder: number;
    engineer: number;
  };
};

export type HistoricalImageryPlaceholder = {
  supported: false;
  timelineYears: number[];
  plannedSignals: Array<"NDVI" | "NDWI" | "impervious_surface" | "waterbody_change" | "construction_expansion">;
  limitation: string;
};

export type SiteQualityLabel =
  | "Live provider screening"
  | "Model-assisted screening"
  | "Mixed provider screening"
  | "Fallback-heavy screening"
  | "Demo-quality estimate only";

export type PlotAreaUnit = "sqm" | "sqyd";

export type SiteFormState = {
  projectName: string;
  clientName: string;
  companyName: string;
  userRole: string;
  coordinateInput: string;
  latitude: string;
  longitude: string;
  radiusMeters: string;
  intendedUse: string;
  constructionType: string;
  buildingType: string;
  floors: string;
  approximatePlotArea: string;
  plotAreaUnit: PlotAreaUnit;
  loadCategory: string;
  purchaseStage: string;
  reportAudience: string;
};
